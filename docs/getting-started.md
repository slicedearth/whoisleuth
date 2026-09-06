# Getting started

This guide covers a local checkout, development server, verification and the
first-party CLI. See [operations and deployment](operations.md) for hosted
configuration and [the application guide](application-guide.md) for analyst
tasks.

## Requirements

- Node.js 24 or later; use the exact `.nvmrc` runtime for repository work
- npm with lockfile support
- Chromium for browser end-to-end tests
- Bash, zsh and PowerShell (`pwsh`) for the completion contract tests

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
npm run build
npm start
```

The application reads deployment settings from the environment. Never commit
passwords, session secrets, provider credentials or production configuration.

## Frontend development

The SvelteKit frontend is under `frontend/`. Root scripts invoke the workspace
commands, so ordinary development can remain at repository root:

```bash
npm run dev
npm run check
npm run build
```

The browser application imports runtime-neutral contracts from `packages/` and
keeps Svelte state, DOM access, IndexedDB and downloads in frontend adapters.
Architecture checks enforce that direction.

## Verification

Before pushing a clean commit, run the same maintained quality, unit and
browser gates as hosted CI:

```bash
npm run verification:ci
```

While iterating, run the owned unit, static and browser checks for the current
dirty diff. The focused command builds once and runs all selected browser specs
in one process:

```bash
npm run verification:focused
```

Pass repository-relative paths after `--` to verify a smaller declared change,
or add `--list` to inspect the plan without running it. This is an iteration
boundary, not release evidence.

For mechanical changes, edit the domain owner first: CLI option grammar belongs
to `cli/command-reference.mts`; Case status and disposition decisions belong to
`case-record-decisions.mts`; Case persistence and audience treatment belongs to
`case-record-projection.mts`. Generated help, completion and public reference
outputs derive from those owners. Browser tests consume only the served build
and private build-identity marker declared by the frontend build owner. The
focused plan selects the affected derived consumers while immutable historical
fixtures remain independent compatibility evidence.

The local CI command requires the exact `.nvmrc` runtime, a Node 26 executable on
`PATH` for the CLI compatibility lane, and a clean worktree. Set
`WHOISLEUTH_CLI_RUNTIME_NODE` to an absolute executable path when that runtime
is installed outside `PATH`. Before package, unit or build work begins, it
probes the shells required by the unit lane and reports missing or unusable
executables together; it does not install or skip them. The command performs the locked install and
changed-line security scan before the maintained quality, coverage, build,
production-browser and secondary CLI-runtime gates. Ordinary interactive
browser work can use `npm run test:e2e`; the full CI command also runs the
isolated performance measurements. Report exact failures, retries, flakes and
skips rather than describing a retried run as clean.

Performance measurements remain part of every complete local and hosted CI
run. Reports retain three samples, medians, maxima, browser-side readiness,
host-side duration, long tasks, and execution context. Elapsed times are
observations, not release limits derived from a development machine. Review
changes using repeated measurements of the same workload under comparable
conditions; a different host's duration alone does not establish a regression
or prove acceptable user experience. Any future blocking performance objective
must state its user-facing requirement, representative workload and execution
conditions instead of inheriting a prior machine's observed speed.

Functional readiness, request boundaries, asset-transfer limits, layout checks
and bounded test timeouts remain mandatory. Shared command and build contracts
provide workflow consistency; they do not claim identical operating systems,
hardware performance or coverage of every supported platform.

Hosted jobs invoke the same executable `preflight`, `quality`, `unit`,
`browser-build` and `cli-runtime` groups owned by `verification:ci`. Maintainers
can run one already-prepared lane with `npm run verification:ci --
--group=<name>`; group mode preserves the lane's runtime and prerequisite checks
but deliberately does not perform the full command's clean-commit guard,
dependency installation, browser orchestration or final cleanup.

The coverage gate measures all loaded production TypeScript, enforces the
global line, branch and function floors, and retains stricter per-file floors
for critical artefact I/O. Its inventory check also rejects any newly omitted
source file. Type-only modules, compatibility re-exports, browser adapters,
framework entries and executable entry points remain visible as a small,
explicit list with an owning type, build, browser or process check; they are
not silently counted as covered.

Some checks deliberately read the repository, dependency graph, fixtures or
generated contracts. They do not contact live investigation targets. Commands
whose names describe drift, provider status or deployment self-checks can have
separate explicit network modes; review their help before running them.

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
domains, resolvers or providers. Confirm the served process belongs to the
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

Candidate-acceptance, catalogue-update, staging-evidence, first-use-study and
release-publication commands are deliberate maintainer actions rather than
ordinary verification. Use the owning documentation or command help and do not
run them as part of an unrelated change.

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

| Path | Responsibility |
| --- | --- |
| `frontend/` | SvelteKit routes, components and browser adapters. |
| `lib/` | Shared hosted/runtime collection and presentation-neutral services. |
| `packages/` | Runtime-neutral contracts and domain modules. |
| `cli/` and `bin/` | CLI grammar, handlers, terminal output and entry points. |
| `netlify/functions/` | Netlify adapters over the shared hosted boundary. |
| `test/` and `e2e/` | Deterministic unit, contract and browser verification. |
| `tools/` | Explicit maintainer checks and generated-contract renderers. |

See [architecture](architecture.md) for ownership and dependency boundaries.
