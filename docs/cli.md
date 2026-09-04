# WHOISleuth CLI guide

The first-party CLI runs on the operator's machine and does not call the hosted
WHOISleuth deployment. Use this guide for installation, common commands,
collection boundaries and output. Installed `whoisleuth --help`, focused
`--help` and `whoisleuth commands` output are the authority for that installed
version. The [CLI reference](cli-reference.md) covers durable command and
artefact contracts.

The generated [privacy and data-flow catalogue](https://github.com/slicedearth/whoisleuth/blob/main/docs/privacy-data-flow-catalogue.md)
lists the network, recipient, retention and export boundary for every command.

## Installation

Public releases require Node.js 24 or later. Release verification uses the
exact Node.js 24 maintainer runtime and separately exercises the installed
package on Node.js 26:

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

The package and application share one semantic version. The package requires no
dependency lifecycle scripts. From a repository checkout, replace `whoisleuth`
with `node bin/whoisleuth.mts`; maintainers can verify the exact package closure
with `npm run cli:package:check`.

## First commands

Inspect the installed command set and plan one Lookup before collecting:

```bash
whoisleuth --help
whoisleuth commands --common
whoisleuth doctor
whoisleuth lookup example.test --plan --json
```

Run Fast or Deep Lookup:

```bash
whoisleuth example.test
whoisleuth lookup example.test --deep
whoisleuth lookup example.test --deep --summary
whoisleuth lookup example.test --deep --browse
whoisleuth lookup example.test --deep --markdown --output lookup.md
```

To continue a reviewed terminal Lookup in the browser, save the completed
private document from the interactive view:

```bash
whoisleuth lookup example.test --deep --browse --save-lookup lookup.json
```

In Console Lookup, open **Replay exported evidence**, select the file, verify
its digest and source states, then create or update a browser-local Case. The
file is not uploaded. Case classification, exact incident links, response
actions and packet preparation remain deliberate browser steps.

Process selected local input:

```bash
whoisleuth bulk domains.txt --csv
whoisleuth discover example.test --preset common --jsonl
whoisleuth verify-artifact lookup.json --json --strict-exit
whoisleuth compare lookup.json --json
whoisleuth brief lookup.json
```

One strict domain, IP address or ASN can occupy command position as Lookup
shorthand. URL-like or ambiguous input requires the explicit `lookup` command.
Only `bulk` accepts multiple targets.

## Command groups

The installed registry groups commands under the same analyst vocabulary as the
application:

| Group | Common commands |
| --- | --- |
| Investigate | `lookup`, `bulk`, `discover`, `ct-search`, `posture`, `http`, `tls`, `compare`, `brief` |
| Respond | `case-pack`, `change-packet`, `sharing-review`, `export` (local handoff from browser-created Cases) |
| Assure | `dnssec-validate`, `mail-transport`, `domain-control`, `assurance`, `workflow-plan`, `diff`, `inspect-archive`, `verify-artifact` |
| Utilities | `doctor`, `commands`, `completion`, `manual`, `registry-scaffold` |

Filter the canonical index without running the selected commands:

```bash
whoisleuth commands --group investigate
whoisleuth commands --group respond --mode offline
whoisleuth commands --json
whoisleuth manual | man -l -
```

`registry-scaffold` has a separate fixture bootstrap contract: its `--profile`
selects one fixed fixture profile and it rejects shared `--config` profiles.
It creates sanitised local fixtures and does not contact a registry.

## Collection boundaries

| Mode | Behaviour |
| --- | --- |
| Fast Lookup | Registration-first triage without WHOIS or deeper website and TLS collection. |
| Deep Lookup | Explicit RDAP, WHOIS, DNS, website, TLS, registrar-RDAP and observed-network collection where applicable. |
| Compact Deep Bulk | Comparison fields from shared Lookup orchestration, omitting full-only collectors and response fields. |
| Offline | Reads only the named local artefact, stdin or built-in catalogue. |
| Authorised active | Requires its dedicated command and per-run owned-or-authorised acknowledgement. |

Networked commands run from the local machine and contact the sources named in
their focused help. They do not use the hosted login or hosted usage controls.
`lookup --plan` lists planned source families and disclosure targets before
collection. `doctor` is offline unless `--network` is selected.

## Output and automation

Terminal text is the default. Commands expose JSON, JSONL, CSV, Markdown, HTML
or domain-only output only where declared by the installed registry. Redirected
and machine output contains no ANSI or transient progress text.

- `--summary` and `--verbose` change presentation, not collection.
- `lookup --browse` provides an interactive terminal view; press `?` for keys.
- `--events` writes versioned lifecycle events to stderr.
- `--strict-exit` and `--fail-on` expose selected evidence states to automation.
- `--output` writes a private local file atomically and refuses an existing path
  unless `--force` is also selected.

Local configuration profiles can set presentation, Fast collection, bounded
concurrency and observer labels. They cannot add targets, enable Deep
collection, choose output paths or approve network work. Explicit command
options override profile defaults.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | The command completed. |
| 2 | Invalid command, option or input. |
| 3 | Collection, lookup or comparison failed. |
| 4 | The result was partial or a selected evidence policy was not met. |
| 70 | Internal CLI bootstrap failure. |
| 130 | The analyst cancelled the command. |
| 143 | The process received SIGTERM. |

## Command details

Run `whoisleuth <command> --help` for exact arguments, input ceilings, network
effects and output formats. The packaged [CLI reference](cli-reference.md) gives
the longer-lived compatibility and evidence contracts, while the generated
[online command reference](https://www.whoisleuth.com/cli#commands) provides a searchable index.

## Safety and limitations

WHOISleuth is a defensive investigation tool, not an authorisation mechanism.
Operators remain responsible for permission, applicable law and provider terms.
Incomplete evidence remains explicitly qualified, and analyst assertions remain
separate from observed facts.
