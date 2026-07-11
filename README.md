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
SITE_PASSWORD=choose-a-password npm start
```

Then open **http://localhost:3000** in a browser and enter that password.

The whole tool sits behind a shared-password gate - `SITE_PASSWORD` is
required, and every `/api/*` route rejects requests without a valid session
regardless of whether the frontend gate is showing. There's no per-user
login, just one password shared with whoever you want to have access; anyone
without it sees only the password prompt. Pick something you're comfortable
sharing with those people, not a password reused elsewhere.

`npm start` builds the prerendered multi-page frontend and starts the shared
Express/API process. The generated `frontend/build/` directory is the only
frontend served by the Node deployment.

The server listens on port 3000 by default. To use a different port:

```bash
PORT=4000 SITE_PASSWORD=choose-a-password npm start
```

Every push and pull request runs the locked install, test suite, JavaScript
type checks, Svelte checks, and production frontend build in GitHub Actions.
Run the same verification locally:

```bash
npm test
npm run typecheck
npm run check
npm run build
```

## Usage

### Looking up domains

- Enter a single domain, IPv4/IPv6 address, or ASN in the search box for a
  full RDAP + WHOIS + availability lookup.
- For domain lookups, the Summary compares overlapping RDAP and WHOIS fields
  after both sources finish. Equivalent values are normalized for harmless
  formatting differences, while source-only values and material conflicts
  retain both original source values for review.
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
  often before the domain shows up anywhere else.
- A registered result with a published abuse contact (from RDAP or WHOIS)
  gets a **Report abuse** draft - a prefilled takedown request referencing
  that domain's risk signals, with the same mailto-link-plus-copy-button
  pattern as the acquisition outreach draft.

## Rate limiting

All `/api/*` routes are rate-limited per client IP (`lib/rate-limit.js`),
shared by `server.js` and the Netlify Functions:

- `/api/login` - 10 attempts per 5 minutes, since the shared password is the
  tool's only access control and the main thing worth throttling.
- `/api/rdap`, `/api/whois`, `/api/availability`, `/api/ct-search`,
  `/api/domain-posture` - 1000 requests per minute, generous enough to clear a
  full 2000-domain fast bulk scan without breaking normal use, while still
  capping a scripted flood well below what upstream registries would treat as
  abuse.

Exceeding either limit returns `429` with a `Retry-After` header. The limiter
is in-memory: on `server.js` (one long-lived process) it applies globally; on
Netlify Functions each container has its own memory, so it only limits bursts
within a single warm container rather than across the whole deployment - a
cheap first line of defense, not a substitute for a shared store (e.g. Redis)
under sustained distributed abuse.

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
3. In the Netlify dashboard, set a `SITE_PASSWORD` environment variable
   (Site settings → Environment variables) before your first deploy - the
   login/session functions read it the same way `server.js` does. Without
   it, `checkPassword`/`isValidSessionToken` fail closed and nobody (not even
   the correct password) can log in.

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
    analysis/           Framework-neutral scoring, comparison, generation, and history logic
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
