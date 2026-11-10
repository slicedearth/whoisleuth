# Retained source maintenance

The website and CLI ship reviewed fallback projections. An opted-in deployment
can refresh certificate and known-exploited vulnerability data independently of
the application release. Dependency updates do not refresh these projections.

## Check

```bash
npm run sources:health
npm run sources:drift -- --live --json
npm run registry:drift -- --json
npm run registrar:standing:check -- --json
npm run registry:fixtures -- --json
```

`sources:health` reads local assets only. The three live source/registry checks
make bounded requests to fixed public source endpoints; they do not collect
investigation targets or write files. `registry:fixtures` checks local fixture
identity and review dates.

The weekly **Source and registry drift audit** notes verified routine certificate
and known-exploited catalogue updates in the job summary without failing that
job. It compares the bundled data, not the deployment. Removals, rollback,
inconsistent provenance, overdue publisher data and unavailable sources still
require attention. Missing or malformed reports cannot pass the audit, even if
the check commands exit successfully. Review reports are retained for seven
days. The job does not open pull requests, change pins or publish data.
Ordinary pull-request checks stay fixture-based.
For `sources:drift`, exit 0 means compared sources match, 1 means drift/review is
due, and 2 means at least one comparison is inconclusive. Inspect individual
rows: an unavailable source is not an empty catalogue.

The source check covers SSLBL, KEV, browser-library advisories, selected shared
infrastructure lists, both official Cloudflare range lists, the latest Unicode
confusables release and RDAP extensions. Unrelated changes elsewhere in an
upstream repository do not require a new pin.

To check and prepare routine certificate and KEV updates in one pass, use
`npm run sources:drift -- --live --json --prepare-dir=/tmp/new-source-review`.
It creates a new directory and prepares candidates from the exact response
already checked, with separate digest receipts. It does not refetch, activate
or overwrite data. The usual drift exit codes still apply.

## Refresh a data edition without a build

First deploy a version with this feature and opt in using
`RETAINED_SOURCE_EDITIONS=1` in the production functions environment. This is
a one-time deployment change. Previews, local servers and default installations
do not read the store. Subsequent data and control changes do not require a
build, CLI release, separate service or public endpoint.

The production scheduled function runs daily at 03:17 UTC. It uses one fixed
publisher URL each for certificate and known-exploited data when configured for
automatic updates. Missing or held controls do not contact publishers. Failed
downloads, older or malformed editions and removals leave the last accepted
data in place. A repeated check cannot renew provenance. An ageing certificate
edition can be renewed only by a genuinely newer publisher timestamp.
The worker logs the outcome, known digest and check time; check time is not a
source timestamp. Wait at least five minutes between certificate downloads,
including manual downloads and reruns.

Prepare reviewed files without writing into the checkout:

```bash
npm run sources:prepare -- sslbl /tmp/certificate-edition.json /tmp/certificate-feed.csv
npm run sources:prepare -- kev /tmp/kev-edition.json /tmp/known-exploited.json
npm run sources:prepare -- registrar /tmp/registrar-edition.json /tmp/registrars.csv /tmp/notices.html '<observed-at-ISO>'
npm run sources:prepare -- infrastructure /tmp/infrastructure-edition.json --upstream '<reviewed-full-revision>'
```

Only `--upstream` makes requests, to check the pinned public range sources and
the official edge ranges. Infrastructure also accepts a reviewed snapshot JSON
instead. The tool does not overwrite files. Review the data and record the
printed `sha256:…` receipt separately. The digest identifies exact reviewed
bytes; it is not a publisher signature.

### Hosted controls

On the intended authenticated site, use the existing [Blob CLI commands](https://cli.netlify.com/commands/blobs/)
or hosting UI. Source IDs are `sslbl`, `kev` and `registrar`. Inspect
`state/<source>` first: `from` is its `current.digest`, or null if no edition is
active. Stage a candidate before writing a promotion control:

```bash
netlify blobs:set retained-source-editions-v1 candidate/registrar --input /tmp/registrar-edition.json
netlify blobs:set retained-source-editions-v1 control/registrar --input /tmp/registrar-control.json
```

| Version 1 control JSON | Effect |
| --- | --- |
| `{"version":1,"action":"automatic"}` | Check the certificate or KEV publisher on the next scheduled run. |
| `{"version":1,"action":"hold"}` | Pause refreshes; keep the active edition. |
| `{"version":1,"action":"promote","from":null,"digest":"sha256:…"}` | Activate a current candidate. Replace null with the active digest on later promotions. |
| `{"version":1,"action":"rollback","from":"sha256:…","digest":"sha256:…"}` | Restore the retained previous digest. Set `from` to null if bundled data is active. |
| `{"version":1,"action":"bundled","from":"sha256:…"}` | Return to bundled data; keep the active edition for rollback. |

Use full receipt digests. Do not write `state/` or `attempt/` keys manually.
Wait for each operation to finish before changing its control. The worker
rechecks the instruction and conditionally writes state. Read the outcome and
active digest back: uploading is not activation. Storage is limited to one
candidate and two activated editions per source. Keep reviewed copies separately
if longer rollback history is required.

Authenticated production Deep domain Lookups use fixed public edition keys.
Each worker caches the result for up to ten minutes. A brief transport outage
may reuse the last verified edition for up to one hour without changing its
dates; absent or invalid state uses the bundled fallback. Warm workers can
revalidate an unchanged edition without downloading it again when the store
confirms its strong version identifier. This does not renew the source dates.
Fast, Compact, Bulk, monitoring and IP/ASN lookups do not read this store.
Publisher and store requests do not include targets or investigation data. A
stale miss does not establish absence.

Use one local certificate, KEV or registrar file with
`whoisleuth lookup example.test --deep --source-edition FILE --source-digest sha256:…`.
It verifies locally before collection and adds no requests. In the browser,
**Use a reviewed infrastructure edition** applies a verified local file to
the current campaign cohort review only. It does not alter saved Cases,
exported cluster reviews or the bundled range catalogue.

## Refresh bundled fallback data or reviewed logic

1. Download the exact source outside the checkout. Record its public URL,
   revision, publication date, observation time and SHA-256. Check redistribution
   terms and review additions, removals and unexpected count changes.
2. Update the source's existing owner below. Regenerate outputs through that
   owner; do not hand-edit generated projections or historical fixtures.
3. Run the owner's check mode and affected tests. Review the complete diff and
   locally assembled CLI when shared runtime data changes. Runtime requests,
   evidence authority and stored-format support must remain unchanged.

| Source | Owner / refresh command |
| --- | --- |
| SSLBL | `npm run sslbl:snapshot -- --input=/path/to/sslblacklist.csv`; repeat with `--check-only` |
| KEV | Pins in `tools/cisa-kev-catalog.mts`; `npm run catalog:kev -- --source /path/to/feed.json --write`, then `--check` |
| Browser-library advisories | Pins in `tools/retire-browser-catalog.mts`; `npm run catalog:retire -- --source /path/to/jsrepository.json --write`, then `--check`; expression qualification is mandatory |
| Infrastructure ranges | `npm run common-infrastructure:update -- --commit <reviewed-full-revision>`; then `npm run common-infrastructure:check` |
| Unicode | Source policy in `lib/idn-confusable-policy.mts`; [projection and calibration](idn-confusables.md) |
| Registrars and notices | `npm run registrar:standing:update -- --iana-source /path/to/registrars.csv --icann-source /path/to/notices.html --observed-at <ISO-timestamp>`; then `npm run registrar:standing:check` |
| Root zone, RDAP bootstrap and extensions | [Registry data contract](registry-data-contract.md); refresh the reviewed baseline and capability projections together |

RDAP capability interpretation lives in `lib/rdap-capabilities.mts`. Saved
Lookup evidence retains its review date and selects the corresponding semantic
catalogue epoch; future or unsupported review dates are rejected. A date-only
review updates the current review date, without copying a catalogue. A genuine
interpretation change adds an immutable epoch by extending the previous table.
Keep epochs required by supported saved-artefact versions, and verify historical
readers without regenerating their fixtures.

Cloudflare's publisher date can remain old while its complete ranges are
unchanged. The range owner verifies both official lists and records a separate,
digest-bound observation; it does not relabel publication time. Mismatch,
malformed data or an unavailable list prevents renewal. Its existing 30-day
review window remains separate from data changes.

A newer Unicode source is a review candidate, not an automatic upgrade. Retain
prior supported mappings, review new characters and run the labelled calibration
and candidate-volume checks before adopting its versioned projection.
