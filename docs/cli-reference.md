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

Public releases require Node.js 24 or later. Release verification uses the
exact Node.js 24 maintainer runtime and separately exercises the installed
package on Node.js 26:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth doctor
```

The scoped package and application share one semantic version. The package
requires no dependency lifecycle scripts and does not call the hosted
WHOISleuth deployment. From a repository checkout, replace `whoisleuth` with
`node bin/whoisleuth.mts`.

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

`dnssec-validate` and `mail-transport` are isolated authorised actions. Both
require a selected literal public resolver, a local trust-anchor document and
`--owned-or-authorized`; mail transport also requires `--active-probe`. Mail
transport handles at most three selected MX hosts sequentially, sends `EHLO`
and uses `STARTTLS` only when advertised. It does not send mail, authenticate,
test relay, enumerate recipients or retry automatically. DNSSEC, TLSA/DANE,
PKIX, STARTTLS and SMTP transport remain separate evidence states.

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

Terminal text is the default. JSON, JSONL, CSV, Markdown, HTML and domain-only
formats are available only where the installed command declares them.
Redirected and machine output contains no ANSI or progress text. Diagnostics
and optional target-free `--events` output use standard error.

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

`inspect-archive` reads current workspace archive v7 and exact versions 5 and 6. It
reports section metadata and digest-only search results unless `--reveal` is
explicitly selected. It never searches notes, contacts or arbitrary raw fields.

`export` reads supported saved Lookup v1 or v2 and writes current Lookup
evidence schema 27. Exact public schema 26 remains readable and can contain
public contact fields; current schema 27 excludes raw registration payloads,
expanded contacts, credentials, complete query-bearing URLs and provider
payloads.

`verify-artifact` checks a recognised structure and its applicable integrity
contract. `interchange-report` describes retained and omitted fields.
`sign-artifact` and `verify-signature` keep artefact validity, signature
validity and signer trust separate. None of these checks establishes that
evidence is accurate, current, safe to share or attributable to a person.

## Command-family boundaries

- Evidence collection commands retain separate source states. A failed or
  missing supporting source is not converted into absence, availability or a
  favourable score.
- Discover and Certificate Transparency commands produce review candidates.
  Generation, publication and shared infrastructure do not establish ownership,
  control, activity, intent or maliciousness.
- Bulk applies one declared collection contract per target. Fast accepts up to
  500 targets and Deep up to 50; each target remains a separate request.
- Respond commands prepare local Cases, packets and sharing reviews. They do not
  submit, publish, notify or grant recipient authorisation.
- Assurance, comparison and calibration commands describe supplied or retained
  evidence. They do not tune the running model, change infrastructure or turn an
  analyst label into observed truth.
- `workflow-plan` lists fixed installed recipes without executing them.
  `workflow-run` executes only installed steps, requires approval for network
  work and pauses for analyst-selection placeholders.

Use the installed focused help for positional inputs, exact ceilings, options,
network effects, outputs and command-specific exit behaviour.
