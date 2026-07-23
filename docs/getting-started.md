# Getting started

This guide covers local installation, development, verification, and the CLI.
For hosted configuration and deployment controls, see
[operations and deployment](operations.md).

## Requirements

- Node.js 24 or later
- npm, bundled with Node.js

The Node version is declared in `package.json` and `.nvmrc`. CI and the Netlify
build use the same major version.

## Install and run

Install the locked workspace dependencies:

```bash
npm install
```

Build the prerendered frontend and start the Express deployment:

```bash
SITE_PASSWORD=choose-a-password \
SESSION_SECRET=choose-a-separate-random-secret \
npm start
```

Open:

- `http://localhost:3000` for the public overview; or
- `http://localhost:3000/login` for the protected Console.

`SITE_PASSWORD` is required. `SESSION_SECRET` should be a separate random
value, such as 32 random bytes encoded as hex. Do not reuse another account
password or expose either value to frontend code.

To use another port:

```bash
PORT=4000 \
SITE_PASSWORD=choose-a-password \
SESSION_SECRET=choose-a-separate-random-secret \
npm start
```

`npm start` runs a production build before starting `server.mts`. The server
serves only the generated `frontend/build/` output for frontend routes.

## Frontend development

Run the Vite development server with:

```bash
npm run dev
```

This is useful for frontend work. Complete flows that require authenticated
API requests, raw WHOIS sockets, or other backend collection should be checked
against the Express deployment or the Playwright production-style server.

The public overview, guide, privacy notice, sign-in page, and synthetic demo do
not start live investigations. Dashboard, Lookup, Discover, Bulk, Brands,
Monitor, and Registry support are part of the protected Console.

## Verification

Run focused tests while iterating. Before delivery, run the complete relevant
sequence:

```bash
npm test
npm run typecheck
npm run check
npm run build
npm run test:e2e:built
git diff --check
npm audit --omit=dev
```

The commands cover:

- Node unit and integration tests;
- TypeScript checks for the backend, frontend analysis modules, and E2E tests;
- Svelte diagnostics;
- the production static build;
- Chromium browser workflows; and
- production dependency advisories.

Automated tests use deterministic fixtures. They must not contact live
registries, domains, Certificate Transparency services, or optional providers.

## Browser end-to-end tests

Install the Chromium build used by Playwright once:

```bash
npm run test:e2e:install
```

Build and run the suite in one command:

```bash
npm run test:e2e
```

If `npm run build` has already completed, avoid rebuilding identical assets:

```bash
npm run test:e2e:built
```

Playwright starts a local production-style server on port 4173 with test-only
authentication values from `playwright.config.ts`. Failure traces and
screenshots are written to the ignored `test-results/` directory. A successful
local run does not create a retained HTML report.

Representative public and authenticated states also run local axe-core checks
for WCAG-tagged regressions. The scanner is a development-only dependency: it
submits no page, finding, or telemetry to a hosted service and supplements,
rather than replaces, the focused keyboard, focus, responsive, and
screen-reader coverage.

## Maintainer checks

### Release version

```bash
npm run release:check
```

Checks that the root manifest and lockfile use the same valid semantic version
and that npm publication remains disabled. It is read-only and does not create
a commit, tag, release, package, or deployment. See the
[release discipline](releasing.md) before preparing or tagging a release.

### Schema inventory

```bash
npm run schema:inventory
```

Generates a report from the actual browser-store, hosted-state, export,
interchange, CLI, and derived-model version constants. It records compatibility,
migration direction, write behavior, and bounds without reading browser or
hosted data.

### Specialist workflow benchmark

```bash
npm run benchmark:workflow
npm run benchmark:workflow -- --json
```

Runs a deterministic offline regression benchmark across checked-in registry
fixtures, candidate generation, partial-source handling, relationships,
detection rules, graph limits, and workspace archive round trips. It is not a
live coverage or production-performance benchmark.

### Browser-local platform evaluation

```bash
npm run platform:local-data
npm run platform:local-data -- --json
```

Reports declared collection capacity and the trade-offs behind the native
IndexedDB provider without inspecting browser data. Fixed browser fixtures
cover transactions, migration, indexed reads, rollback, quotas, persistence,
deletion, and deadlines.

### Local CodeQL

```bash
npm run security:codeql
```

Scans the current checkout, including uncommitted changes, with the standard
JavaScript and TypeScript suite. It requires the official CodeQL CLI on `PATH`,
at `~/.local/bin/codeql`, or through an absolute `CODEQL_PATH`. The wrapper
keeps its bounded database and SARIF output in the operating system's temporary
directory and removes them when complete.

Exit status 0 means no unreviewed findings or baseline drift. Status 1 means
review is required. Status 2 means setup or analysis was inconclusive. Hosted
CodeQL remains authoritative when its managed bundle differs from the local
version.

### Registry drift

```bash
npm run registry:drift
npm run registry:drift -- --json
```

Makes exactly two fixed, capped requests to official IANA catalogues. It
compares the embedded compatibility snapshot without probing registries or
rewriting files. Exit status 1 reports reviewable drift and status 2 reports an
inconclusive check or invalid invocation.

### Deployment self-check

```bash
npm run deployment:self-check -- https://your-deployment.example
npm run deployment:self-check -- https://your-deployment.example --json
```

Runs the bounded public-boundary check documented in
[operations and deployment](operations.md#deployment-self-check).

## Command-line interface

The first-party CLI calls the same shared intelligence modules as the hosted
application. Start with:

```bash
node bin/whoisleuth.mts --help
```

The [CLI guide](cli.md) documents commands for Lookup, Bulk, Certificate
Transparency, discovery, posture, HTTP and TLS intelligence, registry-source
comparison, compatibility inspection, Risk calibration, and evidence export.
It also defines output formats and exit codes.

The CLI is a local package boundary. It is not included in the static frontend
or the Netlify function bundles unless a shared module is also used there.

## Project layout

```text
server.mts              Express, authentication, API, and static-site adapter
lib/                    Shared bounded collection and analysis modules
netlify/functions/      Thin Netlify adapters and optional scheduled worker
frontend/               SvelteKit public site and protected Console
bin/ and cli/            First-party CLI
fixtures/               Sanitized deterministic registry fixtures
test/ and e2e/           Unit, integration, and browser verification
tools/                  Maintainer checks and offline evaluation commands
docs/                   User, operator, architecture, contract, and CLI guides
```

See [architecture orientation](architecture.md) for component ownership and
the request pipeline.
