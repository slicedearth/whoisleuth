# Browser-local data architecture

WHOISleuth keeps ordinary investigation state in the current browser profile.
The server processes bounded requests but does not provide a general case or
workspace database. Users deliberately choose what to retain, export or
delete.

## What is stored

The authenticated Console uses IndexedDB for bounded collections including
Cases, Brand Profiles, watchlists, shortlist entries, campaigns, certificate
search history, custom rules, retained relationship observations, saved Bulk
sessions, website snapshots, investigation templates, Bulk review state and
Analyst Review Item lifecycle state.

Each collection has a canonical owner that declares its current schema,
supported readers, record and byte limits, normalisation rules, future-version
behaviour and write semantics. The generated
[schema inventory](case-contracts.md) and
[privacy catalogue](privacy-data-flow-catalogue.md) project those declarations;
this document does not duplicate their complete tables.

The active IndexedDB codec is plaintext JSON. Browser access controls protect
the profile boundary, but IndexedDB is not encrypted at rest by WHOISleuth.
Anyone able to use the browser profile, a privileged extension or the device
may be able to read it. Clearing site data removes the local workspace.

Small tab-scoped handoffs and transient preferences use `sessionStorage` or
`localStorage` only under their documented limits. They are not silently
promoted into workspace evidence.

## Data model and evidence semantics

Stored records retain their own provenance, observation time, completeness,
truncation and limitations. Imported, analyst-authored, provider-reported and
collected evidence remain distinct. Missing or unreadable storage is reported
as unavailable; it does not become an empty collection or evidence of absence.

Cases remain keyed by canonical registrable domain while schema 13 can retain
the exact normalised submitted hostname on each new evidence snapshot. A Case
migrated directly from public schema 12 may retain a null hostname because
WHOISleuth does not reconstruct historical input from weaker fields. Case
response histories are append-only and bounded.

The current workspace archive is version 6. It contains Case schema 13 and a
bounded analyst review-state section. Exact public workspace version 5 with
Case schema 12 remains readable and migrates directly without inventing review
decisions. The Brand Profile contract similarly reads exact public version 6
and writes version 7. Other reader-only historical formats and unreleased
checkpoints are unsupported.

## IndexedDB behaviour

The browser adapter provides:

- one versioned database and manifest for the bounded workspace collections;
- exact keyed reads rather than full-database scans for ordinary operations;
- transactions for multi-record changes and archive application;
- deterministic record and byte accounting before writes;
- quota-aware failures that preserve the prior committed state;
- bounded retries for concurrent-tab conflicts;
- explicit deadlines instead of indefinite waits;
- non-destructive future-version refusal; and
- deletion and clear-all operations owned by the relevant workspace surface.

All untrusted stored and imported values are bounded before expensive
normalisation or merge. Accessors, sparse arrays, custom prototypes, excessive
nesting, oversized collections and unknown envelope keys fail closed. Returned
domain graphs are detached from caller-owned input and frozen where their
contract promises immutability.

Post-write failures do not report a committed mutation as absent. Concurrent
updates use the collection's revision and conflict policy rather than silently
overwriting a newer value. A failed read or quota error remains visible to the
interface.

## Migration from legacy browser storage

On the first authenticated load after the IndexedDB transition, WHOISleuth:

1. reads each supported legacy local-storage document within its byte and
   structure limits;
2. normalises only versions explicitly supported by that collection owner;
3. writes the bounded records and migration manifest atomically;
4. verifies the committed manifest and record identities; and
5. leaves the source documents untouched.

IndexedDB becomes authoritative after successful migration. Later writes do
not automatically rewrite the retained legacy documents. The Dashboard can
deliberately refresh compatible legacy copies before returning to an older
build, subject to local-storage quota; a downloaded workspace remains the safer
portable backup.

A malformed, unsupported or future source never triggers an empty replacement,
reset or deletion. Browser-store future versions are preserved without write.
Portable future archives are rejected before preview or merge.

## Workspace export, import and recovery

A workspace export is a deliberate local download. Its versioned manifest
records the selected sections, codec, counts, byte totals and ordered SHA-256
digests. Digests detect corruption or mismatched content; they do not establish
authorship, truth or confidentiality.

Import validates the complete envelope and selected sections before applying a
non-destructive merge. The preview reports additions, conflicts, skips,
unavailable sections and unsupported versions. Omission does not delete local
data. Settings are resolved after section selection so a deselected or rejected
Brand Profile cannot supply an active-profile preference.

The recommended portable backup wraps the ordinary archive with
PBKDF2-HMAC-SHA-256 and AES-256-GCM in the browser. The passphrase and derived
key are not persisted or sent. The encrypted envelope remains version 1 and
authenticates its embedded supported workspace document. Encryption protects
the downloaded file while locked, not the active IndexedDB database, an open
Console, a compromised device, a malicious extension or a weak passphrase.

An explicitly labelled unencrypted export remains available. Separately
downloaded archives remain under the user's retention and deletion control.

## Capacity and storage pressure

Collection-specific limits are enforced before accumulation. WHOISleuth does
not assume the browser's available quota and cannot guarantee that every
browser or private-browsing mode will persist IndexedDB. The interface reports
quota, blocked, unavailable and timeout states and does not prune evidence
silently.

Histories remain in the existing atomic records. The current design adds no
second database, synchronisation service, hosted custody or background network
operation.

## Separate storage boundaries

Optional hosted monitoring is not part of the ordinary browser workspace. It
stores only its documented compact application-encrypted projection and
bounded object metadata under operator control. Disabling monitoring does not
delete retained ciphertext.

CLI files, downloaded exports and optional rendered captures are also separate.
They remain on the operator's filesystem until the operator deletes them and
are never copied into IndexedDB automatically.

See the [privacy notice](../PRIVACY.md), [threat model](threat-model.md) and
[operations guide](operations.md) for disclosure, security and hosted-retention
details.
