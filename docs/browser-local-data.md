# Browser-local data architecture

WHOISleuth keeps ordinary investigation state in the current browser profile.
The server processes bounded requests but does not provide a general case or
workspace database. Users deliberately choose what to retain, export or
delete.

## What is stored

The authenticated Console uses IndexedDB for bounded collections including
Cases, Brand Profiles, watchlists, shortlist entries, campaigns, certificate
search history, custom rules, retained relationship observations, saved Bulk
sessions, website snapshots, investigation templates, Bulk review state, saved Case views and
Analyst Review Item lifecycle state.

Each collection has a canonical owner that declares its current schema,
supported readers, record and byte limits, normalisation rules, future-version
behaviour and write semantics. The generated
[schema inventory](case-contracts.md) and
[privacy catalogue](privacy-data-flow-catalogue.md) project those declarations.

The default and unencrypted named workspaces use the plaintext JSON codec.
Anyone able to use the browser profile, a privileged extension or the device
may be able to read them. Named workspaces can instead use the encrypted codec
described below. Clearing site data removes every local workspace.

Case attachment references contain filenames, declared sources and observation
times, retention times, byte counts and SHA-256 digests. Database version 2 adds
a `files` object store to the existing `records` and `manifests` stores. Original
bytes use binary `ArrayBuffer` values, deduplicated by content within the Case collection;
independent references preserve their own provenance. A metadata revision and
its file writes or removals commit in one transaction. Bytes are removed only
when no Case still references them. Ordinary collection reads do not load file
bodies; selected reads verify both the byte count and digest. Missing or
damaged bodies remain explicit and do not erase their references.

Selection is limited to 128 files and 64 MiB in one operation; the browser's
origin quota also applies. File retention never prunes existing evidence to
make room. JSON backups carry references, not original bytes.

Small tab-scoped handoffs and transient preferences use `sessionStorage` or
`localStorage` only under their documented limits. They are not silently
promoted into workspace evidence.

## Named workspaces

The default workspace retains the original database and legacy keys. Named
workspaces use UUID identities and separate databases with the same collection
definitions, codecs and save coordinator. A version-1 IndexedDB directory holds
up to 1,000 names, identifiers, revision counters and timestamps. Names are
limited to 100 characters. Unknown versions or malformed directory records are
unavailable, not an empty directory.

Each loaded page fixes its workspace from a tab-local selection. Switching
requires a full navigation to the Dashboard; in-flight operations cannot be
retargeted. Guide progress, one-use candidate handoffs and named-workspace Brand
preferences use workspace-scoped session keys. The default Brand preference
keeps its original local-storage key. Appearance remains browser-wide.

A document holds a shared Web Lock while its named workspace is open. Deletion
requires an exclusive lock, refuses an open workspace and marks a directory
record as pending deletion before deleting its database. A blocked or uncertain
deletion retains that state for explicit recovery; it cannot recreate an empty
workspace under the deleted identity. Renames compare directory revisions.
Platforms without Web Locks retain default-workspace support but cannot open,
create or delete named workspaces.

All databases share the origin's browser quota and profile access. Workspace
names alone are not an access-control boundary. Backups do
not include the directory or tab state. Export from each workspace separately
and explicitly select the destination before importing. Named workspaces have
no legacy local-storage copies; the default migration and rollback paths are
unchanged. Clearing browser site data removes every workspace.

### Encrypted working workspaces

An optional named-workspace codec encrypts each bounded JSON record with
AES-256-GCM, a fresh 96-bit nonce and a 128-bit tag. A random 128-bit salt and
600,000 PBKDF2-HMAC-SHA-256 iterations derive separate 256-bit encryption and
authentication keys. Keys are non-extractable and held only in the document.
Record lookup keys use HMAC rather than plaintext identifiers; authenticated
context binds the workspace, collection and record. A keyed collection digest
also binds schema, byte count, record membership and order. Metadata and codec
versions fail closed. Ciphertext encoding overhead has separate bounds and
does not increase decoded evidence limits.

Retained file bodies use the same keys with distinct file-lookup and file
authentication contexts. Their binary envelope contains a 12-byte nonce,
ciphertext and 16-byte tag, without JSON/base64 expansion. Workspace, collection,
content identity and declared byte length are authenticated. A file-only repair
also advances the collection revision so its transaction can be acknowledged.

Creation initialises all encrypted collections before publishing the directory
entry. Opening an existing encrypted workspace requires its collection manifests;
missing manifests are not silently recreated as empty data. A workspace created
before saved Case views can explicitly add that empty collection from the storage
recovery screen. Every other collection must validate; retained records or files
without their manifest prevent creation. The transaction checks absence again
before writing. This does not recover deleted views: those require a backup.
Randomised ciphertext does not turn a semantically unchanged update into another write.

Every tab unlocks independently. Reloading, locking or leaving the console
discards the unlocked document; tab handoffs and Brand selection stay in memory.
Workspace names, collection counts, sizes and timestamps are visible metadata.
Encryption does not prevent deletion or rollback to an older valid copy, and
does not protect an unlocked page or a compromised device. There is no key
escrow or passphrase reset.

Conversion is an explicit backup transfer: export an encrypted backup, create
and unlock a new encrypted workspace, review the import, then check its records.
The original workspace remains unchanged until deliberately deleted. Portable
backups use their existing independent envelope and passphrase, not working
workspace keys. A tested backup can restore into a new workspace if the working
passphrase is lost; no backup means those encrypted records cannot be recovered.

The selected Case identifier lives only in the current page's memory. Its
read-only context uses the canonical Case store, refreshes after Case writes in
the same tab or when the tab regains focus, and clears on reload or sign-out.
This selection neither changes the Case nor authorises a network request.

## Data model and evidence semantics

Stored records retain their own provenance, observation time, completeness,
truncation and limitations. Imported, analyst-authored, provider-reported and
collected evidence remain distinct. Missing or unreadable storage is reported
as unavailable; it does not become an empty collection or evidence of absence.

Cases have individual UUIDs and can share a canonical registrable domain.
Schema 16 can retain
the exact normalised submitted hostname on each new evidence snapshot and the
observation time and explicit review deadline of a response route. Analyst
decisions can retain confidence and its basis. Cases migrated from supported
schemas 12–15 may retain null or unknown values because WHOISleuth does
not reconstruct historical input from weaker fields. Case response histories
are append-only and bounded. Pins and sightings keep unknown observation times
as null, independently of the time the record was saved.

The current workspace archive is version 9. It contains Case schema 16, bounded
analyst review state and saved Case views. Exact workspace versions 5–8 remain
readable and gain an empty saved-views section; version 5 also adds an empty
review-state section without inventing decisions. Brand Profiles write version 9 and read exact
versions 6–8; website snapshots write version 6 and read exact versions 4–5.
Other historical formats and future versions are unsupported.

Native HTML fingerprints use algorithm 2. Public algorithm-1 baselines retain
their hashes and remain readable; HTML-derived comparisons across algorithms
are unavailable rather than a match or a change. Refresh a baseline deliberately
to use the current parser. Exact favicon-byte comparison remains separate.

Saved Bulk schema 5 reads public schema 4; retained relationship schema 2 reads
public schema 1. Current records preserve each contributing source's identity,
state, observation time and completeness. Unknown historical provenance stays
unknown, and a partial source can still support an exact positive pivot. The
archive versions these sections independently; its outer format is unchanged.
An undated pivot's retention event is labelled as an analyst action, never as a
newly dated source observation.

## IndexedDB behaviour

The browser adapter provides:

- one versioned database and manifest per workspace for its bounded collections;
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

The record collections are captured together in one IndexedDB read transaction.
Colour theme, reading density and decorative effects are browser-wide preferences;
the Appearance control applies them without changing evidence or collection. Density
and effects stay on this browser and are not included in workspace backups.
Theme and active-profile preferences are read separately from their scoped storage;
the exported active profile must exist in the captured profile collection.
Backups use compact JSON, with a 32-MiB archive limit and a 5-MiB limit per
section. Previously formatted JSON backups remain readable. Encryption adds
base64 encoding and authenticated-envelope metadata to the file size.

Import validates the complete envelope and section checksums into a page-local
snapshot. Selection previews reuse that snapshot and reread local records;
application merges with current records inside the storage transaction.
The preview reports additions, conflicts, skips,
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

JSON storage and archive readers derive aggregate parsing work from those
byte limits, while retaining independent nesting and per-container limits.
The writer checks the same admission policy before committing; adding an
ordinary field does not require another hand-maintained object-count allowance.
Bulk sessions can retain up to 2,000 rows when the complete store fits 4 MiB.
Schema 5 stores identical row Profile context once on the session; mixed contexts
remain per-row. The collection reader restores complete rows before application
use. Schema 4 still requires its original explicit row context.

Brand Profiles can retain up to 100 profiles in a 4-MiB collection; profile-file
imports allow 32 MiB, including formatting and export metadata. Imports also
enforce record, nesting and text limits.

Histories are stored in the same atomic collection records. Normalisation and
storage-pressure reporting perform no network operation.

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
