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
| `tools/` | Explicit maintainer checks, deterministic measurements and generated-reference renderers. | Runtime product behaviour. |

Frontend compatibility paths re-export shared modules through
identity-preserving facades. Non-frontend production code cannot
import Svelte routes, components or browser adapters.

The Cases route and Monitor's Cases view use one Case workspace component.
It owns the list, filters, selection, drafts and collection refresh; Monitor
owns the separate inbox, watchlist, campaign and relationship projections.
The Console's in-memory workflow owner retains the selected Case identifier.
A read-only context component reads that Case from the browser store; scoped
commit notifications contain collection identifiers, not record payloads.
The Case response workspace coordinates response writes, reconciliation and focus.
Observation, assessment, action and outcome components own their forms and
temporary drafts; Quick and Advanced use the same form definitions. The
domain model owns validation and append-only histories, and the browser-store
adapter owns persistence.
The packet component owns one transient manual-handoff preview. Its generator
supplies text and structured output; input identity and the existing
freshness-bound review digest govern reuse. No preview is stored in the Case.

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

Express and Netlify currently return one buffered response. Browser progress
shows the planned source families and elapsed time but does not persist partial
source fragments. Cancellation stops the browser waiting and propagates an
abort signal where supported; already-admitted work can finish within its
existing deadline. Only a validated final envelope can become a result.

### Collection profiles

| Profile | Use | Boundary |
| --- | --- | --- |
| **Fast** | High-volume registration triage. | RDAP-led registration analysis with bounded authoritative DNS fallback where required; WHOIS and rich website/TLS work are skipped explicitly. |
| **Deep, compact** | Analyst-selected richer Bulk triage. | Adds bounded WHOIS, DNS, website and TLS evidence needed for compact comparison while omitting rich follow-ups and raw publications. |
| **Deep, full** | One target in Lookup or the CLI. | Adds the declared registrar, WHOIS, DNS, HTTP, TLS, page, technology, posture and observed-network context within separate source limits. |

Optional security.txt and external intelligence actions are separate explicit
selections. Authorised active DNSSEC and mail-transport commands are isolated
CLI operations and never run through Lookup, Bulk, monitoring or recipes.

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

The generated [capability contract](capability-manifest.md),
[privacy/data-flow catalogue](privacy-data-flow-catalogue.md),
[schema inventory](case-contracts.md) and
[portable compatibility reference](portable-domain-contracts.md) provide the
exhaustive metadata.

## Data ownership and persistence

Ordinary workspace data is stored in IndexedDB in the current browser profile.
Collection owners declare schema, limits, migration and future-version
behaviour. Browser adapters perform version admission, transactions,
quota-aware writes and concurrent-tab conflict handling; pure domain modules
perform validation, normalisation and merge.

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
