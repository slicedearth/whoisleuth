# Browser-local data architecture

WHOISleuth keeps ordinary investigation state in the current browser. This
preserves the default privacy and cost boundary. The application now uses one
asynchronous native IndexedDB provider for its bounded investigation
collections. This document records that contract, the one-time migration from
the former local-storage documents, and the separate gate for an encrypted
browser vault.

## Current evidence

The owning browser-store models declare these independent serialised ceilings:

| Collection | Current backend | Declared ceiling |
| --- | --- | ---: |
| Cases | IndexedDB | 4 MiB |
| Watchlists | IndexedDB | 2 MiB |
| Brand Profiles | IndexedDB | 1 MiB |
| Campaigns | IndexedDB | 0.5 MiB |
| Shortlist | IndexedDB | 1 MiB |
| Certificate Transparency history | IndexedDB | 1 MiB |
| Detection rules | IndexedDB | 0.25 MiB |
| Retained relationship observations | IndexedDB | 0.75 MiB |
| Saved Bulk sessions | IndexedDB | 4 MiB |
| Website profile snapshots | IndexedDB | 0.5 MiB |
| Investigation templates | IndexedDB | 0.25 MiB |
| Bulk review views and queue state | IndexedDB | 0.5 MiB |

The combined declared ceiling is 15.75 MiB. These are safety limits rather than
expected usage, and a browser may enforce a different origin quota. However,
the aggregate exceeds the 5 MiB planning reference used by the former
local-storage design. The model ceilings still apply in IndexedDB so changing
the backend does not make any collection unbounded.

Certificate Transparency history schema 2 records a bounded per-query count
when older check summaries are discarded by the event or byte limit. Reaching
the 20-check capacity is therefore distinct from confirmed pruning. Schema 1
records remain readable and migrate non-destructively with earlier pruning
certainty marked unknown rather than invented as zero.

Saved Bulk session schema 3 adds an optional compact comparison envelope to
each settled Deep row. It retains at most 12 normalised technology identifiers,
a bounded TLS issuer label, an exact SPKI SHA-256 fingerprint, and independent
source states. Schemas 1 and 2 remain readable and are normalised without
inventing the fields. The envelope does not contain raw page, script,
certificate, TLS, WHOIS, RDAP, or contact data.

Investigation search still builds a disposable bounded projection from cases,
campaigns, Brand Profiles, and analyst-selected relationship observations.
Retained relationship observations first pass through a versioned, typed common
evidence envelope in memory. That incremental adapter preserves source schema,
observation time, completeness, truncation, derivation, and limitations before
the existing search and graph projection consumes it. The envelope has explicit
record and byte accounting, refuses malformed or future source schemas, makes
no network request, and performs no writes. It is not a new collection:
IndexedDB records and the workspace archive remain authoritative, and
discarding the projection leaves them unchanged.

Individual records are stored under stable collection keys, and workspace
imports can update several collections in one IndexedDB transaction.
Website-profile snapshots retain at most 60 explicit analyst saves and 12 per
canonical domain. They contain curated technology identifiers, posture states,
identity digests, source health, timestamps, completeness markers and an
optional normalised leaf-certificate observation from the same completed Deep
Lookup rather than raw lookup responses or certificate bytes.
Investigation templates retain at most 20 analyst-authored variants of the
three built-in guides. They can customise bounded guidance, omit allowlisted
steps, and add approval gates, but cannot introduce arbitrary actions, run
code, start collection, submit evidence, or remove a mandatory request gate.

Run the deterministic evaluation without reading browser data:

```bash
npm run platform:local-data
npm run platform:local-data -- --json
```

The versioned report derives its byte totals from the owning model constants.
It performs no network requests, reads no browser records, and changes no
production storage. It remains a capacity regression check rather than the
active-provider selector.

## Decision

Use the dependency-free native IndexedDB provider for ordinary persistent
investigation collections.

IndexedDB is a same-origin, asynchronous, transactional browser database with
object stores and indexes. It addresses the demonstrated aggregate-capacity
and whole-document-query constraints while retaining local-only operation. The
browser tests verify opening a temporary database, one-time legacy migration,
atomic multi-record commits, keyed and indexed reads, rollback after an aborted
transaction, quota failure, retained legacy input, deletion, cleanup, and
bounded operation deadlines.

Production browser-local operations use a bounded ten-second deadline. This
still fails closed instead of waiting indefinitely while allowing ordinary
manifest and record transactions to finish on slower mobile devices or under
temporary browser contention.

A wrapper library such as Dexie is not required for this capability. It may be
reconsidered if the production adapter, schema upgrades, or transaction code
becomes difficult to maintain. Adding it before that evidence would increase
the dependency and upgrade surface without changing the underlying browser
storage guarantees.

SQLite compiled to WebAssembly is deferred. Its bundle, worker, browser
filesystem, compatibility, and recovery costs are not justified by the current
query model.

## Production contract

The provider:

1. Remain asynchronous and provider-neutral so browser storage details do not
   leak through every component.
2. Preserve the existing model normalizers, schema versions, bounds, pruning,
   future-version refusal, and stable quota errors as the authority for each
   collection.
3. Use bounded collection and keyed reads. Unbounded cursors or whole-database
   exports are not acceptable.
4. Provide explicit atomic transactions when one action changes related
   collections.
5. Keep the workspace archive as the deliberate portable backup and recovery
   format.
6. Report unavailable, blocked, quota, migration, and unsupported-schema states
   explicitly. It must not silently present an empty workspace after a failed
   read.
7. Keep all ordinary records same-origin and browser-local. No server sync,
   analytics, hosted custody, or background upload follows from this decision.

## Migration and rollback

The migration is non-destructive and resumable:

1. Read and normalise each supported legacy document through its existing
   model.
2. Write the bounded records and a migration manifest in one IndexedDB
   transaction.
3. Read the records back and verify collection counts, schema versions, and
   deterministic digests before switching the active provider.
4. Leave the legacy documents intact. IndexedDB becomes authoritative after a
   successful migration, so later application writes do not silently rewrite
   those retained source documents.
5. Refuse to overwrite a newer unsupported record in either backend.
6. Preserve workspace archive export and import. The Dashboard can also update
   all legacy documents from the current IndexedDB state before a deliberate
   return to an older build. That compatibility copy is bounded by
   local-storage quota and does not replace a downloaded workspace backup.

The manifest records the schema, codec, revision, source, record count, byte
count, retained legacy digest, and a SHA-256 digest of the ordered encoded
records. The digest detects accidental corruption and unsynchronised mutation;
it is not a secret or an authentication boundary against code already running
on the same origin.

## Encrypted portable archives

Dashboard offers an optional encrypted wrapper around the ordinary checksummed
workspace archive. Encryption and decryption happen in the browser through
native Web Crypto. Version 1 uses PBKDF2-HMAC-SHA-256 with 600,000 iterations,
a fresh 16-byte salt, and AES-256-GCM with a fresh 12-byte initialisation
vector and 128-bit authentication tag. The schema, version, creation time,
content contract, key-derivation parameters, salt, cipher parameters, and
initialisation vector are authenticated as additional data.

The envelope is bounded to approximately 13.4 MiB around the existing 10 MiB
plaintext archive limit. It accepts only its fixed version 1 algorithm contract
and canonical base64url fields before performing password work. Import then
passes the decrypted document through the ordinary archive byte, manifest,
checksum, schema, preview, and non-destructive merge checks.

The threat model is deliberately narrow:

- it protects the downloaded file while the file is locked and its passphrase
  is unknown;
- the passphrase and derived key stay in memory, are not persisted, are not
  sent to the server, and are cleared from the form after each attempt;
- a forgotten passphrase is not recoverable;
- a wrong passphrase and corrupted authenticated ciphertext produce the same
  error;
- it does not protect the active plaintext IndexedDB workspace, an unlocked
  Console, a compromised same-origin page, a malicious browser extension,
  device malware, a keylogger, or a weak or reused passphrase; and
- unencrypted archive versions 1 through 5 remain importable, without inventing
  sections that those formats did not contain, and an unencrypted current
  archive can still be downloaded through a separately labelled compatibility
  action.

## Separate decisions

- **IndexedDB vault:** Version 1 still stores normalised records as plaintext
  JSON inside the browser database. Portable archive encryption does not change
  that boundary. An optional encrypted live vault would still require a
  separate passphrase and recovery design, opaque or blind lookup keys,
  auto-lock behaviour, rekeying, and performance tests. A key or passphrase must
  not be persisted beside the ciphertext. Encryption cannot protect records
  while the vault is unlocked from same-origin script or a malicious browser
  extension.
- **PWA support:** Offline installation, caching, and service-worker lifecycle
  are independent from local database selection.
- **Synchronisation:** IndexedDB remains tied to one origin and browser profile.
  Cross-device or collaborative work would require a separately approved
  identity, custody, conflict, retention, and cost model.
- **Durability:** Browser storage can still be cleared or evicted. A workspace
  archive remains the portable backup boundary.
