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
npm run dev
```

The install command matches required CI and keeps registry advisory availability
separate from source verification. Run `npm run dependencies:audit` when
reviewing dependencies and before a release; its online, fail-closed policy is
documented in [Dependency maintenance](dependency-maintenance.md).

The development server prints its local URL. The protected Console requires the
same authentication configuration described in the operations guide; public
routes and the fixed synthetic demo do not perform live investigation
collection.

Build and run the portable Express host with:

```bash
npm start
```

`npm start` builds the frontend before starting Express.

The application reads deployment settings from the environment. Never commit
passwords, session secrets, provider credentials or production configuration.

## Frontend development

The SvelteKit frontend is under `frontend/`. Root scripts invoke the workspace
commands. Run `npm run check` for Svelte validation or `npm run build` for a
standalone production build from the repository root.

The browser application imports runtime-neutral contracts from `packages/` and
keeps Svelte state, DOM access, IndexedDB and downloads in frontend adapters.
Architecture checks enforce that direction.

## Verification

Use [Contributing](../CONTRIBUTING.md) to locate an owner and choose checks for
an ordinary change. During editing and before a feature-branch push:

```bash
npm run verification:focused -- --list
npm run verification:focused
```

The plan explains selected owners and import dependents. Pass explicit
repository-relative paths after `--` to narrow the declared scope. Documentation
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
quality checks, coverage, production-browser tests and CLI compatibility checks.
Shared executable groups keep the required local and hosted checks aligned.
Already-prepared lanes can use `npm run verification:ci -- --group=<name>`;
group mode does not install dependencies or orchestrate other lanes.

Performance reports retain samples, execution context, readiness, long tasks
and layout evidence. Elapsed time is observational, not a limit calibrated to
one development machine. Compare repeated workloads under comparable
conditions. Functional readiness, network boundaries, byte limits and bounded
timeouts remain enforced.

Coverage includes loaded production TypeScript and independent critical I/O
floors. Exclusions must identify their type, build, browser or process check.
Tests use local fixtures; deliberate source-refresh and deployment checks have
separate network modes. Do not run those for an unrelated edit.

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
| `npm run frontend:loading-report` | Measure route closures against loading budgets. |
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
