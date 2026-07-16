<p align="center">
  <img src="frontend/static/favicon.svg" width="72" height="72" alt="WHOISleuth logo" />
</p>

<h1 align="center">WHOISleuth</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License: Apache 2.0" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node >= 24" />
  <img src="https://img.shields.io/badge/frontend-SvelteKit%20%2B%20Vite-ff3e00" alt="SvelteKit and Vite" />
  <a href="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml"><img src="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://app.netlify.com/projects/whoisleuth/deploys"><img src="https://api.netlify.com/api/v1/badges/600adb21-cece-4a13-8df8-d177ace3d945/deploy-status" alt="Netlify Status" /></a>
</p>

A local domain intelligence and brand-protection console, built on WHOIS +
RDAP. At its core it checks domain, IP, and ASN records - single lookups or
bulk scans of a domain list - backed by the official IANA RDAP bootstrap
service and live WHOIS (TCP/43) queries to the relevant registries. On top of
that it adds the pieces for hunting typosquats and lookalikes: keyword and
typosquat candidate generators, a Certificate Transparency search for
lookalikes no generated list would guess, availability/opportunity scoring, a
typosquat phishing-risk score, and brand-asset cloning detection (exact and
perceptual favicon matching against a Brand Profile's official site).
Findings can be triaged, drafted into abuse reports, organized into
browser-local cases and campaigns, kept in a shortlist, and monitored over
time with a watchlist that records a bounded timeline of material changes -
all with CSV/JSON import/export. Brand Profiles
can also audit their official domains' mail and DNS posture (SPF, DMARC, MX,
DNSSEC, CAA, MTA-STS, TLS-RPT, BIMI, and explicitly configured DKIM
selectors).

Runs as a small Node backend (needed for raw WHOIS sockets and cross-origin
RDAP requests, which browsers can't do directly) serving a prerendered
SvelteKit frontend built with Vite. The lookup logic lives in a shared `lib/`
so it can run either as a traditional always-on Node/Express server
(`server.mts`) or as Netlify Functions (`netlify/functions/`) with no logic
duplicated between the two.

<p align="center">
  <a href="https://whoisleuth.com/demo"><strong>Explore the public synthetic demo →</strong></a><br />
  <sub>Fixed fictional data · no sign-in · no live registry, DNS, website, or hosted analysis request</sub>
</p>

## At a glance

| Workspace | Purpose | Important boundary |
| --- | --- | --- |
| **Lookup** | Inspect one domain, IP address, or ASN through normalized RDAP/WHOIS evidence and optional deep DNS, HTTP, favicon, page-identity, and TLS observations. | Fast and deep results disclose skipped, partial, unsupported, and failed sources rather than treating missing evidence as negative evidence. |
| **Discover** | Generate bounded typo, homoglyph, keyboard, separator, word-order, and impersonation candidates; supplement them with structured Certificate Transparency matches. | Candidate generation is local. Certificate Transparency is an explicit hosted search and its timestamps are public-log observations, not proof of site activity or maliciousness. |
| **Bulk** | Triage a list of domains with filters, score explanations, CSV export, scan-local relationships, and fast/deep profiles. | Each domain is a separately budgeted lookup. Fast mode avoids WHOIS and deep website/TLS collection; deep mode costs more requests and time. |
| **Brands** | Keep browser-local official-domain profiles, posture settings, allowlists, and optional page-identity baselines. | Profiles stay in that browser. A posture audit and baseline capture run only when explicitly requested. |
| **Monitor** | Maintain bounded watchlists, analyst cases, evidence timelines, campaigns, relationship comparisons, and deliberate case/store exports. | Investigation state is browser-local by default. An optional Netlify worker can retain only encrypted compact scheduled-watchlist state when explicitly configured; there are no accounts, automatic reports, or automatic notifications. |
| **Demo** | Walk through a representative brand-to-case workflow using reserved domains and clearly marked synthetic evidence. | The public demo uses an isolated tab-scoped store, never calls analysis APIs, and cannot write production browser stores. |

The application is intentionally an analyst workbench rather than an autonomous
scanner or enforcement system. Scores, similarity, relationships, and generated
candidates are prioritisation context; a human remains responsible for review
and any external action.

See the [architecture orientation](docs/architecture.md) for the main execution,
trust, storage, and deployment boundaries, and the
[registry data contract](docs/registry-data-contract.md) for normalized source
shapes and compatibility details. The
[engineering case study](docs/engineering-case-study.md) explains the project's
constraints, representative decisions, difficult problems, and useful
code-review entry points.

## Contents

- [At a glance](#at-a-glance)
- [Disclaimer](#disclaimer)
- [Requirements](#requirements)
- [Install & run](#install--run)
- [Usage](#usage)
- [Rate limiting](#rate-limiting)
- [Deploying to Netlify](#deploying-to-netlify)
- [Project structure](#project-structure)
- [Architecture orientation](docs/architecture.md)
- [Engineering case study](docs/engineering-case-study.md)

## Disclaimer

Licensed under Apache 2.0 (see [LICENSE](LICENSE)) - provided **as is, with
no warranty**. A few things worth being deliberate about before you rely on
this tool or point it at data that isn't your own:

- **Data accuracy.** RDAP/WHOIS responses are only as current, complete, and
  correctly-parsed as the upstream registry provides - fields can be
  redacted, stale, or missing entirely (see the WHOIS parsing notes in
  `lib/whois.mts`). Don't treat the Opportunity/Risk scores, availability
  state, or abuse contact as a substitute for your own verification before
  acting on them, especially for anything with legal or financial
  consequences.
- **Intended use.** The typosquat/homoglyph generator and Certificate
  Transparency search are meant for monitoring domains and brands you have
  a legitimate interest in (your own brand, a client's, etc.) - the same
  candidate-domain output that helps a defender monitor lookalikes is
  equally a list of not-yet-registered lookalikes, so don't use this
  against a brand you have no relationship to.
- **Outreach and abuse-report drafts don't send anything automatically** -
  both only build a `mailto:` link plus a copy-to-clipboard button; a human
  reviews and sends each one. That said, using registrant contact data
  pulled via WHOIS/RDAP for outreach is still subject to whatever
  anti-spam (CAN-SPAM, CASL, PECR, etc.) and privacy law (GDPR, CCPA, etc.)
  applies in your and the recipient's jurisdiction - that's on you to
  comply with, not something this tool enforces for you.
- **Registry/registrar terms of service.** Several registries' own WHOIS/
  RDAP terms restrict automated bulk querying without a separate bulk-access
  agreement. This tool's rate limiting (see below) protects against
  accidental abuse, not against violating an individual registry's own
  terms if you run large or frequent bulk scans against it.

See [PRIVACY.md](PRIVACY.md) for how registrant data is handled and how to
clear it (fill in your own contact details before sharing a deployment).

## Requirements

- [Node.js](https://nodejs.org/) 24 or later (the current LTS line used by CI and Netlify)
- npm (bundled with Node)

## Install & run

```bash
npm install
SITE_PASSWORD=choose-a-password SESSION_SECRET=choose-a-separate-random-secret npm start
```

Then open **http://localhost:3000** in a browser and enter that password.

The whole tool sits behind a shared-password gate - `SITE_PASSWORD` is
required, and every investigation API route rejects requests without a valid
session regardless of whether the frontend gate is showing. Login and session
status remain the narrow unauthenticated exceptions needed to enter the tool.
There's no per-user
login, just one password shared with whoever you want to have access; anyone
without it sees only the password prompt. Pick something you're comfortable
sharing with those people, not a password reused elsewhere.

`SESSION_SECRET` should be a separate random value (for example, 32 random
bytes encoded as hex). It signs session cookies without turning a captured
cookie into an offline verifier for `SITE_PASSWORD`. For compatibility,
deployments that omit it derive a slower signing key from `SITE_PASSWORD`,
but setting the independent secret is recommended.

`npm start` builds the prerendered multi-page frontend and starts the shared
Express/API process. The generated `frontend/build/` directory is the only
frontend served by the Node deployment.

The server listens on port 3000 by default. To use a different port:

```bash
PORT=4000 SITE_PASSWORD=choose-a-password SESSION_SECRET=choose-a-separate-random-secret npm start
```

When self-hosting behind a reverse proxy such as nginx, Caddy, or a managed
load balancer, set `TRUST_PROXY=1` only if that proxy overwrites forwarded
headers and clients cannot connect directly to the Node process. This lets
per-IP rate limits use the proxy-supplied client address and lets proxied
HTTPS requests receive HSTS. Secure cookies continue to fail closed when a
proxy reports HTTPS even without this setting. Other forwarded client and
scheme data is ignored; all proxied users will otherwise share the proxy
socket's rate-limit bucket. Do not enable it on a directly
internet-facing Node process, where clients could forge those headers.

Sessions are stateless and valid for up to 30 days. Signing out clears the
cookie from that browser but cannot revoke a copied token before it expires.
Rotate `SESSION_SECRET` (or `SITE_PASSWORD` when no independent session secret
is configured) to invalidate every outstanding session immediately.

### Emergency feature switches

Operators can stop individual hosted network features without changing or
redeploying the frontend. Set any switch to `1`, `true`, `yes`, or `on`:

| Environment variable | Enforced effect |
| --- | --- |
| `WHOISLEUTH_DISABLE_LOOKUP` | Blocks unified Lookup and Bulk submissions. |
| `WHOISLEUTH_DISABLE_RDAP` | Blocks direct RDAP and omits RDAP inside unified Lookup/availability. |
| `WHOISLEUTH_DISABLE_WHOIS` | Blocks direct WHOIS and omits WHOIS inside deep Lookup/availability. |
| `WHOISLEUTH_DISABLE_AVAILABILITY` | Blocks direct availability and omits availability analysis inside unified Lookup. |
| `WHOISLEUTH_DISABLE_DNS_INTELLIGENCE` | Stops evidence/delegation DNS queries and also disables the DNS-dependent posture audit. Transport DNS needed to reach an otherwise-enabled RDAP, WHOIS, or website endpoint is not evidence collection and remains available. |
| `WHOISLEUTH_DISABLE_WEBSITE_PROBE` | Stops homepage and favicon requests while retaining registry analysis. |
| `WHOISLEUTH_DISABLE_TLS_INTELLIGENCE` | Stops the one-connection TLS/certificate profile while retaining other deep evidence. |
| `WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY` | Blocks Certificate Transparency search. |
| `WHOISLEUTH_DISABLE_DOMAIN_POSTURE` | Blocks owned-domain posture audits. |

The authenticated capability report is generated from the same policy that
the Express routes and direct Netlify Functions enforce. A disabled top-level
endpoint returns HTTP `503` with `errorCode: FEATURE_DISABLED`, `feature`, and
`disabledBy`. Unified Lookup degrades optional disabled sources explicitly
instead of treating them as absent or failed evidence. Browser controls mirror
the report for clarity, but hiding or disabling a control is never the security
boundary. Existing local candidate generation, cases, watchlists, profiles,
exports, and saved evidence remain usable.

When RDAP, WHOIS, DNS intelligence, website probing, or TLS intelligence is disabled, a requested
deep scan is marked incomplete for persistence purposes. Its enabled evidence
is still shown, while watchlists and analyst cases retain prior deep-only
evidence instead of recording skipped sources as removals.

Express reads the environment for each request. Hosting platforms may require
an environment update or new function instance before a changed value takes
effect. Removing the variable or setting any value other than the four values
above re-enables the feature.

Every push and pull request runs the locked install, test suite, JavaScript
type checks, Svelte checks, production frontend build, and browser end-to-end
suite in GitHub Actions. Run the same verification locally:

```bash
npm test
npm run typecheck
npm run check
npm run build
npm run test:e2e:install   # one-time: downloads the Chromium browser Playwright drives
npm run test:e2e
```

### Browser end-to-end tests

The `e2e/` directory holds a [Playwright](https://playwright.dev/) smoke
suite (Chromium only) covering authentication, responsive navigation, core
investigation workflows, browser-local persistence and exports, accessibility,
and the isolated public demo. It builds and runs its own local production-style
server on port 4173 with a test-only `SITE_PASSWORD`/`SESSION_SECRET`
(configured in `playwright.config.ts`, not your shell) and never queries
live WHOIS, RDAP, DNS, CT, or website data - tests that need submission
behavior use domain values the backend rejects locally before any upstream
request. First run `npm run test:e2e:install` to download the Chromium
build Playwright drives (a one-time step, separate from `npm install`), then
`npm run test:e2e` to run the suite headlessly. A `playwright-report/`
directory (traces/screenshots for failed tests only) is written to the repo
root and is gitignored.

## Usage

### Looking up domains

The normalized source shapes, source-health states, limits, truncation fields,
compact-storage boundary, and lookup evidence schema are documented in the
[registry data contract](docs/registry-data-contract.md).

- Enter a single domain, IPv4/IPv6 address, or ASN in the search box for a
  full RDAP + WHOIS + availability lookup.
- For domain lookups, the Summary compares overlapping RDAP and WHOIS fields
  after both sources finish. Equivalent values are normalized for harmless
  formatting differences, while source-only values and material conflicts
  retain both original source values for review. A failed, unsupported,
  skipped, not-found, or partial source is kept distinct from an unpublished
  field, so incomplete collection is not presented as a registry discrepancy.
- RDAP bootstrap data is validated, shared across concurrent requests, and
  retained as a bounded stale fallback during a temporary IANA outage. Domain
  lifecycle events are normalized into deterministic creation, expiration,
  update, transfer, deletion, and reinstantiation dates without discarding the
  bounded source event list.
- HTTPS registry endpoints are preferred. A small number of current IANA
  bootstrap entries expose only HTTP; those remain usable for lookup coverage,
  and source diagnostics explicitly identify the cleartext transport.
- A successful RDAP response is accepted only when its object type and domain,
  IP range, or ASN range match the requested object. Empty, mismatched, and
  malformed successful responses fall through to the next bounded bootstrap
  endpoint; diagnostics and evidence exports retain the outcome of each attempt.
- A deep, non-compact domain Lookup may make one additional bounded HTTPS
  request when the registry object publishes a complete registrar RDAP domain
  link. Registrar data is displayed as a separate attributed source and is
  never merged into registry fields or used for availability or Risk scoring.
  The follow-up is omitted from fast and compact Bulk work, and unsupported or
  failed registrar responses remain neutral source states.
- Structured domain results retain registry object IDs, registrar IANA IDs,
  registrar WHOIS endpoints, and reseller data when published. Fast Bulk scans
  remain WHOIS-free: they use RDAP first and may use a bounded authoritative
  DNS-delegation check to positively confirm registration for TLDs without
  usable RDAP. A missing DNS delegation never means that a domain is available.
  Full Lookup and deep scans retain the WHOIS referral chain.
- Full Lookup normalizes WHOIS creation, expiration, and update dates alongside
  bounded registrant, administrative, technical, billing, and registrar-abuse
  contacts when those roles are published. Existing scalar WHOIS fields remain
  available for compatibility, while capped fields and inventories are labelled
  in the structured view rather than presented as complete.
- Lookup retains a bounded inventory of nested RDAP contacts by published role,
  including repeated names, organizations, email addresses, phone numbers,
  postal addresses, public identifiers, and HTTP(S) references. Bulk,
  watchlists, and analyst cases continue using the compact primary-contact
  shape so richer contact arrays do not expand browser-local stores implicitly.
- Lookup also retains bounded RDAP conformance identifiers, response language,
  explicit RFC-style redaction metadata, and published IDN variant groups.
  Capped contact, redaction, and variant inventories are labelled rather than
  presented as complete; the raw upstream response remains available only in
  the single-lookup view and its deliberate evidence export.
- Deep domain scans collect a bounded point-in-time DNS observation for A,
  AAAA, CNAME, NS, MX, SPF, DMARC, and CAA alongside registry-derived DNSSEC.
  Per-record diagnostics distinguish authoritative absence from resolver
  failure, malformed neighbours are discarded, and caps are disclosed. Lookup
  displays the evidence; deliberate JSON and Bulk CSV exports retain it. Shared
  infrastructure is relationship context, not proof of ownership or abuse,
  and the richer observation is not copied into watchlists or analyst cases.
- Deep domain scans also make one bounded TLS connection to one public address
  selected from an SSRF-guarded DNS resolution. The original domain remains the
  SNI and hostname-verification target. Lookup retains the connected address,
  negotiated protocol/cipher/ALPN, runtime authorization outcome, hostname and
  validity status, bounded leaf subject/issuer/SAN/serial/fingerprint/public-key
  metadata, and a capped chain summary. This is a point-in-time observation of
  one edge, not an exhaustive protocol/cipher audit or a maliciousness verdict.
- IPv4, IPv6, and ASN RDAP results retain their bounded status and lifecycle
  metadata instead of treating those fields as domain-only. Published CIDR0
  prefixes are accepted only for the requested address family and malformed
  neighbouring entries are discarded; status, event, and CIDR caps are
  disclosed in normalized results and the Lookup view.
- After a successful single lookup, **Export JSON** downloads a versioned
  evidence package containing the submitted/registrable-domain context,
  normalized and raw RDAP/WHOIS sources, source endpoints and timestamps,
  discrepancy analysis, and availability/web/mail/TLS findings. The download is
  created locally and may contain contact data published by the registry.
- The unified `/api/lookup` response includes a versioned `diagnostics`
  object with independent RDAP, WHOIS, and availability statuses, source
  provenance, and stable source error codes. HTTP errors retain the existing
  human-readable `error` and add a machine-readable `errorCode` such as
  `AUTH_REQUIRED`, `RATE_LIMITED`, `MISSING_QUERY`, or `INVALID_QUERY`, so
  clients do not need to match message text. Diagnostics version 4 adds an
  optional separately-attributed registrar RDAP child beneath the RDAP source.
- Clients that only need the derived assessment can add `compact=1` to
  `/api/lookup`. This retains `availability` and `diagnostics` while omitting
  raw RDAP and WHOIS payloads; Bulk uses this mode to bound browser memory and
  transfer size.
- Paste multiple domains into Lookup to hand them to Bulk, or paste/upload a
  CSV or text list directly in Bulk. Named domain columns, quoted CSV fields,
  comma/semicolon/tab delimiters, and case-insensitive deduplication are
  supported.
- Use the keyword, typosquat, or Certificate Transparency discovery tools to
  select candidate domains and send them directly to Bulk.
- New network evidence uses an additive, versioned observation envelope for
  source health, timestamp, duration, completeness, truncation, limitations,
  and bounded diagnostics. DNS and Certificate Transparency are the first
  adopters; their established response fields remain unchanged, and older
  records without an envelope remain valid.
- Authenticated deployments expose a provider-neutral `/api/capabilities`
  report so browser, CLI, and worker consumers can distinguish hosted support,
  local-only analysis, disabled features, and unavailable integrations. The
  report is server-authoritative, identifies the active concurrency provider
  and scope, and does not claim unimplemented scheduled capabilities.
- Star any bulk result to add it to the **Shortlist**, which persists in the
  browser's local storage.

### Optional external threat-intelligence boundary

One optional adapter searches existing URLscan public scan history for
recent malicious-verdict matches. It remains disabled unless the operator sets
`WHOISLEUTH_ENABLE_URLSCAN=1` and a valid `URLSCAN_API_KEY`, and it runs only
when a user explicitly selects the archived-verdict option for a deep,
non-compact single-domain Lookup. It sends the canonical registrable domain,
never a URL path or query, makes one bounded search request, follows no
redirect with the credential, performs no scan submission, retains no cache,
and does not run in fast or compact Bulk paths. The normalized provider result
is displayed transiently and is not copied into browser-local stores or the
structured Lookup evidence export. To remain compatible with URLscan's free
API tier, it searches the canonical domain and date range, then filters verdicts
from the newest 20 returned scans locally. This bounded view can miss older
malicious scans and a provider miss is never treated as evidence of safety.

A second optional adapter queries existing URLhaus host records for archived
malware-distribution URLs. It remains disabled unless the operator sets
`WHOISLEUTH_ENABLE_URLHAUS=1` and a valid `ABUSECH_AUTH_KEY` (the legacy
`URLHAUS_AUTH_KEY` remains accepted), and it runs only
when a user explicitly selects malware-distribution records for a deep,
non-compact single-domain Lookup. The adapter posts only the canonical
registrable domain to the fixed host-lookup endpoint, keeps its Auth-Key in an
HTTP header, follows no credential-bearing redirect, and never submits a URL,
sample, or report. Responses are capped at 256 KB and 20 displayed findings;
the adapter uses a six-second timeout, one-request process-local concurrency,
conservative process-local fair-use counters, and no cache. Raw results remain
separately attributed and outside compact stores and structured evidence
exports.

A third optional adapter searches retained ThreatFox malware indicators for an
exact canonical registrable-domain match. It remains disabled unless the
operator sets `WHOISLEUTH_ENABLE_THREATFOX=1` and the same valid
`ABUSECH_AUTH_KEY`, and it runs only when a user explicitly selects malware
infrastructure records for a deep, non-compact single-domain Lookup. The fixed
HTTPS endpoint receives one JSON search request with `exact_match` enabled;
the adapter follows no redirect, never submits an indicator, URL, sample, or
report, and keeps no cache. Responses are capped at 256 KB and 20 displayed
findings with a six-second deadline, one-request process-local concurrency, and
conservative process-local fair-use counters. Findings retain bounded malware
family, infrastructure role, confidence, and observation-time context and
remain separately attributed.

Before any adapter can be enabled, `lib/threat-intelligence-contract.mts` requires a
versioned provider definition that declares its supported target types, the
exact target representation it would receive (registrable domain, hostname,
origin, or full URL), a reviewed terms URL and privacy-policy decision,
commercial-use, attribution, caching, provider query-retention, and
redistribution policy, plus bounded
timeouts, response sizes, cache TTLs, concurrency, and daily/monthly request
budgets. Version 1 permits lookup-only integrations and deliberately excludes
automatic URL submission.

Adapter output is normalized into separately attributed, bounded findings and
explicit `success`, `partial`, `not_found`, `unsupported`, `skipped`,
`rate_limited`, `unavailable`, or `error` states. It has no global “safe” field:
a provider miss, outage, quota failure, or unsupported target cannot become
evidence of safety. Risk model v5 recognizes only allowlisted phishing or
malware findings from positive provider states. A lone publisher contributes
no points, and the two community malware datasets remain one publisher family;
only corroboration across at least two independent publisher families can add
one bounded factor (+18 when both have a record observed within 90 days of its
provider query, otherwise +10). Unknown providers, suspicious-only categories,
neutral misses, and failures contribute nothing. Raw provider findings remain
transient; compact cases retain only the already-supported versioned score and
factor explanation. The contract itself performs no requests or stores
credentials. Each adapter remains subject to a fresh terms and privacy review
before it is enabled; the URLscan policy
declaration was reviewed on 15 July 2026 and conservatively records commercial
use and redistribution as restricted, provider query retention as
provider-defined, and caching as prohibited.
The URLhaus policy declaration was also reviewed on 15 July 2026. Its
community API is free for authenticated not-for-profit use under fair-use
limits, while commercial use may require a paid plan; redistribution is
therefore treated as restricted and provider query retention as
provider-defined. Deployments must keep the adapter disabled unless their use
qualifies under those terms or they have an appropriate commercial agreement.
The ThreatFox declaration was reviewed on the same date under the same abuse.ch
terms and privacy policy. Its community API expires older indicators, so a
neutral result is never presented as complete historical coverage or evidence
of safety. Commercial deployments must keep it disabled unless their use is
covered by the provider's community terms or an appropriate paid agreement.

### Opportunity & Risk scoring

- A deep-checked registered result gets a versioned **Risk** score for analyst
  prioritization, distinct from the **Opportunity** score that rates how
  approachable a domain is to acquire. The Risk score is a heuristic review
  indicator, not a maliciousness verdict. Model v5 groups related observations
  into three contextual families: domain resemblance, brand presentation, and
  credential-lure behavior. Related observations within one family remain
  individually visible but do not manufacture extra corroboration; a separate
  factor is added only when two or more distinct families agree. Even the
  strongest single family cannot reach the danger threshold when combined with
  all ordinary activity, mail, privacy, and recency context.
- Optional external observations stay independently attributed. Only
  allowlisted phishing or malware records corroborated across two independent
  publisher families add one bounded Risk factor; multiple datasets from one
  publisher cannot corroborate one another. Source age is derived against each
  provider result's own observation time, a lone source adds no points, and a
  provider miss is never evidence of safety.
- A matching favicon, official-asset relationship, password form, or suspicious
  phrase can also occur on legitimate SSO, payment, agency, CDN, and authorized
  campaign pages. Domains classified by the active Brand Profile as official,
  partner, or allowlisted therefore keep their observational score visible but
  are excluded from untrusted high-risk triage and Monitor saves. Review the
  contributing factors and evidence rather than treating the score as a verdict.
- A single-domain lookup's availability card shows a compact, numbered
  **Risk** and **Opportunity** meter beside the status: the bar speeds up
  scanning but never replaces the score value.
- Hover any Opportunity/Risk meter or bulk-table score for a tooltip breaking
  down exactly which signals contributed and by how much. Bulk CSV exports
  include the Risk model version and factor breakdown alongside the score.
  Analyst-case snapshots and reports retain the same version. Scores created
  before explicit versioning remain readable, but watchlist and case timelines
  do not treat a difference between unversioned and versioned scores as a
  change in the observed domain.

### Brand protection & monitoring

- Save a **Brand Profile** (official domains, product names, TLDs, approved
  partner domains, and an allowlist) - the typosquat generator can prefill
  from the active profile and drops candidates already in its allowlist, and
  bulk/watchlist results mark any domain in the allowlist instead of
  treating your own domain as a lookalike.
- Lookup and Bulk analyze internationalized domains locally in the browser.
  Unicode and DNS-safe ASCII forms are shown together, per-label writing
  scripts are identified, and a bounded, versioned visual skeleton can be
  compared with official domains in the active Brand Profile. These findings
  are contextual review indicators, never a maliciousness verdict, and do not
  change the Risk score. The typosquat generator uses the same curated mapping
  so generated confusable candidates and result explanations stay consistent.
  Mapping `tr39-17.0-curated-ascii-v2` adds a reviewed IDNA-distinct
  candidate-generation subset from Unicode 17 while retaining a maximum of
  eight generated substitutions per ASCII character. Mapping changes are
  explicitly versioned because upstream confusable data can evolve; the
  curated subset is not an exhaustive registry-variant or visual-similarity
  database. Lookup evidence
  schema version 11 retains the analysis supplied to the export; Bulk CSV
  exports include the compact IDN fields.
- Run **Audit official domains** from a Brand Profile to check preventive
  mail/DNS controls. Each finding retains its source records, explains why it
  passed or needs review/action, and provides a concrete next step. DKIM is
  checked only for selectors saved in the profile because selectors cannot be
  discovered reliably from DNS; the audit never guesses them.
- A Brand Profile can explicitly capture a browser-local official-site
  baseline from its first official domain. The baseline includes the page
  title, canonical host, favicon hashes, versioned normalized-HTML,
  visible-text, DOM and form fingerprints, and bounded external-resource host
  and recognized tracking-identifier sets. It records whether the capture was
  complete or partial and when it was observed, but never stores page HTML,
  URL paths or query strings. Capturing does not persist anything until the
  profile is saved; an inconclusive update leaves the existing baseline
  unchanged. A registered lookalike serving the exact or a perceptually close
  official favicon is flagged in results and contributes bounded
  brand-presentation context to its Risk score. The remaining baseline
  components are retained for explainable page comparison rather than treated
  as proof of common ownership or intent.
  Lookup compares normalized HTML and static DOM/form digests, visible-text
  SimHash distance, external-resource-host overlap, and recognized tracking
  identifiers independently. It reports no combined page-similarity score and
  does not feed these comparisons into Risk scoring. The comparison is
  computed transiently in the browser and is not copied into cases,
  watchlists, or evidence exports.
- A deep check also pulls a few signals straight from the domain's homepage
  HTML at no extra fetch cost: a login/password form, urgency-driven
  phishing/social-engineering language ("verify your account", "security
  alert", ...), the page title, and any image/script/stylesheet it loads
  directly from your official domain instead of copying - a lazy
  phishing-kit tell. These observations contribute conservatively within their
  contextual families and require evidence from another family before receiving
  a corroboration bonus.
- The same bounded homepage request now retains an HTTP observation with the
  final response, a validated redirect chain, transport, selected response and
  security headers, declared versus captured body size, and a SHA-256 over the
  captured response bytes. The hash scope explicitly distinguishes a complete
  captured body from a capped prefix; a prefix hash is not presented as a hash
  of the complete upstream response. URL query strings are omitted from
  retained provenance. Missing security headers and cross-origin redirects are
  contextual evidence, not maliciousness verdicts, and do not change scoring.
  Bulk results, watchlists, and analyst cases keep only a compact summary of
  the final origin, response status, transport, redirect count/flags, MIME
  type, and presence-only security-header tokens. They never copy URL paths,
  query strings, header values, attempt errors, or redirect inventories from
  the richer Lookup observation.
- Deep Lookup also derives a versioned, bounded page-identity summary from
  that same captured HTML response, without making another request. It can
  retain the document language, canonical and meta-refresh targets, selected
  Open Graph identity, generator metadata, form counts, bounded external
  form-action origins, normalized resource-type counts, external resource and
  embedded origins, mail-contact domains, download context, and recognized
  public tracking identifiers. Credentials, query strings, fragments,
  resource/download paths, form-action paths, and complete email addresses are
  not retained; oversized inputs and collection caps are reported as partial
  observations. This evidence is displayed only in Lookup and its deliberate
  evidence export. It is not copied into Bulk, watchlists, or analyst cases and
  does not alter Risk scoring. Static parsing does not run JavaScript, and the
  resulting metadata is contextual relationship/review evidence rather than a
  verdict about site ownership or intent. Data-bearing `srcset` attributes are
  skipped instead of being split incorrectly by the lightweight parser.
- Page identity also includes an independently versioned fingerprint bundle
  derived from the same capped response. It reuses the exact captured-body
  SHA-256 and adds a noise-reduced normalized-HTML SHA-256, visible-text
  SimHash, static tag-sequence SHA-256, form-structure SHA-256, and bounded
  external-resource-host and public-tracking-identifier sets with deterministic
  set digests. Normalization removes comments and script/style/non-executing
  bodies, reduces routine timestamps and random identifiers, omits nonce,
  token, value, and tracking-query volatility, and sorts attributes where the
  lightweight parser can do so safely. Normalized markup and visible text are
  discarded after hashing. Component caps and source truncation remain
  explicit; fuzzy SimHash is comparison data, not cryptographic evidence or
  proof of common ownership.
- A bulk scan presents bounded **Relationship evidence** from observations
  already collected by that scan: exact nameserver sets, resolved IP
  addresses, recognized public tracking identifiers, exact or perceptually
  similar favicons, and asset hosts under configured official domains. Each
  relationship states its comparison method and can be loaded back into the
  query box. The comparison is scan-local, performs no extra lookups, changes
  no Risk score, and is not copied into shortlists, watchlists, cases, or
  exports. Shared observations are investigation pivots, not proof of common
  ownership, coordination, intent, or maliciousness. CT hostname and
  certificate-count provenance is not treated as certificate reuse. Deep Bulk
  results can group exact native leaf-certificate SHA-256 observations within
  the current scan. Multi-domain certificates, shared hosting, CDNs, and
  managed platforms are common, so this remains relationship context rather
  than proof of common ownership, control, intent, or abuse.
- **Bulk triage controls** keep large scans usable: filter by availability
  family, high-risk score, error state, mutation family, and one or more
  evidence signals. Counts update while the scan runs; filters change only
  the visible rows, never the saved/exported scan data.
- Typosquat candidates retain their **mutation provenance** (omission,
  keyboard substitution, homoglyph, dictionary term, TLD typo, and the other
  generator families) through bulk results, watchlists, and CSV export. When
  several algorithms produce the same domain, every contributing family is
  retained rather than silently discarded. The Risk model uses only its
  allowlisted generator machine values as a bounded context signal; arbitrary
  imported labels cannot increase the score. Candidate generation validates
  domain labels before including them and applies deterministic per-family,
  label-variant, TLD, and overall candidate limits before browser handoff. The
  Discover status reports when a limit prevents complete coverage.
- Discover offers three local **generation presets**: Common edits,
  Impersonation, and All families. All families preserves the established
  default output, while the narrower presets let analysts focus on particular
  mutation groups without changing the global safety limits. A live upper-bound
  estimate shows the possible candidate count before validity filtering and
  deduplication; it allocates no candidate objects and makes no network
  requests. Network lookups begin only after selected candidates are handed to
  Bulk and scanned.
- Adjacent-key substitution and insertion can use **QWERTY, AZERTY, or
  QWERTZ** geometry. QWERTY remains the compatibility default; changing the
  layout clears any previously generated set so the visible results always
  match the active configuration. Layout selection changes only local
  candidate generation and does not alter the Risk model.
- Bounded separator families add valid internal hyphens, remove existing
  separators, and preserve two-to-four-token brand boundaries so deterministic
  word reorderings can be generated in joined and hyphenated forms. Each family
  keeps separate provenance, and four-token permutations stop at the existing
  per-family boundary. Risk model v5 recognizes these generator-owned values as
  low-context evidence; earlier stored scores remain readable but incomparable
  across model versions.
- The Impersonation preset uses a bounded curated set of access, account,
  support, payment, and recovery terms in joined and hyphenated prefix/suffix
  forms. These candidates retain the existing `dictionary` machine provenance
  and display as **Impersonation term** evidence; a term match is investigation
  context, not a maliciousness verdict.
- When the seed is a domain, the selected TLD field now expands that exact
  label and every generated label variation across the bounded selected TLD
  set. These results retain an explicit **Selected TLD substitution** source,
  including alongside any label-level mutation that also contributed.
- After a generated-list scan, **Defensive registration coverage** groups the
  results by mutation family and TLD: protected/allowlisted domains,
  registered exposures, available gaps, and unknown results. Groups can be
  loaded back into the query box or exported as a coverage CSV, using scan
  data already collected with no extra network calls.
- Save a generated typosquat set as a **Watchlist** and re-scan it later.
  Each watchlist retains a bounded, browser-local timeline of material
  availability, registrar, nameserver, date, mail, compact HTTP, website, and
  Risk-score changes. Fast rescans update registration data without erasing
  last-known deep-scan evidence; an explicit deep re-scan refreshes page/mail
  and HTTP signals. Risk-score changes are reported only when both observations
  carry the same explicit model version.
  Deep watchlist rescans keep the same 200-domain safety limit as other deep
  checks; larger watchlists remain available for fast registration monitoring.
  Timeline entries can be filtered to changed checks only and are included
  in the existing JSON backup/export.
- **Optional hosted monitoring worker**: Netlify deployments include a private
  scheduled function that polls every five minutes, but it is a no-op unless
  `WHOISLEUTH_SCHEDULED_MONITORING` is explicitly enabled with a valid
  32-byte Base64 `WHOISLEUTH_SCHEDULED_MONITOR_KEY` and a bounded
  `WHOISLEUTH_SCHEDULED_MONITOR_NAMESPACE`. The function has no production URL.
  Set these values for the **Production** deploy context only. Automatic runs
  occur only for the published deploy, and a manual invocation of preview or
  branch-deploy code is rejected before Blob construction even if its
  configuration was inherited accidentally.
  When ready, it opens the site-wide `whoisleuth-scheduled-monitor` Blob store,
  decrypts one bounded state envelope in memory, and processes at most two
  existing fast compact lookups and eight internal deliveries within a
  24-second soft budget. Durable progress is an encrypted cursor; provider
  outages, inconclusive observations, conflicts, and deadlines remain explicit
  and cannot erase an earlier conclusive baseline. The current frontend does
  not yet expose controls that copy a browser watchlist into this store.

  The five-minute schedule itself can use 8,640 function invocations in a
  30-day month or 8,928 in a 31-day month, including no-op invocations while the
  feature is disabled. Blob reads, writes, and domain lookups occur only when
  the complete enable configuration is valid. Scheduled intervals are targets,
  not guarantees: bounded work is resumed by later invocations when several
  lists are due or upstream services are slow. To roll back lookup and storage
  activity, set `WHOISLEUTH_SCHEDULED_MONITORING=0` (or remove it) and redeploy.
  Disabling the worker does not delete its encrypted Blob; remove that object
  deliberately from the Netlify Blobs page only when its retained history is
  no longer required. Removing the function's schedule is required to reclaim
  the no-op invocation allowance as well.
- Use **Search Certificate Transparency logs** to find hostnames with a
  publicly-issued TLS certificate matching a brand keyword - catches
  lookalikes the typosquat generator's fixed permutations would never guess,
  often before the domain shows up anywhere else. Certificate searches now use
  a shared bounded query contract: keywords are limited to 200 characters,
  control characters are rejected before any upstream request, and invalid
  input does not consume a hosted certificate-search operation. Results retain
  structured provenance: each match groups observed hostnames by canonical
  registrable domain, records the earliest and latest CT observation
  timestamps, and counts distinct certificates. CT timestamps are public-log
  observation metadata — they do not prove that a site is active, malicious,
  or registered at a particular time.
- Discover presents these structured results as **one selectable candidate per
  registrable domain**, sorted by most recent CT observation. Each candidate's
  observed certificate hostnames stay visible as provenance (filtering matches
  both the canonical domain and its hostnames), and only the canonical
  registrable domains are sent on to Bulk. The bounded CT provenance (observed
  hostnames, first/last observation timestamps, distinct certificate count)
  rides along through the browser-session handoff and is shown compactly in
  Bulk beside each scanned row and in the CSV export (`ct_first_observed`,
  `ct_last_observed`, `ct_certificate_count`, `ct_hostnames`). CT observation
  timestamps and certificate counts are provenance only — they never feed the
  Risk or Opportunity scores. An older backend that returns only the legacy
  hostname list still works: Discover falls back to hostname-only candidates,
  notes that detailed CT provenance was unavailable, and hands them off
  without manufacturing timestamps or counts.
- Complete structured certificate searches also maintain a bounded,
  browser-local baseline for each normalized keyword. A later search labels
  canonical domains that were absent from the previous complete result and
  can filter the list to those new observations. Capped and legacy responses
  are retained in the local check summary but never replace a complete
  baseline, avoiding false "new" labels after a partial result. Discover's
  **Previous certificate searches** panel can reuse or delete individual
  searches, or clear all CT history. This history stays in `localStorage`, is
  limited to 30 searches and 20 checks per search, and can be removed without
  affecting watchlists, cases, or Brand Profiles.
- A registered result with a published abuse contact (from RDAP or WHOIS)
  gets a **Report abuse** draft - a prefilled takedown request referencing
  that domain's risk signals, with the same mailto-link-plus-copy-button
  pattern as the acquisition outreach draft.

### Analyst cases

Move a finding from discovery into a documented investigation. From a **Lookup**
result or a **Bulk** row you can open a **case** for a domain; **Monitor** is the
full investigation workspace, with `Cases`, `Campaigns`, `Relationships`, and
`Watchlists` tabs.

- Each case carries an analyst **status** (New, Reviewing, Monitoring,
  Escalated, Resolved), a **disposition** (Unreviewed, Suspicious, Confirmed
  abuse, False positive, Expected, Closed without action), free-text **tags**,
  timestamped **notes**, its **source** (Lookup, Bulk, Monitor), and a bounded,
  chronological **evidence history**: a small set of normalized snapshots
  (availability, risk/opportunity scores, registrar, dates, nameservers, mail
  and website signals) captured from results over time - never the raw registry,
  RDAP, DNS, HTML, or screenshot data. Re-capturing materially identical
  evidence advances the latest snapshot's timestamp rather than adding a
  duplicate entry; only a material change opens a new snapshot. Monitor exposes
  the full evidence timeline for every case: newest-to-oldest observations with
  capture source, scan depth, repeat-detection, and depth-aware field-level
  change reports. When capture depths differ enough to prevent reliable
  comparison, the timeline explains why rather than falsely reporting a change or
  a removal.
- Monitor lets you filter by status and disposition, search by domain or tag,
  sort by recent activity, edit a case inline, and delete one with a
  confirmation. A case links back to a fresh **Look up** of its domain, and
  Lookup/Bulk link forward into the matching Monitor record.
- Expanded cases also compare their latest compact evidence against the other
  cases already stored in that browser. Exact retained normalized nameserver
  sets and exact final HTTP(S) origins can become bounded cross-case
  investigation pivots. This comparison makes no network requests, creates no
  aggregate score or ownership claim, and does not add a new persisted relationship
  record; shared DNS, redirect, hosting, CDN, parking, and platform services
  remain common explanations.
- The **Relationships** tab presents those same bounded comparisons in a
  semantic table with search, relationship-family filtering, stable sorting,
  explicit partial-result labels, and direct case pivots. The projection shows
  at most 50 relationships and 20 case links per row, transforms into labelled
  stacked rows on narrow screens, and creates no new request, score, or stored
  relationship record.
- The **Campaigns** tab groups existing cases into bounded browser-local
  investigations. Each campaign retains only a name, optional description,
  and up to 50 normalized case domains; it does not duplicate case evidence,
  notes, status, or disposition. A missing domain remains visible as an
  unavailable case so portable membership is not silently lost after a case
  deletion or import on another browser. Campaign membership is an analyst
  organization aid, not evidence of common ownership, coordination, intent,
  or maliciousness.
- Campaign collection export/import uses a separate versioned JSON contract.
  Imports merge matching campaign IDs non-destructively: domain membership is
  unioned, while newer valid metadata wins. The store is limited to 50
  campaigns, 50 domains per campaign, a 512 KiB serialized budget, and 2 MB
  import files. Campaign data stays in `localStorage` under
  `whoisleuth-campaigns-v1` and never leaves the browser unless deliberately
  exported.
- **Cases live only in the current browser.** They are held in `localStorage`
  under `whois-rdap-cases-v1` and are never sent to any server. Clearing your
  browser storage (or using a different browser or device) removes them unless
  you exported them first. The store is at schema version 2; a version-1 store
  (single evidence snapshot) is discovered under the same key and migrated to an
  evidence history on load, and a store written by a newer, unsupported version
  is never overwritten.
- **Export** writes a portable JSON file that includes the schema version and an
  export timestamp. **Import** merges a file into your existing cases by domain.
  Tags, notes, and evidence snapshots are unioned (identical snapshots
  deduplicate, and an older import can never move an observation backwards),
  while a scalar field (status, disposition, source) is only replaced when the
  imported record is both valid and more recently updated than your local copy -
  a record with a missing or invalid timestamp is treated as older than any
  local case, and a field absent from an imported record never overwrites your
  local value. So importing can add context but cannot silently reset a local
  status, disposition, or decision. Imports are capped at 2 MB and validated
  field by field; unknown or malformed records are skipped rather than trusted.
- Storage is bounded to keep it safe and predictable: up to 500 cases, 50 notes
  per case (2000 characters each), 20 tags per case (40 characters each), and 25
  evidence snapshots per case. The whole store is held to a serialized byte
  budget: if evidence history would push it over, the oldest snapshots are
  pruned first, and analyst-authored notes, tags, status, and decisions are
  never discarded to make room. Old or malformed stored data is repaired on load
  rather than crashing the app.
- **Single-case evidence reports** are available inside each expanded case in
  Monitor. You can export a _structured JSON_ or _readable Markdown_ package
  containing the case summary, current assessment, full evidence timeline
  (chronological, with depth-aware change reports), and an explicit
  `notesIncluded` indicator. The **Include analyst notes** checkbox defaults to
  **off** — enable it only when you need the notes in the report. These reports
  are generated locally in the browser, never uploaded or sent automatically,
  and are **not** import files (they are read-only evidence packages, distinct
  from the whole-store backup/import JSON described above). Reports include a
  limitations statement confirming that they contain normalized observations,
  not raw registry/web responses, and that snapshot fingerprints are
  deduplication identifiers rather than cryptographic evidence hashes.
- **Notes may contain sensitive investigation detail** (analyst identities,
  victim data, internal decisions). Treat an exported case file as sensitive:
  store it somewhere access-controlled and share it deliberately. Review every
  report before sharing it — Markdown reports in particular should be checked
  for escaped content that an analyst or import may have stored.

### Public synthetic demo

The unauthenticated `/demo` route presents one bounded fictional workflow from
brand definition through candidate discovery, triage, evidence review, and a
synthetic case export. It uses fixed fixtures on reserved domains and makes no
live registry, DNS, website, certificate, Netlify Function, or other analysis
request. Demo progress is kept only in `sessionStorage` under
`whoisleuth:synthetic-demo:v1`; it never reads or writes production Brand
Profiles, candidates, cases, campaigns, watchlists, or history, and **Reset
demo** removes the tab-scoped record.

Demo exports use the distinct `whoisleuth.synthetic-demo-case` schema, carry
`synthetic: true`, and include an explicit warning that they are not live
findings, evidence packages, or abuse reports. The demo is a representative
product walkthrough rather than a shadow implementation of every workspace.

## Rate limiting

Authentication attempts and network-heavy API routes are rate-limited per
client IP (`lib/rate-limit.mts`), shared by `server.mts` and the Netlify
Functions:

- `/api/login` - 10 attempts per 5 minutes, since the shared password is the
  tool's only access control and the main thing worth throttling.
- `/api/lookup`, `/api/rdap`, `/api/whois`, `/api/availability`, `/api/ct-search`,
  `/api/domain-posture` - 1000 requests per minute, generous enough to clear a
  full 2000-domain fast bulk scan without breaking normal use, while still
  capping a scripted flood well below what upstream registries would treat as
  abuse.

Exceeding either limit returns `429` with a `Retry-After` header. The limiter
is in-memory: on `server.mts` (one long-lived process) it applies globally; on
Netlify Functions each container has its own memory, so it only limits bursts
within a single warm container rather than across the whole deployment - a
cheap first line of defense, not a substitute for a shared store (e.g. Redis)
under sustained distributed abuse. Netlify deployments additionally apply
its edge-enforced, per-IP rate limiting to the canonical `/api/login` and
`/api/lookup` paths. Those two rules use the code-based allowance available
on all Netlify plans and protect the password gate and the main high-volume
scan path before a function container is invoked.
Requests made directly to `/.netlify/functions/*` do not pass through those
path-specific edge rules. The function-level limiter still applies, but it is
container-local; deployments that need durable protection against distributed
abuse should add a shared rate-limit store or platform-level traffic controls.

Network-heavy authenticated work also uses immediate in-memory concurrency
leases. These are cost classes rather than provider quotas:

| Operation class | Included work | Per session | Per runtime instance |
| --- | --- | ---: | ---: |
| `registry_light` | fast Lookup, RDAP, fast availability | 12 | 36 |
| `registry_deep` | deep Lookup, WHOIS, deep availability | 4 | 12 |
| `certificate_search` | Certificate Transparency search | 2 | 4 |
| `posture_audit` | domain-posture audit | 3 | 8 |

Each admitted request also receives a versioned, server-derived feature
identity for later durable accounting. Version 1 distinguishes fast/deep
Lookup, fast/deep compact Bulk work, direct RDAP, direct WHOIS, fast/deep
availability, Certificate Transparency, and domain-posture requests while
continuing to map them onto the four cost classes above. Compact response mode
is the existing Bulk API contract; it is useful attribution, but not a security
boundary because a custom client can choose another compatible response shape.
Future deployment-wide totals must therefore retain an overall limit as well as
feature-specific limits.

An exhausted lease returns `429`, `Retry-After: 1`, and the stable
`NETWORK_CONCURRENCY_LIMITED` error code. The lease is always released when
the request succeeds or fails. Session keys are irreversible hashes of valid
session tokens; bearer tokens are not retained in the budget maps.

Express and Netlify enter these leases through the same provider-neutral
runner. Its contract uses one atomic acquire decision, an explicit lease
release, and bounded status reporting; acquisition and release may be
synchronous or asynchronous. The default provider remains entirely in memory.

Deployments can optionally set both `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` to enforce the same ceilings across runtime
instances through the service's HTTPS REST API. No additional package is
required. `WHOISLEUTH_BUDGET_NAMESPACE` can provide a deployment-specific
1-64 character key prefix when one database is shared; otherwise a versioned
default is used. The write-capable REST token is a server secret and must never
be exposed to browser code, committed, or included in a public build.

Distributed acquisition uses one atomic server-side script over expiring
sorted-set leases and release uses one further command. Leases contain only an
operation class, opaque random identifier, expiry, and one-way hash of the
existing session fingerprint—never query targets, evidence, responses, or the
session token. A five-minute lease expiry recovers capacity after interrupted
serverless invocations without allowing a late release to decrement a newer
lease. Provider outages fail closed with HTTP `503` and the stable
`NETWORK_BUDGET_UNAVAILABLE` code rather than silently reverting to per-instance
limits.

An operator can additionally set `WHOISLEUTH_OPERATION_USAGE_LIMITS` to a
bounded JSON policy. It requires global `daily` and `monthly` positive integer
ceilings and accepts optional limits for the version-1 operation features:

```json
{
  "daily": 2000,
  "monthly": 20000,
  "features": {
    "bulk_deep": { "daily": 250, "monthly": 2500 },
    "certificate_transparency": { "daily": 100, "monthly": 1000 }
  }
}
```

These figures are examples, not hosting-plan recommendations. Choose them from
the deployment's measured request costs and provider allowances. The policy is
valid only with both distributed REST credentials; missing credentials or a
malformed policy fail closed rather than silently disabling accounting.

Accounting uses provider server time and fixed UTC-epoch-aligned 24-hour and
30-day buckets. The 30-day bucket is not a calendar month, rolling window, or
provider billing total. One atomic acquisition checks session/runtime
concurrency, the global counters, and any configured feature counters before it
creates a lease or increments usage. A concurrency denial or provider failure
does not consume usage; an admitted operation remains counted even if its
downstream lookup later fails. Every admitted feature is counted, even without
a feature ceiling, and the global ceiling cannot be bypassed by selecting a
different compatible response shape. Counter keys retain only the operation
feature, fixed-window identifier, and integer count and expire shortly after
their window ends.

Usage exhaustion returns HTTP `429`, a `Retry-After` value bounded by the
current window reset, and `NETWORK_USAGE_LIMITED` with a global/feature and
24-hour/30-day scope. Enabling usage accounting does not add provider commands:
an allowed operation still uses one atomic acquisition command and one release
command. The container-local fixed-window request limiter remains a separate
control.

Without the optional provider, these concurrency ceilings have the same
local-only boundary as the fixed-window limiter. Express enforces them across
one process. Netlify enforces them only inside one warm function instance,
with state reset on cold starts. Direct function paths still perform
function-level authentication, rate limiting, and concurrency checks even
when they bypass canonical-path edge rules.

## Deploying to Netlify

This repository also ships TypeScript Netlify Functions for RDAP, WHOIS,
availability, Certificate Transparency search, and domain-posture audits. They
remain thin entry points over the same `lib/` code `server.mts` uses, so behavior
is identical either way. To deploy:

1. Push this repo to GitHub and connect it in Netlify (or run `netlify deploy`
   from the Netlify CLI if you have it installed).
2. Netlify reads `netlify.toml`, runs `npm run build`, publishes the
   prerendered `frontend/build/` workspace, and builds the functions in
   `netlify/functions/`. Direct routes such as `/lookup`, `/bulk`, and
   `/monitor` resolve to independent static HTML entries rather than relying
   on a catch-all client-side rewrite.
3. In the Netlify dashboard, set `SITE_PASSWORD` and a separate random
   `SESSION_SECRET` environment variable
   (Site settings → Environment variables) before your first deploy - the
   login/session functions read them the same way `server.mts` does. Without
   `SITE_PASSWORD`, authentication fails closed and nobody can log in.

Bulk scans run as one `/api/lookup` call per domain with client-side
concurrency (see `frontend/src/routes/bulk/+page.svelte`) rather than one long server-held
request, since serverless functions have a per-invocation execution limit -
this keeps each function call short regardless of how many domains are in a
bulk run.

## Project structure

```
LICENSE                 Apache 2.0 license text
NOTICE                  Copyright attribution notice
PRIVACY.md              Template privacy notice - what data is processed, retention, deletion
server.mts               Express backend: lookup/posture/auth routes
frontend/               SvelteKit multi-page frontend workspace
  src/routes/           Lookup, Discover, Bulk, Monitor, Brands, and Privacy pages
  src/lib/              Browser state, workflow helpers, and analysis modules
    cases.ts            Browser-local analyst case store (localStorage wrapper)
    analysis/           Framework-neutral scoring, comparison, generation, history, and case logic
  static/               Frontend-owned static assets
  build/                Generated static output (ignored; created by npm run build)
lib/                    Shared lookup logic, used by both server.mts and netlify/functions/
  classify.mts          Query classification (domain/IPv4/IPv6/ASN)
  rdap.mts              IANA bootstrap lookup + RDAP response parsing
  whois.mts             WHOIS (TCP/43) referral chain + response parsing
  availability.mts      Availability/opportunity signal derivation
  dns-mx.mts            MX-record lookup (phishing-risk signal for deep checks)
  domain-posture.mts    Owned-domain DNS collection, assessment, and remediation
  domain-posture-parsers.mts  Pure SPF/DMARC/MTA-STS/TLS-RPT/BIMI/DKIM parsers
  favicon.mts           Favicon SHA-256 hash fetch (phishing-clone signal for deep checks)
  html-signals.mts      Bounded homepage signals and versioned static page-identity evidence
  tls-intelligence.mts  One-connection TLS/certificate profile with public-address pinning
  threat-intelligence-contract.mts  Bounded policy and result boundary for optional external providers
  ct-search.mts         Certificate Transparency search (crt.sh) for lookalike hostnames
  safe-fetch.mts        SSRF-guarded fetch (blocks private/loopback/link-local targets)
  auth.mts              Shared-password session cookie (sign/verify, no user accounts)
  rate-limit.mts        Per-IP rate limiting for login and lookup routes
netlify/functions/      Netlify Functions (lookups, posture audit, auth/session)
netlify.toml            Netlify build/redirect config
docs/architecture.md    System context, request pipeline, trust boundaries, and trade-offs
docs/engineering-case-study.md  Project constraints, decisions, challenges, and review guide
docs/registry-data-contract.md  Normalized registry source and evidence contracts
```

The frontend is a prerendered SvelteKit multi-page app built with Vite. The
Node server and Netlify both serve the same generated `frontend/build/`
output.
