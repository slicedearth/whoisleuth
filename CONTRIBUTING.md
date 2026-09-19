# Contributing

Start with [local setup](docs/getting-started.md). Use the committed lockfile
and development runtime in `.nvmrc`. Keep changes focused and add a regression
test that would fail without the change.

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
- **CLI options:** `cli/command-reference.mts` owns grammar and command bindings.
  Help and completion derive from it; command handlers own execution.
- **Portable fields:** `packages/cases/case-record-projection.mts` requires
  explicit audience treatment. Preserve independent privacy assertions and
  immutable published-version fixtures; do not derive their expected answers
  from the implementation being tested.

Lifecycle definitions use one internal metadata format. Its factory supplies
the metadata version and empty optional policies; variants still need explicit
discriminators and fixture bindings. Public document versions are separate.

Follow imports and nearby tests rather than adding another registration table.
An ordinary helper in an existing area needs no package-inventory baseline or
ownership exception. New unit tests follow `test/<name>.test.mts` and are
discovered automatically. Source counts are reported; resource bounds still
protect bytes, processing and untrusted imports.
New tests need no timing-profile entry. Current discovery decides what runs;
retained measurements only help balance shards. New browser tests use a labelled
scheduling estimate until accepted measurements are available.

## Check the change

```bash
npm run verification:focused -- --list
npm run verification:focused
```

The default scope is the working diff. For a committed or smaller change, pass
its paths explicitly after `--`. Read the plan: runtime imports find unit and
browser consumers, while domain rules preserve workflow checks. Ordinary Svelte
components inherit the checks of their consuming routes; known component families
retain their workflow suites. Shared-code edits keep all compiler projects checked,
so erased type imports need not select unrelated runtime tests.
Missing runtime import evidence falls back to all unit tests, and unexplained
interface changes select all functional browser tests. A full run remains available for infrastructure
changes and reproducing CI; see [verification](docs/getting-started.md#verification).

Selected browser specifications are loaded before expensive checks. This catches
test-discovery and import errors without starting a server or browser; it is not
a substitute for the subsequent verified-build execution.

For ordinary Case setup, `test/support/current-case.mts` supplies a deterministic,
detached current record and collection envelope. Invalid overrides fail at setup
instead of being silently normalised. Keep the expected behaviour in the test
independent. Historical-format and hostile-input tests must retain their own
explicit inputs, not regenerate them through a current fixture builder.

Before submitting a feature branch, run proportionate local checks and state
any omissions. Merge requires complete fresh hosted checks against the current
merge candidate. Release verification is a separate boundary. Local success
does not promise identical behaviour on every supported environment.

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

- Change a Case form's presentation in its owning component. Inspect the
  focused plan and exercise the affected control with keyboard and narrow-screen
  checks; do not change domain rules to achieve a visual result.
- Change a recheck rule in `packages/cases/case-recheck-model.mts` and add an
  independently expected result in `test/case-recheck.test.mts`. A failed
  collection must remain inconclusive.
- Extract a private helper from an existing module, preserving its exported
  behaviour. The existing consumer tests and focused plan should still find it
  without an inventory baseline or a new registration table.

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
