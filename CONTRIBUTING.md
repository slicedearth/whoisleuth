# Contributing

Start with [local setup](docs/getting-started.md). Use the committed lockfile
and development runtime in `.nvmrc`. Keep changes focused. Add an independent
regression test for a behavioural defect; inspect cosmetic changes in the
rendered interface rather than freezing individual CSS values in tests.
Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Format edited source with `npm run format -- <path> ...`; quote paths containing
parentheses. The shared configuration also works in editors. Keep formatting
focused on the files being changed, and put larger readability-only changes in
their own commit. It is an editing aid, not a blocking CI style gate. Generated
references, retained data and compatibility fixtures use their existing owners.

## Find the owner

- **Interface behaviour:** start at `frontend/src/routes/`, follow component
  imports, and keep temporary form state with the form. Domain rules belong in
  `packages/`; browser storage and DOM operations belong in frontend adapters.
- **Case decisions:** `packages/cases/case-record-decisions.mts` owns identities
  and labels. Transition policy is separate from presentation. Response forms
  use the existing workspace save coordinator, not independent writes.
- **Response history:** `case-response-actions.mts` owns action transitions;
  `case-response-outcomes.mts` owns observed effects and closure. Packet input
  validation is in `case-response-review-inputs.mts`, separate from construction.
- **Lookup downloads:** `frontend/src/lib/analysis/lookup-exports.ts` prepares
  projections and files; the route owns visible status, not export formatting.
- **Lookup state:** `controllers/lookup-session.ts` owns request state, URL
  reconciliation and session snapshots; `lookup-view-state.ts` restores observations.
  `lookup-case-workspace.ts` and `lookup-watchlist-workspace.ts` own their drafts,
  saves and stale-result guards. `lookup-section-navigation.ts` handles section
  buttons, evidence links and hash restoration through the shared anchor controller.
  Request and storage adapters retain their collection and transaction boundaries.
- **Bulk state:** `bulk-scan-controller.ts` owns a scan from start through pause,
  cancellation and disposal. `bulk-view-state.ts` creates, resets and projects
  filters. `bulk-session-workspace.ts` owns saved-session drafts, retention
  approval and write/reload outcomes; the route connects it to the scan controller.
- **Bulk actions:** `bulk-case-actions.ts` coordinates Case writes and refreshes;
  `bulk-monitor-actions.ts` admits every Monitor save through the same checks.
  `analysis/bulk-export.ts` owns CSV columns; the route only downloads the result.
- **Brand Profile editing:** `controllers/brand-profile-editor.ts` owns form values,
  reset/load, submission and capture cancellation. The route's existing mutation
  coordinator still owns writes, conflicts and recovery reads.
- **CLI options:** family `cli/*-command-definitions.mts` files own command
  bindings; `command-definition.mts` owns shared options. Help and completion
  derive from them; command handlers own execution.
- **CLI recipes:** `cli/investigation-recipes.mts` owns recipe definitions. Names,
  argument choices and catalogue entries derive; plan construction validates
  each step against the command's independent network contract.
- **Portable fields:** `packages/cases/case-record-projection.mts` requires
  explicit audience treatment. Preserve independent privacy assertions and
  immutable published-version fixtures; do not derive their expected answers
  from the implementation being tested.

Lifecycle definitions use one internal metadata format. Its factory supplies
the metadata version and empty optional policies; variants still need explicit
discriminators and fixture bindings. Public document versions are separate.

Follow imports and nearby tests rather than adding another registration table.
Cross-runtime analysis belongs in `packages/analysis/`; domain directories
inherit dependency boundaries without a filename allowlist. Existing public
facades stay compatible, but new internal imports use the implementation owner.
An ordinary helper in an existing area needs no package-inventory baseline or
ownership exception. New unit tests follow `test/<name>.test.mts` and are
discovered automatically. Source counts are reported; resource bounds still
protect bytes, processing and untrusted imports.
New tests need no timing-profile entry. Current discovery decides what runs;
retained measurements only help balance shards. New browser tests use a labelled
scheduling estimate until accepted measurements are available.

## Check the change

Choose checks for the behaviour changed, not the number of files touched.

| Change | Local verification |
| --- | --- |
| Spacing, colours, typography or equivalent wording | `npm run check`, `git diff --check`, and rendered review of affected pages at desktop/mobile widths and both themes. No new regression test or full local suite is required. |
| A pure domain rule or helper | Run its independent unit tests and compiler checks. Preserve relevant property, hostile-input and compatibility tests. |
| Navigation, forms, loading, persistence or meaningful evidence copy | Use the focused plan below and exercise the changed workflow. Keep accessibility and privacy expectations independent. |
| Shared protocols, schemas, authentication, packaging or verification infrastructure | Use the relevant integration and contract checks; broaden to the full local boundary when the change crosses those boundaries. |

Visual review includes alignment, hierarchy, density, legibility, hover/focus and
clipping. Screenshots help review a substantial redesign; they are not an
automatic request for screenshot baselines or pixel assertions. Changes to
disclosed scope, uncertainty, privacy or accessibility are behavioural, not
equivalent wording.

For behavioural changes:

```bash
npm run verification:focused -- --list
npm run verification:focused
```

While editing, add `--iteration` to run the selected unit/type checks and
browser-import discovery without building or executing browsers, packages or
repository-wide integration gates. The plan explains which changed paths
selected each check and lists every deferred gate. Run the same selection
without `--iteration` at the coherent batch boundary. Neither mode replaces
the complete required pre-merge checks.

For a fast all-domain feedback pass, use `npm run test:unit`. Repository-wide
integration checks use the `.integration.test.mts` suffix and run through
`npm run test:integration`. `npm test` still discovers both; required CI runs
product coverage and integration checks separately, without instrumenting the
repository analyser itself. New test files need no inventory registration.

Small leaf components can have a `<kebab-name>.component.spec.ts` browser
contract exercised through a real page. Focused selection uses it only when the
component imports no local modules and has no cross-cutting owner. Shared state,
storage, navigation and unresolved imports retain workflow coverage. Full
pre-merge browser coverage is unchanged.

Passing screenshots are an optional review gallery: set
`WHOISLEUTH_E2E_VISUAL_EVIDENCE=1` when collecting images for inspection. Ordinary
runs retain all viewport, accessibility and behaviour assertions; failures still
retain automatic screenshots and traces. `WHOISLEUTH_E2E_LOCAL_JOBS=2` permits
two functional shards on a host with sufficient capacity. The default is one,
performance measurements remain isolated, and queued shards stop on failure.
Loading reports record transfer, timing and long tasks without historical
bundle-size ceilings. Prepared interactions still require zero new assets;
readiness, layout stability, module isolation and request boundaries remain
blocking. Review measurements for material regressions rather than updating
a size baseline whenever an implementation changes.

The default scope is the working diff. For a batch spanning local commits, use
`npm run verification:focused -- --since=<base-commit> --list`, then omit `--list`
to run it. This includes committed, staged, unstaged and new files. Explicit
paths after `--` select a smaller declared scope. Read the plan: runtime imports
and routes referenced by browser tests find consumers, while domain rules
preserve workflow checks. Ordinary frontend
components and models inherit the checks of their consuming routes; known families
retain their workflow suites. Shared-code edits keep all compiler projects checked,
so erased type imports need not select unrelated runtime tests.
No known runtime consumer falls back to all unit tests. An unresolved local import
keeps its reachable test consumers selected for every source change and is named
in the plan; missing graph roots remain conservative. Unexplained interface
changes select all functional browser tests. A full run remains available for infrastructure
changes and reproducing CI; see [verification](docs/getting-started.md#verification).

Verification responsibilities are separate: `tools/verification-policy.mts`
contains the curated workflow obligations; `runtime-test-consumers.mts` indexes
runtime dependents; `verification-ownership.mts` combines them into the explained
plan. An ordinary module or test still requires no registration.

UI tests should assert the behaviour they protect. Locate navigation by its
destination and accessible role; avoid layout classes or whole explanatory
sentences when their wording is not the contract. Keep independent assertions
for meaningful names, privacy disclosures and evidence limitations. Run the
affected tests before broad verification.

Lookup and Bulk collection start in `controllers/*-collection-workflow.ts`:
admission, submitted context and completion live there. Routes supply view effects;
request controllers own cancellation and workspace controllers own saved mutations.
Lookup section eligibility and deferred imports live together in
`components/lookup-section-surfaces.ts` and `lookup-web-surfaces.ts`, shared by
rendering and intent loading.

Selected browser specifications are loaded before expensive checks. This catches
test-discovery and import errors without starting a server or browser; it is not
a substitute for the subsequent verified-build execution.

Frontend build identity discovers local build helpers through configuration
imports. Adding or extracting a helper needs no inventory entry. Unrelated test
tools are not frontend inputs; source bytes, served bytes and the build revision
must still match before reusing an artefact.

For ordinary Case setup, `test/support/current-case.mts` supplies a deterministic,
detached current record and collection envelope. Invalid overrides fail at setup
instead of being silently normalised. Keep the expected behaviour in the test
independent. Historical-format and hostile-input tests must retain their own
explicit inputs, not regenerate them through a current fixture builder.

For a portable Case field, start with `case-record-contracts.mts`, then declare
its audience treatment in `case-record-projection.mts`. Current recovery is in
`case-record-operations.mts`; declared historical input adaptation is in
`case-record-version-input.mts`, with store/import admission in
`case-migration-model.mts`. Change the format owner in
`packages/contracts/case-portability.mts` only when the durable contract changes.
Run the Case ownership and portability lifecycle tests; retain published
fixtures unchanged and add an independent current fixture when required.

CLI commands are grouped by responsibility: collection, network, evidence,
review, assurance, workflow, history and support. Each family's
`cli/*-command-definitions.mts` owns its reference and grammar bindings;
`cli/*-arguments.mts` owns its parsed contract and semantic validation.
The combined argument union is inferred from those parsers. Shared option
definitions live in `command-definition.mts`; help, completion and browser
reference pages derive from them. Keep effects in the corresponding runner,
not in the data-only definition. Independent network and privacy expectations
remain in the contract tests.
Each runner declares its own dependency type beside its handlers; the dispatcher
composes those types. Add a new injectable effect at its consumer, not to a
parallel central list. Only workflow handlers receive recursive command execution.

Before submitting a feature branch, run proportionate local checks and state
any omissions. Merge requires complete fresh hosted checks against the current
merge candidate. Release verification is a separate boundary. Local success
does not promise identical behaviour on every supported environment.
For a Linux-specific change, `npm run verification:linux -- --focused <path> ...`
runs the existing selection in a clean container; add `--list` to preview it.
The complete local Linux run is opt-in with `--full`, not a routine push requirement.

For workflow changes, run `npm run workflow:check`. Local and hosted quality
checks use the same pinned actionlint release and platform archive digests.
The command downloads the official executable into a temporary directory,
checks its digest, validates every workflow and removes the executable.
Set `WHOISLEUTH_ACTIONLINT_ARCHIVE` to a previously downloaded matching archive
for offline use. No global installation or additional language toolchain is
required. Optional shellcheck and pyflakes discovery is disabled so installed
host tools cannot silently change this check's scope.

## Review a small change

Trace an interface event from its form through validation, the domain operation
and persistence result. For a pure rule, run its test with
`node --test test/<name>.test.mts`. After extracting a helper, inspect the focused
plan to confirm its consumers were discovered without new bookkeeping.

Preserve drafts on validation or write failure. A committed write followed by
a refresh failure is not an ordinary save failure: reconcile or reload rather
than repeating an append-only action. Check keyboard focus, status messages and
narrow-screen layout for affected forms.

For a concrete editing rehearsal, use one small change at a time:

- Change a Case form's presentation in its owning component and review its
  rendered appearance and keyboard operation. Do not change domain rules or
  add tests for individual style values to achieve a visual result.
- Change a recheck rule in `packages/cases/case-recheck-model.mts` and add an
  independently expected result in `test/case-recheck.test.mts`. A failed
  collection must remain inconclusive.
- Extract a private helper from an existing module, preserving its exported
  behaviour. The existing consumer tests and focused plan should still find it
  without an inventory baseline or a new registration table.

For state changes, add a field to its owning state type and factory, then define
whether it survives reset and navigation. Exercise the lifecycle through that
owner instead of adding another route-level reset list. For removals, update
consumers and inspect the focused plan's conservative fallback for deleted files.
Remove obsolete behaviour tests, not historical compatibility or privacy evidence.
Retain a forwarding export when the removed internal location is a supported
public entry point.

Review the actual diff and selected checks after each exercise. These rehearsals
show the change path; they do not establish that an unfamiliar contributor
found it understandable.

## Observe a first-use session

The controlled [task script](fixtures/first-use-analyst-study-tasks.mts) covers
orientation, evidence review, saved filters, rechecks, file recovery and CLI
workflow continuation. Use supplied synthetic material in an isolated workspace;
do not collect live targets merely to conduct a study.

`npm run study:first-use -- --template=desktop` prints a current recording
template; `--template=mobile` omits the CLI task. Record only attempted tasks,
replace template defaults with observations, and keep the task version and
digest unchanged. The same command accepts a local JSON array of sessions for
aggregation. Older task scripts cannot be pooled into the current report.
Do not retain names, targets, recordings or free-text notes in these records.
Automated browser checks, simulated sessions and elapsed time alone are not
evidence of human usability.

Do not include credentials, private investigations or local paths in source,
fixtures or reports. Automated tests use deterministic reserved targets and
must not perform live collection. Report security issues through
[the security policy](SECURITY.md).
