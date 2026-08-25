# Architecture orientation

WHOISleuth is a TypeScript modular monolith with a SvelteKit browser interface,
a shared Express/Netlify request boundary and a separately packaged local CLI.
The design keeps evidence rules independent from presentation and makes every
network, storage and active-operation boundary explicit.

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
The hosted application uses the same request services behind Express and
Netlify adapters so deployment shape does not redefine evidence semantics.

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

Frontend compatibility paths may re-export shared modules, but their exports
must remain identity-preserving facades. Non-frontend production code cannot
import Svelte routes, components or browser adapters.

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

| Profile | Intended use | Boundary |
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
exhaustive metadata. Human guides link to those owners rather than repeating
their matrices.

## Data ownership and persistence

Ordinary workspace data is stored in IndexedDB in the current browser profile.
Collection owners declare schema, limits, migration and future-version
behaviour. Browser adapters perform version admission, transactions,
quota-aware writes and concurrent-tab conflict handling; pure domain modules
perform validation, normalisation and merge.

Workspace exports are deliberate local files with versioned manifests and
section digests. Import validates the full envelope before a non-destructive
merge. The current archive v6 reads exact public v5; Case schema 13 reads and
migrates exact public schema 12. Unsupported future browser records are
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
requests. Timing-sensitive tests use the repository stress convention, and a
failure is diagnosed before any retry is accepted.

## Deliberate trade-offs

- A modular monolith keeps contracts shared without adding service-to-service
  authentication, deployment or evidence-custody boundaries.
- Buffered hosted responses preserve one validated final-result contract.
- IndexedDB keeps ordinary evidence under the user's browser profile without a
  hosted workspace database.
- Bounded known-field projections favour explainability and privacy over raw
  response retention.
- Human review remains mandatory for response, acquisition, defensive-control
  and authorised active operations.
