# WHOISleuth CLI

The first-party command-line interface runs the same local classification and
lookup modules as the Express and serverless adapters. It does not call the
hosted WHOISleuth deployment.

`whoisleuth --help` displays the copyright, AGPL-3.0-only licence, and official
source location. It groups commands by investigation, discovery, saved-evidence,
integrity, and calibration workflows. `whoisleuth <command> --help` displays the
command's purpose, focused invocation, example, and collection boundary without
printing the full command list. `whoisleuth commands --json` exposes those same
contracts as a stable local catalogue for wrappers and terminal tooling.
Packaged copies include `LICENSE`, `NOTICE`, and
`TRADEMARKS.md` alongside the CLI documentation.

## Installation

Public releases require Node.js 24 or later and install the `whoisleuth`
command:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth doctor
```

Update and verify an existing global installation with:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest
whoisleuth --version
```

The scoped package and application share one semantic version. The package runs
locally and does not call the hosted WHOISleuth deployment. Networked commands
contact only the sources described by their collection profile; offline review,
comparison, verification, completion, and manual commands remain local.

## Commands

```bash
node bin/whoisleuth.mts lookup example.com
node bin/whoisleuth.mts lookup AS13335 --json
printf 'example.com\n' | node bin/whoisleuth.mts lookup --json
node bin/whoisleuth.mts lookup example.com --deep
node bin/whoisleuth.mts lookup example.com --deep --plan --json
node bin/whoisleuth.mts lookup example.com --deep --summary
node bin/whoisleuth.mts lookup example.com --deep --verbose
node bin/whoisleuth.mts lookup example.com --deep --markdown --output lookup.md
node bin/whoisleuth.mts lookup example.com --deep --json --strict-exit --events
node bin/whoisleuth.mts lookup example.test --deep --observer workstation-a --vantage office-egress --json > office.json
cat domains.txt | node bin/whoisleuth.mts bulk --jsonl
node bin/whoisleuth.mts bulk domains.txt --csv --registered-only
node bin/whoisleuth.mts bulk domains.txt --domains --inconclusive-only
node bin/whoisleuth.mts bulk domains.txt --queries --errors-only
node bin/whoisleuth.mts bulk domains.txt --concurrency 4
node bin/whoisleuth.mts bulk domains.txt --deep --checkpoint bulk-checkpoint.json
node bin/whoisleuth.mts bulk domains.txt --deep --checkpoint bulk-checkpoint.json --resume
node bin/whoisleuth.mts ct-search 'example brand' --json
node bin/whoisleuth.mts discover example.com --preset common --jsonl
node bin/whoisleuth.mts discover example.test --dictionary private-terms.txt --snapshot discovery-state.json --json
node bin/whoisleuth.mts discover-scan example.test --scan-limit 50 --checkpoint candidate-scan.json --json
node bin/whoisleuth.mts discover-scan example.test --deep --scan-limit 20 --resolver 192.0.2.53 --observation-snapshot observed-candidates.json --csv
node bin/whoisleuth.mts posture example.com --selectors selector1 --retired-selectors selector0 --mail-profile defensive-no-mail --json
node bin/whoisleuth.mts http example.com --json
node bin/whoisleuth.mts tls example.com --json
node bin/whoisleuth.mts registry-support example.uk --json
node bin/whoisleuth.mts registry-doctor lookup.json --json
node bin/whoisleuth.mts risk-calibrate calibration.json --json
node bin/whoisleuth.mts lookalike-calibrate reviewed-candidates.json --json
node bin/whoisleuth.mts verify-artifact workspace.json --json
node bin/whoisleuth.mts verify-artifact lookup.json --json
node bin/whoisleuth.mts verify-artifact workspace-encrypted.json --passphrase-file passphrase.txt --json
node bin/whoisleuth.mts source-report lookup.json --json
node bin/whoisleuth.mts inspect-archive workspace.json --json
node bin/whoisleuth.mts inspect-archive workspace.json --search example.invalid --json
node bin/whoisleuth.mts sign-artifact response-packet.json --private-key-file analyst-private.pem > response-packet.signed.json
node bin/whoisleuth.mts verify-signature response-packet.signed.json --public-key-file analyst-public.pem
node bin/whoisleuth.mts lookup example.com --deep --json > lookup.json
node bin/whoisleuth.mts compare lookup.json --json
node bin/whoisleuth.mts page-compare official.json candidate.json --json
node bin/whoisleuth.mts mail-review bulk.json --json
node bin/whoisleuth.mts review-evidence dnssec-evidence.json --json
node bin/whoisleuth.mts domain-control domain-control-input.json --json
node bin/whoisleuth.mts assurance domain-assurance-input.json --json
node bin/whoisleuth.mts sharing-review response-packet.json --marking amber --recipient-scope organization --purpose 'Reviewed incident handoff' --human-reviewed --personal-data-reviewed --redactions-confirmed --json
node bin/whoisleuth.mts workflow-plan domain-triage example.test --json
node bin/whoisleuth.mts diff first-lookup.json second-lookup.json --json
node bin/whoisleuth.mts reconcile office.json mobile.json external.json --json
node bin/whoisleuth.mts timeline first-observation.json second-observation.json latest-observation.json --json
node bin/whoisleuth.mts export lookup.json > evidence.json
node bin/whoisleuth.mts export lookup.json --markdown > evidence.md
node bin/whoisleuth.mts export lookup.json --html > evidence.html
node bin/whoisleuth.mts doctor
node bin/whoisleuth.mts doctor --network --json
node bin/whoisleuth.mts commands --json
node bin/whoisleuth.mts completion zsh
node bin/whoisleuth.mts completion powershell
node bin/whoisleuth.mts manual | man -l -
```

These examples run from a checked-out repository; replace
`node bin/whoisleuth.mts` with `whoisleuth` after installation. The root
application package remains private. A separate scoped CLI archive is assembled
from the exact executable dependency closure, installed in a temporary
directory, and smoke tested with:

```bash
npm run cli:package:check
```

The check includes only the executable, reachable TypeScript modules, CLI
guide, licence, notices, and trademark terms. It excludes application routes,
deployment adapters, tests, and development tools. Direct runtime dependencies
are pinned to the exact versions exercised by the reviewed repository lockfile.
The package and its dependencies require no lifecycle scripts, so the install
examples disable them explicitly.
Its generated manifest stays private. Release-candidate assembly is a separate
explicit operation and never publishes from a developer checkout. Use the
scoped package name; an unqualified `npx whoisleuth` is not this project.

Lookup defaults to the conservative fast profile. `--deep` must be requested
explicitly and can add bounded WHOIS, DNS, website, TLS, registrar RDAP, and
observed-network IP RDAP work for a domain. The browser Console's optional
security.txt and external intelligence selections are not CLI flags; the CLI
does not run those actions implicitly.

For a directly entered public IP address, `lookup --deep` can also run one
bounded reverse-DNS query. Terminal output shows the explicit source state and
up to five normalized PTR names; JSON retains up to eight. PTR names are
operator-published routing context, not proof of hosting control or ownership.
Fast lookups do not run this query.

`lookup --plan` performs classification and prints a versioned preflight without
starting collection. It lists the normalized target, selected fast or deep
mode, planned source families, conditional operations, and the data each family
may receive. The plan cannot predict live feature configuration, cache state,
redirects, referrals, source availability, or an exact request count. It can be
combined with `--json`, but not with report, detail, strict-exit, progress-event,
or quiet options.

Only one query is accepted by `lookup`. Multiple-input processing belongs to
the explicit `bulk` command rather than being silently inferred by `lookup`.
Standard input is capped at 4 KiB and must contain one non-empty line.

`registry-support` is an offline catalogue view. It accepts one domain, bare
suffix, or leading-dot suffix as an argument or on stdin and makes no network
request. Its output is described below.

`doctor` is offline by default. It checks the Node runtime, platform, terminal
capabilities, and availability of offline command families. `doctor --network`
adds independent bounded public-DNS, HTTPS/RDAP bootstrap, and WHOIS port 43
checks against fixed IANA diagnostic infrastructure. The three probes run
within the same per-probe ceiling so one stalled transport does not block the
others. The report retains only state, HTTP status, and a bounded explanation,
not resolved addresses or response content. A failed optional network check
returns the partial-failure exit code rather than claiming that all CLI
collection is unavailable.

`completion bash`, `completion zsh`, `completion fish`, and `completion
powershell` print static shell completion scripts to stdout. The command does
not edit a shell profile or make a network request. Review the generated script
before sourcing it or placing it in the relevant shell completion directory.
`manual` prints a generated roff manual page and likewise changes no local
configuration.

`commands` prints the installed command catalogue without running collection or
reading evidence. `commands --json` emits version 1 of the
`whoisleuth.cli.command-catalogue` schema, including each command's usage,
example, declared collection mode, collection scope, and boundary. This is the
supported discovery contract for local wrappers; it is not a permission grant
or a substitute for focused help.

Focused command help and the generated manual classify every operation as
offline or networked and state the relevant target, input, and concurrency
ceiling. These labels describe observable behavior rather than granting
authorization. The packaged `DISCLOSURE` defines the intended defensive scope;
operators remain responsible for law, provider terms, and authorization.

## Deployment boundary

The CLI runs locally. The serverless deployment publishes only `frontend/build`
and packages functions only from `netlify/functions`, so `bin/` and `cli/` are
not part of the hosted static site or function bundle. The application root and
ordinary package-check candidate remain private. Explicitly reviewed CLI
release candidates can be published under the scoped public package described
in the installation section.

Commands that query RDAP, WHOIS, DNS, HTTP, TLS, or Certificate Transparency do
so directly from the machine running the CLI. They do not use the hosted login,
hosted session, or deployment usage controls; upstream providers can see and
rate-limit the local machine's network address. Offline `discover`, `compare`,
`page-compare`, `mail-review`, `review-evidence`, `domain-control`, `assurance`,
`sharing-review`, `workflow-plan`, `diff`, `reconcile`, `timeline`,
`risk-calibrate`, `lookalike-calibrate`, `registry-doctor`, `verify-artifact`, `source-report`, `export`,
`commands`, `completion`, and `manual` operations make no network requests. Commands write
to stdout unless the analyst deliberately selects a local output file.

## Output

Human-readable terminal output is the default. On an interactive terminal it
uses restrained semantic colour, groups Lookup evidence by purpose, wraps
prose to the detected terminal width, and shows transient progress on stderr
for slower collection. State remains explicit in text, so colour is never the
only distinction. Redirected terminal output, JSON, and JSONL contain no ANSI
sequences or progress text. `--no-color` and a non-empty conventional
`NO_COLOR` environment variable disable colour; `WHOISLEUTH_NO_PROGRESS=1`
disables the transient indicator. Command examples remain one copyable line
even when prose is wrapped for a narrow terminal.

Every command accepts `--output <file>` as a safer alternative to shell
redirection. WHOISleuth buffers bounded output, creates a private temporary file
beside the destination, syncs it, and publishes it atomically with mode `0600`.
An existing destination is refused. `--force` is valid only with `--output` and
allows an intentional atomic replacement. A failed or cancelled command does
not publish a partial output file. Output is capped at 32 MiB.

`lookup --markdown` and `lookup --html` build the existing normalized evidence
report directly after one completed domain lookup. They do not start a second
collection. These report formats reject IP and ASN inputs before collection;
JSON and terminal output remain available for those query types.

Lookup terminal output supports three detail levels. The standard view keeps
the normal bounded evidence summary. `--summary` keeps the source states and
key findings while omitting endpoints and supporting detail. `--verbose` adds
the document generation time and the existing bounded per-source collection
timings. These switches are presentation-only and cannot be combined with
`--json`; they do not change collection or the result document.

`--json` writes one versioned document to standard output:

```json
{
  "schema": "whoisleuth.cli.lookup",
  "version": 1,
  "generatedAt": "2026-07-14T00:00:00.000Z",
  "mode": "fast",
  "query": "example.com",
  "type": "domain"
}
```

The complete document also carries the normalized `rdap`, `whois`,
`availability`, and `diagnostics` sections returned by the shared lookup
orchestrator. Machine output goes to stdout. Usage and lookup errors go to
stderr, so redirected JSON is not mixed with diagnostics.

Human-readable domain lookup output separately shows the registrar RDAP status
and endpoint whenever the shared lookup diagnostics represent that follow-up.
Deep mode may report success, unsupported, not found, or an explicit failure;
fast mode reports the existing skipped state. IP, ASN, and lookup responses
without registrar diagnostics remain unchanged. These source states are
provenance only and do not decide availability or imply safety.

When a deep domain response includes registry interpretation version 1, the
terminal summary also shows the lifecycle label, separately attributed RDAP and
WHOIS disclosure states, reconciliation state, and complete, partial, and
unavailable publication counts. It does not print published contact routes.
The JSON document retains the bounded interpretation and its limitations.

A deep domain lookup can also show the status, selected public address, and
registered network name from the bounded observed network context. It uses the
same address and IP RDAP source represented in the JSON document. This is
point-in-time edge or network-registration context, not proof of the origin
host, hosting control, ownership, intent, or maliciousness. Fast and compact
commands do not run the enrichment.

The deep terminal summary also reports the website activity state, page title,
DNS, HTTP, and TLS source states, bounded publisher-declared structured
identity entities, up to six bounded technology indicators, a browser-library
profile count, and the four passive security-posture counts.
These are concise projections of the same evidence already present in the
lookup response. The browser-library line counts apparent components and
catalogue advisory matches without retaining script references or raw
signatures. These summaries make no extra request, omit raw evidence
descriptions, and do not turn a technology or advisory match, or a missing
posture signal, into proof of exploitability, hosting control, ownership, or
maliciousness. Use `--json` when the full bounded evidence, limitations, and
source diagnostics are required.

`lookup --strict-exit` is an opt-in automation policy. It still emits the
ordinary complete output document, but returns exit code 4 when a requested
diagnostic source is partial, unavailable, rate-limited, timed out, or failed.
The default exit contract remains unchanged, so inconclusive source health does
not silently break existing scripts.

`lookup --events` and `bulk --events` write versioned
`whoisleuth.cli.progress` version 1 JSONL lifecycle events to stderr while the
ordinary final result stays on stdout. Events contain only the command,
sequence, time, source state or Bulk item index, categorical failure reasons,
and final exit status. They do not contain a target, query, endpoint, file
path, error detail, or evidence value. Human progress and error text are
suppressed while events are active. `--events` cannot be combined with
`--output`, because the final event must describe the same completed stdout
delivery observed by the caller.

Pressing Ctrl-C asks an in-flight Lookup or Bulk run to stop, suppresses any
partial final result, flushes an enabled Bulk checkpoint, and exits with code
130. Already started network operations remain subject to their existing hard
timeouts while the shared in-process API unwinds; the executable terminates
after CLI cleanup. A second Ctrl-C removes any known unpublished temporary
output file on a best-effort basis before exiting immediately.

Bulk can persist compact progress with `--checkpoint <file>`. A new checkpoint
is private, bounded to 16 MiB, versioned, and tied to the exact ordered input
and scan mode by SHA-256. It stores only compact per-item results, never full
Lookup responses. Reusing the same path is refused unless `--resume` is also
specified. Resume revalidates the complete untrusted document and skips only
the exact completed rows; changed input, mode, schema, digest, or malformed
results fail closed.

If checkpoint persistence fails after collection, WHOISleuth still emits the
completed final result, reports the checkpoint limitation, and exits with code
4. The last successfully published checkpoint remains available, but it may
not contain the final completed items.

`diff <left.json> <right.json>` compares two different saved domain Lookup
documents entirely offline. It reuses the bounded Bulk comparison model for
registration, DNS, page identity, mail, certificate, and relationship fields,
keeps missing and unavailable evidence distinct, and makes no ownership or
maliciousness inference. The output records both original observation times.

`lookup --observer <label> --vantage <label>` can add two bounded analyst labels
to a saved Lookup document. The labels identify the person or process that ran
the observation and the collection context chosen by that analyst; they are
not verified identities, network measurements, or proof of independent
collection. They do not change which sources are queried.

`reconcile <observation.json> <observation.json> [...]` accepts from 2 to 5
saved Lookup documents for the same domain and compares their bounded fields
offline. It keeps agreement, disagreement, and non-comparable evidence
separate, retains observation times and optional analyst labels, and copies no
filenames or raw registration payloads. Distinct complete label pairs are
reported as labelled collection contexts only; majority agreement is not
treated as truth or authority.

`timeline <observation.json> <observation.json> [...]` accepts from 2 to 20
saved Lookup documents for one domain, orders them by their validated
observation times, and compares each adjacent pair offline. The 32 MiB aggregate
input ceiling is enforced while files are read and again by the timeline
builder. Output retains normalized field states and observation times but no
input filenames or raw registry payloads. A difference can reflect a domain
change or changed collection conditions, so the command makes no current-state,
ownership, intent, safety, or maliciousness conclusion.

When diagnostics version 5, 6, 7, or 8 reports a documented registry collection
constraint, terminal output also shows the suffix, WHOIS and RDAP access
profiles, and the bounded limitation. This is static access-policy context: it
does not make another request, and restricted, unpublished, or unavailable
machine access is not evidence that a domain is unregistered or safe.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed. Individual sources may still be partial or inconclusive; inspect diagnostics. |
| 2 | Invalid command, option, input, or stdin shape. |
| 3 | The requested lookup, collection, or comparison operation could not run. |
| 4 | A bounded operation completed partially, such as Bulk item failures or failed explicit Doctor network checks. |
| 70 | Unexpected CLI bootstrap failure. |
| 130 | The analyst cancelled the command. No partial final result was emitted. |

This release supports `lookup`, `bulk`, `ct-search`, `discover`, `discover-scan`, `posture`,
`http`, `tls`, `registry-support`, `registry-doctor`, `risk-calibrate`,
`lookalike-calibrate`, `verify-artifact`,
`inspect-archive`, `sign-artifact`, `verify-signature`, `source-report`,
`compare`, `page-compare`, `mail-review`, `review-evidence`, `domain-control`,
`assurance`, `sharing-review`, `workflow-plan`, `diff`, `reconcile`, `timeline`,
`export`, `doctor`, `commands`, `completion`, and `manual`. Additional command families
are added as separate bounded increments rather than exposing incomplete
aliases.

## Registry capability coverage

`registry-support` projects the embedded, versioned registry compatibility
catalogue for one domain or suffix. It distinguishes an explicit
fixture-backed or access-documented suffix profile from the generic IANA
discovery profile and reports the RDAP and WHOIS discovery/access paths,
WHOIS query and parser profiles, fixture scenarios,
verification references, documentation references, and the catalogue's
limitation. The same document includes a dated, official-source aggregate of
generic, generic-restricted, sponsored, and infrastructure RDAP coverage. That
snapshot is separate from the suffix profile and from live reachability.

Terminal output is bounded and control-safe. `--json` emits version 3 of the
`whoisleuth.cli.registry-support` schema. Unknown but syntactically valid
suffixes retain the generic `discovery_only` profile; malformed input exits
with code 2. The command never probes a registry or tests current reachability.
Coverage is context only and cannot decide registration, availability,
ownership, safety, or maliciousness.

`registry-doctor [lookup.json]` compares one saved domain Lookup with the same
reviewed local capability profile. It reports whether RDAP and WHOIS collection
states align with allowed, permission-required, or unsupported access, counts
bounded normalized publication fields, and reports whether a registry object
identifier was observed. A missing identifier is a publication omission, not
a failed lookup. The command is offline, makes no retry, and cannot establish
current registry reachability.

The offline RDAP supplied-evidence review implements the request shape defined
by RFC 9536 for `resources`, `domains`, `nameservers`, and `entities`. It also
validates a supplied server's `reverse_search_properties_mapping` response
before preparing a request. Only registered IANA property paths and exact
supported resource/property pairs are accepted. Preparing the request neither
proves that a particular server supports it nor sends a reverse search; active
execution remains gated on a reviewed server policy, privacy boundary, and
deterministic fixtures.

The separate maintenance command `npm run rdap-extensions:drift` compares the
pinned official RDAP extension fixture with the reviewed local interpretation
catalogue entirely offline. `--live` performs one bounded manual fetch from the
fixed official CSV URL and reports added, removed, renamed, status-changed,
unrecognized, and local-only identifiers. `--json` emits
`whoisleuth.rdap-extension-drift-audit` version 1. Drift exits with status 1 and
requires specification and fixture review; the command never enables an
extension, changes authority or availability logic, or issues reverse search.

`npm run service-dependencies:audit` validates the passive service-dependency
catalogue entirely offline. It checks the catalogue digest, duplicate
identifiers and target suffixes, evidence classes, source and licence
treatment, source dates, and a fixed 180-day review age. `--json` emits
`whoisleuth.service-dependency-signature-audit` version 1. A stale or changed
signature requires manual provider and benign-fixture review; the command
never resolves a target, checks an account, or tests claimability.

## Offline Risk calibration

`risk-calibrate` replays a versioned analyst-labelled fixture dataset through
the exact Risk model shared with the web application. It does not perform a
lookup, contact the hosted deployment, persist the dataset, alter model weights,
choose a threshold, or tune the model automatically. The report compares fixed
thresholds from 40 through 90 and identifies 70 as the current review band.

Input is capped at 2 MiB and 500 records. Each record requires a unique bounded
ID, an ASCII DNS hostname, one existing analyst disposition, and a strict
whitelist of current scoring inputs. Unknown fields are discarded; arrays,
strings, ages, booleans, provider records, and external findings are revalidated
and bounded before scoring. The accepted dataset envelope is:

```json
{
  "schema": "whoisleuth.risk-calibration-dataset",
  "version": 1,
  "records": [
    {
      "id": "fixture-1",
      "domain": "login.example.test",
      "analystDisposition": "confirmed_abuse",
      "evidence": {
        "availability": "registered",
        "mutationTypes": ["dictionary"],
        "hasPasswordField": true
      }
    }
  ]
}
```

`confirmed_abuse` is treated as a positive calibration label; `false_positive`
and `expected` are negative labels. `unreviewed`, `suspicious`, and
`closed_no_action` remain contextual and are excluded from threshold quality
metrics, as are records for which Risk is not applicable. Terminal output caps
its record list at 100 while `--json` retains the complete bounded report,
factor breakdowns, score bands, and per-threshold confusion metrics. Analyst
dispositions and heuristic scores are review context: neither proves
maliciousness or safety.

The authenticated Monitor workspace can deliberately create the accepted
dataset from explicitly selected cases. Selection is available only when a case
has a reviewed disposition and retained normalized evidence. That local export
contains the case ID, domain, disposition, and a bounded whitelist of current
scoring inputs. It excludes notes, tags, assertions, actions, contacts, raw
source data, provider payloads, and stored Risk scores. Before download, a local
review step shows the selected, included, and excluded counts, the domains and
dispositions that will be written, and the excluded evidence classes. The CLI
still validates every exported record and never trains, tunes, or changes the
Risk model.

## Lookalike review-yield calibration

`lookalike-calibrate [dataset.json]` summarizes reviewed candidate outcomes by
mutation family without retaining domains, candidate identifiers, analyst
notes, or evidence values in its output. Input uses
`whoisleuth.lookalike-calibration-input` version 1, is capped at 2 MiB and 5,000
unique opaque records, and requires one reviewed disposition plus from 1 to 12
bounded mutation-family identifiers per record.

The report keeps exact disposition counts, review-lead rate, false-positive
rate, and a per-family sample state. Fewer than 20 reviewed observations remains
`insufficient`. The command is diagnostic only: it does not tune candidate
generation, filtering, ranking, or Risk, and a useful historical yield does not
establish that a current candidate is malicious or safe.

## Offline artifact verification

`verify-artifact` validates a supported local artifact without printing its
evidence contents. Input is capped at 15 MiB. It currently recognises ordinary
and encrypted workspace archives, case-response packets, acquisition-decision
exports, domain-comparison exports, Bulk mail-exposure exports, and Bulk review
manifests. It also verifies the internal digests of a complete investigation
capsule, including its evidence, brief, graph, and optional analyst-record
projections, and that capsule can be passed to `sign-artifact`. It also validates the bounded versioned structure of saved CLI
Lookup JSON. Because saved Lookup documents do not embed a checksum or
signature, that result is reported as `structure_valid` with content integrity
explicitly unchecked. Saved Lookup validation retains its stricter 8 MiB
document ceiling.

For an ordinary workspace archive, the command validates the versioned
structure, section byte counts, record counts, and per-section checksums. For a
supported signed review artifact, it validates the declared SHA-256 digest. An
encrypted archive without `--passphrase-file` can establish only that the
envelope is structurally valid; it reports `envelope_valid` and explicitly
leaves authenticated encryption and inner checksums unchecked.

Supplying a separate passphrase file, capped at 1 KiB, allows authenticated
decryption followed by the ordinary workspace checks. The passphrase is never
accepted as a command-line value, printed, or retained. Verification detects
changes against the artifact's declared contract; it does not authenticate the
analyst or establish that an observation was accurate or remains current.

## Privacy-safe source reliability report

`source-report` summarises source states, durations, truncation, and rate-limit
counts from one version-1 CLI Lookup, Bulk, or Bulk-item document, a JSON array
of up to 100 such documents, or an array containing only previously generated
source-reliability reports. Lookup documents and reports cannot be mixed.
Merged reports preserve exact state and sample totals and add bounded ranges
for each input report's median and p95 duration, a bounded source timeline,
fast/deep/unknown cohorts, and the earliest and latest valid report generation
times. Exact duplicate reports are rejected so one saved report is not
accidentally counted twice. Per-source failure, partial, truncation, and
rate-limit rates remain separate. The command does not pretend that aggregate
timing distributions can reconstruct the original target-level samples. Input
is capped at 12 MiB and traversal, source, duration, and output counts are
bounded.

The report retains only fixed source identifiers and aggregate operational
counts. It does not output targets, queries, endpoints, source limitations, raw
evidence, or provider payloads. Observation-envelope duration and the
potentially overlapping Lookup timing are reported separately and never added
together. It is a local engineering diagnostic, not analytics, a source-quality
score, or evidence that a collector is currently healthy.

## Workspace archive inspection

`inspect-archive` verifies an ordinary or encrypted workspace archive and then
reports its versioned sections, counts, byte sizes, and checksum states without
printing stored records. An encrypted archive requires
`--passphrase-file`; passphrases are never accepted on the command line.

An optional `--search` is exact and case-insensitive across a fixed allowlist
of target fields. Default matches disclose only the section, field name, and a
SHA-256 digest. `--reveal` must be selected explicitly to print the matched
value. Notes, contacts, raw evidence, arbitrary object fields, and partial text
search are excluded. Unicode domain searches are canonicalized to their
DNS-safe ASCII form before exact comparison. `--require-match` makes a
no-match result fail for automation and is valid only with `--search`.
Traversal, input size, matches, depth, arrays, and strings are bounded.

## Optional evidence-package signing

`sign-artifact` signs a locally verified case-response packet or supported
review manifest with an externally managed Ed25519 private key:

```bash
node bin/whoisleuth.mts sign-artifact packet.json --private-key-file analyst-private.pem > packet.signed.json
node bin/whoisleuth.mts verify-signature packet.signed.json --public-key-file analyst-public.pem
```

The signed package embeds the public key, key identifier, signature time, and
original artifact. Verification first checks the exact package field set and
signature, then the artifact's own checksums or manifest. A result is reported
as `signature_valid`; signer trust is separately reported as `trusted_key` or
`embedded_key_only`. Without a separately supplied trusted public key,
verification establishes only that the package is internally self-consistent.
WHOISleuth does not generate, store, recover, rotate, publish, or establish
trust in signing keys.

## Bulk lookup

`bulk` accepts a newline-delimited file or stdin. It preserves input order,
removes case-insensitive duplicates, and returns a result for every retained
query. Input is capped at 1 MiB. Fast mode is capped at 500 queries with four
workers by default. Deep mode is capped at 50 queries with two workers by
default. Explicit concurrency cannot exceed eight in fast mode or three in
deep mode.

Bulk uses the shared compact lookup response, so it does not retain raw RDAP
objects or WHOIS response bodies. `--json` returns one bounded collection;
`--jsonl` emits one self-contained versioned item per line. `--domains` emits
only successfully normalized domain names, while `--queries` preserves the
selected bounded input queries and is suitable for an exact retry queue.
Version 2 adds a
bounded `dnsSummary` projection for observed A, AAAA, NS, and MX records plus
null MX, SPF, and DMARC state. `--csv` writes fixed columns for automation,
including the DNS summaries and explicit outcome.

`--registered-only`, `--inconclusive-only`, and `--errors-only` are mutually
exclusive output filters. The first retains registered, for-sale, and expiring
authority-aware states. The second retains unknown authority states and failed
rows. The third retains only rows whose lookup operation failed, which is useful
for producing an exact retry queue without treating an inconclusive successful
lookup as an operational error. Filtering does not change collection and never
converts an unavailable or failed source into an unregistered result. Machine
documents record collected and emitted counts. A mixture of successful and
failed queries exits with code 4 while preserving every collected result before
output filtering. For example, `bulk domains.txt --queries --errors-only`
produces only the exact failed inputs while retaining the partial-failure exit.

## Certificate Transparency search

`ct-search` accepts one keyword as an argument or on stdin and calls the same
bounded Certificate Transparency module as the web application. It contacts
the upstream public log search service directly from the local machine; it
does not call the hosted WHOISleuth deployment. Quote a multi-word keyword so
the shell passes it as one argument.

Terminal output summarizes certificate rows, observed hostnames, canonical
registrable-domain matches, observation times, bounded certificate-issuance
groups, and completeness. An issuance group contains names observed together
in one public certificate record; a cross-domain group is a review lead, not
an attribution or ownership finding. Terminal output shows at most 100 matches
and five hostnames per match, with explicit omission notes. `--json` returns
the complete bounded structured result in the versioned
`whoisleuth.cli.ct-search` schema. The certificate-group cap is reported
separately from the registrable-domain result cap. CT observations do not prove
that a website is active or malicious.

## Lookalike discovery

`discover` runs the same pure, bounded lookalike generator as the Discover
tool without making network requests. It accepts a brand label or a
domain with one suffix label. The default TLD set is `com,net,org`; replace it
with `--tlds com,net` when narrower coverage is wanted.

Generation presets are `common`, `impersonation`, and `all` (the default).
Keyboard-aware mutations support `qwerty` (the default), `azerty`, and
`qwertz`; `--keyboard all` uses their bounded combined neighbour set, including
adjacent number-row keys. Supply a UTF-8 text file with
`--dictionary terms.txt` to add up to 100 local terms when
using the `impersonation` or `all` preset. Dictionary input is capped at 4,096
bytes and individual terms at 32 characters. Machine output records accepted
and rejected term counts but never copies the private terms into its metadata.

Use `--families <ids>` instead of `--preset` to run an exact comma-separated
selection. Supported IDs are `character_addition`, `character_omission`,
`character_duplication`, `character_transposition`, `pluralization`,
`tld_embedding`, `www_prefix`, `hyphenation`, `separator_omission`,
`word_reordering`, `keyboard_substitution`, `keyboard_insertion`, `vowel_swap`,
`bitsquatting`, `ascii_homoglyph`, `unicode_homoglyph`,
`unicode_whole_label`, `unicode_homoglyph_depth_2`, `dictionary`,
`dictionary_token_replacement`, `tld_typo`, and `tld_substitution`. Machine
output records the normalized custom selection. A custom dictionary file
requires `dictionary` or `dictionary_token_replacement` in that selection.

`--domains` writes the unique candidate names only. `--snapshot <file>` keeps
one private, versioned local observation of the normalized seed, generation
configuration, custom-dictionary digest, and candidate set. The first run
creates the snapshot; later runs report added and removed candidates before
atomically replacing it. The snapshot never stores private dictionary terms.
Use the same command from a local scheduler such as cron or a system timer to
perform repeatable discovery runs. WHOISleuth does not install a scheduler,
run a background daemon, or infer that an added candidate is registered,
active, available, or malicious.

Dotted subdomain permutations are intentionally excluded because the lookup
pipeline validates a hostname's registrable parent. The CLI does not present
authoritative parent registration evidence as proof that a generated hostname
exists.

Terminal output is capped at 200 candidates with an explicit notice. Versioned
JSON and JSONL use `whoisleuth.cli.discover` schema version 2 and retain the
complete bounded candidate set and mutation provenance. Internationalised
candidates show the DNS-safe ASCII form and readable Unicode form together in
terminal output. The Impersonation and All presets can add up to six
deterministic whole-label Unicode candidates when every letter has a reviewed
same-script replacement. The command generates candidates only. It does not
claim that a domain is registered, active, or malicious.

`unicode_homoglyph_depth_2` is an explicit `--families` option and is never
enabled by a preset. It replaces exactly two ASCII letters with characters
from the same reviewed script, ranks curated mappings first, and returns at
most 256 candidates. JSON and terminal output report generated candidates,
cross-script or invalid combinations omitted by policy, and lower-ranked
label variants omitted by the family or overall generation budget.

## Supervised candidate scan

`discover-scan` composes the same bounded generator with the compact Lookup
collector. Unlike `discover`, it is an explicitly networked command. It selects
the first deterministic candidates up to `--scan-limit`, processes fixed
chunks sequentially, and retains each registration and DNS source state. Fast
mode is the default and accepts at most 500 candidates. Explicit `--deep` mode
is capped at 50 candidates and concurrency 3 because it can add WHOIS, DNS,
HTTP, TLS, page, and technology work for every selected candidate.

Use `--chunk-size 1-100`, `--concurrency 1-8`, and the existing private
`--checkpoint <file> [--resume]` boundary to control a run. The checkpoint is
tied to the exact ordered candidate set and scan mode. A new generation order,
limit, or mode requires another checkpoint. `--resolver` accepts at most three
literal IPv4 or IPv6 recursive-resolver addresses and applies them only to DNS
observations in this local run. Resolver hostnames and automatic third-party
resolver selection are not supported. The selected resolvers can observe the
queried candidates and may apply their own logging and retention policies.

An optional newline-delimited `--allowlist` accepts at most 500 domains and 64
KiB. Matching candidates remain in evidence and are labelled `suppressed` in
the review queue; the full list and unmatched entries are not copied into
output, while each matching scanned candidate necessarily exposes that match.
Allowlisting never deletes a result or asserts that it is safe. Output filters
select registered, inconclusive, acquisition-review, or
suppressed rows without changing whole-run counts or source health. JSON,
JSONL, CSV, and domain-list forms retain mutation provenance and explicit
review lanes. The queue provides next manual actions, not automatic lookup,
acquisition, blocking, submission, or enforcement.

Deep compact results can group exact shared addresses, nameservers, and mail
servers observed across at least two candidates. These bounded relationships
are pivot leads only. Common hosting, delivery, registrar, and mail services
can produce the same relationship without common ownership or control.

`--observation-snapshot <file>` keeps a private versioned local projection of
registration state, confidence, and bounded A, AAAA, NS, MX, null-MX, SPF, and
DMARC summaries for the exact candidate set, mode, and resolver selection.
Version 2 records registration and DNS observation times and latest component
states separately; version 1 is read and normalized on the next write. A later
identical run reports material field changes only for components collected
with enough completeness to support the comparison. If registration or DNS is
partial or unavailable, the prior usable evidence for that component is
preserved and the attempt is reported as unavailable rather than converting
missing data into a removal. Raw registry
records, contacts, page content, and request details are excluded. Snapshot
differences are review prompts, not proof of ownership, control, intent,
safety, or maliciousness.

## Domain posture audit

`posture` runs the standard-profile form of the owned-domain DNS and
email-security audit used by Brand Profiles. It queries registry status and
DNSSEC evidence, nameserver delegation, SPF, DMARC, MX, CAA, MTA-STS, TLS-RPT,
and BIMI directly from the local machine. Literal SPF include and redirect
branches are expanded within fixed depth, policy-query, DNS-term, void-answer,
cycle, and time bounds. External DMARC reporting authorization and external
nameserver, mail, SPF, and reporting dependencies are separately reported.
Supply up to ten known active and retired DKIM selectors in total with
`--selectors selector1,selector2` and `--retired-selectors selector0`;
selectors cannot be reliably discovered from DNS, so no-selector output
reports DKIM as not checked. Use `--mail-profile standard`,
`--mail-profile defensive-no-mail`, or `--mail-profile parked` to make the
intended mail posture explicit rather than inferring it from DNS.

Terminal output shows each pass, review, action, or informational result and
caps displayed records at five per check with an explicit omission notice.
Versioned JSON retains the complete bounded report, including SPF traversal,
DMARC authorization, and dependency provenance. Warnings and dangers are
findings rather than command failures; transient resolver or policy-fetch
failures remain informational and should be retried before changing DNS.

## HTTP intelligence

`http` runs the same bounded safe homepage probe used by a deep lookup. It
tries HTTPS before HTTP, follows only validated public-network redirects, caps
each attempt at six seconds, and captures at most 300,000 response bytes for
hashing and metadata. A non-success HTTP response still proves that a web
service answered; failure of both schemes remains inconclusive rather than
evidence that no website exists.

The command reports normalized redirect, response, content, selected security-
header, body-hash, completeness, and attempt provenance. Captured homepage text
is never written to terminal or JSON output. Query strings are removed by the
shared HTTP evidence normalizer, and terminal values are additionally bounded
and control-safe.

## TLS intelligence

`tls` runs the same bounded one-connection TLS collector used by deep lookups.
It resolves the hostname once through the public-address guard, validates every
answer, connects directly to the first validated address on port 443, and keeps
the original hostname for SNI and certificate identity checking. Resolution
and handshake work share a five-second deadline.

The report retains the negotiated protocol, ALPN and cipher, runtime trust and
hostname checks, certificate validity, bounded subject and issuer names, SANs,
SAN class counts, signature algorithm and OID, extended-key-usage purposes,
classified Authority Information Access presence counts, SHA-256 certificate
and public-key fingerprints, a bounded certificate chain, and neutral
findings. AIA responder and issuer locations are classified as HTTP, HTTPS, or
other and then discarded; they are not retained or followed. The collector
stores no certificate bytes, session material, or application data and does
not enumerate supported protocol or cipher suites.
A failed collection is inconclusive rather than proof that no TLS service
exists.

## Registry-source comparison

`compare` reads one version-1 `whoisleuth.cli.lookup` domain document from a
file or stdin and emits a version-3 `whoisleuth.cli.compare` document. Its
primary comparison reconciles normalized registry RDAP and WHOIS fields. When
the saved deep lookup also represents the optional registrar RDAP follow-up,
an additional sibling comparison reconciles the portable registry and
registrar RDAP publication fields. The command does not repeat the lookup,
contact the hosted deployment, or treat a conflict as a command failure. Use a
deep lookup when multiple sources are wanted; a fast lookup deliberately
records WHOIS as skipped, and comparison preserves that state as unavailable
rather than misreporting RDAP-only publication.

Input is capped at 8 MiB and must retain the lookup schema, mode, source
diagnostics, and normalized parsed source sections. Per-value, list, and event
bounds are revalidated because saved JSON is treated as untrusted input. A
successful registrar source must include a normalized object and agree with
its diagnostic status. Raw RDAP JSON, registrar contacts and source-specific
handles, WHOIS response bodies, availability evidence, and unrelated lookup
fields are not copied into the comparison result.

When the saved Lookup contains valid version-5, version-6, or version-7, context-only
registry-access diagnostics, version 3 retains their bounded suffix, access profiles, and
limitation. Terminal output labels the same collection context explicitly.
It explains source reachability only and cannot decide registration,
availability, ownership, safety, or maliciousness. Older documents and saved
lookups without that context do not gain a registry-access field.

Terminal and versioned JSON output cover domain identity, registry object ID,
registrar, registrar IANA ID, lifecycle dates, DNSSEC, statuses, and name
servers. The shared comparison model normalizes harmless case, punctuation,
ordering, and date-precision differences while distinguishing conflicts,
one-source publication, redaction, incomplete sources, and unavailable
sources. This is source reconciliation, not an availability, ownership, or
maliciousness decision.

## Static page comparison

`page-compare <left.json> <right.json>` reads two different version-1 saved
Deep domain Lookup documents and compares the already-retained static page
identity, exact and perceptual favicon evidence, technology identifiers, TLS
issuer label, and TLS public-key fingerprint. DOM structure is compared first
by its exact bounded tag-sequence digest, then, when both captures provide it,
by a parse5-tokenized structural SimHash. It makes no request and requires
complete supported static page-identity observations on both sides.

Each page component remains independent. Exact, similar, overlapping,
different, unavailable, and partial evidence are not collapsed into a score.
Matching components are investigative relationships rather than proof of
copying, common ownership, control, intent, safety, or maliciousness. Static
comparison does not execute JavaScript; use the optional local rendered
capture package only when that additional active behavior is authorised.

## Passive mail exposure review

`mail-review [bulk.json|bulk.jsonl]` reads version-2 Bulk output locally and
summarizes MX, null MX, SPF, DMARC, and mail-provider relationships. It keeps
authenticated mail, authentication gaps, incomplete authentication evidence,
no explicit MX, null MX, and incomplete DNS evidence as separate states.
Shared-provider relationships are based only on the registrable domain of an
observed MX hostname and do not establish shared ownership or control.

The command makes no DNS or SMTP request and retains no source path. It does
not test message acceptance, relay behavior, mailbox existence, catch-all
behavior, SMTP banners, or whether a mail server is rogue, safe, or malicious.

An analyst may add a bounded `tlsaEvidence` object to a version-2 Bulk item for
offline DANE review. It must name the exact `_25._tcp.<mx-host>` service, and
that host must occur in the same item's retained MX evidence. A certificate
association match is complete only when `dnssecState` is `validated`. TLSA
usages 0 and 1 additionally require `pkixValidationState: "validated"`.
Usages 0 and 2 compare against the bounded `authorityMaterials` array; usages
1 and 3 compare against the supplied leaf certificate or SPKI. Mismatched
service names, missing certificate roles, unvalidated prerequisites, malformed
material, and truncation remain invalid, partial, or untrusted rather than
becoming a DANE match.

## Offline supplied-evidence review

`review-evidence [evidence.json]` accepts one version-1 JSON input and performs
only deterministic local parsing, comparison, or request planning. Input is
capped at 16 MiB. The command never retrieves DNS, opens SMTP, contacts an
RDAP server, submits a resolver query, or looks up an address in a hosted
GeoIP service.

Supported input schemas are:

- `whoisleuth.dnssec-evidence-input`: compares bounded DS and DNSKEY records,
  recalculates DNSKEY key tags and supported DS digests, and reviews supplied
  RRSIG validity windows at `observedAt`. `consistent` describes only the
  supplied DS/DNSKEY relationship. It does not authenticate a chain to a root
  trust anchor, validate RRSIG cryptography, or prove that a missing record is
  absent.
- `whoisleuth.tlsa-evidence-input`: binds TLSA records to one explicit
  `_port._transport.hostname` service and compares supplied leaf or authority
  certificate/SPKI bytes. `matched` requires independently validated DNSSEC;
  PKIX-TA and PKIX-EE usages also require an independently validated PKIX path.
  The command does not retrieve the certificate or negotiate STARTTLS.
- `whoisleuth.rdap-search-input`: normalizes a supplied RDAP search-help
  response and prepares an exact supported reverse-search request without
  sending it.
- `whoisleuth.rpki-route-input`: compares a route prefix and origin ASN with a
  bounded analyst-supplied VRP set.
- `whoisleuth.local-geoip-query`: queries an analyst-supplied bounded prefix
  database whose source, version, and licence metadata remain in the result.
- `whoisleuth.encrypted-dns-plan-input`: validates an explicitly reviewed
  encrypted-DNS provider contract and prepares a bounded query plan. It does
  not execute the plan.

The common output is `whoisleuth.cli.offline-evidence-review` version 1. It
retains the nested result's explicit state and limitations. A locally
consistent relationship is not converted into a claim about current
publication, ownership, safety, or maliciousness.

## Domain control manifests

`domain-control [input.json]` builds or reviews a bounded desired-state
manifest without making a request or changing configuration. A manifest input
uses `whoisleuth.domain-control-manifest-input` version 1, includes an expiry,
and may record expected nameservers, DS, MX, CAA, TLS issuer, TLS SPKI
fingerprint, registrar-lock preference, and a renewal-review date for up to 100
domains. Empty fields mean unconfigured; they do not require a record to be
absent.

The emitted `whoisleuth.domain-control-manifest` version 1 is normalized and
protected by a canonical SHA-256 digest. It can also be passed to
`sign-artifact` for an optional local Ed25519 signature. Integrity and
signature verification detect changes and authenticate possession of the
selected key; neither establishes that the desired state is correct.

A review input uses `whoisleuth.domain-control-review-input` version 1 and
contains one manifest plus separately attributed observations. Only a complete
`observed` field may produce `drift`. Partial, unavailable, unsupported, and
missing observations remain inconclusive, and unrelated observations are
counted but ignored. The review performs no DNS, RDAP, HTTP, TLS, SMTP, or
registrar request.

## Domain assurance review

`assurance [input.json]` reviews one bounded analyst-authored workflow entirely
offline. The input uses `whoisleuth.domain-assurance.input` version 1 and one of
three fixed kinds:

- `planned-change` records a bounded window, evidence-backed milestones,
  rollback criteria, and post-change checks;
- `recovery-dependencies` reviews up to 100 domains across registrar, DNS,
  mail, certificate, and recovery providers and highlights exact provider
  concentration; and
- `retirement` checks a fixed set of decommissioning controls without treating
  an unchecked item as complete.

Provider labels, readiness confirmations, evidence references, and expected
states remain analyst assertions. The output preserves incomplete and
needs-review states, stores no credentials, makes no request, and changes no
registrar, DNS, mail, certificate, or recovery configuration.

## Pre-sharing review

`sharing-review [artifact.json]` performs a redacted local preflight before an
analyst deliberately shares an artifact. The analyst must select a TLP 2.0
marking, a recipient scope, and a bounded purpose. Optional confirmations record
human review, personal-data review, and redaction review. The command validates
supported artifact integrity where possible, detects stricter embedded TLP
markings, and reports only key-category counts; it never emits inspected values
or copies raw evidence.

An imported stricter marking cannot be downgraded by the requested marking, and
recipient scope is checked against the effective marking. Evading this local
preflight remains possible, so the result is a review aid rather than access
control, legal advice, or recipient authorization.

## Fixed investigation plans

`workflow-plan <recipe> <domain|brand>` turns one of four fixed recipes into a
versioned `whoisleuth.cli.investigation-plan` document. Supported recipes are
`domain-triage`, `lookalike-review`, `owned-domain-review`, and
`historical-comparison`. Each step names an existing CLI command, carries its
arguments as a JSON array, declares whether it is offline or networked, and
marks network-disclosure or analyst-selection approval gates.

The command is plan-only. It does not execute a step, construct a shell script,
interpret a placeholder as a file path, read an artifact, make a request,
change a case, or submit evidence. Analysts deliberately run selected commands
after reviewing their collection boundaries. This provides repeatable
domain-specific workflows without an arbitrary automation or plugin surface.

## Optional local rendered capture

`packages/web-capture` is a private repo-local Playwright package, not part of
the distributable core CLI or hosted application. It requires an explicit
authorization flag and one new output directory:

```bash
npm run capture:local -- https://example.test --output-dir ./capture-example --authorize-rendered-capture
npm run capture:compare -- ./official/manifest.json ./candidate/manifest.json --json
```

It writes a fixed 1024x768 PNG, screenshot SHA-256 and perceptual dHash, a DOM
digest containing hashes and bounded element counts rather than markup or page
text, and a version-2 `whoisleuth.web-capture-manifest` compatible with the
Cases importer. Version-1 manifests remain importable.

Rendered capture executes page JavaScript. It caps HTTP(S) requests and request
hostnames, blocks downloads, service workers, WebSockets, non-read methods,
credentials, non-default ports, and private or reserved addresses, and retains
no request path, query, headers, bodies, cookies, credentials, DOM markup, or
page text. The browser connection is not pinned to the address checked before
each hostname's first request, so DNS rebinding remains a residual risk. Use a
disposable network-restricted environment for untrusted targets.

The separate offline comparison command accepts two selected version-2 local
capture manifests. It first verifies each referenced screenshot and DOM digest
against its declared size, SHA-256, screenshot dimensions, and perceptual hash;
it also validates bounded source and limitation metadata and requires the DOM,
manifest, and source collection times to agree. It then
compares screenshot distance, exact rendered DOM and visible-text digests,
bounded element counts, page identity, technologies, and request-domain sets.
It does not recrawl either target, reveal the input paths, or collapse the
independent components into a similarity or maliciousness score. A missing
perceptual hash remains unavailable rather than becoming a visual difference.

## Lookup evidence export

`export` converts one version-1 `whoisleuth.cli.lookup` domain document from a
file or stdin into the same versioned `whoisleuth.lookup-evidence` JSON package
produced by the web Lookup tool. It performs no lookup and writes only to
stdout, so use ordinary shell redirection when a file is wanted. Pretty JSON is
the default; `--compact` emits one compact JSON line for pipeline use, while
`--markdown` produces a readable source-attributed summary and `--html`
produces a self-contained printable report. Compact, Markdown, and HTML output
are mutually exclusive.

The saved input is capped at 8 MiB and revalidated using the same schema,
source-status, parsed-data, scalar, list, and event boundaries as `compare`.
The export retains query context, source diagnostics, normalized registry data,
raw registry RDAP JSON, the raw WHOIS referral chain, availability analysis,
and the shared registry-source comparison. Version 23 can add the exact local
SSLBL comparison already represented by a deep full Lookup. Version 21 adds the bounded registry
lifecycle, disclosure, publication-quality, reconciliation, and abuse-routing
interpretation derived from the already-collected sources. Registrar RDAP raw
data, contacts, entities, links, notices, and source-specific handles remain
excluded. Schema version 20 replaces selected security-policy values in
retained HTTP evidence
with presence-only markers and can include fixed response-policy findings from
an already-represented deep lookup. Version 19 additionally retains the bounded credential-surface projection
when the saved deep lookup represents it. Version 18 retains the bounded structured identity projection
when the saved deep lookup represents it. Version 17 retains the normalized portable-field comparison, explicit
source-health states, a strict bounded projection of observed network
registration, an optional normalized security.txt disclosure source, HTTPS
service-binding publications, and the passive browser-library profile when the
saved deep lookup represents them. Raw IP RDAP payloads, security.txt response
bodies, script references, matched script content, and contact entities remain
excluded.

Markdown output summarizes query context, assessment state, registry sources,
source reconciliation, network observations, and collection diagnostics. It
escapes all upstream text as untrusted content, bounds displayed values and
lists, and deliberately omits raw RDAP JSON and full WHOIS response bodies.
Use JSON when the complete evidence package or machine processing is required.
The browser Console reuses this bounded Markdown renderer for domain results
after first reducing the typed Lookup response to the known normalized fields
needed by the report. It separately offers bounded IP and ASN summaries from
their normalized RDAP and source-health fields; IP reports can also include
bounded reverse-DNS context already collected by Lookup. The browser action
does not change the CLI input or output contract.
When a version-5, version-6, or version-7 lookup records a documented registry-access constraint, both
Markdown and HTML include that context in collection diagnostics without
changing its non-authoritative interpretation. Both formats also include the
selected address and bounded network registration when present, together with
the edge-versus-origin limitation.

HTML uses the same bounded summary model as Markdown. The generated document
contains inline styling for screen and print, but no scripts, forms, active
links, or external resources. A restrictive embedded Content Security Policy
provides defense in depth when the local file is opened in a browser. All
registry values are HTML-escaped and displayed as text.

This is a deliberately rich evidence package. Raw registry sources can contain
publicly published contact data, and deep availability evidence can contain
bounded website, DNS, mail, page-identity, and TLS observations. Review and
secure the output before sharing it. The CLI does not add browser-only IDN
profile analysis, so that optional evidence field is `null`.
