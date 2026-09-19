# Architecture orientation

WHOISleuth is a TypeScript modular monolith with a SvelteKit browser interface,
a shared Express/Netlify request boundary and a separately packaged local CLI.
Evidence rules sit below the browser, CLI and deployment adapters.

The [current product boundaries](product-boundary.md) define the supported
jobs and execution planes. The [threat model](threat-model.md) describes the
assets, actors and controls behind this architecture.

## System context

```text
browser ──authenticated bounded request──> Express or Netlify adapter
   │                                           │
   │                                           └──> public registries, DNS,
   ├──> IndexedDB workspace                         target services and
   └──> deliberate local exports                    selected providers

local CLI ──> offline contracts and local files
    └──────> explicit bounded network commands
```

The browser and CLI share runtime-neutral contracts and analysis rules. They do
not share storage adapters, authentication state or implicit network effects.
Express and Netlify adapters call the same request services and evidence rules.

## Component ownership

| Layer | Owns | Does not own |
| --- | --- | --- |
| `packages/contracts/` | Schema identity, compatibility descriptors, limits, capability metadata and portable contracts. | DOM, filesystem, network or framework effects. |
| Domain packages | Pure Case, workspace, investigation, evidence, relationship, comparison and monitoring rules. | Browser storage, terminal presentation or hosted adapters. |
| `lib/` | Shared bounded collection, safe transport, authentication and host-neutral runtime services. | Svelte state or CLI argument handling. |
| `frontend/` | Routes, components, accessibility, browser state, IndexedDB and downloads. | Canonical cross-runtime contract ownership. |
| `cli/` and `bin/` | Command grammar, handlers, terminal output, local files and explicit CLI network effects. | Hosted sessions or browser persistence. |
| Express and Netlify adapters | Deployment-specific request and response integration. | Independent evidence or scoring rules. |
| `packages/web-capture/` | Optional sandboxed browser capture, pinned resource collection, browser-lifetime deny proxy and local artefacts. | Hosted collection, browser workspaces or automatic Case imports. |
| `packages/local-application/` | Optional loopback application startup and filesystem workspace package. | A separate evidence model or hosted deployment. |
| `tools/` | Explicit maintainer checks, deterministic measurements and generated-reference renderers. | Runtime product behaviour. |

Frontend compatibility paths re-export shared modules through
identity-preserving facades. Non-frontend production code cannot
import Svelte routes, components or browser adapters.

The Cases route uses the Case workspace component for its list, filters,
selection, drafts and collection refresh. Monitor's legacy Cases URL redirects
there; Monitor owns inbox, watchlist, campaign and relationship projections.
The Console's in-memory workflow owner retains the selected Case identifier.
A read-only context component reads that Case from the browser store; scoped
commit notifications contain collection identifiers, not record payloads.
The Case response workspace coordinates response writes, reconciliation and focus.
Observation, assessment, action and outcome components own their forms and
temporary drafts; Quick and Advanced use the same form definitions. The
domain model owns validation, and the browser-store adapter owns persistence.
Within `packages/cases/`, response records define the vocabulary and types;
response actions own transitions and history reconciliation; response outcomes
own independent reviews and linked closures. The original response-model entry
point exports these responsibilities. Packet construction and exact review-input
validation are separate modules, sharing vocabulary but not field projections.
The packet component owns one transient manual-handoff preview. Its generator
supplies text and structured output; input identity and the existing
freshness-bound review digest govern reuse. No preview is stored in the Case.

Lookup's route coordinates collection and local context. Its export module owns
portable-output preparation, download status and file delivery; evidence-quality
and decision-review views share the contributor presentation projection.

The shared investigation package owns graph relationships, source clocks and
input coverage. The browser owns visual grouping, search and pagination.
Capsule version 4 embeds graph version 3 and brief version 3; exact historical
capsules remain readable through their declared embedded-contract versions.

## Request pipeline

A hosted request passes through one protected pipeline:

1. parse and bound the request body;
2. authenticate the session where the route requires it;
3. apply request-rate and operation-admission controls;
4. classify and normalise the target;
5. select the declared Fast, Compact or Deep contract;
6. perform only the admitted bounded collectors;
7. normalise source-specific results without merging their identities;
8. derive evidence, availability and scoring projections; and
9. return one bounded response envelope.

Full Deep Lookup can negotiate bounded NDJSON source updates and one final
response through the shared HTTP operation owner. Fast, Compact and ordinary
JSON clients retain buffered responses. Source updates are presentation-only;
only the validated final envelope becomes a result. Cancellation closes delivery
and propagates where supported; started collectors keep their operation lease
until they finish. The native function uses its lifecycle extension for this
cleanup and falls back to JSON when that extension is unavailable.

### Collection profiles

| Profile | Use | Boundary |
| --- | --- | --- |
| **Fast** | High-volume registration triage. | RDAP-led registration analysis with bounded authoritative DNS fallback where required; WHOIS and rich website/TLS work are skipped explicitly. |
| **Deep, compact** | Analyst-selected richer Bulk triage. | Adds bounded WHOIS, DNS, website and TLS evidence needed for compact comparison while omitting rich follow-ups and raw publications. |
| **Deep, full** | One target in Lookup or the CLI. | Adds the declared registrar, WHOIS, DNS, HTTP, TLS, page, technology, posture and observed-network context within separate source limits. |

Optional security.txt and external intelligence actions are separate explicit
selections. Authorised active DNSSEC and mail-transport commands are isolated
CLI operations and never run through Lookup, Bulk, monitoring or recipes.

Full Deep Lookup keeps registration queries at the registrable domain and
addresses DNS, TLS and web collectors to the submitted hostname. Delegation
health declares its registration-domain target separately. Evidence exports,
Case snapshots and graph projections retain these identities; comparisons do
not interpret a different collection target as an observed target change.
Explicit selected-URL requests use a bounded POST body and a shared admission
parser in both HTTP runtimes. Registration resolution is separate from supporting
collection. The website collector reuses the outbound transport without a
homepage or scheme fallback; compact projections preserve the selection mode
while omitting paths and queries.

## Outbound trust boundary

Every target, referral, redirect, resolved address and upstream response is
untrusted. Shared transport primitives:

- reject credentials, fragments and unsupported protocols;
- resolve and admit only public addresses;
- cap DNS candidates before connection;
- pin the admitted address for the connection;
- repeat validation at every redirect or referral boundary;
- bound bodies and decompression before parsing;
- cap redirects, sockets, retries, concurrency and deadlines; and
- minimise error output and retained endpoint detail.

RDAP, registrar RDAP, WHOIS, DNS, HTTP, TLS, certificate-log, routing and
provider results retain separate source identities and observation times. A
source failure or truncated response remains explicit. Supporting evidence
cannot decide authoritative registration availability.

Brand settings reviews use shared source-context and record-normalisation
owners. The control centre, matrix and history use the same comparison rules;
profile mutations use the existing revision-checked persistence coordinator.
Portable expectations distinguish unspecified, absent, specified and
observation-only record sets. CLI projections retain source observation times
separately from capture and report times; history compares like sources with
increasing observation times.

Analyst and certificate inboxes share timestamp, age and latest-cohort helpers.
Equal or unknown observation times remain explicit; source dates are separate
from Case edits and analyst decision times.

Homepage capture, native analysis, fingerprints and offline technology review
share the source-size policy in `lib/outbound-request-bounds.mts`.
Native tree construction, derived outputs, deadlines and concurrency have
separate bounds. Consumers reuse the parsed element evidence.

Active mail review admits only analyst-selected owned or authorised targets. It
performs the fixed bounded DNS, connection, `EHLO` and optional `STARTTLS`
exchange; it sends no message, authenticates no account and does not test relay,
recipients, mailboxes or catch-all behaviour.

## Evidence and decision model

Normalisers reduce upstream data into bounded known fields while retaining
source health, collection depth, completeness, truncation and limitations.
Raw payloads are transient unless a deliberately selected full saved-lookup
contract says otherwise.

Availability is authority-aware. Risk and Opportunity models are versioned,
bounded and explainable; missing evidence does not become a favourable score.
DNSSEC, RPKI, DANE/TLSA, PKIX, signatures and timestamp tokens keep independent
validation states. Relationship edges identify their source and never imply
ownership, common control or malicious coordination.

Portable Decision Facts, claim passports, comparison records and readable
reports are projections of validated evidence. Digests establish content
identity or integrity under their named canonicalisation contract; they do not
establish truth, authorship or signer trust.

Mail and campaign review outputs declare `sorted-json-v2`; historical versions
retain their original digest rules. Archive inspection exposes a versioned
content identity alongside its legacy bare-hash field. New Case snapshots
declare code-unit factor ordering; historical snapshot identifiers retain their
original ordering, while evidence comparison treats factors as sets.

The shared investigation manifest owns file identities, source declarations and
ordered packaging events. Its ZIP container uses generated paths and the shared
bounded ZIP reader. Browser preparation and inspection run in a cancellable
one-shot worker; workspace imports use the existing preview and save coordinator.
CLI package review applies the existing source-format validators after byte
verification. Opaque files have byte identity only; explicit inline previews
use bounded JSON-text and PNG decoders, not executable document rendering.

BagIt is a separate unencrypted layout owned by `packages/interchange/bagit.mts`;
it uses the shared bounded ZIP reader and checksum-verifies payload and tag
files without interpreting payload content. The investigation adapter includes
the existing source manifest as a tag. Browser operations use the package
worker; CLI folder operations share the fresh-directory writer and add bounded
recursive, symlink-refusing reads. No fetch declaration triggers a request.

Optional encrypted evidence packages wrap the ordinary ZIP in a version-1 binary
envelope. `packages/investigation/investigation-package-crypto.mts` owns the
wrapper; `packages/evidence/passphrase-encryption.mts` shares the native key
derivation and passphrase policy with encrypted workspace archives. The 58-byte
header contains the 21-byte magic `WHOISLEUTH-ENCRYPTED` terminated with NUL,
a version byte, big-endian 32-bit iteration count, 16-byte salt, 12-byte IV and
big-endian 32-bit plaintext length. AES-256-GCM authenticates the complete header
and ciphertext with a 16-byte tag. PBKDF2-SHA-256 uses 600,000 iterations. Readers
reject unsupported parameters and inconsistent lengths before key derivation,
authenticate before ZIP parsing, then use the ordinary file-identity checks.
The wrapper adds 74 bytes without reducing the admitted payload. Browser
preparation and unlocking run in the one-shot worker; unlocking does not persist
a package.

The generated [capability contract](capability-manifest.md),
[privacy/data-flow catalogue](privacy-data-flow-catalogue.md),
[schema inventory](case-contracts.md) and
[portable compatibility reference](portable-domain-contracts.md) provide the
exhaustive metadata.

## Data ownership and persistence

The shared workspace provider owns collection validation, preparation,
reconciliation and revision checks. Its transaction adapter supplies record and
file I/O. The browser adapter uses IndexedDB. The optional local application
uses an authenticated loopback adapter and a dedicated Node SQLite worker;
there is no browser-database fallback in that mode. SQLite commits include all
changed collections, original files and an operation receipt in one transaction.
A missing acknowledgement is resolved against that receipt before another
write. The selected filesystem workspace has its own stable random identity
and format version. It is plaintext at rest. The existing server owns explicit
collection; offline mode rejects it before dispatch.

`packages/local-application/` owns startup arguments and package entry. Its
package includes the verified static build and the server/worker dependency
closure. Optional packages bundle the runtime dependencies installed from their
derived production lock; platform-specific optional dependencies are omitted.
Installed file digests must match the reviewed package inputs. Application
source maps, private build identity and development output are not packaged;
third-party packages retain their distributed files and notices.

Ordinary workspace data is stored in IndexedDB in the current browser profile.
Collection owners declare schema, limits, migration and future-version
behaviour. Browser adapters perform version admission, transactions,
quota-aware writes and concurrent-tab conflict handling; pure domain modules
perform validation, normalisation and merge.

The default workspace keeps its existing database. Named workspaces select a
separate database through the same provider; a small versioned directory owns
names and identity, not collection contents. Each loaded page fixes its
selection, and switching performs a full navigation. Shared document locks
exclude deletion while another tab uses a workspace; deletion records a
tombstone before removing its database. See [browser-local data](browser-local-data.md)
for storage, recovery and isolation boundaries.

Encrypted named workspaces use the provider's record codec and keyed collection
integrity hook. The workspace directory holds only bounded encryption metadata;
passphrase-derived keys remain in the unlocked document. The provider retains
ownership of atomic writes, conflict checks and recovery. Ciphertext overhead
is accounted for separately from decoded collection limits.

Workspace replacement and archive recovery share the fresh-destination lease
and key lifecycle. Replacement copies the existing collection-owner inventory,
including local recovery state, and verifies source records and original-file
batches separately. The provider remains the atomic-write owner; replacement
does not add a second persistence coordinator or rewrite the source in place.

The provider captures bounded records and manifests in one readonly
transaction. Larger standard plaintext collections are then decoded,
digest-checked and reconstructed in a one-shot same-origin worker using the
same collection definitions as the local decoder. Small collections, custom
codecs and contexts without workers use that decoder locally. Verification
failure leaves the collection unavailable; it does not produce an empty store
or bypass integrity checks. Brand file imports use the same worker for bounded
file parsing, profile merge and collection preparation. The provider awaits the
prepared result, rechecks the collection revision and owns the transaction and
commit recovery. Cancellation before committing leaves the saved collection
unchanged; cancellation after committing starts cannot turn a successful write
into a failed-save retry. Workers do not access storage or make collection
requests. Ordinary edits keep local preparation; background processing is
explicit per operation.

Dashboard and Lookup search use a disposable same-origin browser worker. The
worker builds the shared investigation projection and search index, matches
normalised terms directly, and returns a summary or one requested result page.
Collection reads and lifecycle cancellation remain in the browser adapter;
the worker has no storage or network operations.

Aggregate mail parsing, report admission and review digests run in a one-shot
same-origin worker. The component owns file selection, profile identity and
cancellation; the shared interchange module owns input bounds and coverage.
Parsed reports remain transient, with paginated browser rendering and explicit
local export. The worker has no storage or network operations.

Monitor prepares evidence gaps and timelines in one-shot same-origin workers
using the existing source-review models. Immutable collection snapshots are
replaced by their storage owners, not deeply reactive form state, and shared
between the two views. Each controller retains only its current input and
result; collection changes invalidate it, inactive views do not start
preparation, and refresh re-evaluates the retained evidence locally.
Relationship projections derive from their current collections when read.
Worker deadlines, cancellation and teardown share the browser operation adapter.
Retained comparison indexes inspect saved Bulk rows only after an explicit
session pair is requested; selected sessions retain full validation.

Workspace exports are deliberate local files with versioned manifests and
section digests. Import validates the full envelope before a non-destructive
merge. Each format's compatibility declaration owns its current writer and
supported readers. Unsupported future browser records are
preserved without write where promised, while portable future files are
rejected before merge.

Optional hosted monitoring is a separate execution and custody boundary. It
stores only a compact application-encrypted projection and bounded metadata
when configured. It is not a general workspace, evidence or account store.

See [browser-local data](browser-local-data.md) and the
[privacy notice](../PRIVACY.md) for the complete retention and deletion model.

## Authentication and operation controls

The protected Console uses a shared-password session boundary with signed,
HttpOnly, SameSite cookies. Rate limiting and operation admission are separate:
rate limits bound request frequency, while leases and operation budgets bound
concurrent or expensive work. Optional distributed counters contain only their
documented opaque control metadata.

Feature configuration can disable optional collection without changing the
meaning of a source state. An unavailable feature is reported as unavailable,
not as a negative finding. Credentials remain server-side and are never
returned in capability metadata or error details.

## CLI boundary

The CLI is assembled from its exact reachable module closure and runs locally.
Its canonical command registry owns usage, options, collection mode, handler,
network effect, completion and help metadata. `commands`, focused `--help` and
the generated manual are projections of that registry.

Offline commands do not request a target or provider. Network commands disclose
their mode and target boundary, and `lookup --plan` performs request-free
classification. Local files are bounded before parsing, unsafe file types are
refused, existing outputs are not replaced without explicit selection and
cancellation does not publish a partial final document.

The hosted application does not ship the CLI entry point. A CLI release
candidate is built, installed and exercised separately from the application
build.

## Verification architecture

Verification is layered:

- unit and property tests cover pure rules, bounds and failure semantics;
- mutation tests protect selected critical decision branches;
- type and Svelte checks cover compile-time and component contracts;
- architecture checks enforce dependency direction;
- schema, compatibility, capability, privacy and public-product checks detect
  metadata drift;
- package checks install and exercise the exact CLI candidate; and
- browser tests verify routing, accessibility, persistence, export and rendered
  behaviour.

Automated tests use deterministic fixtures and make no live investigation
requests. Timing-sensitive coverage also has a separate stress suite.
