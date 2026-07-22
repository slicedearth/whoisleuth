# Browser-local data architecture

WHOISleuth keeps ordinary investigation state in the current browser. This
preserves the default privacy and cost boundary. The application now uses one
asynchronous native IndexedDB provider for its bounded investigation
collections. This document records that contract, the one-time migration from
the former local-storage documents, and the separate gate for an encrypted
browser vault.

## Current evidence

The owning browser-store models declare these independent serialized ceilings:

| Collection | Current backend | Declared ceiling |
| --- | --- | ---: |
| Cases | IndexedDB | 4 MiB |
| Watchlists | IndexedDB | 2 MiB |
| Brand Profiles | IndexedDB | 1 MiB |
| Campaigns | IndexedDB | 0.5 MiB |
| Shortlist | IndexedDB | 1 MiB |
| Certificate Transparency history | IndexedDB | 1 MiB |
| Detection rules | IndexedDB | 0.25 MiB |

The combined declared ceiling is 9.75 MiB. These are safety limits rather than
expected usage, and a browser may enforce a different origin quota. However,
the aggregate exceeds the 5 MiB planning reference used by the former
local-storage design. The model ceilings still apply in IndexedDB so changing
the backend does not make any collection unbounded.

Investigation search still builds a disposable bounded projection from cases,
campaigns, and Brand Profiles. Individual records are stored under stable
collection keys, and workspace imports can update several collections in one
IndexedDB transaction.

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

1. Read and normalize each supported legacy document through its existing
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

## Separate decisions

- **Encryption:** Version 1 stores normalized records as plaintext JSON inside
  the browser database. IndexedDB does not provide application-level
  encryption. The provider separates record persistence from a versioned codec
  so an optional encrypted vault can be added without replacing collection
  models or the database schema. That vault still requires a separate threat
  model, passphrase and recovery design, authenticated encryption, opaque or
  blind lookup keys, auto-lock behavior, rekeying, and performance tests. A key
  or passphrase must not be persisted beside the ciphertext. Encryption cannot
  protect records while the vault is unlocked from same-origin script or a
  malicious browser extension.
- **PWA support:** Offline installation, caching, and service-worker lifecycle
  are independent from local database selection.
- **Synchronization:** IndexedDB remains tied to one origin and browser profile.
  Cross-device or collaborative work would require a separately approved
  identity, custody, conflict, retention, and cost model.
- **Durability:** Browser storage can still be cleared or evicted. A workspace
  archive remains the portable backup boundary.
