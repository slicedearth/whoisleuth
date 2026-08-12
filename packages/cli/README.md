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
node bin/whoisleuth.mts lookup example.test --deep --plan --json
node bin/whoisleuth.mts lookup example.test --deep --observer workstation-a --vantage office-egress --json
node bin/whoisleuth.mts lookup example.test --deep --markdown --output lookup.md
node bin/whoisleuth.mts bulk domains.txt --deep --checkpoint bulk-checkpoint.json
node bin/whoisleuth.mts bulk domains.txt --csv --registered-only
node bin/whoisleuth.mts bulk domains.txt --queries --errors-only
node bin/whoisleuth.mts discover example.test --dictionary private-terms.txt --snapshot discovery-state.json --json
node bin/whoisleuth.mts discover-scan example.test --scan-limit 50 --checkpoint candidate-scan.json --json
node bin/whoisleuth.mts page-compare official.json candidate.json --json
node bin/whoisleuth.mts mail-review bulk.json --json
node bin/whoisleuth.mts dnssec-validate example.test --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --json
node bin/whoisleuth.mts mail-transport selected-mx.json --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --active-probe --json
node bin/whoisleuth.mts domain-control domain-control-input.json --json
node bin/whoisleuth.mts assurance domain-assurance-input.json --json
node bin/whoisleuth.mts sharing-review response-packet.json --marking amber --recipient-scope organization --purpose 'Reviewed handoff' --human-reviewed --personal-data-reviewed --redactions-confirmed --json
node bin/whoisleuth.mts workflow-plan domain-triage example.test --json
node bin/whoisleuth.mts diff first-lookup.json second-lookup.json --json
node bin/whoisleuth.mts reconcile office.json mobile.json external.json --json
node bin/whoisleuth.mts timeline first-observation.json second-observation.json latest-observation.json --json
node bin/whoisleuth.mts registry-support example.test --json
node bin/whoisleuth.mts registry-doctor lookup.json --json
node bin/whoisleuth.mts registry-cohort saved-lookups.jsonl --json
node bin/whoisleuth.mts brief lookup.json
node bin/whoisleuth.mts case-pack cases.json --audience trusted --reviewed --json
node bin/whoisleuth.mts monitor-once control-manifest.json --json
node bin/whoisleuth.mts workflow-run domain-triage example.test --approve-network --json --output run.json
node bin/whoisleuth.mts lookalike-calibrate reviewed-candidates.json --json
node bin/whoisleuth.mts doctor
node bin/whoisleuth.mts commands --json
node bin/whoisleuth.mts completion zsh
node bin/whoisleuth.mts completion powershell
node bin/whoisleuth.mts manual | man -l -
```

Fast lookup is the default. Deep collection must be requested explicitly and
can disclose the target to additional authoritative or first-party network
sources. Missing, partial, rate-limited, and unsupported sources remain
explicit and are never interpreted as evidence of safety or absence.
`lookup --plan` classifies a target and explains the selected source families
and disclosures without making a network request. `commands --json` exposes the
installed command contracts for local wrappers without running collection.
The isolated `dnssec-validate` and `mail-transport` actions are not part of
Lookup, Bulk, monitoring, or recipes. Each run requires explicit
owned-or-authorised acknowledgement; mail transport also requires a separate
active-probe acknowledgement and never sends a message, authenticates, tests
relay, or enumerates recipients or mailboxes. Its output distinguishes selected,
public-revalidated, and connected addresses and explicitly reports that A, AAAA,
and CNAME authentication was not evaluated after a candidate is retained, or
that address authentication is unavailable when no candidate exists; only
confirmed connections can form address relationship leads. If a DANE-TA TLSA
usage 2 association is published, active collection retains only the observed
leaf certificate and leaves that comparison partial without certificate-path
construction and trust-anchor path validation. SMTP relay PKIX-TA usage 0 and
PKIX-EE usage 1 records are retained as unsupported and cannot complete SMTP
DANE assurance; a separate usage 3 match remains eligible. Saved
Lookup JSON is byte-, nesting-, entry-, and per-container-bounded before parsing and portable export.
Focused command help and the generated manual label every operation as offline
or networked and state its target, input, and concurrency boundaries. The
packaged [dual-use disclosure](https://github.com/slicedearth/whoisleuth/blob/main/DISCLOSURE)
defines the supported defensive use of those capabilities.

Interactive output uses restrained semantic colour, width-aware wrapping, and
stderr-only progress for slower collection. Redirected and machine-readable
output stays free of ANSI and progress text. Lookup also provides `--summary`
and `--verbose` terminal views without changing what is collected. `doctor` is
offline unless `--network` is explicitly supplied, and completion scripts are
printed without modifying shell configuration. Commands can use atomic private
`--output` files, Lookup can emit strict automation exits and target-free
versioned progress events, and Bulk can resume an exact validated compact
checkpoint. Checkpoint schema 2 preserves each current row's observation time;
legacy schema-1 rows remain readable with unknown observation time rather than
being restamped on resume. Bulk machine output schema 3 distinguishes current
and resumed rows. A checkpoint write failure preserves completed output and returns
the partial-result exit code. Ctrl-C suppresses partial final output and
returns exit code 130. SIGTERM uses the same graceful cleanup path and returns
143; a second interrupt performs best-effort temporary-file
cleanup before exiting immediately.
Strict local profiles can supply only safe presentation, Fast-mode,
concurrency, and observer defaults; command-line options override them.
Supported automation commands can emit JUnit or SARIF and apply explicit
failure policies without changing their collection result.

The offline `timeline` command orders 2 to 20 saved Lookup documents for one
domain and compares each adjacent observation. It retains observation times and
normalised field states but no input filenames or raw registry payloads.
Observed differences remain separate from missing, unavailable, and changed
collection conditions.

Optional bounded observer and vantage labels let analysts distinguish saved
collection contexts without changing collection. `reconcile` compares 2 to 5
same-domain observations while keeping agreement, disagreement, and
non-comparable evidence separate; the labels are context, not proof of
independence. `registry-doctor`, `assurance`, `sharing-review`, and
`lookalike-calibrate` add offline compatibility, change/recovery, sharing, and
review-yield workflows without contacting the hosted application.
`registry-cohort` emits target-free publication-quality timelines from either
saved Lookups or one unmixed family of retained version-1/version-2 cohort
reports; it never sums overlapping retained samples into independent
consistency. `registry-scaffold` produces a sanitised synthetic contributor
fixture. `diff` preserves saved-Lookup output and also emits a bounded
comparison ledger for explicitly paired Bulk sessions or domain portfolios.
`verify-artifact --manifest ... --manifest-entry ...` separates exact retained
byte identity from canonical-only or mismatched identity. `brief` and
`case-pack` create bounded local handoffs, `monitor-once` runs one explicit
control review rather than a daemon, and `workflow-run` executes only installed
fixed-recipe steps with per-run network approval and analyst-selection pauses.
The current schema-26 JSON produced by `export` is accepted directly by
`verify-artifact` and reported as `structure_valid`. It has no embedded checksum
or signature, so exact retained bytes require a verified investigation manifest
entry. The export can contain a bounded privacy-projected registry RDAP
publication, normalised WHOIS values, and bounded contacts and should be
reviewed before sharing. Request and response headers, cookies, session and
credential fields, and credential-bearing or query-bearing URLs are excluded.
Schema 25 remains readable through its historical wrapper contract: retained
diagnostics are authoritative, unavailable wrapper data is suppressed during
replay, and other contradictions fail closed. Verification and browser replay share a 5 MiB,
20,000-entry, 24-level portable boundary.

Lookup can also export a version-1 `whoisleuth.lookup-claim-passport` for one
selected readiness statement. `verify-artifact` checks its strict bounded
structure and sorted-json-v2 digest; `interchange-report` describes the exact
source-state fields it preserves and the raw payload, contact, page-value,
request-path, credential, browser-store, and signer-authentication fields it
excludes.

Current `case-pack` output keeps its version-1 envelope. Trusted and internal
audiences preserve exact analyst-selected Case-to-Brand Profile identifiers;
public output clears them from cases and embedded reports and discloses the
bounded `brandProfileReferencesOmitted` count. Verification also enforces the
actual audience projection after digest validation, rejects re-signed
sensitive-field leaks at expected or unexpected nested paths, and binds each
report to its canonical top-level Case and exact manifest counts. Current
schema-12 input must survive bounded normalisation exactly, provide safe unique
Case identities and a valid unique at-most-eight identifier list, and use
report v8. Schema 11 uses report v7; valid collections through schema 10 remain
compatible with supported reports through v6 and without later branch,
reference, or omission-count fields.

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

See `docs/cli.md` in the package for installation and first use, and
`docs/cli-reference.md` for the complete command, privacy, output, and
evidence-contract reference. Report suspected vulnerabilities through the
private channel described in `SECURITY.md`.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
