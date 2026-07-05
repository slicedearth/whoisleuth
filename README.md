# WHOIS & RDAP Lookup Tool

A local WHOIS + RDAP lookup tool for checking domain, IP, and ASN records —
single lookups or bulk scans of a domain list — backed by the official IANA
RDAP bootstrap service and live WHOIS (TCP/43) queries to the relevant
registries. Includes availability scoring, keyword/typosquat candidate
generators, a browser-local shortlist, and CSV import/export for bulk runs.

Runs as a small Node backend (needed for raw WHOIS sockets and cross-origin
RDAP requests, which browsers can't do directly) serving a static frontend
with no build step. This branch splits the lookup logic into a shared `lib/`
so it can run either as a traditional always-on Node/Express server
(`server.js`) or as Netlify Functions (`netlify/functions/`) with no logic
duplicated between the two.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later (uses the built-in `fetch` API)
- npm (bundled with Node)

## Install & run

```bash
npm install
npm start
```

Then open **http://localhost:3000** in a browser.

The server listens on port 3000 by default. To use a different port:

```bash
PORT=4000 npm start
```

## Usage

- Enter a single domain, IPv4/IPv6 address, or ASN in the search box for a
  full RDAP + WHOIS + availability lookup.
- Paste or upload a CSV/list of multiple domains to run a bulk scan instead.
- Use the keyword or typosquat generators to populate the search box with
  candidate domains, then click **Lookup**.
- Star any bulk result to add it to the **Shortlist**, which persists in the
  browser's local storage.

## Deploying to Netlify

This branch also ships `netlify/functions/rdap.js`, `whois.js`, and
`availability.js` — thin wrappers around the same `lib/` code `server.js`
uses, so behavior is identical either way. To deploy:

1. Push this repo to GitHub and connect it in Netlify (or run `netlify deploy`
   from the Netlify CLI if you have it installed).
2. Netlify reads `netlify.toml` to publish `public/` and build the functions
   in `netlify/functions/` automatically — no extra build command needed.

Bulk scans run as one `/api/availability` call per domain with client-side
concurrency (see `public/js/bulk.js`) rather than one long server-held
request, since serverless functions have a per-invocation execution limit —
this keeps each function call short regardless of how many domains are in a
bulk run.

## Project structure

```
server.js            Express backend: RDAP/WHOIS/availability routes
lib/                  Shared lookup logic, used by both server.js and netlify/functions/
  classify.js           Query classification (domain/IPv4/IPv6/ASN)
  rdap.js               IANA bootstrap lookup + RDAP response parsing
  whois.js              WHOIS (TCP/43) referral chain + response parsing
  availability.js       Availability/opportunity signal derivation
netlify/functions/    Netlify Functions (rdap.js, whois.js, availability.js)
netlify.toml          Netlify build/redirect config
public/
  index.html          Page markup
  style.css            Styles
  js/
    main.js              Entry point: form submit, wiring
    dom.js               Shared DOM element references
    utils.js             Parsing/formatting helpers
    scoring.js           Opportunity scoring, activity/privacy formatting
    render.js            RDAP/WHOIS/availability rendering
    outreach.js           Outreach draft + copy-to-clipboard
    generators.js         Keyword and typosquat candidate generators
    shortlist.js          localStorage-backed shortlist
    single-lookup.js       Single domain/IP/ASN lookup orchestration
    bulk.js                Bulk scan/deep-check, sorting, CSV export
```

No bundler or framework — the frontend loads native ES modules directly via
`<script type="module">`.
