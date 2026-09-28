# Getting started

This guide covers a local checkout, development server, verification and the
first-party CLI. See [operations and deployment](operations.md) for hosted
configuration and [the application guide](application-guide.md) for analyst
tasks.

## Requirements

- Node.js 24 or later; use the exact `.nvmrc` runtime for repository work
- npm with lockfile support
- Chromium for browser end-to-end tests
- Bash, zsh, Fish and PowerShell (`pwsh`) for the completion contract tests

Use the committed lockfile. Do not replace it with an independently resolved
dependency tree.

## Install and run

```bash
npm ci --include=optional --ignore-scripts --audit=false
```

The install command matches required CI and keeps registry advisory availability
separate from source verification. Run `npm run dependencies:audit` when
reviewing dependencies and before a release; its online, fail-closed policy is
documented in [Dependency maintenance](dependency-maintenance.md).

For bundled registry, threat-intelligence and Unicode data, use the separate
[retained source checks and refresh procedure](source-maintenance.md).

### Public pages and demo

Run `npm run dev` and open the URL it prints. This starts the frontend only.
Public pages and the fixed synthetic demo need no API server and make no live
investigation requests.

### Authenticated Console

Create an ignored `.env.local` in the repository root containing `SITE_PASSWORD`
and a separate `SESSION_SECRET`, following [authentication configuration](operations.md#authentication-boundary).
Use development-only values, not production credentials. Generate a signing
secret with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`.

Keep these two commands running in separate terminals, both at the repository
root:

```bash
# Terminal 1: API on port 3000
node --env-file=.env.local server.mts
```

```bash
# Terminal 2: frontend with live reload
npm run dev
```

Open the frontend URL and sign in with the development password. Vite forwards
`/api` requests to `http://localhost:3000`; starting Vite alone cannot provide
sign-in or collection. If port 3000 is occupied, stop the conflicting service
or use the filesystem-local application below. Starting either server does not
start an investigation; collection begins when you request it in the Console.

### Production build on the Express host

Build and run the portable Express host with:

```bash
npm start
```

`npm start` builds the frontend before starting Express.

The application reads deployment settings from the environment. Never commit
passwords, session secrets, provider credentials or production configuration.

### Filesystem-local application

For the Console with a filesystem workspace, see the separate
[local application](../packages/local-application/README.md). Build the frontend,
then run `npm run local:app -- --workspace ../review-workspace --init --offline`.
Choose a folder outside the checkout for real work. This mode uses a private
launch link rather than the hosting password and does not use IndexedDB for
saved collections. `npm run local:package:check` verifies an installed package
against the current production build.

## Frontend development

The SvelteKit frontend is under `frontend/`. Root scripts invoke the workspace
commands. Run `npm run check` for Svelte validation or `npm run build` for a
standalone production build from the repository root.

The browser application imports runtime-neutral contracts from `packages/` and
keeps Svelte state, DOM access, IndexedDB and downloads in frontend adapters.
Architecture checks enforce that direction.

## Verification

Use [Contributing](../CONTRIBUTING.md) to locate an owner and choose checks for
an ordinary change. Presentation-only changes use Svelte validation and rendered
review, not a full local test run. For behavioural changes during editing and
before a feature-branch push:

```bash
npm run verification:focused -- --list
npm run verification:focused
```

The plan explains selected owners and import dependents. Pass explicit
repository-relative paths after `--` to narrow the declared scope, or
`--since=<base-commit>` to include a batch's local commits and working changes.
Documentation
changes select offline document checks; documents included in the CLI also
select package-document checks. Unknown import impact falls back to the full
unit inventory. Browser selection remains deliberately conservative.

Complete required hosted checks must pass against the current merge candidate
before merge or deployment. A routine contribution does not require a second
complete run on the contributor's machine. State which checks were run and
which were not; a focused result is not release evidence.

For verification-infrastructure changes, reproducing hosted failures, or full
offline assurance, run the complete local boundary from a clean commit:

```bash
npm run verification:ci
```

It requires the exact `.nvmrc` runtime, tested shells and a Node 26 executable
on `PATH` (or `WHOISLEUTH_CLI_RUNTIME_NODE`). It performs a locked install,
quality checks, unit coverage, repository integration tests, production-browser
tests and package compatibility checks. Each package is assembled once and its
exact archive is installed independently under both runtimes. No prior test
result substitutes for either installation.
Shared executable groups keep the required local and hosted checks aligned.
Already-prepared lanes can use `npm run verification:ci -- --group=<name>`;
group mode does not install dependencies or orchestrate other lanes.

`npm test`, coverage and scheduled unit profiling share shell preflight before
test workers start. Tests reuse the resolved executable paths; startup checks
use a hang guard, not a performance target. Missing or unusable shells stop the
run before test execution.

Use Linux locally when a change depends on operating-system behaviour or when
reproducing a hosted failure. It is not a prerequisite for every contribution.
Preview the existing focused selection without Docker, then run it in an
isolated Linux checkout:

```bash
npm run verification:linux -- --focused --list test/linux-verification.test.mts
npm run verification:linux -- --focused test/linux-verification.test.mts
```

Paths are explicit because the container verifies a clean commit, not a working
diff. Browser selections build the application and run the selected existing
specifications; they do not maintain a separate Linux suite. A focused pass is
not full CI or release assurance. Complete sharded hosted coverage remains
required before merge.

For a whole lane, use `--group=<name>` with the same groups as `verification:ci`.
The container installs locked dependencies and prepares the build for the
package lane. Use `--full` only when complete local Linux assurance is needed;
it includes the full browser suite. With no selection, the command prints help
without starting Docker.

The runner builds an Ubuntu 24.04 image with the locked browser release, the primary
Node version and the compatibility runtime. It uses the local engine's native
AMD64 or ARM64 architecture, including pinned security-analysis and shell tools,
and checks analysis memory before a full run, not before checks that omit
analysis. It does not silently emulate another architecture. Image digests, architecture and memory
are recorded for each run; hosted runner hardware and architecture remain
separate from this local check. Only committed source and local tag history enter the container: no host
dependencies, credentials, development servers or Docker socket are mounted.
The browser sandbox remains enabled. Container elapsed times are not a proxy
for hosted runner performance.
`-- --build-image` prepares the environment without requiring a clean checkout.
Private logs and environment details remain outside the repository. Failed
containers are stopped and retained for diagnosis; remove them when finished.

Local and hosted quality checks audit all locked dependencies against the same
registry, rejecting moderate-or-higher advisories. The stricter production and
release audits remain separate. Advisory data can change between runs. Alert
reconciliation, action execution and deployment acceptance still involve hosted
services; Linux rehearsal does not certify those services or replace required
checks on the merge candidate.

Static security analysis honours operating-system and container memory limits,
reserves memory for the operating system, and refuses an allocation below the
analyser's minimum before creating a database. Larger codebases may need more
than the minimum; see the [analyser hardware guidance](https://docs.github.com/en/code-security/reference/code-scanning/codeql/hardware-resources-for-codeql).

For an approved version change, `npm run release:prepare -- <version>` updates
the two application manifests and regenerates public examples through their
existing owner. It creates no commit, tag or publication. `npm run release:check`
checks their lockstep, immutable tag identity and the preceding public tag's
durable commitments before dependencies are installed. Installed package tests
then check fresh writer metadata. Published fixtures are not rewritten merely
to change a patch number.

Performance reports retain samples, execution context, readiness, long tasks
and layout evidence. Elapsed time is observational, not a limit calibrated to
one development machine. Compare repeated workloads under comparable
conditions. Interaction reports separate deliberate expansion from movement
after usable paint: transition movement is observational; post-readiness
stability and cold-page layout checks remain blocking. Functional readiness,
network boundaries, byte limits and bounded timeouts remain enforced.

Coverage includes loaded production TypeScript and independent critical I/O
floors. Exclusions must identify their type, build, browser or process check.
Tests use local fixtures; deliberate source-refresh and deployment checks have
separate network modes. Do not run those for an unrelated edit.

[External evaluation examples](../fixtures/risk-evaluation/README.md) retain
licensed, minimised source features separately from synthetic tests. Their
development and evaluation groups are disjoint; the report distinguishes
historical labels, missing inputs and unmeasured accuracy.

## Browser end-to-end tests

Install the supported browser once if necessary:

```bash
npm run test:e2e:install
```

Run the suite or a focused file:

```bash
npm run test:e2e
npx playwright test e2e/public-guide.spec.ts --workers=1 --retries=0
```

The suite uses deterministic fixtures and must not contact live registries,
domains, resolvers or providers. Browser routing and a separately preloaded
server transport guard enforce this. An unexpected collector request fails
the run and names the operation; supply the missing deterministic fixture
rather than disabling the guard. Confirm the served process belongs to the
intended checkout. After testing, remove generated reports and build artefacts
unless they are an intentional deliverable, and confirm port 4173 is free.

Timing-sensitive coverage uses the repository stress convention:

```bash
npm run test:e2e:stress
```

Diagnose a failure before retrying it.

Hosted CI and the complete local built suite run a small required Firefox and
WebKit packet for locking, encrypted restore, draft recovery and native link
navigation. Run that same isolated packet against a verified build with
`npm run test:e2e:critical`. Install its pinned engines with
`npm run test:e2e:critical:install` when they are not already cached.

The targeted cross-browser packet reuses complete functional specifications in
Firefox and WebKit: authentication, workspace isolation and encryption, Case
recovery and returns, offline evidence, source progress and public navigation.
It keeps the same production server, fixture guards and zero-retry policy:

```bash
npx playwright install firefox webkit
npm run test:e2e:cross-browser
```

Use `-- --project=firefox` or `-- --project=webkit` to diagnose one engine.
With an already verified production build, set `WHOISLEUTH_E2E_USE_BUILD=1`.
These desktop engines with narrow viewports do not certify real mobile devices
or every released browser version. The complete Chromium suite remains required
at the full verification boundary.

Failed or interrupted local suites print the location of their retained private
diagnostics directory. It keeps bounded reports, traces and screenshots, without
the temporary checkout, build, dependencies or authentication files. The summary
records any omitted files or subtrees; interrupted reports may be incomplete.
Remove the directory after reviewing it. Successful suites remove their entire
temporary workspace. A cleanup error is reported as a failure and leaves the
workspace for manual inspection.

## Maintainer checks

The less common commands below each have one narrow purpose:

| Command | Purpose |
| --- | --- |
| `npm run schema:inventory` | Verify current schema ownership, compatibility and evidence-storage baselines. |
| `npm run capabilities:check` | Verify generated capability and public-product projections. |
| `npm run privacy:check` | Verify the generated privacy/data-flow catalogue. |
| `npm run verification:ownership:check` | Ensure every tracked verification surface has one owner. |
| `npm run verification:timing:check` | Check the retained timing profile without accepting a new candidate. |
| `npm run test:duration-health -- --report=/absolute/path` | Compare medians from exactly three complete unit profiles (repeat `--report` three times) without rewriting the retained timing baseline. |
| `npm run frontend:loading-report` | Measure every route and check public/workspace isolation. Use `-- --json` to save measurements and `-- --compare=report.json` to show changes against an earlier report. |
| `npm run benchmark:workflow` | Exercise the offline synthetic workflow benchmark. |
| `npm run technology:coverage-check` | Verify reviewed technology-signature coverage. |
| `npm run unicode:confusables` | Audit the local confusable catalogue and labelled corpus. |
| `npm run sources:health` | Compose retained-dataset and evaluation health offline; add `-- --strict` for maintenance enforcement. |
| `npm run registry:drift` | Deliberately compare the fixed official registry catalogues; this is a manual network operation. |
| `npm run providers:policy-check` | Review retained provider-policy freshness metadata. |
| `npm run deployment:self-check` | Run the bounded operator deployment check when explicitly configured. |
| `npm run security:codeql` | Run the local CodeQL wrapper under its documented prerequisites. |
| `npm run security:retire` | Scan a built frontend for retired browser libraries. |
| `npm run maintenance:duplication` | Review exact clones and the static call graph across bounded maintained TypeScript sources. |

`npm run sources:health` distinguishes current, stale, unavailable, malformed,
limited, measured and unproven local states and reports unavailable counts as
unavailable rather than zero. It reads checked-in assets only, performs no
refresh or network request, and does not fail an ordinary run merely because an
optional retained source has aged. Use `npm run sources:health -- --strict` for
the explicit maintenance gate; each entry names its narrower strict command.

Source refresh, catalogue updates and release publication are separate from
ordinary verification. Use the corresponding guide or command help before
running an operation that changes data or contacts an external service.

## Command-line interface

Run the source CLI from a checkout:

```bash
node bin/whoisleuth.mts --help
node bin/whoisleuth.mts lookup example.test --plan --json
node bin/whoisleuth.mts commands --common
```

`--plan` classifies and discloses a Lookup without starting collection. The
installed package uses the `whoisleuth` command and requires no access to the
hosted application:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
```

Use [the CLI guide](cli.md) for common commands and the
[CLI reference](cli-reference.md) for command families, output and safety
boundaries. Installed `whoisleuth <command> --help`, `whoisleuth commands` and
`whoisleuth manual` are the exact command authorities for that package.

## Project layout

See [component ownership](architecture.md#component-ownership) for the directory
map and [Contributing](../CONTRIBUTING.md#find-the-owner) for common editing paths.
