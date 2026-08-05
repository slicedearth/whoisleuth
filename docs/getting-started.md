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
SESSION_MAX_AGE_DAYS=7 \
npm start
```

Open:

- `http://localhost:3000` for the public overview; or
- `http://localhost:3000/login` for the protected Console.

`SITE_PASSWORD` is required. `SESSION_SECRET` should be a separate random
value, such as 32 random bytes encoded as hex. Do not reuse another account
password or expose either value to frontend code. `SESSION_MAX_AGE_DAYS` is
optional, accepts a whole number from 1 to 30, and defaults to 7.

To use another port:

```bash
PORT=4000 \
SITE_PASSWORD=choose-a-password \
SESSION_SECRET=choose-a-separate-random-secret \
SESSION_MAX_AGE_DAYS=7 \
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
npm run cli:package:check
npm run test:e2e:built
git diff --check
npm audit --omit=dev
```

The commands cover:

- Node unit and integration tests;
- strict TypeScript checks for the backend, tools, CLI, Node tests, frontend
  analysis modules, E2E tests, and the pre-render theme bootstrap;
- Svelte diagnostics;
- the production static build;
- Chromium browser workflows; and
- production dependency advisories.

Automated tests use deterministic fixtures. They must not contact live
registries, domains, Certificate Transparency services, or optional providers.

Additional test-health commands are available without adding live collection:

```bash
npm run test:coverage
npm run test:properties
npm run test:profile
```

The coverage command writes an ignored `test-coverage.lcov` report for the
production TypeScript modules exercised by the Node suite. Property checks keep
their ordinary local run counts small. A scheduled read-only workflow runs them
at ten times that depth with a recorded seed, which can be replayed locally:

```bash
WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER=10 \
WHOISLEUTH_FAST_CHECK_SEED=123456 \
npm run test:properties
```

The multiplier, seed, generated case counts, and result summaries are bounded.
The duration profile reports the slowest test files and individual tests so
performance regressions can be investigated without imposing timing-sensitive
pass or fail thresholds.

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
local run does not create a retained HTML report. CI also converts the bounded
JSON reporter output into a shard summary containing result counts, retries,
slow tests, and attachment types without copying attachment paths.

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
migration direction, write behaviour, and bounds without reading browser or
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

### Technology-signature benchmark

```bash
npm run benchmark:technology
npm run benchmark:technology -- --json
npm run technology:signature-scaffold -- --id=example-platform --name="Example platform" --category="site builder" --source=generator
```

Runs the versioned synthetic technology corpus through the same bounded
signature analyser used by Deep Lookup. It lints catalogue identifiers,
categories, confidence levels, evidence classes, fixed explanations, evidence
bounds, and positive and negative fixture coverage. The report includes
per-category expected, observed, missed, unexpected, overlap, collision, and
false-positive metrics without copying fixture HTML, headers, generators, or
resource origins into its output. It makes no network request and is a
regression/calibration result rather than a live coverage claim.

The scaffold emits a catalogue-entry template plus a required positive fixture
and benign negative fixture. It accepts only bounded signature metadata, never
raw pages or response headers. A proposed signature should not be merged until
the benchmark reports no identifier, confidence, category, coverage, or
collision error and its benign fixture does not create an unexpected match.

Reviewed observations can be converted into a separately maintained minimised
fixture with:

```bash
npm run technology:fixture-review -- reviewed-input.json
```

To prepare that input from an existing saved Deep CLI lookup without making a
second request, run:

```bash
npm run technology:review-candidate -- saved-deep-lookup.json \
  --id=reviewed-sveltekit-observation \
  --expected=sveltekit \
  --licence-basis=minimized-with-permission \
  --reviewed-at=2026-08-05T11:00:00.000Z \
  > reviewed-input.json
```

The expected identifiers are an explicit analyst confirmation, not labels
inferred by the tool. Candidate intake requires a complete, successful
technology observation and rebuilds catalogue-owned markers only. It does not
copy the saved query, target, page text, raw response values, contacts, or URLs.
The `minimized-with-permission` value retains the established fixture-contract
spelling.

Licence bases distinguish ordinary factual review, direct permission,
public-domain material, permissively or copyleft-licensed local reference
deployments, and official demonstrations whose applicable terms have been
reviewed. An accessible public URL is not, by itself, sufficient permission for
automated inspection. Prefer a locally run official example under its recorded
licence; review live-demo terms separately before collection.

The fixture review tool accepts only reviewed factual markers. It reconstructs
a fixed safe subset of recognised static markers, passive response headers, and
approved shared vendor origins, rejects target-bearing or contact material, and
verifies the expected catalogue result. The checked-in reviewed corpus contains
only minimised, target-free observations that have passed the contribution
review. Its current partial signature coverage must not be generalised to the
wider web.
The benchmark also reports a 365-day review age, unsampled and under-repeated
signature IDs, sampled evidence rules, declared licence-basis counts, and
reviewed coverage by technology category. Its maturity tiers are cumulative:
an initial corpus, catalogue-wide sampling, two observations per signature,
all evidence rules sampled, and finally a current corpus with no stale or
failing observations. These maintenance signals cannot turn an empty or narrow
corpus into a coverage claim and do not trigger live collection.

Use the separate maintenance gate when a release process requires the highest
reviewed-corpus tier:

```bash
npm run technology:coverage-check
```

This command intentionally fails until every catalogue signature has at least
two passing minimised observations, every evidence rule has been sampled, and
no observation is stale. The ordinary synthetic benchmark continues to measure
deterministic signature behaviour and collision controls; neither result is a
proxy for accuracy on the wider web.

The wider reviewed-accuracy programme keeps technology detection separate from
lookalike analysis, page comparison, service-deprovision cues, and certificate
grouping. Inspect its current evidence rather than inferring accuracy from
synthetic fixture counts:

```bash
npm run accuracy:status
npm run accuracy:status -- --json
```

An `unproven` result is intentional when a corpus lacks both positive and
benign or collision cases. `limited` requires at least five cases, including
both classes; `measured` requires at least twenty, including five from each
class. Those labels describe only the checked-in corpus. They do not establish
general recall, precision, ownership, intent, safety, or maliciousness.

Contributors can create a privacy-first review worksheet without copying a
live response into the repository:

```bash
npm run accuracy:review-scaffold -- \
  --category page-similarity \
  --id reviewed-page-collision
```

The scaffold uses a reserved target and requires an explicit factual or
licensed source basis, privacy and redistribution review, a second review,
and component-level expectations. It is an intake worksheet, not a fixture:
each category still needs a purpose-built replay validator before reviewed
observations can enter an accuracy claim.

### Incremental Lookup qualification

```bash
npm run lookup:transport-spike
npm run lookup:transport-qualify
```

After a production build, measure each public and protected route's initial
static dependency closure:

```bash
npm run build
npm run frontend:loading-report
npm run frontend:authenticated-loading-report
```

The report uses only local build artefacts. It fails if the browser-local
workspace chunk enters a public route, a generated route lacks a reviewed
gzip ceiling, or a route exceeds that deliberately generous regression budget.
CI runs this check after the production build. The estimates are not measured
network timings. The authenticated Playwright report then
cold-loads Lookup and Monitor through the real local sign-in boundary, measures
encoded transfer bytes with Chromium's network protocol, records the first
enabled route control time and main-thread long tasks, and attaches one JSON
measurement per route. Its deliberately broad regression ceilings are build
health tripwires, not user-performance claims or internet benchmarks. A large
protected chunk is not, by itself, a reason to split the storage boundary;
review the runtime measurements before changing that architecture.

Both commands are offline. The qualification report exercises protocol
chunking, buffering detection, slow-consumer handling, authentication expiry,
duplicate events, timeout and abort cancellation, and final-envelope
equivalence. A clean report is necessary but not sufficient for production.
Each authenticated staging adapter and its real proxy or CDN must pass the same
gates before that adapter can be marked qualified. Express and Netlify remain
disabled and use the ordinary buffered response.

After staged adapter runs have produced redacted evidence summaries for the
same build, verify them offline with:

```bash
npm run lookup:staging-evidence -- express.json netlify.json
```

The strict evidence contract requires fresh desktop and mobile measurements
through both direct and production-proxy paths, progressive event timing,
collector-visible cancellation, safe response headers, authentication-expiry
handling, duplicate and timeout rejection, ordinary fallback success, and
final-envelope equivalence. Extra fields are rejected so targets, queries,
credentials, responses, and partial events cannot enter the summary. A passing
report records staging qualification only; it does not enable either adapter
or change the production deployment.

### First-use analyst study

`fixtures/first-use-analyst-study-tasks.mts` provides one repeatable desktop and
mobile task script covering orientation, Lookup, Bulk, all three guided
investigation recipes, a case decision, and archive verification. A moderator
can aggregate bounded controlled observations with:

```bash
npm run study:first-use -- --template=desktop > desktop-session.json
npm run study:first-use -- --template=mobile > mobile-session.json
npm run study:first-use -- sessions.json
```

Session inputs contain task completion, duration, time to first useful pivot,
error and backtrack counts, and controlled terminology issue identifiers. The
generated templates are bound to the current task version and digest. The
contract rejects participant identity, targets, queries, recordings, free-form
notes, unknown fields, stale task definitions, repeated tasks, and duplicate
canonical sessions. The result is a small-study diagnostic, not product
analytics.

### Synthetic analyst journeys

The synthetic journey contract provides a deterministic, fixture-only
regression lane. It maps the principal Console workflows to
four controlled analyst roles and eight end-to-end goals, including initial
domain review, Bulk peer triage, all three guided investigations, reviewed
response preparation, workspace portability, and acquisition review.

Inspect the plan, run the curated browser lane, or create a bounded result
template with:

```bash
npm run journeys:synthetic -- --plan
npm run test:e2e:journeys
npm run journeys:synthetic -- --template=first-domain-assessment:mobile
npm run journeys:synthetic -- results.json
```

The browser lane reuses the full application workflows and their existing
desktop and mobile layout checks. It runs against local fixtures under the E2E
network guard, makes no live registry or third-party requests, uses no retries,
and retains traces only when a test fails. The plan also requires every task to
declare both desktop and mobile coverage before it is accepted.

Aggregated result files retain only controlled outcome states, milestone IDs,
durations, and bounded error or backtrack counts. Identity, domains, queries,
page contents, recordings, and free-form notes are rejected, and nothing is
uploaded. These journeys can catch navigation, state-handoff, layout, and
contract regressions. Interpret action and timing changes as leads for local
inspection rather than conclusions about the interface or evidence.

### Local SSLBL snapshot maintenance

Deep Lookup can compare the observed leaf-certificate SHA-1 fingerprint with a
checked-in local SSLBL snapshot. Download the CSV deliberately, then validate
it without changing the repository:

```bash
npm run sslbl:status
npm run sslbl:check -- --input=sslblacklist.csv
```

The status command verifies the checked-in module and exits non-zero when its
source date is stale, expired, or invalid. The feed check verifies the
operator-supplied file shape, timestamps, digests, entry delta, and rollback and
shrink safeguards. After reviewing the reported delta, regenerate the module
with `npm run sslbl:snapshot -- --input=sslblacklist.csv`. A removal of more
than 25 percent is rejected unless an operator separately reviews the feed and
explicitly supplies `--allow-large-shrink`. None of these commands downloads
the source.

### Registry-fixture freshness

```bash
npm run registry:fixtures
npm run registry:fixtures -- --json
npm run registry:fixture-scaffold -- --profile nic-io-colon --suffix ac --scenario registered
```

The freshness check verifies each reviewed fixture file against its recorded
SHA-256 digest and source-review date. It exits non-zero when a fixture changed,
its review is older than the bounded threshold, or its provenance record cannot
be verified. It does not contact the listed source or claim that the source is
currently reachable.

The scaffold produces a sanitised TypeScript fixture template using reserved
example values. It does not ingest or transform raw registry responses. Before
adding a fixture, remove personal data and tokens, retain only the minimum
parser-relevant fields, add a provenance record, and run the full registry
fixture suite.

### Optional-provider conformance

The automated suite runs every current optional-provider adapter through the
shared fixture-only conformance harness. The harness covers neutral misses,
rate limits, timeouts, malformed and oversized responses, truncation, and
stable provider and observation provenance. It does not enable a provider,
contact a provider, or permit arbitrary plugin code.

### Incremental Lookup transport spike

```bash
npm run lookup:transport-spike
```

This command exercises the shared bounded NDJSON contract offline. Source
updates remain explicitly non-persistable and only a validated final Lookup
envelope can become a result.

The spike is not connected to the frontend, an API route, or a hosting
provider. Production adoption remains gated on a separately reviewed adapter,
remote-runtime compatibility, deadline and cancellation behaviour, buffering
and fallback behaviour, deployment-wide cost controls, a deployment-specific
privacy review, and authenticated desktop and mobile smoke tests. The existing
buffered Netlify and Express endpoint remains the only deployed contract.

### Unicode confusable audit

```bash
npm run unicode:confusables
npm run unicode:confusables -- --json
```

Validates the checked-in bounded Unicode-confusable projection and runs its
offline labelled calibration and candidate-growth gates. It makes no network
request. Maintainers can separately provide the pinned Unicode source file to
check for projection drift; see
[Unicode confusable maintenance](idn-confusables.md).

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

### Browser-library retirement scan

```bash
npm run build
npm run security:retire
```

Scans the generated static JavaScript bundles for known high-severity
vulnerabilities in retired browser-library versions. The scanner downloads its
public advisory catalogue to the operating system's temporary directory and
does not receive lookup targets, evidence, credentials, or browser-local
workspace data. It supplements the production dependency audit and CodeQL; it
does not replace either check.

This maintainer command is separate from the passive browser-library profile
shown by an eligible Deep Lookup. Lookup uses a checked-in, pinned projection
of the catalogue and examines only bounded script indicators already present in
the captured homepage. It does not download a catalogue at request time, fetch
or execute a referenced script, or establish that an apparent component is
reachable or exploitable.

The checked-in projection can be reproduced from the exact pinned source file:

```bash
npm run catalog:retire -- --source /path/to/pinned-jsrepository.json --check
```

The command verifies the source SHA-256 digest before parsing it, applies the
same component, extractor, vulnerability, string, and output-byte limits as the
generator, and compares the resulting module byte-for-byte. The ordinary unit
suite also verifies the checked-in generated-module digest, so an unintended
catalogue edit fails offline verification without requiring the source file.
Replace `--check` with `--write` only when deliberately updating the generated
projection and its digest together. The command reads only the supplied local
file and does not download a catalogue.

### Architectural dependency boundaries

```bash
npm run architecture:check
```

This development-only check rejects circular application dependencies, browser
imports of server-only code, direct deep-collector imports from scheduled fast
and compact entry points, and optional intelligence adapters that bypass the
provider-neutral contract. The existing guarded Lookup dispatcher is the narrow
exception for fast and compact callers: its runtime profile gates remain the
authority for choosing collectors. The check reads local source and the locked
dependency graph only; it makes no network request and has no production effect.

### Dependency maintenance and SPDX export

Monthly grouped dependency update pull requests and the read-only GitHub
dependency-graph export are documented in
[Dependency maintenance and SBOM export](dependency-maintenance.md). Updates
remain subject to human review, branch protection, the complete verification
sequence, and the existing pinned-action, lockfile, licence, audit, CodeQL, and
architecture controls.

### Registry drift

```bash
npm run registry:drift
npm run registry:drift -- --json
```

Makes exactly two fixed, capped requests to official IANA catalogues. It
compares the embedded compatibility snapshot without probing registries or
rewriting files. Root-zone serial and publication-time changes remain visible
but do not fail the audit when the canonical active-TLD set is unchanged. Exit
status 1 reports changed membership, service coverage, or profile claims that
need review; status 2 reports an inconclusive check or invalid invocation.

### Deployment self-check

```bash
npm run deployment:self-check -- https://your-deployment.example
npm run deployment:self-check -- https://your-deployment.example --json
```

Runs the bounded public-boundary check documented in
[operations and deployment](operations.md#deployment-self-check).

## Command-line interface

The first-party CLI calls the same shared intelligence modules as the hosted
application. Public releases require Node.js 24 or later and can run without a
global installation:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
```

From a repository checkout, start with:

```bash
node bin/whoisleuth.mts --help
node bin/whoisleuth.mts doctor
```

The [CLI guide](cli.md) gives the installation and first-use path, while the
[complete CLI reference](cli-reference.md) documents commands for Lookup,
Bulk, Certificate Transparency, discovery, posture, HTTP and TLS intelligence, registry-source
comparison, compatibility inspection, Risk calibration, artefact verification,
privacy-safe source diagnostics, and evidence export. It also defines output
formats, exit codes, terminal detail levels, TTY-only progress and colour,
offline-first diagnostics, atomic private file output, strict automation exits,
resumable Bulk checkpoints, cancellation, saved-Lookup diff, direct readable
reports, machine progress events, a generated manual, and bash, zsh, and fish
completion scripts.

The CLI is a local package boundary. It is not included in the static frontend
or the Netlify function bundles unless a shared module is also used there. The
root application and ordinary candidate stay private, while the exact compiled
dependency closure can be packed, installed, and smoke tested without leaving
temporary artefacts in the repository:

```bash
npm run cli:package:check
```

## Project layout

```text
server.mts              Express, authentication, API, and static-site adapter
lib/                    Shared bounded collection and analysis modules
netlify/functions/      Thin Netlify adapters and optional scheduled worker
frontend/               SvelteKit public site and protected Console
bin/ and cli/            First-party CLI
fixtures/               Sanitised deterministic registry fixtures
test/ and e2e/           Unit, integration, and browser verification
tools/                  Maintainer checks and offline evaluation commands
docs/                   User, operator, architecture, contract, and CLI guides
```

See [architecture orientation](architecture.md) for component ownership and
the request pipeline.
