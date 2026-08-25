# Engineering Case Study

WHOISleuth began as a way to inspect WHOIS and RDAP evidence and grew into a
local-first tool for domain investigation and brand protection.

The engineering goal is a focused, explainable, testable and privacy-conscious
system that can run on modest infrastructure.

## Problem and constraints

The implementation has to reconcile several competing realities:

- RDAP is structured but registry coverage, field publication, endpoint
  behaviour, and transport quality vary.
- WHOIS is broadly useful but free-form, referral-driven, encoding-sensitive,
  and exposed over raw TCP sockets that browsers cannot open.
- A website probe accepts an attacker-controlled hostname, so redirects, DNS
  rebinding, cloud metadata ranges, response size, and timeouts are security
  boundaries rather than ordinary error handling.
- Brand-protection analysis benefits from richer evidence, but bulk discovery
  must stay fast enough for serverless execution and respectful of upstream
  services.
- Investigation notes and history are useful, but a privacy-conscious deployment should
  not require accounts, a hosted evidence database, or custody of other users'
  case data.
- Heuristic scores and shared infrastructure can help prioritisation without
  proving maliciousness, ownership, or coordination.
- The project should remain practical on low-cost serverless hosting with
  per-invocation time limits and non-durable warm-instance memory.

Those constraints shape the architecture more than the choice of framework.

## Representative engineering decisions

### One core, two deployment adapters

Express and Netlify use thin HTTP adapters around the same native TypeScript
modules in `lib/`. Query classification, RDAP/WHOIS collection, availability, source
diagnostics, feature policy, request safety, and operation budgets therefore
have one behaviour contract. This avoids a common serverless migration failure:
fixing a parser or security boundary in one runtime while the other silently
diverges.

### Source health is evidence

The lookup contract keeps `unsupported`, `skipped`, `disabled`, `partial`,
`not_found`, and `error` distinct. A missing field is not treated as proof that
the underlying property is absent. RDAP and WHOIS can disagree without one
unconditionally overwriting the other, and authority analysis prevents a failed
or contradictory registrar referral from erasing positive registry evidence.

This same rule appears in historical comparison: a fast scan cannot report a
deep-only website or favicon signal as removed merely because that source was
not evaluated.

### Fast and deep work are explicit profiles

Fast mode is RDAP-led and omits WHOIS plus deep HTTP/TLS evidence. Deep mode
adds the more expensive sources for analyst-selected investigation. Bulk calls
the same lookup endpoint per domain with bounded client concurrency and asks
for a compact response that excludes raw registry bodies it will not display.

The profile distinction keeps cost and latency visible while preserving one
normalisation path. It also gives retained evidence a meaningful comparability
boundary.

### Outbound requests fail closed

The HTTP boundary does not rely on a preflight DNS lookup followed by an
ordinary fetch. It validates every resolved address and pins the actual socket
connection to that validated set, while retaining the original hostname for
TLS SNI and the Host header. Redirect targets are revalidated, private and
special-purpose IPv4/IPv6 ranges are rejected, response bodies and redirect
chains are capped, and per-request dispatchers are cleaned up.

WHOIS referral targets and TLS collection use their own public-address and
deadline controls rather than assuming that protocol differences make the same
trust problem disappear.

### Bounded data is part of every contract

External responses and imported browser data are attacker-controlled even when
they look structured. Parsers cap response bytes, rows, entities, fields,
strings, arrays, redirect chains, certificate names, contact inventories,
relationship groups, timeline entries, and imported iteration before retaining
or displaying them.

Browser-local cases add a serialised byte budget and deterministic evidence
pruning. Analyst-authored notes, tags, status, and disposition are not silently
discarded to make room for machine observations.

### Persist decisions locally, keep ordinary collection transient

The backend does not write ordinary lookup material to an investigation
database. Bounded process caches can briefly retain validated bootstrap or
upstream results, while Brand Profiles, watchlists, cases, campaigns, shortlist
entries, CT baselines, custom rules, and analyst-selected relationship
observations use versioned browser-local schemas with normalisation and
migration on read. Relationship observations are written only after an
explicit analyst action. Deliberate exports are the portability boundary.

An optional Netlify worker is narrower by design: it stores one
application-encrypted, bounded compact watchlist projection so scheduled fast
checks can resume. It does not become a case database, retain deep website
evidence, synchronise ordinary browser stores, or add individual identities.
This keeps hosted data custody and operating cost low while deliberately giving
up general cross-device synchronisation, accounts, background jobs,
notifications, and centrally managed retention.

### Derived analysis remains explainable

Risk and opportunity results expose their contributing factors. Page
similarity reports separate exact body, normalised HTML, visible text,
structure, forms, resource hosts, tracking identifiers, and favicon signals
rather than hiding them in one opaque percentage. Relationship views state the
exact comparison method and retain human-readable limitations.

Risk models are versioned in stored evidence so a later calibration does not
look like a real change in the observed domain.

## Difficult problems addressed

### Registry coverage without false certainty

The RDAP client validates IANA bootstrap data, shares concurrent bootstrap
loads, retains a bounded stale fallback, tries compatible service endpoints,
and rejects successful responses whose object identity does not match the
requested domain, IP range, or ASN range.

The WHOIS client follows bounded referral chains, decodes split UTF-8 chunks,
tries several validated addresses inside one deadline, retains hop diagnostics,
and normalises several registry response families without treating every
occurrence of a domain string as authoritative registration proof.

### Safe, useful website evidence

One bounded homepage observation feeds activity classification, parking and
for-sale signals, redirect provenance, favicon analysis, response fingerprints,
static page identity, privacy-minimised credential-surface counts, curated
technology indicators, and passive security posture. Reusing that capture
avoids a series of slightly different requests while keeping the exact source
and truncation boundary visible. The credential summary retains only fixed
semantic categories and action relationships, never field metadata or complete
form destinations. These derived findings are review aids, not active
vulnerability checks.

Page identity deliberately avoids retaining full HTML or form destinations in
browser-local cases. Component fingerprints enable comparison without implying
that similarity proves authorship.

Deep Lookup can also map one already-observed public endpoint address to a
bounded IP RDAP registration projection. The result remains separately
attributed because CDNs, proxies, load balancers, and shared hosting prevent it
from proving origin or control. A separate opt-in security.txt action can show
published disclosure contacts without treating the file as authorisation to
test the target.

### Historical evidence that survives model evolution

Case and watchlist histories distinguish repeated observations from material
changes, retain the newest bounded snapshots, merge imports non-destructively,
and compare only evidence gathered at compatible depth. Risk-score changes are
gated by model version so a scoring release does not create a false incident
timeline.

### Concurrency limits that work in more than one runtime

The default operation-budget provider is synchronous and in memory, which is
appropriate for one Express process and useful, but explicitly limited, inside a
warm function instance. The same atomic acquire/release contract can use an
optional HTTPS REST provider for expiring distributed leases and fixed-window
operation counters. Only opaque lease and feature metadata leaves the runtime;
query targets and evidence do not.

## Verification approach

The repository tests parsers, bounds, migrations, scoring, security controls,
compatibility and deterministic ordering with local fixtures. Browser tests
cover authentication, responsive and accessible interaction, storage,
downloads, isolation and the fictional public demo while blocking off-origin
requests. TypeScript, Svelte, production-build, architecture, dependency and
licence checks cover the remaining delivery boundaries. Current CI results are
the authority for the exact revision under review.

## Useful code-review entry points

| Area | Start here | What it demonstrates |
| --- | --- | --- |
| Unified evidence orchestration | [`lib/lookup.mts`](../lib/lookup.mts) | Parallel source reuse, fast/deep/compact behaviour, and explicit source diagnostics. |
| RDAP bootstrap and failover | [`lib/rdap.mts`](../lib/rdap.mts) | Validated bootstrap caching, endpoint selection, identity checks, and bounded structured normalisation. |
| WHOIS referral analysis | [`lib/whois.mts`](../lib/whois.mts) | Raw TCP orchestration, public-address validation, authority reasoning, decoding, and registry compatibility. |
| HTTP trust boundary | [`lib/safe-fetch.mts`](../lib/safe-fetch.mts) | DNS-rebinding resistance, address pinning, redirect validation, byte caps, and dispatcher lifecycle. |
| Derived website analysis | [`lib/website-technology.mts`](../lib/website-technology.mts) and [`lib/website-security-posture.mts`](../lib/website-security-posture.mts) | Curated evidence rules, explicit source limitations, and passive findings without additional requests. |
| Observed network context | [`lib/observed-network-context.mts`](../lib/observed-network-context.mts) | One-address selection, bounded IP RDAP projection, and non-attribution limitations. |
| Disclosure contact collection | [`lib/security-txt.mts`](../lib/security-txt.mts) | Explicit opt-in gating, strict media and field parsing, safe redirects, and bounded normalised output. |
| Hosted cost controls | [`lib/operation-budget.mts`](../lib/operation-budget.mts) | Provider-neutral atomic leases, feature identity, failure semantics, and optional durable accounting. |
| Optional hosted monitoring | [`netlify/functions/scheduled-monitor.mts`](../netlify/functions/scheduled-monitor.mts) and [`lib/scheduled-monitor-netlify-store.mts`](../lib/scheduled-monitor-netlify-store.mts) | Private scheduling, encrypted compact state, resumable bounds, and explicit shared-login consequences. |
| Historical evidence model | [`frontend/src/lib/analysis/case-model.ts`](../frontend/src/lib/analysis/case-model.ts) | Versioned schema migration, non-destructive imports, depth-aware comparison, and serialised storage budgets. |
| Typed local investigation projection | [`frontend/src/lib/analysis/investigation-projection.ts`](../frontend/src/lib/analysis/investigation-projection.ts) | Future-schema-safe source reads, deterministic entities, provenance-backed edges, and explicit projection bounds without a database. |
| Local investigation search | [`frontend/src/lib/analysis/investigation-search.ts`](../frontend/src/lib/analysis/investigation-search.ts) | Bounded deterministic ranking over known projection fields, explicit source limitations, and passive pivots without network or persistence. |
| Public demo boundary | [`frontend/src/lib/analysis/demo-model.ts`](../frontend/src/lib/analysis/demo-model.ts) | Fixed synthetic fixtures, dependency-aware state normalisation, and a deliberately distinct export contract. |
| Browser network isolation | [`e2e/fixtures.ts`](../e2e/fixtures.ts) | Authentication setup, active off-origin request blocking, console failure collection, and scoped expected-noise handling. |

## Deliberate limitations

WHOISleuth currently has a shared deployment password rather than individual
accounts, stores ordinary investigations in one browser rather than a server
database, and does not send automatic reports or notifications. An explicitly
configured optional worker can rescan one bounded, encrypted compact watchlist
projection; it is not a general background-job system or collaborative evidence
store. WHOISleuth is not a vulnerability scanner, passive-DNS platform,
takedown service, or proof that a domain is malicious.

These are explicit scope and trust decisions for the current project,
not claims that the omitted features are trivial. Adding them would require a
new identity, authorisation, persistence, retention, privacy, and hosted-cost
model.
