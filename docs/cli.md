# WHOISleuth CLI

The first-party command-line interface runs the same local classification and
lookup modules as the Express and serverless adapters. It does not call the
hosted WHOISleuth deployment.

## Current command

```bash
node bin/whoisleuth.js lookup example.com
node bin/whoisleuth.js lookup AS13335 --json
printf 'example.com\n' | node bin/whoisleuth.js lookup --json
node bin/whoisleuth.js lookup example.com --deep
cat domains.txt | node bin/whoisleuth.js bulk --jsonl
node bin/whoisleuth.js bulk domains.txt --concurrency 4
node bin/whoisleuth.js ct-search 'example brand' --json
node bin/whoisleuth.js discover example.com --preset common --jsonl
```

These examples run from a checked-out repository. The package exposes a
`whoisleuth` binary for local linking or installation from source, but the
package is not currently published to the public npm registry; do not assume
that an unqualified `npx whoisleuth` resolves to this repository.

Lookup defaults to the conservative fast profile. `--deep` must be requested
explicitly and can make the additional bounded WHOIS, DNS, website, and TLS
requests used by a deep web lookup.

Only one query is accepted by `lookup`. Multiple-input processing belongs to
the explicit `bulk` command rather than being silently inferred by `lookup`.
Standard input is capped at 4 KiB and must contain one non-empty line.

## Output

Human-readable terminal output is the default. `--json` writes one versioned
document to standard output:

```json
{
  "schema": "whoisleuth.cli.lookup",
  "version": 1,
  "generatedAt": "2026-07-14T00:00:00.000Z",
  "mode": "fast",
  "query": "example.com",
  "type": "domain"
}
```

The complete document also carries the normalized `rdap`, `whois`,
`availability`, and `diagnostics` sections returned by the shared lookup
orchestrator. Machine output goes to stdout. Usage and lookup errors go to
stderr, so redirected JSON is not mixed with diagnostics.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed. Individual sources may still be partial or inconclusive; inspect diagnostics. |
| 2 | Invalid command, option, input, or stdin shape. |
| 3 | The unified lookup could not run. |
| 4 | A bulk command completed with one or more per-query failures. |
| 70 | Unexpected CLI bootstrap failure. |

This release supports `lookup`, `bulk`, `ct-search`, and `discover`. Posture,
HTTP, TLS, comparison, and export commands are added as separate bounded
increments rather than exposing incomplete aliases.

## Bulk lookup

`bulk` accepts a newline-delimited file or stdin. It preserves input order,
removes case-insensitive duplicates, and returns a result for every retained
query. Input is capped at 1 MiB. Fast mode is capped at 500 queries with four
workers by default. Deep mode is capped at 50 queries with two workers by
default. Explicit concurrency cannot exceed eight in fast mode or three in
deep mode.

Bulk uses the shared compact lookup response, so it does not retain raw RDAP
objects or WHOIS response bodies. `--json` returns one bounded collection;
`--jsonl` emits one self-contained versioned item per line. A mixture of
successful and failed queries exits with code 4 while preserving every result.

## Certificate Transparency search

`ct-search` accepts one keyword as an argument or on stdin and calls the same
bounded Certificate Transparency module as the web application. It contacts
the upstream public log search service directly from the local machine; it
does not call the hosted WHOISleuth deployment. Quote a multi-word keyword so
the shell passes it as one argument.

Terminal output summarizes certificate rows, observed hostnames, canonical
registrable-domain matches, observation times, and completeness. It shows at
most 100 matches and five hostnames per match, with explicit omission notes.
`--json` returns the complete bounded structured result in the versioned
`whoisleuth.cli.ct-search` schema. CT observations do not prove that a website
is active or malicious.

## Lookalike discovery

`discover` runs the same pure, bounded lookalike generator as the Discover
workspace without making network requests. It accepts a brand label or a
domain with one suffix label. The default TLD set is `com,net,org`; replace it
with `--tlds com,net` when narrower coverage is wanted.

Generation presets are `common`, `impersonation`, and `all` (the default).
Keyboard-aware mutations support `qwerty` (the default), `azerty`, and
`qwertz`. Terminal output is capped at 200 candidates with an explicit notice;
versioned JSON and JSONL retain the complete bounded candidate set and mutation
provenance. The command generates candidates only—it does not claim that a
domain is registered, active, or malicious.
