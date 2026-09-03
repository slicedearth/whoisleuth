# Portable domain compatibility

The portable runtime boundary is split by meaning rather than by presentation
layer. Schema identity, versions, bounds, compatibility metadata, and lifecycle
relationships live in `packages/contracts/`. Parsing, normalisation, merging,
projection, canonicalisation, and integrity verification live in the matching
pure domain package. Browser storage, downloads, passphrase controls, terminal
formatting, filesystem access, and environment adapters remain outside those
packages.

Historical paths under `frontend/src/lib/analysis/` are exact re-export
facades. Browser callers keep the same exported values and functions, while CLI
and other non-frontend consumers import the dependency-neutral owner directly.
The architecture gate rejects any CLI dependency path into frontend source.

Application release 2.0.1 is the current public writer. The generated Case
portability reference and `npm run schema:inventory` are the canonical current
version inventories; this guide describes why those families remain separate
without maintaining another version list.

## Registered families

### Investigation portability

`packages/contracts/investigation-portability.mts` owns the compatibility
descriptors, lifecycle contracts, and immutable fixtures. Runtime behaviour is
owned by `packages/investigation/`. The generated schema inventory reports the
exact tier and retained versions, so this narrative does not repeat them.

The exact public investigation-capsule writer remains readable alongside its
single v2 successor. Other investigation documents retain only their public
current writer unless the generated durable inventory records a direct reader.
Cryptographic-family and canonicalisation dispatch remain explicit; no current
writer regenerates a public historical fixture.

### Investigation projections

`packages/contracts/investigation-projections.mts` owns these descriptors and
their fixtures. Pure bounded projection and export behaviour lives in
`packages/investigation/`; frontend modules are compatibility facades only.
The generated inventory distinguishes deliberate exports from transient
projections without assigning the latter a migration lifecycle.

The parent-domain review is a deliberate source-neutral JSON export with a
512 KiB ceiling. It contains exact retained submitted-hostname observations,
canonical parent groups, attributable Case and snapshot provenance,
completeness, truncation, omissions, and limitations. Transient response-scope
selection, Case notes, tags, contacts, assertions, response actions, raw
payloads, credentials, and complete URLs are excluded. The ordinary Campaign
export and workspace archive do not embed this derived review.

### External-observation interchange

`packages/contracts/external-observation-interchange.mts` owns this family's
descriptors and immutable input and normalisation fixtures. Strict parsing,
bounded row conversion, source
attribution, completeness, limitations, and non-destructive Case merging are
owned by `packages/interchange/`.

Only the public current strict findings writer is readable. Fixed-column
finding rows and domain, DNS, and certificate observation rows retain their
separately versioned bounded conversion contracts. Reader-only findings history
and unversioned rows are outside the v2 boundary; future and unsupported
versions are rejected before conversion or merge.

### Offline comparison

`packages/contracts/offline-comparison.mts` owns the comparison descriptors and
fixtures. Comparison behaviour is owned by `packages/comparison/`.

CLI page-comparison and comparison-ledger documents are published output only.
The generated inventory records their current writers without creating
historical readers. Page, technology, TLS,
favicon, Bulk, and retained-relationship comparisons preserve partial and
unavailable states instead of inferring equality, removal, safety, ownership,
or coordination.

### Workspace archive section

`packages/contracts/case-portability.mts` remains the sole lifecycle owner for
ordinary and encrypted workspace archives and now also registers the exact
version-1 workspace-settings section. Pure archive composition, parsing,
preview, checksum validation, and injected-Web-Crypto envelope behaviour live
in `packages/workspace/`. Browser storage, download, and passphrase UI remain
adapters. Exact public ordinary archive version 5 reads directly alongside the
v2 archive writer, while encrypted envelope version 1 remains unchanged.
Earlier reader-only archives fail explicitly without mutation.

## Compatibility and privacy bounds

All newly registered claims bind exact fixture bytes and SHA-256 digests.
Unsupported future portable formats fail before partial parsing or merge, and
output-only history gains no writer. The relocation adds no archive section,
browser persistence, network request, collector, provider, telemetry, score,
availability rule, or authority decision. Raw registry payloads, expanded
contacts, credentials, cookies, and query-bearing URLs remain excluded.
