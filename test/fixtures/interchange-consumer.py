"""Optional bounded offline consumer test adapter; no remote client is created."""
import contextlib
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import socket
import sys

MAX_INPUT_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_DOCUMENTS = 16
network_refusals = 0


class OfflineNetworkDenied(RuntimeError):
    pass


def deny_network(*args, **kwargs):
    global network_refusals
    network_refusals += 1
    raise OfflineNetworkDenied("Consumer verification is offline.")


def audit(event, args):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.gethostbyname",
                 "socket.gethostbyaddr", "socket.sendto"):
        deny_network()


sys.addaudithook(audit)
socket.create_connection = deny_network
socket.getaddrinfo = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.socket.sendto = deny_network


def schema_checks(document, schema):
    from jsonschema import Draft4Validator
    errors = list(Draft4Validator(schema).iter_errors(document))
    # Paths and keywords only: never echo imported values, private prose or paths.
    return {"valid": not errors, "errors": [
        {"path": [str(part) for part in error.absolute_path][:12],
         "keyword": error.validator} for error in errors[:20]
    ], "errorCount": len(errors)}


def consume(document, official_schema=None):
    if document["format"] == "stix":
        import stix2
        import stix2validator.validator as validator
        from stix2validator import ValidationOptions, validate_string
        # The reviewed wheel omits its bundled schema tree. Route only that
        # default corpus lookup to the existing pinned official resources.
        # Validation algorithms remain the consumer's, not a replacement.
        if not getattr(validator.find_schema, "local_corpus", False):
            original = validator.find_schema
            missing = Path(validator.__file__).parent / "schemas-2.1" / "schemas"
            corpus = Path(__file__).resolve().parents[2] / "fixtures/stix/oasis-stix-2.1-json-schemas/schemas"
            def local_schema(directory, name):
                selected = corpus if not missing.is_dir() and Path(directory) == missing else directory
                return original(str(selected), name)
            local_schema.local_corpus = True
            validator.find_schema = local_schema
        resources_absent = not (Path(validator.__file__).parent / "schemas-2.1" / "schemas").is_dir()
        content = json.dumps(document["value"], ensure_ascii=False)
        parsed = stix2.parse(content, allow_custom=True)
        returned = json.loads(parsed.serialize())
        checked = validate_string(content, ValidationOptions(version="2.1", silent=True, strict=False))
        results = checked if isinstance(checked, list) else [checked]
        return {"id": document["id"], "value": returned,
                "valid": all(result.is_valid for result in results),
                "errors": sum(len(result.errors or []) for result in results),
                "warnings": sum(len(result.warnings or []) for result in results),
                "sharedSchemaCorpus": resources_absent,
                "consumerWheelResourcesAbsent": resources_absent,
                "validation": "STIX 2.1 required constraints; recommendations reported"}
    if document["format"] == "misp":
        import pymisp
        directory = Path(pymisp.__file__).parent / "data"
        lax = schema_checks(document["value"], json.loads((directory / "schema-lax.json").read_text()))
        strict = schema_checks(document["value"], json.loads((directory / "schema.json").read_text()))
        event = pymisp.MISPEvent(force_timestamps=True)
        # The consumer is allowed to normalise its input; validation and
        # comparison must still cover the immutable original input document.
        event.load(json.dumps(document["value"], ensure_ascii=False))
        returned = json.loads(event.to_json())
        if "Event" not in returned:
            returned = {"Event": returned}
        return {"id": document["id"], "value": returned, "valid": lax["valid"],
                "errors": lax["errorCount"], "warnings": 0,
                "validation": "PyMISP bundled lax import schema; strict schema reported separately",
                "strict": strict, "lax": lax, "schemaErrors": lax["errors"],
                **({"official": {"original": schema_checks(document["value"], official_schema),
                                 "reserialised": schema_checks(returned, official_schema)}}
                   if official_schema is not None else {})}
    raise ValueError("Unsupported consumer format.")


def main():
    global network_refusals
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Consumer input exceeds its byte limit.")
    request = json.loads(raw)
    if set(request) not in ({"version", "documents"}, {"version", "documents", "mispSchema"}) or request["version"] != 1:
        raise ValueError("Unsupported consumer request.")
    official_schema = None
    official_digest = None
    if "mispSchema" in request:
        selected = request["mispSchema"]
        if set(selected) != {"source", "sha256"} or not isinstance(selected["source"], str):
            raise ValueError("Invalid schema input.")
        schema_bytes = selected["source"].encode("utf-8")
        official_digest = hashlib.sha256(schema_bytes).hexdigest()
        if len(schema_bytes) > 64 * 1024 or official_digest != selected["sha256"]:
            raise ValueError("Schema identity mismatch.")
        official_schema = json.loads(selected["source"])
        pending = [official_schema]
        while pending:
            item = pending.pop()
            if isinstance(item, dict):
                if "$ref" in item and (not isinstance(item["$ref"], str) or not item["$ref"].startswith("#")):
                    raise ValueError("Only local schema references are permitted.")
                pending.extend(item.values())
            elif isinstance(item, list):
                pending.extend(item)
        from jsonschema import Draft4Validator
        Draft4Validator.check_schema(official_schema)
    documents = request["documents"]
    if not isinstance(documents, list) or not 1 <= len(documents) <= MAX_DOCUMENTS:
        raise ValueError("Consumer document count exceeds its limit.")
    try:
        socket.create_connection(("127.0.0.1", 1))
    except OfflineNetworkDenied:
        pass
    guard_passed = network_refusals == 1
    network_refusals = 0
    results = []
    # Libraries may log source strings. Discard their streams rather than
    # retaining unbounded logs or exposing them through a parent-process error.
    class Discard(io.TextIOBase):
        def write(self, value):
            return len(value)
    with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
        for document in documents:
            identifier = document.get("id")
            if not isinstance(identifier, str) or len(identifier) > 80 or not identifier.isascii():
                raise ValueError("Invalid consumer fixture identifier.")
            try:
                results.append(consume(document, official_schema))
            except Exception as error:
                results.append({"id": identifier, "valid": False, "errorType": type(error).__name__[:80]})
    response = {"version": 1, "versions": {name: importlib.metadata.version(name)
                for name in ("stix2", "stix2-validator", "pymisp")},
                "networkGuardPassed": guard_passed, "networkRefusals": network_refusals,
                "officialSchemaSha256": official_digest,
                "results": results}
    output = json.dumps(response, ensure_ascii=False).encode("utf-8")
    if len(output) > MAX_OUTPUT_BYTES:
        raise ValueError("Consumer output exceeds its byte limit.")
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No exception text, payload values, environment or local paths.
        sys.stderr.write("Offline consumer verification could not complete.\n")
        sys.exit(2)
