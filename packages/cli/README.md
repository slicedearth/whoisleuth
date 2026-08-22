# WHOISleuth CLI

WHOISleuth's command-line interface runs local WHOIS, RDAP, DNS, HTTP, TLS,
certificate, posture and lookalike investigation commands. Networked commands
run from the operator's machine; offline commands read only selected local input.
It does not use the hosted WHOISleuth login or workspace.

## Install

WHOISleuth requires Node.js 24 or later. Run the public package directly:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
```

Or install the `whoisleuth` command globally:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth doctor
```

The package has no dependency lifecycle scripts. Its version follows the
application version.

## Quick start

Inspect the installed command set and plan a Lookup:

```bash
whoisleuth --help
whoisleuth commands --common
whoisleuth lookup example.test --plan --json
```

Run common commands:

```bash
whoisleuth example.test
whoisleuth lookup example.test --deep --summary
whoisleuth bulk domains.txt --csv
whoisleuth discover example.test --preset common --jsonl
whoisleuth compare lookup.json --json
whoisleuth verify-artifact lookup.json --json --strict-exit
```

One strict domain, IP address or ASN can occupy command position as Lookup
shorthand. URL-like or ambiguous input requires the explicit `lookup` command;
only `bulk` accepts multiple targets.

## Command groups

| Group | Common commands |
| --- | --- |
| Investigate | `lookup`, `bulk`, `discover`, `ct-search`, `posture`, `http`, `tls`, `compare`, `brief` |
| Respond | `case-pack`, `change-packet`, `sharing-review`, `export` |
| Assure | `dnssec-validate`, `mail-transport`, `domain-control`, `assurance`, `workflow-plan`, `diff`, `inspect-archive`, `verify-artifact` |
| Utilities | `doctor`, `commands`, `completion`, `manual`, `registry-scaffold` |

Use the installed registry for the complete inventory:

```bash
whoisleuth commands --group investigate
whoisleuth commands --group respond --mode offline
whoisleuth commands --json
whoisleuth manual | man -l -
```

`registry-scaffold` has a separate fixture contract: its `--profile` selects a
fixed fixture profile and it rejects shared `--config` profiles. It creates
sanitised local fixture material.

## Collection and output

Fast Lookup is registration-first. Deep Lookup explicitly adds the applicable
WHOIS, DNS, website, TLS, registrar-RDAP and observed-network sources. Compact
Deep Bulk retains only the fields needed for comparison. Authorised active
commands require their dedicated command and per-run acknowledgement.

Focused `whoisleuth <command> --help` states the exact target, request, input and
output limits. `lookup --plan` lists planned sources before collection.

Terminal text is the default. Commands expose JSON, JSONL, CSV, Markdown, HTML
or domain-only output only where declared. `--output` writes a private local
file atomically and refuses an existing path unless `--force` is selected.
`--strict-exit` and `--fail-on` expose selected evidence states to automation.

Exit codes are 0 for completion, 2 for invalid input, 3 for collection or
comparison failure, 4 for a partial result or unmet selected evidence policy,
70 for internal bootstrap failure, 130 for cancellation and 143 for SIGTERM.

## Repository checkout

Contributors can run the source command without installing the package:

```bash
node bin/whoisleuth.mts --help
node bin/whoisleuth.mts lookup example.test --plan --json
npm run cli:package:check
```

The package includes `docs/cli.md` for usage and `docs/cli-reference.md` for
compatibility, privacy and evidence contracts. Report suspected vulnerabilities
through the private channel in `SECURITY.md`.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
