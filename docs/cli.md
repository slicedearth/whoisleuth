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
```

These examples run from a checked-out repository. The package exposes a
`whoisleuth` binary for local linking or installation from source, but the
package is not currently published to the public npm registry; do not assume
that an unqualified `npx whoisleuth` resolves to this repository.

Lookup defaults to the conservative fast profile. `--deep` must be requested
explicitly and can make the additional bounded WHOIS, DNS, website, and TLS
requests used by a deep web lookup.

Only one query is accepted by this command. Multiple-input processing belongs
to the later `bulk` command rather than being silently inferred by `lookup`.
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
| 70 | Unexpected CLI bootstrap failure. |

This initial increment intentionally supports only `lookup`. Bulk, discovery,
posture, HTTP, TLS, comparison, and export commands will be added as separate
bounded increments rather than exposing incomplete aliases.
