# Contextual evidence reviews

Cases → Evidence → **Specialist evidence reviews** offers incident-sequence, domain-history,
platform-object, storefront and connector reviews. Inputs stay in page memory until you
save or download. Saved reports use the existing Case attachment and evidence
summary controls; select the report file explicitly when preparing a response
packet. Switching tasks or Case sections preserves opened drafts; leaving the Case
discards them. Save the review in the Case, download its JSON, or print a summary.
Reusable inputs are a separate download. Storefront columns keep unreviewed fields
distinct from reviewed fields with no values; platform histories separate report
status, provider response and independent recheck. Sources and interpretation are
available beneath each review, with exact observation times and citation copying.

The CLI uses the same models:

```sh
whoisleuth review-evidence selected-input.json --json --strict-exit
```

Each input has `schema`, `version: 1` and `evidence`. Unknown versions and fields
are rejected. Inputs are bounded to 16 MiB; each supplied context list permits
200 records. `--strict-exit` returns 4 for a partial contextual review. Neither
adapter contacts a destination or executes selected software.

## Incident sequence

Build an analyst-ordered sequence from retained Case pins, imported records and
reported actions. A retained pin supplies its own source, time, completeness and
limitations; unknown times stay unknown. Reordering is deliberate, and reversed
timestamps are flagged without rewriting the sequence. A displayed instruction
is not recorded as a person having followed it.

Schema: `whoisleuth.incident-sequence.input`. `evidence` is an array:

```json
{
  "schema": "whoisleuth.incident-sequence.input", "version": 1,
  "evidence": [{
    "id": "stage-1", "kind": "credential_entry", "basis": "reported_action",
    "description": "The reporter entered a password into the displayed form.",
    "occurredAt": null, "hostname": "example.test",
    "source": "Reporter interview", "reference": "interview-17",
    "referenceSha256": null, "completeness": "unknown",
    "limitations": ["Event time not supplied."]
  }]
}
```

Kinds cover messages, navigation, identity prompts, credential entry, consent,
browser instructions, clipboard events, local execution, payment, recovery and
other events. Basis is `retained_observation`, `imported_record` or
`reported_action`. Reference hashes identify the supplied record; they do not
authenticate its source. Save the reusable input with the review to continue
later. These stages never execute a command, submit a form or open a destination.

## Domain history and retirement

The Case view compares retained snapshots using the existing source, hostname,
scan-depth and model-version rules. Registration, DNS, mail and web changes are
shown alongside source-qualified certificate pins. Equal-time observations are
not ordered into a change sequence. Retired dependencies must involve the Case
domain or one of its hostnames. An expected window qualifies the review; it does
not approve a change automatically or establish transfer or takeover.
Review prompts connect comparable page, mail, delegation and registration changes
to the retained concern. Incomplete comparisons remain visible. A changed creation
date asks for reassessment of earlier decisions without asserting a new owner,
resetting a baseline or discarding history; expiry alone never establishes deletion.

Schema: `whoisleuth.domain-history.input`. Its `evidence` contains:

- `caseExport`: an ordinary supported editable Case export, with `version` and
  `cases`; the exact existing Case reader rejects data loss or silent repair.
- `caseId`: the Case selected from that export.
- `declarations`: `expectedChanges` and `retiredDependencies` arrays.

An expected change is `{family, start, end, reason}`. A retired dependency is
`{asset, dependency, family, retiredAt, source}`. Families are `registration`,
`dns`, `mail`, `certificate` and `web`; times are explicit ISO timestamps. The
reusable input download includes the selected Case and is not duplicated in
workspace storage when saving the report.

## Platform objects

Schema: `whoisleuth.platform-continuity.input`. `evidence` is an array:

```json
{
  "schema": "whoisleuth.platform-continuity.input",
  "version": 1,
  "evidence": [{
    "platformOrigin": "https://platform.example.test",
    "objectType": "extension", "objectId": "extension-17", "version": "1.0.0",
    "observedAt": "2026-09-22T00:00:00.000Z", "source": "Selected manifest",
    "report": "acknowledged", "providerOutcome": "provider_reports_resolved",
    "recheck": "not_checked", "recheckedAt": null
  }]
}
```

Object types include account, tenant, application, extension, package, page,
channel and post. Identity is scoped to platform origin and object type, not a
URL alone. Version is nullable. Report status is `not_reported`, `submitted` or
`acknowledged`. Provider outcomes and independent rechecks use the existing Case
response vocabulary. A recheck needs its own time; provider resolution does not
establish removal. Save or download the reusable input to add later observations.

## Storefronts

Schema: `whoisleuth.storefront-review.input`. `evidence` contains `official`,
`candidate`, `authorisedComparator: true`, `resellerStatus` and `resellerSource`.
Reseller status is `authorised`, `not_authorised` or `unknown`; a non-unknown
declaration needs a source. Both observations use this shape:

```json
{
  "hostname": "shop.example.test",
  "observedAt": "2026-09-22T00:00:00.000Z", "source": "Selected capture",
  "brandNames": ["Example shop"], "contactDomains": ["example.test"],
  "policyHashes": null, "checkoutOrigins": ["https://checkout.example.test"],
  "paymentMethods": ["card"], "assetHashes": null
}
```

Null means not reviewed; an empty array means no values were recorded. Policy
and asset hashes are lowercase hexadecimal SHA-256. Checkout values are origins
only. Exact shared values are displayed without a combined scam score. Check
reseller, affiliate and regional-store authority before preparing a complaint.

## Connectors

Schema: `whoisleuth.connector-review.input`. `evidence` contains `current` and
nullable `previous` configuration objects, each with exactly one `mcpServers`
or `servers` map. Select that section rather than unrelated application settings.

```json
{
  "schema": "whoisleuth.connector-review.input", "version": 1,
  "evidence": {
    "current": {"mcpServers": {
      "remote": {"url": "https://connector.example.test/service"},
      "local": {"command": "npx", "args": ["--yes", "@example/connector@1.0.0"]}
    }},
    "previous": null
  }
}
```

The browser accepts the configuration itself. Reports retain names, endpoint
origins, executable basenames, recognised package identities, declared
capabilities and metadata counts. They exclude local paths, argument contents,
environment values, header values, authentication material and URL paths or
queries. Raw configuration is not saved with the report. Matching retained
metadata does not mean excluded values are unchanged. No command, connector,
tool, prompt or model is run; declarations are not negotiated capabilities or a
safety assessment.
