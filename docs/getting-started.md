# Getting started

This guide covers a local checkout, development server, verification and the
first-party CLI. See [operations and deployment](operations.md) for hosted
configuration and [the application guide](application-guide.md) for analyst
tasks.

## Requirements

- Node.js 24 or later; use the exact `.nvmrc` runtime for repository work
- npm with lockfile support
- Chromium for browser end-to-end tests

Use the committed lockfile. Do not replace it with an independently resolved
dependency tree.

## Install and run

```bash
npm ci
npm run dev
```

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

Run focused tests while changing a bounded surface. Before pushing a clean
commit, run the same maintained quality, unit and browser gates as hosted CI:

```bash
npm run verification:ci
```

The parity command requires the exact `.nvmrc` runtime, a Node 26 executable on
`PATH` for the CLI compatibility lane, and a clean worktree. Set
`WHOISLEUTH_CLI_RUNTIME_NODE` to an absolute executable path when that runtime
is installed outside `PATH`. The command performs the locked install and
changed-line security scan before the maintained quality, coverage, build,
production-browser and secondary CLI-runtime gates. Ordinary interactive
browser work can use `npm run test:e2e`, which excludes machine-timing ceilings
so a focused functional run cannot contend with its own performance
measurement. Report exact failures, retries, flakes and skips rather than
describing a retried run as clean.

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
