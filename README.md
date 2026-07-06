# WHOISleuth

A local WHOIS + RDAP lookup tool for checking domain, IP, and ASN records —
single lookups or bulk scans of a domain list — backed by the official IANA
RDAP bootstrap service and live WHOIS (TCP/43) queries to the relevant
registries. Includes availability/opportunity scoring, a typosquat
phishing-risk score, a Certificate Transparency search for lookalikes not yet
in any generated candidate list, abuse-report drafting, keyword/typosquat
candidate generators, a browser-local shortlist and watchlist, and CSV
import/export for bulk runs.

Runs as a small Node backend (needed for raw WHOIS sockets and cross-origin
RDAP requests, which browsers can't do directly) serving a static frontend
with no build step. This branch splits the lookup logic into a shared `lib/`
so it can run either as a traditional always-on Node/Express server
(`server.js`) or as Netlify Functions (`netlify/functions/`) with no logic
duplicated between the two.

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

- [Node.js](https://nodejs.org/) 18 or later (uses the built-in `fetch` API)
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

The server listens on port 3000 by default. To use a different port:

```bash
PORT=4000 SITE_PASSWORD=choose-a-password npm start
```

## Usage

- Enter a single domain, IPv4/IPv6 address, or ASN in the search box for a
  full RDAP + WHOIS + availability lookup.
- Paste or upload a CSV/list of multiple domains to run a bulk scan instead.
- Use the keyword or typosquat generators to populate the search box with
  candidate domains, then click **Lookup**.
- Star any bulk result to add it to the **Shortlist**, which persists in the
  browser's local storage.
- A deep-checked (registered) result also gets a **Risk** score — a
  phishing-risk indicator (active site, configured mail server, hidden
  ownership, recent registration) distinct from the **Opportunity** score,
  which instead rates how approachable a domain is to acquire.
- Save a generated typosquat set as a **Watchlist** and re-scan it later —
  domains that moved from available/unknown to registered since the last
  check are flagged as new registrations (a fresh squatting attempt), and
  any that lapsed back to available are flagged as released.
- Use **Search Certificate Transparency logs** to find hostnames with a
  publicly-issued TLS certificate matching a brand keyword — catches
  lookalikes the typosquat generator's fixed permutations would never guess,
  often before the domain shows up anywhere else.
- A registered result with a published abuse contact (from RDAP or WHOIS)
  gets a **Report abuse** draft — a prefilled takedown request referencing
  that domain's risk signals, with the same mailto-link-plus-copy-button
  pattern as the acquisition outreach draft.
- A single-domain lookup's availability card shows the same **Opportunity**
  and **Risk** score chips as the bulk results table, next to the status
  pill.
- Hover any Opportunity/Risk score chip for a tooltip breaking down exactly
  which signals contributed and by how much (e.g. "Base score for
  'registered' +40, Active site in use -20, ... Total 30"). The same
  breakdown is included as extra columns in CSV exports.

## Rate limiting

All `/api/*` routes are rate-limited per client IP (`lib/rate-limit.js`),
shared by `server.js` and the Netlify Functions:

- `/api/login` — 10 attempts per 5 minutes, since the shared password is the
  tool's only access control and the main thing worth throttling.
- `/api/rdap`, `/api/whois`, `/api/availability`, `/api/ct-search` — 1000
  requests per minute, generous enough to clear a full 2000-domain fast bulk
  scan without breaking normal use, while still capping a scripted flood well
  below what upstream registries would treat as abuse.

Exceeding either limit returns `429` with a `Retry-After` header. The limiter
is in-memory: on `server.js` (one long-lived process) it applies globally; on
Netlify Functions each container has its own memory, so it only limits bursts
within a single warm container rather than across the whole deployment — a
cheap first line of defense, not a substitute for a shared store (e.g. Redis)
under sustained distributed abuse.

## Deploying to Netlify

This branch also ships `netlify/functions/rdap.js`, `whois.js`,
`availability.js`, and `ct-search.js` — thin wrappers around the same `lib/`
code `server.js` uses, so behavior is identical either way. To deploy:

1. Push this repo to GitHub and connect it in Netlify (or run `netlify deploy`
   from the Netlify CLI if you have it installed).
2. Netlify reads `netlify.toml` to publish `public/` and build the functions
   in `netlify/functions/` automatically — no extra build command needed.
3. In the Netlify dashboard, set a `SITE_PASSWORD` environment variable
   (Site settings → Environment variables) before your first deploy — the
   login/session functions read it the same way `server.js` does. Without
   it, `checkPassword`/`isValidSessionToken` fail closed and nobody (not even
   the correct password) can log in.

Bulk scans run as one `/api/availability` call per domain with client-side
concurrency (see `public/js/bulk.js`) rather than one long server-held
request, since serverless functions have a per-invocation execution limit —
this keeps each function call short regardless of how many domains are in a
bulk run.

## Project structure

```
server.js            Express backend: RDAP/WHOIS/availability/auth routes
lib/                  Shared lookup logic, used by both server.js and netlify/functions/
  classify.js           Query classification (domain/IPv4/IPv6/ASN)
  rdap.js               IANA bootstrap lookup + RDAP response parsing
  whois.js              WHOIS (TCP/43) referral chain + response parsing
  availability.js       Availability/opportunity signal derivation
  dns-mx.js              MX-record lookup (phishing-risk signal for deep checks)
  ct-search.js           Certificate Transparency search (crt.sh) for lookalike hostnames
  safe-fetch.js         SSRF-guarded fetch (blocks private/loopback/link-local targets)
  auth.js               Shared-password session cookie (sign/verify, no user accounts)
  rate-limit.js          Per-IP rate limiting for login and lookup routes
netlify/functions/    Netlify Functions (rdap, whois, availability, ct-search, login, logout, session)
netlify.toml          Netlify build/redirect config
public/
  index.html          Page markup
  style.css            Styles
  js/
    main.js              Entry point: form submit, wiring
    auth.js              Shared-password login gate
    dom.js               Shared DOM element references
    utils.js             Parsing/formatting helpers
    scoring.js           Opportunity scoring, activity/privacy formatting
    render.js            RDAP/WHOIS/availability rendering
    outreach.js           Acquisition outreach draft + copy-to-clipboard
    abuse.js               Abuse-report draft + copy-to-clipboard
    generators.js         Keyword and typosquat candidate generators
    ct-search.js           Certificate Transparency search UI
    shortlist.js          localStorage-backed shortlist
    watchlist.js          localStorage-backed watchlist with re-scan diffing
    single-lookup.js       Single domain/IP/ASN lookup orchestration
    bulk.js                Bulk scan/deep-check, sorting, CSV export
```

No bundler or framework — the frontend loads native ES modules directly via
`<script type="module">`.
