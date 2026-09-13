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

Rendered-page collection uses the separate [optional capture companion](https://github.com/slicedearth/whoisleuth/tree/main/packages/web-capture#install-a-local-candidate),
not the main CLI. It can be installed from a verified local archive; browser
installation and each authorised capture remain explicit actions.

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

Pasted URLs normally select only their hostname. To collect one particular
page, use `whoisleuth lookup 'https://portal.example.test/review' --deep --exact-url`.
This sends the path and query to the website, without the fragment. Review
retained paths and page-derived text before sharing the result.

To continue a reviewed terminal Lookup in the browser, save the completed
private document from the interactive view:

```bash
whoisleuth lookup example.test --deep --browse --save-lookup lookup.json
```

In Console Lookup, open **Replay exported evidence**, select the file, verify
its digest and source states, then create or update a browser-local Case. The
file is not uploaded. Case classification, exact incident links and response
actions remain deliberate analyst steps. Ordinary Case files also support the
offline CLI workflow below.
When several incident Cases share a domain, select the intended Case before
retaining replay evidence. Case packs preserve each current Case ID separately;
trusted and public packs exclude analyst-entered incident titles.

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

### Local Case files

Create a working file, inspect its Case IDs, then append a note:

```sh
whoisleuth case open --domain example.test --title "Review the selected form" --output cases.json
whoisleuth case show cases.json
whoisleuth case note cases.json --note-file note.txt --output cases.json --force
```

Use `--case-id` when the file contains several Cases. `open` reuses the selected
Case; `--new-incident --title "Another incident"` creates a distinct ID for the
same domain. It does not open a browser or collect anything.

`pin`, `assess` and `recheck` read a selected JSON file with `--input`:

```sh
whoisleuth case pin cases.json --input pin.json --output cases.json --force
whoisleuth case assess cases.json --input assessment.json --output cases.json --force
whoisleuth case recheck cases.json --input recheck.json --output cases.json --force
```

A pin describes the supplied observation, not a new collection. For example:

```json
{
  "label": "Selected page observation",
  "value": "A form was retained in the supplied capture.",
  "source": "Analyst supplied capture",
  "observedAt": "2026-09-01T12:00:00.000Z",
  "completeness": "complete",
  "sourceState": "complete",
  "observationHostname": "example.test"
}
```

Supply an observation time only when known; use `null` otherwise. Describe
partial or unavailable evidence honestly. IDs and creation times are allocated
locally. Unknown fields, truncated values and unsupported formats are rejected.

An assessment includes a reviewed disposition and reason, a summary, a rationale,
and evidence relationships. Replace `selected-pin-id` with an ID from `case show`:

```json
{
  "disposition": "suspicious",
  "reviewReasonCode": "other_reviewed",
  "summary": "Review the apparent credential request",
  "rationale": "The supplied observation needs independent corroboration.",
  "evidence": [{ "pinId": "selected-pin-id", "stance": "supports" }]
}
```

Each fact selects one retained `pinId` or a new `pin` object. Stances are
`supports`, `contradicts` or `unresolved`; at least one must support the decision.
Counterevidence and unresolved evidence remain linked, not discarded. Assessment
summary and rationale use single-line text; note files can contain paragraphs.

A recheck input contains `state`, `observedAt`, `completeness`, `source` and
`comparisonSummary`, with optional limitations and follow-up time. For example,
use `state: "unavailable"` and `completeness: "partial"` when a supplied capture
did not complete. `not_reproduced` requires a saved recheck question from the
Case's console workflow, its exact `recheck` context, the target
`observationHostname`, a complete later observation where a baseline exists,
and `conditionsMatch: "comparable"`. It never means global removal or takedown.

Mutations require an explicit output path and write the complete current Case
export. They never prune old evidence to fit. Input formatting may use up to
16 MiB; the canonical store remains limited to 4 MiB and 500 Cases. `show --json`
can export a selected subset to a **different** path. Ordinary Case imports also
allow 16 MiB for formatting and export metadata; the stored-data limit remains
4 MiB. Case packs retain their separate 25-Case selection and 4-MiB source-file
limits, and include generated reports within the bounded import allowance.

`show` reports the exact file digest. Add `--expect-file-digest sha256:<digest>`
to reject a file changed since that review. Source/output locks and atomic
replacement also detect changes during execution. After an interrupted process,
inspect its adjacent `.workflow.lock` before deliberately removing it. Validation
or conflict failures leave the Case file unchanged and return 2. Filesystem
publication failures return 3.

Working files contain private analyst content and file references, not attachment
bytes. Use `case-pack` for a reviewed audience projection and a separate evidence
package for selected original files. Nothing is uploaded or reported automatically.

### Portable evidence files

Package selected files without changing their bytes, then verify the ZIP offline:

```sh
whoisleuth manifest evidence.json screenshot.png --workflow "Evidence review" \
  --package --output evidence.zip
whoisleuth verify-artifact evidence.zip --package --json --strict-exit
whoisleuth manifest evidence.json screenshot.png --workflow "Evidence review" \
  --folder ./evidence-project
whoisleuth verify-artifact --folder ./evidence-project --json --strict-exit
```

Packages admit the 128-file, 64-MiB original selection plus one bounded Case
export, with a separate manifest allowance. Original-file limits remain unchanged.
`verify-artifact` uses the same exact ordinary Case reader as `case show`,
without repairing content. Package verification also reports original-reference
completeness for each Case file; `--strict-exit` returns 4 when a referenced original is missing.
An ordinary Case JSON file alone provides structural validity, not a checksum.
They use generated entry names, not original paths. Ordinary ZIPs and folders
are private and unencrypted; packaging does not redact selected files. The report distinguishes
file identity, supported source formats, opaque content, exact capsule/source
links and capture-manifest attachment matches. Include the capture manifest and
its screenshot/DOM-digest files together to check their declared bytes; original
filenames are not needed to establish a match. It does not import files or establish source truth, signature trust or a
trusted timestamp. Unsupported or rejected entries produce a partial report;
`--strict-exit` returns 4. Without `--package` or `--folder`, `manifest` produces a
standalone JSON manifest; exact public version-2 manifests remain readable.

For an encrypted package, supply a local passphrase file to both commands:

```sh
whoisleuth manifest evidence.json screenshot.png --workflow "Evidence review" \
  --package --passphrase-file ./package-passphrase.txt --output evidence.wlep
whoisleuth verify-artifact evidence.wlep --package \
  --passphrase-file ./package-passphrase.txt --json --strict-exit
```

The file contains one UTF-8 line of at least 12 characters, at most 1,024 bytes.
Keep it private and separate from the package. Neither command uploads it or
includes it in its report. Version-1 encrypted packages protect the entire ZIP,
including its manifest. Unlocking authenticates the container before validating
file identities. The report's package digest identifies the decrypted ZIP;
its input byte count identifies the encrypted file. Wrong passphrases, corrupted
containers and unsupported versions exit 3 without a verification report.
Encryption does not establish authorship, factual accuracy or redaction, and
does not apply to folder exports or separately downloaded JSON backups.

Folders contain `manifest.json` and generated `artifacts/artifact-N` files.
Creation requires a new destination and never replaces an existing folder.
Failed writes can leave partial private output; inspect or remove it before
choosing another destination. Verification rejects symbolic links, unexpected
trees and unlisted files. Its package digest and byte count describe the
canonical stored-ZIP representation, not filesystem metadata. These are
selected evidence exports, not complete workspace backups.

### Resuming a fixed workflow

All recipes listed by `workflow-plan --list` can run through `workflow-run`.
Planning remains offline. Execution emits a checkpoint; terminal output shows
retained steps, output identities, missing inputs and the next required action.
A partial collection
pauses for review; resuming keeps that observation and does not collect it
again. Later steps can finish without making the earlier evidence complete:
the run still exits with code 4. Validation, usage and export failures remain
failures and are retried on resume. Step diagnostics stay on stderr, separate
from checkpoint JSON. New network steps still need `--approve-network`.

New runs connect compatible earlier outputs for domain triage, registry review,
historical comparison and handoff linting. For a complete domain-triage hand-off:

```sh
whoisleuth workflow-run domain-triage example.test --approve-network \
  --json --output run.json
```

Bindings accept Lookup outputs for export, diff, timeline, comparison, source
reports and briefs; evidence exports for verification; and Case-pack output
for sharing review. Remaining placeholders use `--select` in order;
for example, `--select diff=previous.json` keeps the current observation as the
second input. Supply every input for an uncompleted step to use files instead,
or override a connection with `--use-artifact <step-id>:<input-number>=<earlier-step-id>`.
Input numbers start at 1 and refer to the fixed recipe's placeholders.
`diff` compares saved observations of the same or different domains; `timeline`
orders observations of one domain. Candidate and domain-control intent inputs
remain analyst selections. No external file is inferred or extracted automatically.

For example, registry review can reuse its collection without extracting files:

```sh
whoisleuth workflow-run registry-disagreement example.test --approve-network \
  --json --output registry-run.json
```

The evidence-handoff recipe pauses before any human-review declaration. Review
the selected material and the listed declarations, then use
`--confirm-review package` or `--confirm-review lint` for that particular step.
Confirmation applies only to the current invocation and is not inferred from
the checkpoint. A completed recipe means its commands ran, not that an
investigation is resolved or sharing is authorised.

Optional `--interactive` asks for missing paths or values on terminal stderr,
keeping checkpoint JSON on stdout or in the selected output file. A blank answer
pauses. Prompts do not grant network approval or confirm review. Redirected input
and unattended runs use `--select` instead. Resuming a checkpoint preserves its
recorded connections; new defaults are not applied to old checkpoints.

Checkpoint version 3 reads versions 1 and 2. Older installations reject version
3. Checkpoints retain exact output schemas, content digests and input bindings;
changed identities or completed inputs are rejected. Digests identify content,
not source authenticity, truth or freshness. The checkpoint can contain
selected local paths and evidence; review it before sharing.

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
