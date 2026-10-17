# WHOISleuth CLI

Investigate domains, IP addresses and ASNs from your terminal, review selected
local files, and prepare evidence for a browser or offline handoff. Networked
commands run from your computer; offline commands read selected local input.
The CLI does not use the hosted WHOISleuth login or workspace.

[CLI guide](https://github.com/slicedearth/whoisleuth/blob/main/docs/cli.md) ·
[Searchable commands](https://www.whoisleuth.com/cli) ·
[Compatibility reference](https://github.com/slicedearth/whoisleuth/blob/main/docs/cli-reference.md)

## Install and update

Use Node.js 24 or later. Run without a global installation:

```bash
npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help
```

Or install the `whoisleuth` command globally:

```bash
npm install --global --ignore-scripts @slicedearth/whoisleuth-cli
whoisleuth --version
whoisleuth doctor
```

Update an existing installation with
`npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest`, then
check `whoisleuth --version` and `whoisleuth doctor` again. The package requires
no lifecycle scripts; its version follows the application version.

## First commands

Browse the installed commands and plan a Lookup without collecting:

```bash
whoisleuth commands --common
whoisleuth lookup example.test --plan --json
```

For a target you are authorised to assess, use Fast or Deep Lookup:

```bash
whoisleuth example.test
whoisleuth lookup example.test --deep --summary
```

Fast is registration-first; Deep adds the applicable DNS, website, TLS and
other declared sources. `whoisleuth <command> --help` explains that command's
inputs, request boundaries, output formats and exit policy.

## Save, verify and continue in the browser

Save a private Lookup by closing the interactive evidence browser normally,
verify it offline, then create the separate browser-compatible export:

```bash
whoisleuth lookup example.test --deep --browse --save-lookup lookup.json
whoisleuth verify-artifact lookup.json --json
whoisleuth export lookup.json --output evidence.json
whoisleuth verify-artifact evidence.json --json
```

In the console's Lookup page, open **Replay exported evidence** and select
`evidence.json`. Review its digest and source states before retaining evidence
in a case. Keep `lookup.json` as the private CLI original; it can contain raw
registration responses and is not the browser replay format. The evidence
export excludes raw registration payloads and expanded contacts; replay does
not upload either file.

## Work with selected files

```bash
whoisleuth bulk domains.txt --csv-with-metadata
whoisleuth mail-headers message.eml --json
whoisleuth compare lookup.json --json
```

`domains.txt` contains one target per line. `message.eml` is a message file you
select for local review. `lookup.json` is the saved CLI document from the
example above. Bulk performs collection; the mail-header and comparison
commands in this example are offline.

Use `whoisleuth commands --group respond --mode offline` to find local case,
packet and handoff tools. The [case-file guide](https://github.com/slicedearth/whoisleuth/blob/main/docs/cli.md#local-case-files)
covers ordinary case files, JSON inputs and conflict handling. Output written
with `--output` is private and atomic, and existing files require explicit
`--force`. A completed command can still contain partial source evidence.

## Separate tools and security

The [rendered-capture companion](https://github.com/slicedearth/whoisleuth/tree/main/packages/web-capture)
and [filesystem-local application](https://github.com/slicedearth/whoisleuth/tree/main/packages/local-application)
are separate, locally assembled archives—not included in this CLI or published
as npm packages. Their guides cover installation and their distinct storage
and collection boundaries.

The package also includes `docs/cli.md` and `docs/cli-reference.md` for offline
reading. Report suspected vulnerabilities through the private channel in the
[security policy](https://github.com/slicedearth/whoisleuth/blob/main/SECURITY.md).

Copyright 2026 slicedearth. Licensed under
[AGPL-3.0-only](https://github.com/slicedearth/whoisleuth/blob/main/LICENSE).
