# WHOISleuth CLI

WHOISleuth's command-line interface runs the same bounded WHOIS, RDAP, DNS,
HTTP, TLS, certificate-transparency, domain-posture, and lookalike analysis
used by the self-hosted application. Network commands run directly from the
operator's machine. Offline evidence commands do not contact the hosted site.

## Install

WHOISleuth requires Node.js 24 or later. Run the reviewed public package without
a global installation:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
```

Or install the `whoisleuth` command globally:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth doctor
```

Update an existing global installation and confirm the installed release with:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest
whoisleuth --version
```

The package version follows the application version. Each release is assembled
from the executable's bounded dependency closure and retains the project
licence, notices, trademark terms, source location, and provenance metadata.
The generated package manifest pins each direct runtime dependency to the exact
version exercised by the reviewed repository lockfile.

The package has no install, postinstall, or other lifecycle scripts. Network
access begins only when an analyst runs a networked command. Offline commands
may read deliberately selected local evidence or configuration files, but do
not upload them or invoke a hosted WHOISleuth deployment. The installation
examples disable lifecycle scripts for the package and its dependency tree;
WHOISleuth does not require them.

## Repository checkout

Contributors can run the same source command without installing the package:

```bash
node bin/whoisleuth.mts --help
node bin/whoisleuth.mts lookup example.test
node bin/whoisleuth.mts lookup example.test --deep --summary
node bin/whoisleuth.mts lookup example.test --deep --markdown --output lookup.md
node bin/whoisleuth.mts bulk domains.txt --deep --checkpoint bulk-checkpoint.json
node bin/whoisleuth.mts bulk domains.txt --csv --registered-only
node bin/whoisleuth.mts bulk domains.txt --queries --errors-only
node bin/whoisleuth.mts discover example.test --dictionary private-terms.txt --snapshot discovery-state.json --json
node bin/whoisleuth.mts discover-scan example.test --scan-limit 50 --checkpoint candidate-scan.json --json
node bin/whoisleuth.mts page-compare official.json candidate.json --json
node bin/whoisleuth.mts mail-review bulk.json --json
node bin/whoisleuth.mts diff first-lookup.json second-lookup.json --json
node bin/whoisleuth.mts registry-support example.test --json
node bin/whoisleuth.mts doctor
node bin/whoisleuth.mts completion zsh
node bin/whoisleuth.mts manual | man -l -
```

Fast lookup is the default. Deep collection must be requested explicitly and
can disclose the target to additional authoritative or first-party network
sources. Missing, partial, rate-limited, and unsupported sources remain
explicit and are never interpreted as evidence of safety or absence.

Interactive output uses restrained semantic colour, width-aware wrapping, and
stderr-only progress for slower collection. Redirected and machine-readable
output stays free of ANSI and progress text. Lookup also provides `--summary`
and `--verbose` terminal views without changing what is collected. `doctor` is
offline unless `--network` is explicitly supplied, and completion scripts are
printed without modifying shell configuration. Commands can use atomic private
`--output` files, Lookup can emit strict automation exits and target-free
versioned progress events, and Bulk can resume an exact validated compact
checkpoint. A checkpoint write failure preserves completed output and returns
the partial-result exit code. Ctrl-C suppresses partial final output and
returns exit code 130; a second interrupt performs best-effort temporary-file
cleanup before exiting immediately.

Bulk also supports fixed-column CSV, domain-only or exact-query output,
registered, inconclusive, and hard-failure output filters, and bounded A, AAAA,
NS, and MX summaries. Discover
supports local custom dictionaries and private snapshot comparison suitable
for an operator-managed scheduler. The separate networked `discover-scan`
command can collect a deterministic bounded subset in chunks, retain mutation
provenance, apply a non-destructive analyst allowlist, group exact shared DNS
observations, and compare a private component-aware material-change snapshot.
The full allowlist is not emitted, but matching scanned candidates are labelled
as suppressed so the review decision remains explainable. Saved Deep
lookups can be compared across static page, parse5-tokenized DOM structure,
favicon, technology, and TLS evidence, while saved Bulk output can be reviewed
for passive MX, null MX, SPF, DMARC, and shared-provider context.

See `docs/cli.md` in the package for the complete command, privacy, output, and
evidence-contract reference. Report suspected vulnerabilities through the
private channel described in `SECURITY.md`.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
