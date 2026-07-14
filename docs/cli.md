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
node bin/whoisleuth.js posture example.com --selectors selector1,selector2 --json
node bin/whoisleuth.js http example.com --json
node bin/whoisleuth.js tls example.com --json
node bin/whoisleuth.js lookup example.com --deep --json > lookup.json
node bin/whoisleuth.js compare lookup.json --json
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
| 3 | The requested lookup, collection, or comparison operation could not run. |
| 4 | A bulk command completed with one or more per-query failures. |
| 70 | Unexpected CLI bootstrap failure. |

This release supports `lookup`, `bulk`, `ct-search`, `discover`, `posture`,
`http`, `tls`, and `compare`. Export commands are added as separate bounded
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

## Domain posture audit

`posture` runs the same owned-domain DNS and email-security audit used by Brand
Profiles. It queries SPF, DMARC, MX, CAA, MTA-STS, TLS-RPT, BIMI, and RDAP
DNSSEC state directly from the local machine. Supply up to ten known DKIM
selectors with `--selectors selector1,selector2`; selectors cannot be reliably
discovered from DNS, so no-selector output reports DKIM as not checked.

Terminal output shows each pass, review, action, or informational result and
caps displayed records at five per check with an explicit omission notice.
Versioned JSON retains the complete bounded report. Warnings and dangers are
findings rather than command failures; transient resolver or policy-fetch
failures remain informational and should be retried before changing DNS.

## HTTP intelligence

`http` runs the same bounded safe homepage probe used by a deep lookup. It
tries HTTPS before HTTP, follows only validated public-network redirects, caps
each attempt at six seconds, and captures at most 300,000 response bytes for
hashing and metadata. A non-success HTTP response still proves that a web
service answered; failure of both schemes remains inconclusive rather than
evidence that no website exists.

The command reports normalized redirect, response, content, selected security-
header, body-hash, completeness, and attempt provenance. Captured homepage text
is never written to terminal or JSON output. Query strings are removed by the
shared HTTP evidence normalizer, and terminal values are additionally bounded
and control-safe.

## TLS intelligence

`tls` runs the same bounded one-connection TLS collector used by deep lookups.
It resolves the hostname once through the public-address guard, validates every
answer, connects directly to the first validated address on port 443, and keeps
the original hostname for SNI and certificate identity checking. Resolution
and handshake work share a five-second deadline.

The report retains the negotiated protocol, ALPN and cipher, runtime trust and
hostname checks, certificate validity, bounded subject and issuer names, SANs,
SHA-256 certificate and public-key fingerprints, a bounded certificate chain,
and neutral findings. It stores no certificate bytes, session material, or
application data and does not enumerate supported protocol or cipher suites.
A failed collection is inconclusive rather than proof that no TLS service
exists.

## Registry-source comparison

`compare` reads one version-1 `whoisleuth.cli.lookup` domain document from a
file or stdin and reconciles its normalized registry RDAP and WHOIS fields. It
does not repeat the lookup, contact the hosted deployment, or treat a conflict
as a command failure. Use a deep lookup when both sources are wanted; a fast
lookup deliberately records WHOIS as skipped, and comparison preserves that
state as unavailable rather than misreporting RDAP-only publication.

Input is capped at 8 MiB and must retain the lookup schema, mode, source
diagnostics, and normalized parsed source sections. Per-value, list, and event
bounds are revalidated because saved JSON is treated as untrusted input. Raw
RDAP JSON, WHOIS response bodies, availability evidence, and unrelated lookup
fields are not copied into the comparison result.

Terminal and versioned JSON output cover domain identity, registry object ID,
registrar, registrar IANA ID, lifecycle dates, DNSSEC, statuses, and name
servers. The shared comparison model normalizes harmless case, punctuation,
ordering, and date-precision differences while distinguishing conflicts,
one-source publication, redaction, incomplete sources, and unavailable
sources. This is source reconciliation, not an availability, ownership, or
maliciousness decision.
