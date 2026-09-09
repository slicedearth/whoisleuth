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
whoisleuth bulk domains.txt --csv-with-metadata
whoisleuth discover example.test --preset common --jsonl
whoisleuth verify-artifact lookup.json --json --strict-exit
whoisleuth compare lookup.json --json
whoisleuth mail-headers message.eml --json
whoisleuth brief lookup.json
```

One strict domain, IP address or ASN can occupy command position as Lookup
shorthand. URL-like or ambiguous input requires the explicit `lookup` command.
Only `bulk` accepts multiple targets.

## Command groups

The installed catalogue groups commands under Investigate, Respond, Assure and
Utilities, with each command's inputs, output and network boundary.

Filter the canonical index without running the selected commands:

```bash
whoisleuth commands --group investigate
whoisleuth commands --group respond --mode offline
whoisleuth commands --json
whoisleuth manual | man -l -
```

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

### Message-header review

`mail-headers` parses only the bounded header block from a selected message file
or standard input. It extracts domain-only identity, reported SPF, DKIM, DMARC
and ARC states, exact-domain alignment, and the bounded `Received` route in its
reported order. It makes no request and does not retain address local parts,
display names, subject, body, attachments, or raw header values in its output.
Authentication states are header claims, not an independent DNS or
cryptographic validation, and alignment differences can be legitimate.

## Output and automation

### Resuming a fixed workflow

`workflow-run` emits a checkpoint for an installed recipe. A partial collection
pauses for review; resuming keeps that observation and does not collect it
again. Later steps can finish without making the earlier evidence complete:
the run still exits with code 4. Validation, usage and export failures remain
failures and are retried on resume. Step diagnostics stay on stderr, separate
from checkpoint JSON. New network steps still need `--approve-network`.

Checkpoint version 3 reads versions 1 and 2. Older installations reject version
3 rather than unknowingly repeating an incomplete collection. The checkpoint
can contain selected local paths and evidence; review it before sharing.

Use `--json --output state.json` for a resumable file, and add `--force` when
replacing it. File output holds private adjacent `.workflow.lock` files for
the selected resume and output paths until publication. Another writer is
refused; changes to either file during execution prevent replacement. State
files must be regular files without symbolic or additional hard links.

Locks contain only a local process ID and are removed after the run. Following
an interrupted process, confirm that its owner has stopped before removing its
abandoned lock. Locks have no automatic expiry. Shell redirection and external
editors do not participate in this cooperative file-ownership protocol.

### Formats and exit behaviour

Terminal text is the default. Commands expose JSON, JSONL, CSV, Markdown, HTML
or domain-only output only where declared by the installed registry. Redirected
and machine output contains no ANSI or transient progress text.

- `--summary` and `--verbose` change presentation, not collection.
  Verbose Lookup includes retained technology signals and library advisory
  identifiers. Their source times are separate; ages are measured at output
  generation, not at a later replay.
- `lookup --browse` provides an interactive terminal view; press `?` for keys.
- `--events` writes versioned lifecycle events to stderr.
- `--strict-exit` and `--fail-on` expose selected evidence states to automation.
- `--output` writes a private local file atomically and refuses an existing path
  unless `--force` is also selected.

Local configuration profiles can set presentation, Fast collection, bounded
concurrency and observer labels. They cannot add targets, enable Deep
collection, choose output paths or approve network work. Explicit command
options override profile defaults.

`source-report` summarises collector-owned health envelopes in saved Lookup
and Bulk output. Raw publications and extension fields are not interpreted as
diagnostics, and missing health metadata remains unmeasured.

`mail-review` keeps failed input targets, incomplete DNS coverage and original
collection times visible. Source-output and review-generation times do not
stand in for missing observation times. `domain-change` and
`domain-change-packet` retain authority, resolver and certificate observation
times; previously published version-2 packets remain verifiable.

## Exit codes

See the [exit-code reference](cli-reference.md#files-output-and-automation).
A completed command can still contain partial sources; use the selected
command's strict-exit policy when automation requires complete evidence.

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
