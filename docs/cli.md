# WHOISleuth CLI

The first-party command-line interface runs the same local classification and
lookup modules as the Express and serverless adapters. It does not call the
hosted WHOISleuth deployment.

## Commands

```bash
node bin/whoisleuth.mts lookup example.com
node bin/whoisleuth.mts lookup AS13335 --json
printf 'example.com\n' | node bin/whoisleuth.mts lookup --json
node bin/whoisleuth.mts lookup example.com --deep
cat domains.txt | node bin/whoisleuth.mts bulk --jsonl
node bin/whoisleuth.mts bulk domains.txt --concurrency 4
node bin/whoisleuth.mts ct-search 'example brand' --json
node bin/whoisleuth.mts discover example.com --preset common --jsonl
node bin/whoisleuth.mts posture example.com --selectors selector1,selector2 --json
node bin/whoisleuth.mts http example.com --json
node bin/whoisleuth.mts tls example.com --json
node bin/whoisleuth.mts registry-support example.uk --json
node bin/whoisleuth.mts risk-calibrate calibration.json --json
node bin/whoisleuth.mts lookup example.com --deep --json > lookup.json
node bin/whoisleuth.mts compare lookup.json --json
node bin/whoisleuth.mts export lookup.json > evidence.json
node bin/whoisleuth.mts export lookup.json --markdown > evidence.md
node bin/whoisleuth.mts export lookup.json --html > evidence.html
```

These examples run from a checked-out repository. The package exposes a
`whoisleuth` binary for local linking or installation from source, but the
package is not currently published to the public npm registry; do not assume
that an unqualified `npx whoisleuth` resolves to this repository.

The root package is distribution-scoped to the CLI: an npm archive contains
only the executable, its TypeScript CLI and shared runtime modules, this guide,
and the required package metadata and notices. The positive allowlist keeps the
archive boundary stable as the repository evolves. The self-hosted application
continues to run from a repository checkout through `npm start`; it is not
represented as an installable library entry point.

Lookup defaults to the conservative fast profile. `--deep` must be requested
explicitly and can add bounded WHOIS, DNS, website, TLS, registrar RDAP, and
observed-network IP RDAP work for a domain. The browser Console's optional
security.txt and external intelligence selections are not CLI flags; the CLI
does not run those actions implicitly.

Only one query is accepted by `lookup`. Multiple-input processing belongs to
the explicit `bulk` command rather than being silently inferred by `lookup`.
Standard input is capped at 4 KiB and must contain one non-empty line.

`registry-support` is an offline catalogue view. It accepts one domain, bare
suffix, or leading-dot suffix as an argument or on stdin and makes no network
request. Its output is described below.

## Deployment boundary

The CLI is a local repository tool. The serverless deployment publishes only
`frontend/build` and packages functions only from `netlify/functions`, so
`bin/` and `cli/` are not part of the hosted static site or function bundle.
The package also remains private and is not published to the public npm
registry.

Commands that query RDAP, WHOIS, DNS, HTTP, TLS, or Certificate Transparency do
so directly from the machine running the CLI. They do not use the hosted login,
hosted session, or deployment usage controls; upstream providers can see and
rate-limit the local machine's network address. Offline `discover`, `compare`,
`risk-calibrate`, and `export` operations make no network requests and write
their results only to local stdout unless the user redirects them to a file.

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

Human-readable domain lookup output separately shows the registrar RDAP status
and endpoint whenever the shared lookup diagnostics represent that follow-up.
Deep mode may report success, unsupported, not found, or an explicit failure;
fast mode reports the existing skipped state. IP, ASN, and lookup responses
without registrar diagnostics remain unchanged. These source states are
provenance only and do not decide availability or imply safety.

A deep domain lookup can also show the status, selected public address, and
registered network name from the bounded observed network context. It uses the
same address and IP RDAP source represented in the JSON document. This is
point-in-time edge or network-registration context, not proof of the origin
host, hosting control, ownership, intent, or maliciousness. Fast and compact
commands do not run the enrichment.

When diagnostics version 5, 6, or 7 reports a documented registry collection
constraint, terminal output also shows the suffix, WHOIS and RDAP access
profiles, and the bounded limitation. This is static access-policy context: it
does not make another request, and restricted, unpublished, or unavailable
machine access is not evidence that a domain is unregistered or safe.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed. Individual sources may still be partial or inconclusive; inspect diagnostics. |
| 2 | Invalid command, option, input, or stdin shape. |
| 3 | The requested lookup, collection, or comparison operation could not run. |
| 4 | A bulk command completed with one or more per-query failures. |
| 70 | Unexpected CLI bootstrap failure. |

This release supports `lookup`, `bulk`, `ct-search`, `discover`, `posture`,
`http`, `tls`, `registry-support`, `risk-calibrate`, `compare`, and `export`.
Additional export formats are added as separate bounded increments rather than
exposing incomplete aliases.

## Registry capability coverage

`registry-support` projects the embedded, versioned registry compatibility
catalogue for one domain or suffix. It distinguishes an explicit
fixture-backed or access-documented suffix profile from the generic IANA
discovery profile and reports the RDAP and WHOIS discovery/access paths,
WHOIS query and parser profiles, any bounded fallback, fixture scenarios,
verification references, documentation references, and the catalogue's
limitation. The same document includes a dated, official-source aggregate of
generic, generic-restricted, sponsored, and infrastructure RDAP coverage. That
snapshot is separate from the suffix profile and from live reachability.

Terminal output is bounded and control-safe. `--json` emits version 2 of the
`whoisleuth.cli.registry-support` schema. Unknown but syntactically valid
suffixes retain the generic `discovery_only` profile; malformed input exits
with code 2. The command never probes a registry or tests current reachability.
Coverage is context only and cannot decide registration, availability,
ownership, safety, or maliciousness.

## Offline Risk calibration

`risk-calibrate` replays a versioned analyst-labelled fixture dataset through
the exact Risk model shared with the web application. It does not perform a
lookup, contact the hosted deployment, persist the dataset, alter model weights,
choose a threshold, or tune the model automatically. The report compares fixed
thresholds from 40 through 90 and identifies 70 as the current review band.

Input is capped at 2 MiB and 500 records. Each record requires a unique bounded
ID, an ASCII DNS hostname, one existing analyst disposition, and a strict
whitelist of current scoring inputs. Unknown fields are discarded; arrays,
strings, ages, booleans, provider records, and external findings are revalidated
and bounded before scoring. The accepted dataset envelope is:

```json
{
  "schema": "whoisleuth.risk-calibration-dataset",
  "version": 1,
  "records": [
    {
      "id": "fixture-1",
      "domain": "login.example.test",
      "analystDisposition": "confirmed_abuse",
      "evidence": {
        "availability": "registered",
        "mutationTypes": ["dictionary"],
        "hasPasswordField": true
      }
    }
  ]
}
```

`confirmed_abuse` is treated as a positive calibration label; `false_positive`
and `expected` are negative labels. `unreviewed`, `suspicious`, and
`closed_no_action` remain contextual and are excluded from threshold quality
metrics, as are records for which Risk is not applicable. Terminal output caps
its record list at 100 while `--json` retains the complete bounded report,
factor breakdowns, score bands, and per-threshold confusion metrics. Analyst
dispositions and heuristic scores are review context: neither proves
maliciousness or safety.

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
tool without making network requests. It accepts a brand label or a
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
file or stdin and emits a version-3 `whoisleuth.cli.compare` document. Its
primary comparison reconciles normalized registry RDAP and WHOIS fields. When
the saved deep lookup also represents the optional registrar RDAP follow-up,
an additional sibling comparison reconciles the portable registry and
registrar RDAP publication fields. The command does not repeat the lookup,
contact the hosted deployment, or treat a conflict as a command failure. Use a
deep lookup when multiple sources are wanted; a fast lookup deliberately
records WHOIS as skipped, and comparison preserves that state as unavailable
rather than misreporting RDAP-only publication.

Input is capped at 8 MiB and must retain the lookup schema, mode, source
diagnostics, and normalized parsed source sections. Per-value, list, and event
bounds are revalidated because saved JSON is treated as untrusted input. A
successful registrar source must include a normalized object and agree with
its diagnostic status. Raw RDAP JSON, registrar contacts and source-specific
handles, WHOIS response bodies, availability evidence, and unrelated lookup
fields are not copied into the comparison result.

When the saved Lookup contains valid version-5, version-6, or version-7, context-only
registry-access diagnostics, version 3 retains their bounded suffix, access profiles, and
limitation. Terminal output labels the same collection context explicitly.
It explains source reachability only and cannot decide registration,
availability, ownership, safety, or maliciousness. Older documents and saved
lookups without that context do not gain a registry-access field.

Terminal and versioned JSON output cover domain identity, registry object ID,
registrar, registrar IANA ID, lifecycle dates, DNSSEC, statuses, and name
servers. The shared comparison model normalizes harmless case, punctuation,
ordering, and date-precision differences while distinguishing conflicts,
one-source publication, redaction, incomplete sources, and unavailable
sources. This is source reconciliation, not an availability, ownership, or
maliciousness decision.

## Lookup evidence export

`export` converts one version-1 `whoisleuth.cli.lookup` domain document from a
file or stdin into the same versioned `whoisleuth.lookup-evidence` JSON package
produced by the web Lookup tool. It performs no lookup and writes only to
stdout, so use ordinary shell redirection when a file is wanted. Pretty JSON is
the default; `--compact` emits one compact JSON line for pipeline use, while
`--markdown` produces a readable source-attributed summary and `--html`
produces a self-contained printable report. Compact, Markdown, and HTML output
are mutually exclusive.

The saved input is capped at 8 MiB and revalidated using the same schema,
source-status, parsed-data, scalar, list, and event boundaries as `compare`.
The export retains query context, source diagnostics, normalized registry data,
raw registry RDAP JSON, the raw WHOIS referral chain, availability analysis,
and the shared registry-source comparison. Registrar RDAP raw data, contacts,
entities, links, notices, and source-specific handles remain excluded; schema
version 16 retains that normalized portable-field comparison, explicit
source-health states, a strict bounded projection of observed network
registration, and an optional normalized security.txt disclosure source when
the saved deep lookup represents them. Raw IP RDAP payloads, security.txt
response bodies, and contact entities remain excluded.

Markdown output summarizes query context, assessment state, registry sources,
source reconciliation, network observations, and collection diagnostics. It
escapes all upstream text as untrusted content, bounds displayed values and
lists, and deliberately omits raw RDAP JSON and full WHOIS response bodies.
Use JSON when the complete evidence package or machine processing is required.
When a version-5, version-6, or version-7 lookup records a documented registry-access constraint, both
Markdown and HTML include that context in collection diagnostics without
changing its non-authoritative interpretation. Both formats also include the
selected address and bounded network registration when present, together with
the edge-versus-origin limitation.

HTML uses the same bounded summary model as Markdown. The generated document
contains inline styling for screen and print, but no scripts, forms, active
links, or external resources. A restrictive embedded Content Security Policy
provides defense in depth when the local file is opened in a browser. All
registry values are HTML-escaped and displayed as text.

This is a deliberately rich evidence package. Raw registry sources can contain
publicly published contact data, and deep availability evidence can contain
bounded website, DNS, mail, page-identity, and TLS observations. Review and
secure the output before sharing it. The CLI does not add browser-only IDN
profile analysis, so that optional evidence field is `null`.
