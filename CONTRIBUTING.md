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
- **CLI options:** `cli/command-reference.mts` owns grammar and command bindings.
  Help and completion derive from it; command handlers own execution.
- **Portable fields:** `packages/cases/case-record-projection.mts` requires
  explicit audience treatment. Preserve independent privacy assertions and
  immutable published-version fixtures; do not derive their expected answers
  from the implementation being tested.

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
its paths explicitly after `--`. Read the plan: import analysis finds unit
consumers and domain rules select browser checks. Browser families discover new
specifications by filename; Case stage forms use their form and workspace suites.
Missing import evidence falls back to all unit tests, and unexplained interface
changes select all functional browser tests. A full run remains available for infrastructure
changes and reproducing CI; see [verification](docs/getting-started.md#verification).

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

Do not include credentials, private investigations or local paths in source,
fixtures or reports. Automated tests use deterministic reserved targets and
must not perform live collection. Report security issues through
[the security policy](SECURITY.md).
