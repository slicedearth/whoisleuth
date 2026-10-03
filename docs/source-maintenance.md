# Retained source maintenance

The website and CLI ship reviewed projections, not continuously updated feeds.
Dependency updates do not refresh those projections.

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

The weekly **Source and registry drift audit** runs the same checks and retains
reports for seven days when review is needed. It does not open pull requests,
change pins or publish data. Ordinary pull-request checks stay fixture-based.
For `sources:drift`, exit 0 means compared sources match, 1 means drift/review is
due, and 2 means at least one comparison is inconclusive. Inspect individual
rows: an unavailable source is not an empty catalogue.

The source check covers SSLBL, KEV, browser-library advisories, selected shared
infrastructure lists, both official Cloudflare range lists, the latest Unicode
confusables release and RDAP extensions. Unrelated changes elsewhere in an
upstream repository do not require a new pin.

## Refresh

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

Cloudflare's publisher date can remain old while its complete ranges are
unchanged. The range owner verifies both official lists and records a separate,
digest-bound observation; it does not relabel publication time. Mismatch,
malformed data or an unavailable list prevents renewal. Its existing 30-day
review window remains separate from data changes.

A newer Unicode source is a review candidate, not an automatic upgrade. Retain
prior supported mappings, review new characters and run the labelled calibration
and candidate-volume checks before adopting its versioned projection.
