# Browser-local data architecture

WHOISleuth keeps ordinary investigation state in the current browser. This
preserves the default privacy and cost boundary, but the application has grown
beyond one small settings document. This document records the current storage
evaluation and the constraints for any later migration. It does not authorize
or perform a migration.

## Current evidence

The owning browser-store models declare these independent serialized ceilings:

| Collection | Current backend | Declared ceiling |
| --- | --- | ---: |
| Cases | `localStorage` | 4 MiB |
| Watchlists | `localStorage` | 2 MiB |
| Brand Profiles | `localStorage` | 1 MiB |
| Campaigns | `localStorage` | 0.5 MiB |
| Shortlist | `localStorage` | 1 MiB |
| Certificate Transparency history | `localStorage` | 1 MiB |
| Detection rules | `localStorage` | 0.25 MiB |

The combined declared ceiling is 9.75 MiB. These are safety limits rather than
expected usage, and a browser may enforce a different origin quota. However,
the aggregate already exceeds the 5 MiB planning reference used by the current
case model. Per-store checks therefore cannot guarantee that all collections
can reach their own limits on the same origin.

Current investigation search also reads complete bounded case, campaign, and
Brand Profile documents, parses them, and builds a disposable projection and
search index. That is acceptable at present, but it gives the application no
indexed reads or transaction spanning more than one collection.

Run the deterministic evaluation without reading browser data:

```bash
npm run platform:local-data
npm run platform:local-data -- --json
```

The versioned report derives its byte totals from the owning model constants.
It performs no network requests, reads no browser records, and changes no
production storage.

## Decision

Proceed with the dependency-free native IndexedDB prototype. Do not migrate
production data yet.

IndexedDB is a same-origin, asynchronous, transactional browser database with
object stores and indexes. It addresses the demonstrated aggregate-capacity
and whole-document-query constraints while retaining local-only operation. The
browser feasibility test verifies opening a temporary database, an atomic
multi-record commit, keyed and indexed reads, rollback after an aborted
transaction, deletion, cleanup, and bounded operation deadlines.

A wrapper library such as Dexie is not required for this capability. It may be
reconsidered if the production adapter, schema upgrades, or transaction code
becomes difficult to maintain. Adding it before that evidence would increase
the dependency and upgrade surface without changing the underlying browser
storage guarantees.

SQLite compiled to WebAssembly is deferred. Its bundle, worker, browser
filesystem, compatibility, and recovery costs are not justified by the current
query model.

## Required production contract

Any future production adapter must:

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

## Migration gate

A production migration is a separate increment. It must be non-destructive and
resumable:

1. Read and normalize each supported legacy document through its existing
   model.
2. Write the bounded records and a migration manifest in one IndexedDB
   transaction.
3. Read the records back and verify collection counts, schema versions, and
   deterministic digests before switching the active provider.
4. Leave the legacy documents intact through the initial release so a failed
   migration or rollback cannot destroy the only copy.
5. Refuse to overwrite a newer unsupported record in either backend.
6. Preserve archive export and import before removing any legacy path.

The migration should start only after an interface design and representative
browser benchmarks establish that its user-visible benefit exceeds the added
loading, recovery, and test complexity.

## Separate decisions

- **Encryption:** IndexedDB does not provide application-level encryption. A
  useful encrypted mode needs a separate threat model and a key that is not
  stored beside the ciphertext. It must not be bundled into the storage
  migration.
- **PWA support:** Offline installation, caching, and service-worker lifecycle
  are independent from local database selection.
- **Synchronization:** IndexedDB remains tied to one origin and browser profile.
  Cross-device or collaborative work would require a separately approved
  identity, custody, conflict, retention, and cost model.
- **Durability:** Browser storage can still be cleared or evicted. A workspace
  archive remains the portable backup boundary.
