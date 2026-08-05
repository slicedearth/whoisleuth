# WHOISleuth CLI guide

The first-party CLI runs locally and uses the same bounded classification,
collection, and analysis modules as the web application. It does not call the
hosted WHOISleuth deployment. Use this guide for installation, first commands,
collection boundaries, output, and automation behaviour. The
[complete CLI reference](cli-reference.md) documents every command family and
artefact contract.

## Installation

Public releases require Node.js 24 or later and install the `whoisleuth`
command:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth doctor
```

Update and verify an existing installation with:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest
whoisleuth --version
whoisleuth doctor
```

The scoped package and application share one semantic version. The package
includes `LICENSE`, `NOTICE`, `TRADEMARKS.md`, this guide, and the complete
reference. It requires no lifecycle scripts, so the examples disable them.
An unqualified `npx whoisleuth` is not this project.

From a repository checkout, replace `whoisleuth` with
`node bin/whoisleuth.mts`. Maintainers can assemble, install, and smoke-test the
exact compiled package closure without publishing it:

```bash
npm run cli:package:check
```

## First commands

Inspect the installed capabilities before collection:

```bash
whoisleuth --help
whoisleuth commands
whoisleuth doctor
whoisleuth lookup example.com --plan --json
```

Run a fast lookup or deliberately request the deeper profile:

```bash
whoisleuth lookup example.com
whoisleuth lookup example.com --deep
whoisleuth lookup example.com --deep --summary
whoisleuth lookup example.com --deep --markdown --output lookup.md
```

Process an explicit bounded list, generate lookalike candidates, or inspect a
saved result without sending it anywhere:

```bash
whoisleuth bulk domains.txt --csv
whoisleuth discover example.com --preset common --jsonl
whoisleuth verify-artifact lookup.json --json
whoisleuth compare lookup.json --json
whoisleuth brief lookup.json
whoisleuth registry-doctor lookup.json --json
```

Only one query is accepted by `lookup`; multi-input processing belongs to
`bulk`. Standard input to `lookup` is capped at 4 KiB and must contain one
non-empty line.

## Collection profiles

Commands are classified as either networked or offline in focused help, the
generated manual, and `commands --json`.

| Profile | Boundary |
| --- | --- |
| Fast Lookup | Conservative default for domain triage. It does not run WHOIS or deep website and TLS collection. |
| Deep Lookup | Explicitly requested bounded RDAP, WHOIS, DNS, website, TLS, registrar-RDAP, and observed-network work where applicable. |
| Compact deep Bulk | Uses the shared Lookup orchestration but omits full-only response fields and collectors. |
| Offline review | Reads only the named bounded artefact or analyst-authored input and makes no network request. |

Networked commands run from the local machine and contact the sources declared
by their profile. They do not use the hosted login or hosted usage controls;
upstream services can see and rate-limit the local network address. The CLI
does not implicitly enable the browser Console's optional external intelligence
actions.

`lookup --plan` performs classification and emits a versioned preflight without
starting collection. It lists planned source families and disclosure targets,
but cannot predict cache state, live configuration, redirects, referrals,
source availability, or exact request count.

`doctor` is offline by default. `doctor --network` adds three independent,
bounded checks against fixed diagnostic infrastructure and retains only state,
HTTP status, and a bounded explanation.

## Command map

| Goal | Commands |
| --- | --- |
| Investigate a target | `lookup`, `http`, `tls`, `posture`, `registry-support` |
| Review many targets | `bulk`, `discover`, `discover-scan`, `ct-search`, `ct-intake` |
| Compare saved evidence | `compare`, `page-compare`, `diff`, `reconcile`, `timeline`, `mail-review` |
| Review supplied evidence | `brief`, `review-evidence`, `registry-doctor`, `registry-cohort`, `source-report`, `sharing-review` |
| Plan and assure changes | `domain-control`, `monitor-once`, `assurance`, `change-packet`, `workflow-plan`, `workflow-run` |
| Verify and package evidence | `case-pack`, `manifest`, `verify-artifact`, `inspect-archive`, `sign-artifact`, `verify-signature`, `export` |
| Calibrate offline | `risk-calibrate`, `lookalike-calibrate` |
| Operate the CLI | `doctor`, `registry-scaffold`, `commands`, `completion`, `manual` |

Use focused help for the exact arguments and collection ceiling:

```bash
whoisleuth lookup --help
whoisleuth sharing-review --help
whoisleuth commands --json
whoisleuth manual | man -l -
```

## Output and automation

Human-readable terminal output is the default. Interactive terminals use
restrained semantic colour and transient progress on stderr. Redirected output,
JSON, and JSONL contain no ANSI sequences or progress text. State remains
explicit in text, so colour is never the only distinction.

- `--json` and `--jsonl` provide bounded machine-readable documents.
- `--summary` and `--verbose` change human detail without changing collection.
- `--no-color` or `NO_COLOR` disables colour.
- `WHOISLEUTH_NO_PROGRESS=1` disables the transient progress indicator.
- `--events` keeps the final document on stdout and writes versioned JSONL
  lifecycle events to stderr.
- `--strict-exit` treats failures in explicitly requested source families as a
  partial failure while keeping skipped or unsupported sources neutral.
- `--fail-on` applies explicit `source-failure`, `inconclusive`, `danger`, or
  `material-drift` automation policy where the selected command supports it.
- `--junit` emits bounded CI test cases for Lookup, Bulk, and one-shot control
  reviews; owned-domain Posture can emit `--sarif` only with
  `--owned-domain`.

`--config <file> --profile <name>` applies a strict version-1 local profile.
The default path is `$XDG_CONFIG_HOME/whoisleuth/config.json`. Profiles can set
only presentation mode, Fast collection, bounded concurrency, and observer or
vantage labels. They cannot add targets, enable Deep collection, select output
paths, approve network work, or set failure policy. Explicit command options
override defaults from the same option group.

Every command accepts `--output <file>`. WHOISleuth buffers bounded output,
creates a private temporary file beside the destination, syncs it, and publishes
it atomically with mode `0600`. Existing destinations are refused unless
`--force` is deliberately combined with `--output`. Failed or cancelled
commands do not publish partial files. Output is capped at 32 MiB.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed. Individual sources can still be partial or inconclusive; inspect diagnostics. |
| 2 | Invalid command, option, input, or stdin shape. |
| 3 | The requested lookup, collection, or comparison could not run. |
| 4 | A bounded operation completed partially. |
| 70 | Unexpected CLI bootstrap failure. |
| 130 | The analyst cancelled the command; no partial final result was emitted. |

## Detailed command reference

The headings below preserve the established guide anchors while moving their
full contracts into the packaged reference.

### Registry capability coverage

[Read the complete registry capability reference.](cli-reference.md#registry-capability-coverage)

### Offline Risk calibration

[Read the calibration dataset and replay contract.](cli-reference.md#offline-risk-calibration)

### Lookalike review-yield calibration

[Read the reviewed candidate calibration contract.](cli-reference.md#lookalike-review-yield-calibration)

### Offline artefact verification

[Read the archive, saved Lookup, and signed-artefact verification contract.](cli-reference.md#offline-artefact-verification)

### Privacy-safe source reliability report

[Read the target-free source diagnostic contract.](cli-reference.md#privacy-safe-source-reliability-report)

### Workspace archive inspection

[Read the redacted archive summary and search contract.](cli-reference.md#workspace-archive-inspection)

### Optional evidence-package signing

[Read the local signing and verification contract.](cli-reference.md#optional-evidence-package-signing)

### Reproducible investigation manifest

[Read the ordered, path-free artefact digest contract.](cli-reference.md#reproducible-investigation-manifest)

### Bulk lookup

[Read Bulk bounds, filters, formats, checkpoints, and cancellation behaviour.](cli-reference.md#bulk-lookup)

### Certificate Transparency search

[Read the CT query and source-limit contract.](cli-reference.md#certificate-transparency-search)

### Local certificate event intake

[Read the offline, source-qualified event import contract.](cli-reference.md#local-certificate-event-intake)

### Lookalike discovery

[Read candidate generation, dictionaries, snapshots, and output behaviour.](cli-reference.md#lookalike-discovery)

### Supervised candidate scan

[Read the bounded candidate collection workflow.](cli-reference.md#supervised-candidate-scan)

### Domain posture audit

[Read the DNS, mail, and certificate posture contract.](cli-reference.md#domain-posture-audit)

### HTTP intelligence

[Read the bounded HTTP collection contract.](cli-reference.md#http-intelligence)

### TLS intelligence

[Read the bounded TLS collection contract.](cli-reference.md#tls-intelligence)

### Registry-source comparison

[Read the normalised RDAP and WHOIS comparison contract.](cli-reference.md#registry-source-comparison)

### Static page comparison

[Read saved page-identity comparison behaviour.](cli-reference.md#static-page-comparison)

### Passive mail exposure review

[Read the saved-evidence mail review contract.](cli-reference.md#passive-mail-exposure-review)

### Offline supplied-evidence review

[Read the DNSSEC, DANE, zone-intent, portfolio, domain-change, and supplied-observation review contract.](cli-reference.md#offline-supplied-evidence-review)

### Domain control manifests

[Read desired-state manifest and drift-review behaviour.](cli-reference.md#domain-control-manifests)

### Domain assurance review

[Read planned-change, recovery-dependency, and retirement contracts.](cli-reference.md#domain-assurance-review)

### Domain change assurance packet

[Read the bounded pre-change, post-change, planning, and integrity contract.](cli-reference.md#domain-change-assurance-packet)

### Pre-sharing review

[Read the local marking, scope, redaction, and integrity preflight.](cli-reference.md#pre-sharing-review)

### Fixed investigation plans

[Read the plan-only recipe contract and approval gates.](cli-reference.md#fixed-investigation-plans)

### Local handoffs and one-shot monitoring

[Read brief, case-package, fixed-recipe execution, and one-shot control-review contracts.](cli-reference.md#local-handoffs-and-one-shot-monitoring)

### Optional local rendered capture

[Read the separate Playwright capture package boundary.](cli-reference.md#optional-local-rendered-capture)

### Lookup evidence export

[Read normalised JSON, Markdown, and HTML export behaviour.](cli-reference.md#lookup-evidence-export)

## Safety and limitations

WHOISleuth is a defensive investigation tool, not an authorisation mechanism.
Operators remain responsible for applicable law, registry and provider terms,
and permission to assess a target. Missing, unsupported, partial, or failed
evidence never establishes absence, availability, safety, ownership, or intent.
Offline analyst assertions remain separately attributed and are not converted
into observed facts.
