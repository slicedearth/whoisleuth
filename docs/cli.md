# WHOISleuth CLI guide

The first-party CLI runs on the operator's machine and does not call the hosted
WHOISleuth deployment. Use this guide for installation, common commands,
collection boundaries and output. Installed `whoisleuth --help`, focused
`--help` and `whoisleuth commands` output are the authority for that installed
version. The [CLI reference](cli-reference.md) covers durable command and
artefact contracts.

The [website command reference](https://www.whoisleuth.com/cli) starts with common
tasks, then offers searchable commands with examples, option explanations and
defaults. Command-section links can be bookmarked. Its option guidance and
installed help derive from the same command definitions.

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
Every audience retains tags, decision summaries and rationale as well as domain
evidence and Case, pin and decision IDs. Public does not mean anonymous.
Browser Lookup evidence can be verified or packaged in the CLI. `brief`,
`export`, `compare`, `registry-doctor` and `source-report` instead require a
saved CLI Lookup; they do not reconstruct it from a browser export.

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

`discover` accepts a brand label or registrable domain and supports multi-part
public suffixes in `--tlds` (for example, `co.uk,com.au`). It preserves the full
suffix and does not collect candidate evidence; use `discover-scan` only after
reviewing its separate network plan. Subdomains and URLs are not generation seeds.

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

For an explicit inherited-policy and direct parent-delegation review, use
`whoisleuth posture example.test --include-inherited-dns --json`. Without that
option, posture collection keeps its existing exact-name scope. The extra
results distinguish recursive policy publication from sampled parent referrals;
they do not establish name existence, message authentication or DNSSEC validity.

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

Lookup planning uses the same target-specific source recipe as collection
progress. Fast IP and ASN plans contain RDAP only; Deep IP plans add WHOIS and
eligible public-address reverse DNS, while Deep ASN plans add WHOIS. Domain-only
web, TLS and selected intelligence are not implied for address or ASN targets.
The website preflight separates optional providers and reports deployment
configuration as disabled or unavailable without testing a source. Browser-only
optional selections do not transfer to a CLI command. Existing templates and
CLI configuration profiles repeat their supported choices without adding a new
selection store. Plans do not measure remaining quota, cost, result fan-out or
an exact request count; completed source quality and deliberate dated refreshes
remain the evidence review, rather than the current form's draft selections.
The website's completed-plan review uses the finished target and mode, with
separate source states and observation times. Original optional consent is not
retained and is shown as unknown; missing output never proves a source was
declined or returned no findings.

### Message and link intake

Use `intake email message.eml --json` for MIME email and nested messages,
`intake calendar invitation.ics`, `intake qr selected.png`, or `intake text`
with text on standard input. These commands never open a destination or execute
supplied content. Output compares displayed and actual hosts, retains reported
header authentication and interprets supplied authorisation parameters without
retaining URL tokens. The source hash identifies the original bytes.
Defanged schemes and hosts are accepted, including `hxxps[:]//host[.]example`.
Path, query and fragment characters keep their supplied meaning; text scanning
removes unmatched surrounding prose brackets, while explicit links remain exact.

Add a repeatable `--reported-action`, such as `entered_device_code` or
`granted_consent`, to include account-recovery guidance based on an explicitly
reported action. The report does not infer a stolen session from domain evidence.
`--strict-exit` returns 4 for a partial review. QR review supports still PNGs;
no decoded result is not proof that a symbol is absent.
Excluded links and unsupported QR payloads make the review partial, with
category counts rather than private payload text. Bare QR hostnames are not
automatically treated as URLs.

### Contextual reviews

`review-evidence` also accepts [contextual review inputs](contextual-reviews.md)
for source-qualified incident sequences, retained domain history, platform-object continuity, authorised storefront
comparison and connector provenance. These workflows are offline; partial
context reviews return 4 when `--strict-exit` is selected. Browser-generated
reusable inputs use the same validators.

### Message-header review

`mail-headers` parses only the bounded header block from a selected message file
or standard input. It extracts domain-only identity, reported SPF, DKIM, DMARC
and ARC states, exact-domain alignment, and the bounded `Received` route in its
reported order. It makes no request and does not retain address local parts,
display names, subject, body, attachments, or raw header values in its output.
Authentication states are header claims, not an independent DNS or
cryptographic validation, and alignment differences can be legitimate.
Both `mail-headers` and `intake email` preserve individual authentication header
positions and service identifiers. Evaluate the receiver boundary yourself; to
record trust in one exact header, add `--trusted-auth-header 1:3` (message part 1,
header 3). Repeat for separate headers. This annotates the supplied claim without
validating it or extending trust to matching service names or nested messages.

`intake pdf selected.pdf`, `intake docx selected.docx` and `intake har selected.har`
use the same offline review as the browser. Document results include part hashes,
page references and extraction coverage. Encrypted documents require a separately
decrypted copy; no password is requested. HAR results preserve file order and
reported timings, with unavailable values distinct from zero. Neither document
resources nor recorded requests are fetched. Add `--strict-exit` for exit 4 when
coverage is partial, and `--json` for the minimised report.

`intake identity events.json --json` reads an Entra sign-in `value` array or an
Okta System Log array. To record a scoped comparison, wrap the selected provider
records in this input (timestamps require an explicit timezone):

```json
{
  "schema": "whoisleuth.identity-events.input",
  "version": 1,
  "provider": "entra",
  "events": [],
  "match": {
    "applicationId": "11111111-1111-4111-8111-111111111111",
    "tenantId": null,
    "actorLabel": null,
    "startedAt": "2026-01-01T00:00:00Z",
    "endedAt": "2026-01-01T01:00:00Z"
  }
}
```

Replace `events` with the selected records. Actor labels apply only within that
file; missing fields stay unavailable. The source hash identifies the complete
selected file, including an envelope when supplied. No provider API is contacted.

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

`pin`, `link`, `withdraw-link`, `assess` and `recheck` read a selected JSON file with `--input`:

```sh
whoisleuth case pin cases.json --input pin.json --output cases.json --force
whoisleuth case link cases.json --input relationship.json --output cases.json --force
whoisleuth case assess cases.json --input assessment.json --output cases.json --force
whoisleuth case recheck cases.json --input recheck.json --output cases.json --force
```

For `link`, use `fromPinId`, `toPinId`, `kind` (`derived_from` or
`shared_source`) and `basis`. `withdraw-link` takes the relationship `id` and
`reason`; its original declaration remains in the file. `case show` lists the
identities and `--json` includes the full history.

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

For [BagIt 1.0](https://www.rfc-editor.org/rfc/rfc8493.html) interchange, use
`--bagit` with `--package` or `--folder` on both commands:

```sh
whoisleuth manifest evidence.json screenshot.png --workflow "Evidence review" \
  --bagit --package --output bag.zip
whoisleuth verify-artifact bag.zip --bagit --package --json --strict-exit
whoisleuth manifest evidence.json --workflow "Evidence review" --bagit --folder ./bag
whoisleuth verify-artifact --bagit --folder ./bag --json --strict-exit
```

BagIt output contains unchanged files under `data/`, SHA-512 payload and tag
manifests, and the existing source-declaration manifest as a tag file. It is
unencrypted and cannot be combined with `--passphrase-file`. Verification also
accepts SHA-256. It checks every manifest, reports absent files and unsupported
algorithms, and never downloads `fetch.txt` locations. A valid result establishes
declared byte integrity, not source-format validity, authenticity or factual
accuracy. Unchecked tags remain explicit; reported entry names are generated.

The bounded reader accepts UTF-8 tags, safe relative paths up to 1,024 UTF-8
bytes and 16 levels, and the same payload byte/file allowances as evidence
packages. Tags have a separate allowance of 32 files, 512 KiB each and 2 MiB
combined. Symbolic links, special files, path collisions and unsupported ZIP
features are refused. BagIt itself does not impose these implementation limits.

For an encrypted ordinary package, supply a local passphrase file:

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

Inspect a paused run without executing any step or rewriting its checkpoint:

```sh
whoisleuth workflow-run domain-triage example.test --resume run.json --preview --json
```

The preview separates validated complete and partial outputs, failed steps that
can be retried, unresolved inputs, pending upstream outputs and fresh approval
requirements. It does not open selected input files. Preview output goes to
stdout; approval, interactive and output-file flags cannot be combined with it.

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
`reconcile` lists each observation time and declared observer/vantage, keeping
disagreement and unavailable evidence separate. Distinct labels do not verify
independent collection; timing and shared caches can affect the comparison.

`domain-control-flight-recorder` retains the last comparable complete observation
across failed or partial collections. A changed recovery records the interval
between complete source observations; it does not assign the change to the
recovery time. An approved window must contain that entire interval. Historical
report versions remain readable without acquiring this newer qualification.

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

### Managed indicator revisions

`indicator-set` uses the same file-backed revision model as Bulk. It performs
no collection or submission. A plan names the set, gives a review `basis` and
UTC `expiresAt`, and supplies `rows` plus an explicit `selectedDomains` list.
Rows use the normal Bulk eligibility rules, including available profile
context, a Suspicious or Confirmed abuse disposition and retained risk evidence.
Supply `officialDomains`, `allowlistedDomains` and `commonInfrastructureDomains`
where applicable; excluded candidates never become additions.

Example plan shape (fictional input; replace the evidence and expiry):

```json
{
  "name": "Reviewed candidates",
  "basis": "Reviewed the selected page observation",
  "expiresAt": "2026-10-23T00:00:00.000Z",
  "selectedDomains": ["candidate.example.test"],
  "rows": [{
    "domain": "candidate.example.test", "availability": "registered",
    "analystDisposition": "suspicious", "risk": 80,
    "profileContext": { "sourceState": "ready" }
  }]
}
```

```sh
whoisleuth indicator-set revise indicator-plan.json --json --output indicators-r1.json
whoisleuth indicator-set inspect indicators-r1.json
whoisleuth verify-artifact indicators-r1.json --strict-exit
whoisleuth indicator-set stix indicators-r1.json --output indicators-r1.stix.json
whoisleuth indicator-set misp indicators-r1.json --output indicators-r1.misp.json
```

Later plans embed the last manifest as `previous` and explicitly list `renewIds`
or `withdrawIds`. New domains still require reviewed rows and selection.
`reintroduceDomains` permits a previously withdrawn domain to receive a new
identity; it never revives the old one. Missing domains stay unchanged.
Renewal updates the review window and note, not the original observation.

Keep previous manifests and use separate output paths. File ownership checks
reject concurrent source/destination changes and refuse replacing the input,
even with `--force`. STIX and MISP operations always emit JSON. MISP expiry is
a review deadline, not automatic deletion; exports require separate recipient
review. Digests verify content, not authorship or an unavailable earlier chain.

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
times; previously published version-2 and version-3 packets remain verifiable.
Current DNS convergence and domain-change inputs use version 2. Each snapshot
declares `queries`, for example
`[{"owner":"example.test","type":"MX","state":"observed"}]`.
An `observed` query with no matching records means an empty answer; `partial`
and `unavailable` queries do not. Omitted queries are not queried. Version-1
inputs remain readable but establish query scope only for supplied records.
An expected empty set alone cannot establish an observed empty answer.

Domain-control review version 3 keeps renewal reminders separate from observed
configuration: `due` and `not_due` describe the chosen review date, not DNS or
registration changes. Incomplete evidence remains `partial` even when a reminder
is due. Terminal and JUnit summaries report due reminders separately. Previous
review and monitor checkpoints retain their original versioned interpretation.

## Exit codes

See the [exit-code reference](cli-reference.md#files-output-and-automation).
A completed command can still contain partial sources; use the selected
command's strict-exit policy when automation requires complete evidence.

For scripts, use `whoisleuth verify-artifact evidence.json --json --strict-exit`.
An incomplete verification returns **4** with that option. Without it, **0**
means a report was produced, not that the artefact passed verification; inspect
the report's state and checks.
Unencrypted workspace archives retain mutable root metadata outside their
section digests, so they return 4 under `--strict-exit` even when all supported
section checks pass. Structure-only exports can pass their narrower contract;
strict exit is not a ranking of cryptographic assurance. `interchange-report`
separately describes import/export support and is not the full verifier inventory.

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
