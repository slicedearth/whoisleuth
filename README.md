<p align="center">
  <img src="frontend/static/favicon.svg" width="72" height="72" alt="WHOISleuth logo" />
</p>

<h1 align="center">WHOISleuth</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg" alt="License: AGPL-3.0-only" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node >= 24" />
  <img src="https://img.shields.io/badge/frontend-SvelteKit%20%2B%20Vite-ff3e00" alt="SvelteKit and Vite" />
  <a href="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml"><img src="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://app.netlify.com/projects/whoisleuth/deploys"><img src="https://api.netlify.com/api/v1/badges/600adb21-cece-4a13-8df8-d177ace3d945/deploy-status" alt="Netlify status" /></a>
</p>

WHOISleuth is a local-first domain intelligence and brand-protection console.
It brings registration, DNS, certificate, website, network, and brand context
into one review workflow without treating an unavailable source as evidence of
absence or safety.

Use it to inspect a domain, IP address, or ASN; discover possible brand
lookalikes; compare a bounded list of domains; document cases; and monitor
material changes. Evidence stays attributed to its source, collection limits
remain visible, and scores remain explainable prioritisation aids rather than
automated verdicts.

<p align="center">
  <a href="https://whoisleuth.com"><strong>View WHOISleuth</strong></a>
  &nbsp;·&nbsp;
  <a href="https://whoisleuth.com/demo"><strong>Explore the synthetic demo</strong></a>
  &nbsp;·&nbsp;
  <a href="https://whoisleuth.com/guide"><strong>Read the public guide</strong></a>
</p>

The demo uses fixed fictional evidence on reserved domains. It does not sign
in, run live analysis, or write to the protected Console's investigation data.

## What it does

| Area | Purpose | Important boundary |
| --- | --- | --- |
| **Lookup** | Inspect one domain, IP address, or ASN through separately attributed registration and supporting evidence. | Deep is the default. Fast performs lower-request registration-first triage. Optional providers and security.txt run only when selected. |
| **Discover** | Generate bounded typo, Unicode-confusable, keyboard, plural, separator, word-order, WWW-style, TLD, and dictionary candidates, including analyst-controlled token replacements and an opt-in two-character Unicode family, with optional Certificate Transparency discovery. Presets or an exact family selection control the local generator. | Candidate generation and optional custom dictionary input stay local. The advanced Unicode family is never preset-enabled. Confusability is a review lead, while certificate-log observations do not prove site activity or maliciousness. |
| **Bulk** | Compare multiple domains with filters, sorting, score explanations, CSV export, and scan-local relationship evidence. | Each domain is a separate bounded lookup. Bulk Deep returns a compact evidence profile rather than the complete single-domain result. |
| **Brands** | Save official domains, product names, allowlists, posture settings, and optional page-identity baselines. | Profiles stay in the current browser unless deliberately exported in a workspace archive. |
| **Monitor** | Manage cases, campaigns, relationships, watchlists, timelines, and evidence reports. | Ordinary investigation state is browser-local. Optional hosted monitoring stores only encrypted compact scheduled-watchlist state. |
| **Registry support** | Inspect fixture-backed parser coverage and documented registry access constraints. | Coverage metadata describes support and limitations. It never decides availability. |

Deep domain Lookup can combine:

- IANA-bootstrap RDAP and bounded WHOIS referral-chain evidence;
- separately attributed registrar RDAP when the registry publishes an eligible
  HTTPS link;
- authority-aware availability analysis;
- DNS, HTTP, favicon, page-identity, mail, and one-connection TLS evidence;
- passive technology and security-posture indicators derived from the captured
  response, without vulnerability testing;
- one observed public endpoint mapped to its IP RDAP network registration;
- optional security.txt and configured external intelligence sources.

Long source records and secondary Deep evidence start collapsed. Their status
and summary remain visible so the page can be scanned before opening the
evidence, provenance, and limitations that matter to the investigation. A
bounded source map uses locally rendered D3 geometry to connect the target to
separately attributed evidence and provide direct links to each visible source.
An ordered lifecycle view adds dated registry and certificate context without
pretending that visual spacing represents elapsed duration. HTTP redirect paths,
the Bulk Risk/Opportunity matrix, and retained watchlist activity use the same
bounded local visual layer. Large Bulk sets use a deterministic capped plot
while the table retains every result; watchlist activity covers retained history
only. These visuals make no additional request and do not replace their
accessible lists, tables, or source records.

## Design principles

- **Authority-aware conclusions.** Registry evidence controls registration
  decisions. Registrar, website, and provider evidence cannot silently replace
  it.
- **Source health is evidence.** Unsupported, skipped, partial, not found,
  rate-limited, unavailable, inconclusive, and error states remain distinct.
- **Bounded collection.** Requests, responses, redirects, arrays, strings,
  concurrency, caches, browser stores, and exports have explicit limits.
- **Safe outbound networking.** HTTP and TLS collection validate public
  addresses, revalidate redirects, resist DNS rebinding, and avoid private
  network targets.
- **Local-first investigation state.** Cases, profiles, watchlists, campaigns,
  shortlist entries, and rules use bounded IndexedDB stores in the current
  browser.
- **Explainable analysis.** Risk, Opportunity, page similarity, relationship,
  technology, and posture findings expose their evidence and limitations.
- **Supplementary visuals.** Charts summarize bounded data already present in
  the page. Accessible source lists and tables remain the complete review
  surfaces.
- **Human-controlled action.** WHOISleuth does not send reports, submit targets,
  run takedowns, or turn a score into an enforcement decision automatically.

## Quick start

Requirements:

- Node.js 24 or later
- npm

Install, build, and start the Express deployment:

```bash
npm install
SITE_PASSWORD=choose-a-password \
SESSION_SECRET=choose-a-separate-random-secret \
npm start
```

Open `http://localhost:3000` for the public overview or
`http://localhost:3000/login` for the protected Console.

`SITE_PASSWORD` is the deployment-wide shared password. `SESSION_SECRET`
should be a separate random value, such as 32 random bytes encoded as hex. The
application has no individual accounts, roles, or selective session
revocation. See the [getting-started guide](docs/getting-started.md) for local
development, verification, browser tests, and CLI usage.

## Architecture

WHOISleuth uses a prerendered SvelteKit frontend and a small Node network
boundary. Shared modules under `lib/` own classification, collection,
validation, normalization, scoring, and evidence contracts. Thin adapters call
those modules from either:

- `server.mts`, an Express server that also serves `frontend/build/`; or
- TypeScript functions under `netlify/functions/`.

The browser cannot open raw WHOIS TCP sockets. The backend does not keep a
general investigation database. It returns bounded request results, while
deliberate browser actions decide which compact records are retained locally or
exported.

For the full request pipeline, trust boundaries, persistence model, and
deployment parity, see the [architecture orientation](docs/architecture.md).

## Documentation

| Document | Use it for |
| --- | --- |
| [Application guide](docs/application-guide.md) | Tool workflow, Fast and Deep modes, result states, scoring, saved work, guided investigations, and exports. |
| [Getting started](docs/getting-started.md) | Installation, local development, verification commands, browser tests, and CLI entry points. |
| [Release discipline](docs/releasing.md) | Semantic-version selection, manifest checks, protected-branch delivery, tagging, and rollback evidence. |
| [Operations and deployment](docs/operations.md) | Authentication, proxy trust, feature switches, optional providers, rate and operation limits, hosted monitoring, Netlify, and deployment checks. |
| [Architecture orientation](docs/architecture.md) | Components, request flow, outbound trust boundaries, persistence, and deliberate trade-offs. |
| [Registry data contract](docs/registry-data-contract.md) | Normalized RDAP, WHOIS, diagnostics, provenance, and compatibility rules. |
| [Registry compatibility](docs/registry-compatibility.md) | Fixture-backed parser support and separately documented access context. |
| [Browser-local data](docs/browser-local-data.md) | IndexedDB, migration, rollback, capacity, and the separate encryption decision. |
| [CLI guide](docs/cli.md) | Commands, output formats, exit codes, offline calibration, and evidence exports. |
| [Engineering case study](docs/engineering-case-study.md) | Constraints, representative decisions, hard problems, and review entry points. |
| [Privacy notice](PRIVACY.md) | Collection, browser storage, optional hosted processing, retention, export, and deletion. |

The public `/guide` route is the shortest user-facing introduction. These
repository documents provide the operator and engineering detail behind it.

## Verification

The main local verification sequence is:

```bash
npm test
npm run typecheck
npm run check
npm run build
npm run test:e2e:built
git diff --check
npm audit --omit=dev
```

Install Playwright's Chromium build once with `npm run test:e2e:install`.
Additional offline or bounded maintainer checks include:

```bash
npm run schema:inventory
npm run benchmark:workflow
npm run platform:local-data
npm run release:check
npm run security:codeql
npm run registry:drift
npm run deployment:self-check -- https://your-deployment.example
```

The registry-drift and deployment checks make only their documented, fixed,
bounded network requests. Automated unit and browser tests use deterministic
fixtures and do not query live registries, domains, or providers.

## Deployment summary

Netlify reads `netlify.toml`, builds the static frontend, and packages the
TypeScript functions. Before the first production deployment, set
`SITE_PASSWORD` and a separate `SESSION_SECRET`. Optional providers, distributed
operation controls, and encrypted scheduled monitoring remain disabled unless
their complete configurations are supplied.

Read [operations and deployment](docs/operations.md) before exposing a
deployment publicly. It documents the shared-login boundary, reverse-proxy
trust, feature switches, optional credentials, fail-closed states, limits, and
post-deployment checks.

## Licence, attribution, and responsible use

WHOISleuth is licensed under the [GNU Affero General Public License version 3
only](LICENSE) (`AGPL-3.0-only`). Commercial use is permitted, but an operator
that modifies WHOISleuth and makes that version available over a network must
offer the corresponding source under the AGPL. Existing versions previously
released under Apache License 2.0 remain available under the licence supplied
with those versions. Third-party packages, services, and data retain their own
licences and terms.

The [trademark policy](TRADEMARKS.md) covers the WHOISleuth name and logo
separately from the source licence. Copyright and attribution details are in
[NOTICE](NOTICE).

The software is provided **as is, without warranty**. Registration data can be
redacted, stale, incomplete, or parsed imperfectly. Scores and generated
candidates require analyst review. Use collection, contact data, and report
drafts only where you have a legitimate purpose and comply with applicable
registry terms, privacy law, anti-spam law, and authorization boundaries.

See [PRIVACY.md](PRIVACY.md) for data handling and deletion guidance. Review
and adapt that notice before sharing your own deployment.

## Project structure

```text
server.mts              Express, authentication, API, and static-site adapter
lib/                    Shared bounded collection and analysis modules
netlify/functions/      Thin Netlify adapters and optional scheduled worker
frontend/               Prerendered SvelteKit public site and protected Console
bin/ and cli/            First-party command-line interface
fixtures/               Sanitized deterministic registry fixtures
test/ and e2e/           Unit, integration, and browser verification
tools/                  Maintainer checks and offline evaluation commands
docs/                   User, operator, architecture, contract, and CLI guides
```

The generated `frontend/build/` output is ignored. Both deployment adapters
serve the same frontend and call the same shared intelligence modules.
