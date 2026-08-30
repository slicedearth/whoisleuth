<p align="center"><img src="frontend/static/favicon.svg" width="64" height="64" alt="WHOISleuth mark" /></p>
<h1 align="center">WHOISleuth</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg" alt="License: AGPL-3.0-only" />
  <img src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" alt="Node >= 24" />
  <img src="https://img.shields.io/badge/frontend-SvelteKit%20%2B%20Vite-ff3e00" alt="SvelteKit and Vite" />
  <a href="https://www.npmjs.com/package/@slicedearth/whoisleuth-cli"><img src="https://img.shields.io/npm/v/@slicedearth/whoisleuth-cli?label=cli&logo=npm" alt="Published CLI version" /></a>
  <a href="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml"><img src="https://github.com/slicedearth/whoisleuth/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://app.netlify.com/projects/whoisleuth/deploys"><img src="https://api.netlify.com/api/v1/badges/600adb21-cece-4a13-8df8-d177ace3d945/deploy-status" alt="Netlify status" /></a>
</p>

WHOISleuth is a local-first domain investigation and brand-protection tool. It
keeps registration, DNS, certificate, website, network and analyst evidence
separately attributed, including unavailable and partial sources.

Use it to investigate a domain, IP address or ASN; discover possible brand
lookalikes; compare domain sets; retain reviewed Cases; prepare response
material; and compare later observations. Scores are explainable prioritisation
aids rather than automated verdicts.

<p align="center">
  <a href="https://www.whoisleuth.com"><strong>View WHOISleuth</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.whoisleuth.com/demo"><strong>Explore the synthetic demo</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.whoisleuth.com/resources"><strong>Browse investigation resources</strong></a>
</p>

<p align="center">
  <a href="https://www.whoisleuth.com/demo"><img src="docs/assets/whoisleuth-homepage.jpg" width="960" alt="WHOISleuth public homepage showing a fictional domain investigation" /></a>
</p>

The demo uses fixed fictional evidence on reserved domains. It makes no live
investigation request, requires no sign-in and writes no Console workspace data.

## How work is organised

WHOISleuth uses three analyst jobs: **Investigate**, **Respond** and **Assure**.

| Tool | Purpose |
| --- | --- |
| **Dashboard** | Start or resume work across the three jobs. |
| **Lookup** | Inspect one domain, IP address or ASN. |
| **Discover** | Generate lookalikes or review certificate and registry observations. |
| **Bulk** | Triage and compare a selected domain set. |
| **Brands** | Record official scope, reviewed baselines and owned-domain controls. |
| **Monitor** | Review Cases, changes, response preparation, watchlists and local rules. |

The public [Resources hub](https://www.whoisleuth.com/resources) is the shortest
user guide. [Application documentation](docs/application-guide.md) covers the
browser tools and saved work.

## Privacy and safety

Ordinary retained work stays in IndexedDB in the current browser profile.
Explicit network operations send only their declared bounded target or evidence
classes to the relevant hosted boundary, public source or selected provider.
Optional hosted monitoring is separately configured and stores only its compact
application-encrypted projection. Local exports and CLI files remain under the
operator's control.

The generated [privacy/data-flow catalogue](docs/privacy-data-flow-catalogue.md)
and [JSON](docs/privacy-data-flow-catalogue.json) list exact capability data
flows. See the [privacy notice](PRIVACY.md) for retention, export and deletion.

## Quick start

Requirements: Node.js 24 or later and npm.

```bash
npm ci
npm run dev
```

Build and start the Express host:

```bash
SITE_PASSWORD=choose-a-password \
SESSION_SECRET=choose-a-separate-random-secret \
npm start
```

The public CLI package runs locally and does not require the hosted application:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth example.test --plan --json
```

`--plan` describes a Lookup without collecting. Use
[Getting started](docs/getting-started.md) for local development and browser
tests, or the [CLI guide](docs/cli.md) for installed commands.

## Architecture

The application is a TypeScript modular monolith:

- `packages/` owns runtime-neutral contracts and domain rules;
- `lib/` owns shared bounded hosted/runtime services;
- `frontend/` owns SvelteKit routes, browser state and IndexedDB adapters;
- `cli/` and `bin/` own local command grammar, handlers and terminal output;
- Express and Netlify functions adapt the same hosted request boundary.

The backend has no general investigation database. The browser decides which
bounded records to retain or export. The CLI has separate offline, networked and
authorised-active contracts. See [architecture](docs/architecture.md),
[current product boundaries](docs/product-boundary.md) and the
[threat model](docs/threat-model.md).

Public release 2.0.1 is the current public writer. This checkout directly reads
its exact durable formats and the retained legacy formats written by release
1.47.4. Exact Case and workspace readers are listed in the generated
[Case portability reference](docs/case-contracts.md); other current writers and
direct migrations are in the
[portable compatibility reference](docs/portable-domain-contracts.md).

## Documentation

| Document | Use it for |
| --- | --- |
| [Application guide](docs/application-guide.md) | Browser tools, evidence states, saved work and exports. |
| [Getting started](docs/getting-started.md) | Local setup, development and verification. |
| [CLI guide](docs/cli.md) and [reference](docs/cli-reference.md) | Installed commands, output and safety. |
| [Operations](docs/operations.md) | Authentication, limits, optional providers, monitoring and deployment. |
| [Architecture](docs/architecture.md) | Components, request pipeline, persistence and verification. |
| [Browser-local data](docs/browser-local-data.md) | IndexedDB, migration, backup, encryption and deletion. |
| [Registry data](docs/registry-data-contract.md) and [compatibility](docs/registry-compatibility.md) | Normalised registration contracts and fixture-backed support. |
| [Generated capability contract](docs/capability-manifest.md) | Exhaustive execution, disclosure, budget and failure metadata. |
| [Privacy notice](PRIVACY.md) | Processing, recipients, storage, retention, exports and rights. |
| [Release discipline](docs/releasing.md) | Versioning, candidate verification, delivery and rollback. |

## Verification

Start with the checks relevant to your change:

```bash
npm test
npm run typecheck
npm run check
npm run build
git diff --check
```

The complete gate matrix, including browser, architecture, privacy,
compatibility, package and security checks, is in
[Getting started](docs/getting-started.md#verification).

## Licence and responsible use

WHOISleuth is licensed under the [GNU Affero General Public License version 3
only](LICENSE) (`AGPL-3.0-only`). Third-party packages, services and data retain
their own terms. The [trademark policy](TRADEMARKS.md), [notices](NOTICE),
[dual-use disclosure](DISCLOSURE) and [security policy](SECURITY.md) apply
separately.

The software is provided as is, without warranty. Registration and technical
data can be redacted, stale, partial or wrong. Use collection, contact data and
response material only with an appropriate purpose, authorisation and review of
applicable law and provider terms.
