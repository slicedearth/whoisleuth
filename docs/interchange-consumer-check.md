# Optional offline consumer exercise

This optional maintainer check parses, validates and reserialises reserved
synthetic exports with separate STIX and MISP consumer implementations. It uses
the ordinary defensive indicator, managed indicator and Case sighting export
owners, then sends the returned documents through the existing Case importer.
It does not contact a remote service or establish universal interoperability.

Use an explicitly approved disposable Python environment with these reviewed
versions: `stix2==3.0.2`, `stix2-validator==3.3.1`, and `pymisp==2.5.34.4`. Keep
that environment and its resolved installation record outside the repository;
this check does not install dependencies or change the application package.

```sh
node test/interchange-consumer-harness.mts --python /path/to/approved-environment/bin/python
node --test test/interchange-consumer-check.test.mts
```

To also check the official MISP 2.5 schema, supply an unchanged local copy of
[`format/2.5/schema.json` at `63d46c54ccccd646fa352ee74d218f618ccce75b`](https://github.com/MISP/MISP/blob/63d46c54ccccd646fa352ee74d218f618ccce75b/format/2.5/schema.json):

```sh
node test/interchange-consumer-harness.mts --python /path/to/approved-environment/bin/python --misp-schema /path/to/schema.json
```

The pinned file is 13,979 bytes, Git blob
`ac7a5108519b015007a8716b72a05ac5afd63978`, SHA-256
`ecd424a612aa46a884422eaa2e0ffa63f6972b9133ce0b9ad6085430221bc287`.
Its source repository carries AGPL-3.0; the schema is used as an external
verification input, not copied into the repository or an application package.
The command does not download it. Exact digest matching precedes parsing, and
only local schema references are admitted. Official validation of the original
and reserialised documents is reported separately from PyMISP's bundled schemas.

The explicit tool command is the optional native-consumer integration exercise,
including rejection controls, immutable originals and real Case normalisation.
The ordinary unit command is hermetic: it does not load Python packages, inspect
a private environment variable or conditionally skip a test. Its Case projection
test uses the same helper with first-party synthetic export values.

The process accepts at most 16 fixture documents and 2 MiB of input, returns at
most 4 MiB, and has a 30-second deadline. Its socket operations and DNS resolution
are refused inside the subprocess. A refusal control runs without making a
connection; actual consumer calls must attempt zero network operations. Library
logs and exception text are discarded. Failure messages do not echo payloads,
environment values or local paths. Input and output are transient, and originals
are kept unchanged alongside the reserialised values during comparison.

## What is checked

The 15 fixtures comprise 13 positive documents and two malformed controls.
They cover known and unknown source clocks, Case sightings, markings, and
managed-indicator new, renewed, locally expired and deliberately withdrawn
states in both interchange formats. Local expiry is not silently converted
into revocation or deletion. The check independently compares stable source
identifiers, clock instants, markings, withdrawal, organisation-only MISP
distribution, unpublished/non-IDS status and disabled correlation. Export
fixtures also contain private-field canaries before projection, which must not
appear in the exported documents.

The returned supported claims pass through the existing importer and real Case
normaliser. Malformed patterns and non-boolean flags must be rejected. Separate
tests reject weakened privacy flags, invalid domain values, changed source
identities/clocks and loss of withdrawal. This is a synthetic software exercise,
not a first-use or contributor session with human participants.

## Explicit limits and observed normalisation

- The reviewed validator wheel omits its STIX schema resources. Only its
  default missing-resource lookup is routed to the existing pinned official
  STIX 2.1 schema corpus. The consumer's validation algorithm remains separate,
  but the schema evidence is shared, not independently sourced. The corpus
  revision and full-tree SHA-256 are checked and reported. Required constraints
  must pass; recommendation warnings remain visible as counts, including custom
  property and synthetic observable identifier recommendations.
- Native STIX reserialisation may shorten redundant UTC fractional precision
  and omit optional `revoked: false`, whose STIX default is false. The check
  preserves exact clock instants and true revocation; it never supplies a clock
  where the original had none.
- PyMISP's bundled lax import schema and native parser accept these exports.
  Its strict bundled attribute schema rejects the source `first_seen` and
  `last_seen` fields as additional properties. That strict-schema rejection is
  reported separately, not presented as a pass and not worked around by
  deleting valid source clocks. Numeric timestamp/distribution strings may
  become numbers during reserialisation. No remote MISP server acceptance is
  claimed.
- With the pinned official schema, each attribute's `first_seen` and `last_seen`
  is compared independently by UUID. An additional synthetic document has
  unequal first/last instants and an attribute with neither clock. Six controls
  deliberately remove, change or add one field in a returned copy; reordering
  attributes must leave comparisons unchanged. These controls do not edit
  application exports or discard timestamps to obtain validation acceptance.
  The report records schema results and comparison outcomes, not live-server
  acceptance.
- Case import intentionally retains supported, attributed entity claims. It
  does not retain full descriptions, note bodies, comments, complete relationship
  history, operational validity/revocation state, IDS/correlation flags, or the
  managed review-expiry basis. Deleted MISP attributes are excluded, not treated
  as evidence removal. Keep the original documents for these semantics and
  restrictions; a successful claim projection is not a lossless interchange
  round trip or permission to distribute the source.

## Measured official-schema experiment

The 5 October 2026 offline run with the versions above accepted all six original
MISP export fixtures and their six reserialised documents under the pinned
official schema; PyMISP lax accepted all six while its bundled strict schema
rejected all six. The additional unequal-clock document also passed official
and lax validation while failing bundled strict validation. Across the seven
documents, all 14 present fields preserved their instants and all 14 absent
fields stayed absent. The six deliberate comparison mutations were detected,
and UUID-based comparison survived attribute reordering. These are measured
synthetic results; no server was contacted and application exports were unchanged.
