# WHOISleuth CLI reference

The WHOISleuth CLI runs locally. Installed `whoisleuth <command> --help`,
`whoisleuth commands` and `whoisleuth manual` are the exact grammar, option and
command authorities for that installed version. The public
[CLI reference](https://www.whoisleuth.com/cli) provides a searchable view generated
from the same registry.

This page records the common interfaces and the boundaries that matter across
commands. The generated [privacy/data-flow catalogue](https://github.com/slicedearth/whoisleuth/blob/main/docs/privacy-data-flow-catalogue.md)
contains the exhaustive recipient, retention and export metadata.

## Installation

Use the [installation guide](cli.md#installation) for runtime requirements,
installation and updates. The CLI runs locally without a hosted account.

## Find and inspect commands

```bash
whoisleuth --help
whoisleuth commands --common
whoisleuth commands --group investigate --mode network
whoisleuth lookup --help
whoisleuth lookup example.test --deep --plan --json
```

The command index groups work under Investigate, Respond, Assure and Utilities.
Filters combine by intersection. `commands --json` emits the versioned local
catalogue without reading evidence or running the selected commands.

An eligible domain, reserved documentation domain, IP address or ASN can occupy
command position as Lookup shorthand. Use explicit `lookup` where input needs
supported URL-like normalisation. Credentials, paths, queries, fragments, ports
and unsupported special-use targets are rejected by the shorthand.

Explicit `lookup` normally uses only a pasted URL's hostname. Add
`--deep --exact-url` to collect that page's path and query instead of the
homepage; fragments are not sent. `--plan` discloses this scope without making
requests or copying the URL into the plan. Use stdin to keep a sensitive URL
out of shell history. Saved request provenance omits queries, but paths and
page-derived text still require review before sharing.

`registry-scaffold` has a separate fixture contract: its `--profile` selects one
fixed fixture profile and shared `--config` profiles are rejected. It produces
sanitised local fixture material and makes no registry request.

## Requests and authorisation

Offline commands read only supplied arguments, files, standard input and
installed catalogues. Networked commands contact the sources named by their
focused help; those sources can observe and rate-limit the operator's network
address. The CLI does not inherit hosted login, provider configuration or
hosted operation limits.

`lookup --plan` classifies a target and lists intended source families and
disclosures without collecting. Fast is the Lookup default. Deep adds the
applicable registration, DNS, HTTP, TLS, page, technology and network context.
Optional browser providers are not implicit CLI actions.

The [message-header review](cli.md#message-header-review) is offline and reports
publisher claims, not independent DNS or cryptographic validation.

`dnssec-validate` and `mail-transport` are isolated authorised actions. Both
require a selected literal public resolver, a local trust-anchor document and
`--owned-or-authorized`; mail transport also requires `--active-probe`. Mail
transport handles at most three selected MX hosts sequentially, sends `EHLO`
and uses `STARTTLS` only when advertised. It does not send mail, authenticate,
test relay, enumerate recipients or retry automatically. DNSSEC, TLSA/DANE,
PKIX, STARTTLS and SMTP transport remain separate evidence states.
STARTTLS detection uses the full bounded reply. If the retained capability
inventory is shortened, the report remains partial and names the omission.

The repository-only rendered-capture package is outside hosted and distributable
collection. It executes remote page JavaScript only for an explicitly
authorised route set, and each admitted resource operator receives the exact
requested URL. Captures and screenshots remain local until the operator deletes
them.

## Files, output and automation

File inputs are bounded before parsing; directories, devices and named pipes are
refused. Output goes to the terminal unless a command supports `--output`.
Private output is written atomically and an existing path is refused unless
replacement is explicit.

`--` ends option processing. All later arguments are literal positional inputs,
including names such as `--help`. Use `./-evidence.json` for a hyphen-prefixed
filename when completing paths across shells. Options must precede `--`.

Terminal text is the default. JSON, JSONL, CSV, Markdown, HTML and domain-only
formats are available only where the installed command declares them.
Redirected and machine output contains no ANSI or progress text. Diagnostics
and optional target-free `--events` output use standard error.

For `bulk` and `discover-scan`, `--csv-with-metadata` adds the source schema and
version, observation and report times, collection origin, scan mode, diagnostic
version and source-health states. Missing clocks remain `unknown`; a null
source state is unmeasured, not a negative result. `--csv` keeps the compact columns.

`--fail-on` and `--strict-exit` expose selected evidence states to automation
without changing the result document. Review focused help for the policies a
command supports.

| Code | Meaning |
| ---: | --- |
| 0 | The command completed; individual sources can still be partial. |
| 2 | The command, option or input was invalid. |
| 3 | Collection, lookup or comparison failed. |
| 4 | The result was partial or a selected evidence policy was not met. |
| 70 | The CLI could not complete bootstrap. |
| 130 | The analyst cancelled; no partial final result was emitted. |
| 143 | SIGTERM stopped the process; no partial final result was emitted. |

## Portable documents and compatibility

Readers accept only their declared public and current versions. Unknown,
unreleased historical and future schemas fail before partial interpretation;
an invalid import is not treated as an empty document.

`inspect-archive` reads current workspace archive v8 and exact versions 5, 6 and 7. It
reports section metadata and digest-only search results unless `--reveal` is
explicitly selected. It never searches notes, contacts or arbitrary raw fields.

`export` reads supported saved Lookup v1 or v2 and writes current Lookup
evidence schema 29. Published v2 schemas 27 and 28 and exact v1 schema 26 remain
readable. Versions 27–29 exclude raw registration payloads, expanded
contacts, credentials, complete query-bearing URLs and provider payloads;
schemas 28 and 29 also retain the bounded registrar-standing projection.
Schema 29 identifies the hostname used for DNS, TLS and web observations,
separately from the registrable domain used by registration sources. Older
evidence retains its original collection scope.

`verify-artifact` checks a recognised structure and its applicable integrity
contract. `interchange-report` describes retained and omitted fields.
`sign-artifact` and `verify-signature` keep artefact validity, signature
validity and signer trust separate. None of these checks establishes that
evidence is accurate, current, safe to share or attributable to a person.

### Signer trust

Use `verify-signature package.json --trust-store-file trust.json --json` to
check an explicitly selected fingerprint policy offline. The result contains
the ordinary signature verification and a separate current trust decision.
Only a matching `trusted` entry succeeds; unknown, `retired`, `revoked` or
future-reviewed entries return exit code 4, including with `--quiet`.
Malformed files return 2. Without this option, the existing verification
output is unchanged. A supplied `--public-key-file` must also match.

The trust file contains no keys. For example:

```json
{
  "schema": "whoisleuth.evidence-signer-trust-store",
  "version": 1,
  "entries": [{
    "keyIdSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "label": "Evidence reviewer",
    "status": "trusted",
    "updatedAt": "2026-09-01T00:00:00.000Z",
    "note": "Fingerprint confirmed through the established contact channel."
  }]
}
```

Replace the example fingerprint with the SHA-256 fingerprint of the signer's
SPKI DER public-key bytes, confirmed through an authenticated channel—not
merely copied from the package being checked. Review rotation and revocation
updates through that channel. On rotation, mark the old entry `retired` and
optionally record `successorKeyIdSha256`; independently confirm and add the
replacement entry. Use `revoked` for a withdrawn trust decision. Neither a
successor link nor a claimed signing date overrides current status.

Files support 1,024 distinct entries within 4 MiB. Labels and single-line notes
allow 160 and 2,048 characters respectively. Reports include only the matching
entry and the exact file digest. Keep the file and any saved reports under your
own retention policy. No automatic key discovery, key storage or trust refresh occurs.

## Command-family boundaries

- Evidence collection commands retain separate source states. A failed or
  missing supporting source is not converted into absence, availability or a
  favourable score.
- Discover and Certificate Transparency commands produce review candidates.
  Generation, publication and shared infrastructure do not establish ownership,
  control, activity, intent or maliciousness.
- Bulk applies one declared collection contract per target. Fast accepts up to
  500 targets and Deep up to 50; each target remains a separate request.
- Respond commands package browser-created Cases and prepare local packets,
  reports and sharing reviews. They do not create durable Cases, submit,
  publish, notify or grant recipient authorisation.
- Assurance, comparison and calibration commands describe supplied or retained
  evidence. They do not tune the running model, change infrastructure or turn an
  analyst label into observed truth.
- `workflow-plan` lists fixed installed recipes without executing them.
  `workflow-run` executes only installed steps, requires approval for network
  work and pauses at unresolved analyst selections. Repeat
  `--select <step-id>=<path-or-value>` for remaining placeholders in order, or bind
  a compatible earlier output with `--use-artifact <step-id>:<input-number>=<earlier-step-id>`.
  Checkpoints retain exact selections and bindings and distinguish incomplete
  collection from retryable failures; see [resuming a fixed workflow](cli.md#resuming-a-fixed-workflow)
  for the supported versions and resume behaviour.

Use the installed focused help for positional inputs, exact ceilings, options,
network effects, outputs and command-specific exit behaviour.
