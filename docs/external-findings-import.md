# External findings and intelligence import

The Cases view can import a deliberately small JSON document containing findings
collected outside WHOISleuth. The import is local-only and inert: WHOISleuth
validates and previews the complete document before it can add evidence pins to
browser-local cases.

The same control accepts bounded STIX 2.1 bundles and MISP event JSON. These
formats follow a stricter merge path: supported claims can be added only to an
existing case selected by the analyst. They become separately labelled case
assertions rather than collected evidence, and the importer never creates a
case, starts a lookup, enriches an entity, changes a score, publishes an event,
or enables MISP correlation or IDS use.

An imported finding is not treated as evidence collected by the current
WHOISleuth session. Its source class, observation time, completeness, and
limitations remain attached to a separately labelled evidence pin. WHOISleuth does not independently verify the finding,
change the case's analyst status or disposition, fetch a reference, execute
content, contact a provider, or submit a report.

## Version 2 schema

```json
{
  "schema": "whoisleuth.external-findings",
  "schemaVersion": 2,
  "source": {
    "name": "Local analyst export",
    "reference": "offline review",
    "collectedAt": "2026-07-28T01:00:00.000Z"
  },
  "findings": [
    {
      "domain": "review-target.invalid",
      "category": "page",
      "evidenceClass": "provider_report",
      "summary": "A credential form was reported in a retained external observation.",
      "observedAt": "2026-07-28T00:45:00.000Z",
      "completeness": "partial",
      "limitations": [
        "Rendered behavior was not retained."
      ],
      "reference": "finding-17"
    }
  ]
}
```

The root object accepts only `schema`, `schemaVersion`, `source`, and
`findings`. The source accepts only:

- `name`: required text, at most 80 characters;
- `reference`: optional text, at most 500 characters;
- `collectedAt`: optional date and time.

Each finding accepts only:

- `domain`: a required canonicalisable domain;
- `category`: `certificate`, `dns`, `http`, `malware`, `other`, `page`,
  `registration`, or `reputation`;
- `evidenceClass`: `deployment_observation` when the named source made the
  observation itself, or `provider_report` when the source reported it from a
  separate dataset;
- `summary`: required text, at most 900 characters;
- `observedAt`: a required date and time;
- `completeness`: `complete`, `inconclusive`, `partial`, or `unknown`;
- `limitations`: up to eight text entries of at most 240 characters each;
- `reference`: optional text, at most 500 characters.

Additional properties, unsupported categories or completeness states, invalid
domains or dates, control characters, empty findings, and future schema
versions reject the whole document.

Version 1 remains readable and normalises to version 2. Because version 1 did
not distinguish provenance classes, its findings become `provider_report`
rather than being upgraded to first-party observations. Analyst hypotheses and
conclusions do not belong in this findings schema; use the separate case
assertion workflow so claims never become observed evidence.

## Documented observation-row converters

Three neutral version-1 row formats can be converted locally into the strict
findings schema. Each root uses `schemaVersion: 1`, an optional bounded
`source.name`, and an `observations` array:

| Schema | Required row fields | Result |
| --- | --- | --- |
| `whoisleuth.domain-observation-rows` | `domain`, `source`, `status`, `observedAt` | Registration-category finding |
| `whoisleuth.dns-observation-rows` | `domain`, supported `type`, `value`, `observedAt` | DNS-category finding |
| `whoisleuth.certificate-observation-rows` | `domain`, 64-character `fingerprintSha256`, `observedAt` | Certificate-category finding |

Rows can additionally supply a supported `completeness` state and a bounded
`reference`. Certificate rows can include a bounded issuer and `notAfter`
timestamp. Supported DNS types are A, AAAA, CAA, CNAME, DS, MX, NS, SOA, SVCB,
HTTPS, and TXT. Conversion inspects at most 400 rows, retains at most 100
strict findings, and reports accepted, rejected, duplicate, and truncated
counts before import. Exclusions identify only the row number and a fixed
reason, not rejected values. The converter does not autodetect arbitrary
third-party files, fetch records, or treat imported values as independently
verified observations.

## Sanitised capture artefact manifest

`whoisleuth.web-capture-manifest` versions 1 and 2 import reviewed metadata for a
sanitised screenshot and optional DOM digest without importing either
artefact's bytes. Each capture declares a domain, capture time, completeness,
optional page title and final HTTP(S) origin, up to 30 request domains, up to 20
technology labels, limitations, and one or two artefact metadata records.

A screenshot record contains a plain file name, PNG, JPEG, or WebP MIME type,
SHA-256 digest, declared byte size up to 10 MiB, and dimensions up to
10,000 by 10,000. Version 2 can additionally carry one 16-character screenshot
perceptual dHash produced by the optional local capture package. A DOM-digest record contains a plain file name,
`application/json` MIME type, SHA-256 digest, and declared byte size up to
1 MiB. The importer does not read or verify referenced files. It rejects
embedded bytes, archive or decompression fields, path separators, parent-path
names, URL credentials, paths, queries, fragments, duplicate artefact kinds,
unsupported MIME types, and arbitrary fields. The resulting case finding says
that the metadata was imported and unverified.

## Portable WARC and WACZ response evidence

The Cases importer accepts a strict uncompressed `.warc` file as a separate
local-only path. It parses at most 8 MiB, 100 records, and 1 MiB per record,
then retains at most 25 supported HTML response findings. Request records,
cookie or authorisation material, downloads, compressed response bodies,
non-HTML content, invalid or credentialed target URLs, excessive HTML, and
mismatched supported record digests are excluded. The importer never executes
page content or makes a request.

For each retained response, the importer keeps only the normalised domain,
HTTP(S) origin, bounded title, response status, WARC observation time,
completeness, fixed limitations, and whole-archive SHA-256 digest. Supported
SHA-1 and SHA-256 `WARC-Block-Digest` values are checked locally. A missing or
unsupported record digest leaves the finding partial; a mismatched supported
digest excludes the response. Paths, queries, fragments, headers, request
bodies, response bodies, and archive bytes are not retained.

The same control accepts a bounded `.wacz` package conforming to the supported
WACZ 1.x data-package structure. The package is processed locally and is never
replayed. WHOISleuth requires a root `datapackage.json`, one to eight declared
`.warc` or `.warc.gz` resources under `archive/`, safe unique ZIP paths,
supported ZIP compression, declared byte lengths, and SHA-256 resource
digests. If `datapackage-digest.json` is present, its SHA-256 digest must match
the manifest. The optional absence of that file is retained as a limitation.
Selected ZIP entries, aggregate decompressed WARC bytes, gzip expansion, entry
count, manifest size, and declared package bytes are bounded before the
existing WARC privacy filter runs. Indexes, page lists, screenshots, custom
files, and descriptive package fields are not imported.

## Bounds and merge behaviour

- Maximum JSON or CSV file size: 384 KiB.
- Maximum WARC or WACZ file size: 8 MiB.
- Maximum WACZ ZIP entries: 128, including ignored entries.
- Maximum selected WACZ WARC resources: 8.
- Maximum aggregate expanded WARC bytes from a WACZ: 8 MiB.
- Maximum findings: 100.
- Maximum distinct domains: 25.
- Maximum findings per domain: 20.
- A preview shows at most the first eight validated findings.

Applying a validated preview creates a missing case or adds evidence pins to an
existing one in a single browser-storage update. Existing status, disposition,
notes, assertions, decisions, actions, and evidence remain intact. Reimporting
the same normalised finding from the same named source skips the duplicate.
Normal case-storage limits still apply, including bounded evidence history and
quota-aware pruning.

Imported summaries, references, and limitations become browser-local case data.
They are therefore included in deliberate case or workspace exports. Avoid
including raw provider payloads, expanded registration contacts, credentials,
tokens, or unnecessary URL paths and query strings.

## STIX 2.1 and MISP preview

The local file is limited to 512 KiB, 500 STIX objects or MISP attributes, a
maximum nesting depth of 12, and 8,000 traversed JSON nodes. At most 100
normalised claims are retained in a preview. The preview reports accepted
claims, exact duplicates, conflicting external identifiers, unsupported or
malformed exclusions, and whether a bound truncated the result before an
analyst can select an existing case and merge.

The supported entity subset is:

- STIX `domain-name`, `url`, `ipv4-addr`, `ipv6-addr`,
  `autonomous-system`, and `x509-certificate` objects;
- simple exact-match STIX Indicators for those same entity types;
- MISP `domain`, `hostname`, `url`, `ip-src`, `ip-dst`, `AS`, and
  `x509-fingerprint-sha256` attributes.

Complex STIX patterns, unsupported object and attribute types, deleted MISP
attributes, malformed entity values, and STIX objects outside version 2.1 are
not reinterpreted. Unsupported values are not copied into the exclusions list.

For every merged assertion, WHOISleuth stores the normalised entity, source-file
SHA-256 digest, format, source name, publisher when declared, external
identifier, external timestamps, confidence when declared, labels, and
markings. The source digest identifies the exact local file used for the
review; it is not a signature or proof that the publisher created the file.
Repeated merges from the same normalised source claim are idempotent.

Imported claims use the `unknown` assertion class because the file is an
external assertion, not a WHOISleuth observation or an analyst-verified fact.
Open the owning case to review provenance and decide whether later independent
collection supports, contradicts, or leaves the claim unresolved.
