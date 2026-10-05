# Case portability contracts

This reference is generated from the canonical Case portability family in
`packages/contracts/case-portability.mts`. Run
`node tools/case-contract-doc.mts --write` to reproduce it. Runtime validators
remain statically imported; lifecycle module and export names are descriptive
metadata and are never executed dynamically.

## Supported versions

“Durable supported” is the public compatibility commitment. A
version is listed only when an exact reader or verifier and a matching frozen
fixture remain. Every writer emits only the version shown in “Current writer”.

| Contract | Canonical lifecycle schema | Durable supported | Readable | Current writer | Future version | Migration |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Browser-local Cases | `whoisleuth.browser.case-store` | 12, 13, 14, 15, 16, 17, 18, 19 | 12, 13, 14, 15, 16, 17, 18, 19 | 19 | `preserve_without_write` | `normalize_to_current` |
| Portable Case export | `whoisleuth.case-export` | 12, 13, 14, 15, 16, 17, 18, 19 | 12, 13, 14, 15, 16, 17, 18, 19 | 19 | `reject` | `normalize_to_current` |
| Case report | `whoisleuth.case-report` | 9, 10, 11, 12, 13, 14, 15 | 9, 10, 11, 12, 13, 14, 15 | 15 | `reject` | `read_only` |
| Case-response packet | `whoisleuth.case-response-packet` | 6, 7, 8, 9, 10, 11, 12, 13 | 6, 7, 8, 9, 10, 11, 12, 13 | 13 | `reject` | `read_only` |
| Review-input digest material | `whoisleuth.case-response-review-inputs` | 1, 2, 3, 4, 5, 6, 7 | 1, 2, 3, 4, 5, 6, 7 | 7 | `reject` | `read_only` |
| CLI Case-pack | `whoisleuth.cli.case-pack` | 2 | 2 | 2 | `reject` | `read_only` |
| Workspace archive | `whoisleuth.workspace-archive` | 5, 6, 7, 8, 9, 10 | 5, 6, 7, 8, 9, 10 | 10 | `reject` | `normalize_to_current` |
| Workspace settings section | `whoisleuth.workspace-settings` | 1 | 1 | 1 | `reject` | `exact_current_only` |
| Encrypted workspace archive | `whoisleuth.encrypted-workspace-archive` | 1 | 1 | 1 | `reject` | `exact_current_only` |

Browser-local Case reading and portable Case import accept only schema
12, 13, 14, 15, 16, 17, 18, 19. The current writers emit Case report
schema 15 and response-packet schema
13; the compatible output epochs are
listed above. Response-packet verification accepts schema
6, 7, 8, 9, 10, 11, 12, 13. Review-input digest material
accepts exact versions 1, 2, 3, 4, 5, 6, 7
and the current writer emits version 7.

## CLI Case/report epochs

The Case-pack verifier accepts every exact Case/report epoch listed below.

| Case versions | Matching report versions |
| ---: | ---: |
| 12 | 8 |
| 13 | 9 |
| 14 | 10 |
| 15 | 11 |
| 16 | 12 |
| 17 | 13 |
| 18 | 14 |
| 19 | 15 |

The durable CLI Case-pack envelope is version 2.
The durable workspace archive envelope supports versions 5, 6, 7, 8, 9 and 10;
its embedded Case section consumes the supported Case contract shown above.
The encrypted workspace envelope remains version 1
and authenticates an ordinary workspace document without changing either the
workspace or embedded Case version.

## Public compatibility boundary

The published format checkpoint is release 2.4.0. It emitted
Case schema 16, Case report schema 12, response-packet schema
10, review-input digest material version 4, and workspace
archive schema 9. The current writer emits
Case schema 19, report schema 15,
response-packet schema 13, review-input version 7, and workspace
archive schema 10.

Application patches do not create new format epochs. Release verification also
checks the actual preceding public tag's durable commitments against this checkout.

Both the latest public formats and the current writers directly preserve the
formats written by public release 1.47.4:
browser and portable Case schema 12, Case report schema 8, response-packet schema 6,
CLI Case-pack schema 2 with its Case 12/report 8 epoch, workspace archive schema
5, workspace settings schema 1, and encrypted workspace archive schema 1.
Case schemas 12, 13, 14, 15, 16, 17 and 18 migrate directly to schema
19; response packets
6, 7, 8, 9, 10, 11 and 12 verify alongside packet
13. Every declared CLI epoch remains
readable without passing through an unreleased checkpoint.

Older formats accepted only by historical readers and formats produced only by
unreleased local checkpoints are outside the v2 compatibility boundary.
Unsupported and future inputs fail explicitly and non-destructively; they are
never reinterpreted as current, partially imported, or silently imported as an
empty collection. Browser-local future data remains preserved without write,
and no import path automatically deletes stored data.

## Durable compatibility evidence

The lifecycle family binds 56 immutable current-format
fixtures to exact byte counts and SHA-256 identities. The canonical JSON
commitment is
`docs/case-supported-contract-baseline-v1.json`; it is derived from
lifecycle metadata and covers writers, readers, shapes, bounds, canonicalisation,
privacy projections, public facades, verifier dispatch, and rejection behaviour.
Its drift gate requires an explicit reviewed removal record, support window,
safe migration or export path, and updated fixtures and guidance before any
supported contract can disappear.

Malformed, oversized, ambiguous, unknown-key, and unsupported-future inputs
remain rejection cases. Browser-local future data is preserved by the storage
adapter without being rewritten; portable import and verifier paths reject
future versions. Every later release must preserve or migrate each contract in
the durable baseline.
