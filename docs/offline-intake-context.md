# Selected-input indicators and internal containment

Message intake remains local and inert. It does not resolve indicators, open
links, consult reputation services, execute attachments or apply controls.

## Source-linked indicator review

Version 2 of `whoisleuth.message-intake` adds literal IPv4/IPv6 observations and
explicitly labelled MD5, SHA-1 and SHA-256 strings from selected plain text,
message body text, supported calendar fields and extracted document text.
Private and reserved addresses are valid textual observations, not permission
to contact them. A labelled hash string is a supplied claim, not proof that a
file has that digest. Bare opaque hexadecimal values are not interpreted.

Each indicator identifies its input/message/document part and page when known.
The review retains the source-byte and part digests separately. Identical values
from different parts remain separately attributed; repeated identical values
within one part are deduplicated. The UI can copy a source citation. Indicators
are not added to Lookup targets and do not become a risk score or finding.

Complete URL spans, address local parts, recognised credential-bearing lines,
message headers, script/style content and QR payloads are not scanned for
indicators. HAR and identity-event imports keep their existing restricted
projections: no broad scan of their original fields occurs. Extraction is
limited to 512 observations, 4,096 candidate checks and 2,097,152 text code
units across an input. Reached bounds are partial coverage, never proof that
no further indicators exist.

Version-1 reports remain readable without invented indicator coverage. Their
original source digests do not acquire new observations retrospectively.

## Optional distribution declarations

After reviewing input in Lookup or a Case, open **Declare distribution
context**. Supply a channel, non-sensitive source label and optional declared
time, reference, observer and vantage labels. Apply or clear changed declarations
before saving or downloading. These are analyst claims, not verified delivery,
capture conditions, network location or independent collection. The local review
time remains separate from a declared observation time.

The CLI accepts the same explicit declaration:

```sh
whoisleuth intake text selected.txt --intake-context context.json --json
```

```json
{
  "schema": "whoisleuth.intake-context",
  "version": 1,
  "context": {
    "channel": "sms",
    "observedAt": "2026-01-02T03:04:05.000Z",
    "sourceLabel": "Reported message",
    "reference": "CASE-17",
    "observerLabel": "Reviewer A",
    "vantageLabel": "Selected device"
  }
}
```

The separate context file is limited to 8 KiB; stdin is not accepted for it.
Use `null` for unknown optional values. Channels are `email`, `sms`, `messaging`,
`social`, `advertisement`, `website`, `document`, `other` and `unknown`.
Do not supply credentials, recipients, personal account identifiers or exact
URLs in labels. All declarations are included in the downloaded or deliberately
retained review. The Case summary pin contains counts and the report identity,
not the indicator values or declaration text. Retaining original input remains
a separate choice.

## Selected internal containment handoff

In **Case → Response → Account and device recovery**, open **Prepare an internal
containment handoff**. Select retained next-step assertions and, independently,
their linked evidence pins. Choose security operations, identity response,
endpoint response or network response for tailored review guidance.

The preview displays the selected statements, rationale, recorded state,
times, pin values and source metadata. **Exact JSON disclosure** exposes the
complete download, including selected pin scope, provenance and recheck fields.
Supports, contradicts, unresolved and
unrecorded relationships remain distinct. A linked pin that is not selected is
not silently included; an unavailable referenced pin remains unavailable.
The handoff is limited to 20 requests, 40 pins and 128 KiB, with no silent
truncation. No original file bytes or unrelated Case notes, title, contacts,
recipient values, assertions or pins are included.

Review the audience disclosure before copy, download or explicit retention.
Internal and trusted audiences use the existing Case disclosure policy. Public
preview excludes internal requests and supporting pins and cannot produce a
containment export. Selected analyst text may still be sensitive: minimisation
does not provide anonymisation. Saving uses an ordinary retained Case file and
a source-hashed summary pin, not another task or state store.

The existing `review-evidence` CLI command accepts an equivalent selected input:

```json
{
  "schema": "whoisleuth.internal-containment.input",
  "version": 1,
  "caseExport": { "version": 18, "cases": [] },
  "caseId": "selected-case-id",
  "selection": {
    "audience": "internal",
    "recipientRole": "identity_response",
    "assertionIds": ["selected-next-step-id"],
    "evidencePinIds": ["selected-linked-pin-id"]
  },
  "disclosureReviewed": true
}
```

Replace the empty example with a supported ordinary Case export and exact
retained IDs after reviewing its selected content. The CLI does not write the
Case; `--strict-exit` returns 4 when selected supporting context is incomplete.
Output uses `whoisleuth.internal-containment` version 1 inside the existing
offline-review envelope. Neither external resolution nor a resolved Case closes
an open internal request. The handoff performs no assignment, notification,
blocking, credential change, isolation or other containment action.
