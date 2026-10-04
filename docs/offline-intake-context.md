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

### Supplied phone candidates

Plain-text intake can also identify possible telephone numbers, including a
support number in a supplied snippet with no link. Candidates are review leads:
they do not authenticate a caller, identify an operator or establish wrongdoing.
No number is dialled, resolved or checked against a reputation service.

Review and select each observation deliberately before including it in a saved
review. Unselected candidates remain transient. The selected observation keeps
its original spelling, source digest and exact text range, not the surrounding
snippet. Text ranges use zero-based, end-exclusive UTF-16 code-unit offsets;
supplementary characters occupy two units. A declared source time is separate
from the local review time. Identify manual transcription or OCR-derived text
when that is how the supplied text was obtained.

An advertised support contact and a sender or caller-ID claim describe different
roles; neither verifies ownership. International formatting can be compared only
where its prefix and supported separators permit a defensible normalisation.
National-format numbers, conflicting country context and unsupported characters
remain uncertain. Extensions are separate, not appended to the destination.
Dates, identifiers and unsupported forms must not be treated as verified numbers.

Selected numbers can still be private contacts. Review the selected content
before saving or sharing it. Ordinary public/trusted Case projections do not
include the private intake attachment; domain-focused interchange does not invent
a telephone mapping. A missing exported phone observation is not evidence that
none was supplied.

### Compare a displayed claim with a supplied destination

Use the intake's manual destination comparison when supplied ad, search or
screenshot material shows one destination and a separate source supplies another.
Identify each source, any known observation time, and whether its text is a claim,
transcription or supplied observation. The comparison uses the same safe hostname
parsing as an HTML link's displayed-host comparison.

Review the exact hostname and registrable boundary. A hostname such as
`store.example.test.attacker.invalid` is not `store.example.test`. Legitimate
tracking destinations can also differ. Missing, malformed or credential-bearing
input leaves insufficient evidence rather than inventing a redirect chain.

Exact entered URLs stay in the private transient view. Retained output uses the
minimised hostname/origin projection and supplied qualifications, not private
paths, query values or fragments. Comparing the pair never follows either URL
and does not establish that a redirect occurred.

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

### Select phone observations in the CLI

First run `whoisleuth intake text selected.txt --json`. Standard error shows a
candidate count, the full source digest, UTF-16 ranges and uncertainty, but not
the numbers themselves. JSON output excludes unselected candidates. `--quiet`
suppresses this discovery guidance. Inspect the corresponding text in your
selected file before choosing a range.

A version-2 context file binds selections to those exact input bytes. For
example, a file containing `Support: +1 202 555 0107` followed by one LF newline
has this selection:

```json
{
  "schema": "whoisleuth.intake-context",
  "version": 2,
  "context": null,
  "review": {
    "sourceDigestSha256": "sha256:4ff4224ff4ed496fb67fa2ccb25f87b284d1d291f8e79b57646d6c32700eeb52",
    "phones": [{
      "start": 9,
      "end": 24,
      "declaration": {
        "sourceLabel": "Selected support snippet",
        "observedAt": null,
        "basis": "supplied_text",
        "role": "advertised_support_contact",
        "countryCallingCode": null
      }
    }],
    "destinationPair": null
  }
}
```

Run the earlier `--intake-context context.json` command to include that selected
observation. A changed file or incorrect range is rejected; obtain its current
digest and review it again. `context` can also carry the existing distribution
declaration. Version-1 context files remain supported.

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
