<p align="center">
  <img src="frontend/static/favicon.svg" width="72" height="72" alt="WHOISleuth logo" />
</p>

<h1 align="center">WHOISleuth</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License: Apache 2.0" />
  <img src="https://img.shields.io/badge/node-%3E%3D20.19-brightgreen" alt="Node >= 20.19" />
  <img src="https://img.shields.io/badge/frontend-SvelteKit%20%2B%20Vite-ff3e00" alt="SvelteKit and Vite" />
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
Findings can be triaged, drafted into abuse reports, kept in a browser-local
shortlist, and monitored over time with a watchlist that records a bounded
timeline of material changes - all with CSV/JSON import/export. Brand Profiles
can also audit their official domains' mail and DNS posture (SPF, DMARC, MX,
DNSSEC, CAA, MTA-STS, TLS-RPT, BIMI, and explicitly configured DKIM
selectors).

Runs as a small Node backend (needed for raw WHOIS sockets and cross-origin
RDAP requests, which browsers can't do directly) serving a prerendered
SvelteKit frontend built with Vite. The lookup logic lives in a shared `lib/`
so it can run either as a traditional always-on Node/Express server
(`server.js`) or as Netlify Functions (`netlify/functions/`) with no logic
duplicated between the two.

## Contents

- [Disclaimer](#disclaimer)
- [Requirements](#requirements)
- [Install & run](#install--run)
- [Usage](#usage)
- [Rate limiting](#rate-limiting)
- [Deploying to Netlify](#deploying-to-netlify)
- [Project structure](#project-structure)

## Disclaimer

Licensed under Apache 2.0 (see [LICENSE](LICENSE)) - provided **as is, with
no warranty**. A few things worth being deliberate about before you rely on
this tool or point it at data that isn't your own:

- **Data accuracy.** RDAP/WHOIS responses are only as current, complete, and
  correctly-parsed as the upstream registry provides - fields can be
  redacted, stale, or missing entirely (see the WHOIS parsing notes in
  `lib/whois.js`). Don't treat the Opportunity/Risk scores, availability
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

- [Node.js](https://nodejs.org/) 20.19.0 or later (required by the Svelte build toolchain)
- npm (bundled with Node)

## Install & run

```bash
npm install
SITE_PASSWORD=choose-a-password SESSION_SECRET=choose-a-separate-random-secret npm start
```

Then open **http://localhost:3000** in a browser and enter that password.

The whole tool sits behind a shared-password gate - `SITE_PASSWORD` is
required, and every `/api/*` route rejects requests without a valid session
regardless of whether the frontend gate is showing. There's no per-user
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
suite (Chromium only) covering authentication, mobile navigation, the Lookup
input, and Bulk analysis. It builds and runs its own local production-style
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
- Structured domain results retain registry object IDs, registrar IANA IDs,
  registrar WHOIS endpoints, and reseller data when published. Fast Bulk scans
  are RDAP-only; full Lookup and deep scans retain the WHOIS referral chain.
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
- IPv4, IPv6, and ASN RDAP results retain their bounded status and lifecycle
  metadata instead of treating those fields as domain-only. Published CIDR0
  prefixes are accepted only for the requested address family and malformed
  neighbouring entries are discarded; status, event, and CIDR caps are
  disclosed in normalized results and the Lookup view.
- After a successful single lookup, **Export JSON** downloads a versioned
  evidence package containing the submitted/registrable-domain context,
  normalized and raw RDAP/WHOIS sources, source endpoints and timestamps,
  discrepancy analysis, and availability/web/mail findings. The download is
  created locally and may contain contact data published by the registry.
- The unified `/api/lookup` response includes a versioned `diagnostics`
  object with independent RDAP, WHOIS, and availability statuses, source
  provenance, and stable source error codes. HTTP errors retain the existing
  human-readable `error` and add a machine-readable `errorCode` such as
  `AUTH_REQUIRED`, `RATE_LIMITED`, `MISSING_QUERY`, or `INVALID_QUERY`, so
  clients do not need to match message text.
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
- Star any bulk result to add it to the **Shortlist**, which persists in the
  browser's local storage.

### Opportunity & Risk scoring

- A deep-checked (registered) result gets a **Risk** score - a phishing-risk
  indicator (active site, configured mail server, hidden ownership, recent
  registration) distinct from the **Opportunity** score, which instead rates
  how approachable a domain is to acquire.
- A single-domain lookup's availability card shows a compact, numbered
  **Risk** and **Opportunity** meter beside the status: the bar speeds up
  scanning but never replaces the score value.
- Hover any Opportunity/Risk meter or bulk-table score for a tooltip breaking down exactly
  which signals contributed and by how much (e.g. "Base score for
  'registered' +40, Active site in use -20, ... Total 30"). The same
  breakdown is included as extra columns in CSV exports.

### Brand protection & monitoring

- Save a **Brand Profile** (official domains, product names, TLDs, approved
  partner domains, and an allowlist) - the typosquat generator can prefill
  from the active profile and drops candidates already in its allowlist, and
  bulk/watchlist results mark any domain in the allowlist instead of
  treating your own domain as a lookalike.
- Run **Audit official domains** from a Brand Profile to check preventive
  mail/DNS controls. Each finding retains its source records, explains why it
  passed or needs review/action, and provides a concrete next step. DKIM is
  checked only for selectors saved in the profile because selectors cannot be
  discovered reliably from DNS; the audit never guesses them.
- A brand profile can also fetch and save its official site's favicon hash
  (a plain SHA-256 of the raw `/favicon.ico` bytes, computed during any deep
  check). A registered lookalike serving that exact same favicon - a common
  tell for a cloned phishing kit - gets flagged in results and contributes
  heavily to its Risk score.
- A deep check also pulls a few signals straight from the domain's homepage
  HTML at no extra fetch cost: a login/password form, urgency-driven
  phishing/social-engineering language ("verify your account", "security
  alert", ...), the page title, and any image/script/stylesheet it loads
  directly from your official domain instead of copying - a lazy
  phishing-kit tell. All feed into the Risk score.
- A bulk scan flags **Related infrastructure**: domains in the same scan
  that share an exact nameserver set or favicon hash with each other, with
  a one-click way to load the group back into the query box. Uses signals
  already collected by the scan - no extra lookups - and can surface a
  whole campaign even without a brand profile to compare against.
- **Bulk triage controls** keep large scans usable: filter by availability
  family, high-risk score, error state, mutation family, and one or more
  evidence signals. Counts update while the scan runs; filters change only
  the visible rows, never the saved/exported scan data.
- Typosquat candidates retain their **mutation provenance** (omission,
  keyboard substitution, homoglyph, dictionary term, TLD typo, and the other
  generator families) through bulk results, watchlists, and CSV export. When
  several algorithms produce the same domain, every contributing family is
  retained rather than silently discarded.
- After a generated-list scan, **Defensive registration coverage** groups the
  results by mutation family and TLD: protected/allowlisted domains,
  registered exposures, available gaps, and unknown results. Groups can be
  loaded back into the query box or exported as a coverage CSV, using scan
  data already collected with no extra network calls.
- Save a generated typosquat set as a **Watchlist** and re-scan it later.
  Each watchlist retains a bounded, browser-local timeline of material
  availability, registrar, nameserver, date, mail, website, and Risk-score
  changes. Fast rescans update registration data without erasing last-known
  deep-scan evidence; an explicit deep re-scan refreshes page/mail signals.
  Deep watchlist rescans keep the same 200-domain safety limit as other deep
  checks; larger watchlists remain available for fast registration monitoring.
  Timeline entries can be filtered to changed checks only and are included
  in the existing JSON backup/export.
- Use **Search Certificate Transparency logs** to find hostnames with a
  publicly-issued TLS certificate matching a brand keyword - catches
  lookalikes the typosquat generator's fixed permutations would never guess,
  often before the domain shows up anywhere else. Results now retain
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
full case workspace (a `Cases` tab alongside `Watchlists`).

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

## Rate limiting

All `/api/*` routes are rate-limited per client IP (`lib/rate-limit.js`),
shared by `server.js` and the Netlify Functions:

- `/api/login` - 10 attempts per 5 minutes, since the shared password is the
  tool's only access control and the main thing worth throttling.
- `/api/lookup`, `/api/rdap`, `/api/whois`, `/api/availability`, `/api/ct-search`,
  `/api/domain-posture` - 1000 requests per minute, generous enough to clear a
  full 2000-domain fast bulk scan without breaking normal use, while still
  capping a scripted flood well below what upstream registries would treat as
  abuse.

Exceeding either limit returns `429` with a `Retry-After` header. The limiter
is in-memory: on `server.js` (one long-lived process) it applies globally; on
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

## Deploying to Netlify

This branch also ships `netlify/functions/rdap.js`, `whois.js`,
`availability.js`, `ct-search.js`, and `domain-posture.js` - thin wrappers
around the same `lib/` code `server.js` uses, so behavior is identical either
way. To deploy:

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
   login/session functions read them the same way `server.js` does. Without
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
server.js               Express backend: lookup/posture/auth routes
frontend/               SvelteKit multi-page frontend workspace
  src/routes/           Lookup, Discover, Bulk, Monitor, Brands, and Privacy pages
  src/lib/              Browser state, workflow helpers, and analysis modules
    cases.ts            Browser-local analyst case store (localStorage wrapper)
    analysis/           Framework-neutral scoring, comparison, generation, history, and case logic
  static/               Frontend-owned static assets
  build/                Generated static output (ignored; created by npm run build)
lib/                    Shared lookup logic, used by both server.js and netlify/functions/
  classify.js           Query classification (domain/IPv4/IPv6/ASN)
  rdap.js               IANA bootstrap lookup + RDAP response parsing
  whois.js              WHOIS (TCP/43) referral chain + response parsing
  availability.js       Availability/opportunity signal derivation
  dns-mx.js             MX-record lookup (phishing-risk signal for deep checks)
  domain-posture.js     Owned-domain DNS collection, assessment, and remediation
  domain-posture-parsers.js  Pure SPF/DMARC/MTA-STS/TLS-RPT/BIMI/DKIM parsers
  favicon.js            Favicon SHA-256 hash fetch (phishing-clone signal for deep checks)
  html-signals.js       Homepage-HTML signals (title, password field, phishing language, asset hotlinking)
  ct-search.js          Certificate Transparency search (crt.sh) for lookalike hostnames
  safe-fetch.js         SSRF-guarded fetch (blocks private/loopback/link-local targets)
  auth.js               Shared-password session cookie (sign/verify, no user accounts)
  rate-limit.js         Per-IP rate limiting for login and lookup routes
netlify/functions/      Netlify Functions (lookups, posture audit, auth/session)
netlify.toml            Netlify build/redirect config
```

The frontend is a prerendered SvelteKit multi-page app built with Vite. The
Node server and Netlify both serve the same generated `frontend/build/`
output.
