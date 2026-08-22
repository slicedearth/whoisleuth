# Threat Model

This threat model describes the WHOISleuth product boundary accepted in the
[product decision](product-boundary.md). It supplements the
[architecture orientation](architecture.md), [security policy](../SECURITY.md),
and [privacy notice](../PRIVACY.md). It is not a claim that upstream public data
is correct, complete, current, or safe.

## Security objectives

WHOISleuth should:

- prevent an investigated target or imported artefact from reaching private or
  reserved network resources;
- keep credentials, sessions, analyst notes, raw payloads, personal data, and
  deliberate local evidence within their documented custody boundaries;
- preserve source identity, observation time, completeness, truncation, and
  limitations through derivation, storage, export, replay, and comparison;
- prevent malformed, oversized, duplicate-key, deeply nested, or future-version
  input from escaping its bound or being silently reinterpreted;
- keep active actions deliberate, authorised, rate-bounded, cancellable where
  promised, and separate from ordinary Lookup, Bulk, monitoring, and offline
  review;
- make signed, hashed, or cryptographically validated claims only about the
  exact bytes, projection, key, trust anchor, and validation family checked;
  and
- fail closed when a required security, privacy, authority, schema, or budget
  condition cannot be established.

## Protected assets

- Deployment passwords, session secrets, provider credentials, signing keys,
  trust anchors, and optional worker configuration.
- Analyst-selected targets, cases, notes, assertions, response actions,
  profiles, watchlists, campaigns, relationship observations, and exports.
- Browser-local storage manifests and records, encrypted archives, hosted
  compact watchlist projections, and portable evidence packages.
- Network isolation, operation budgets, rate limits, authentication, and
  feature policy.
- Evidence provenance, source-health states, timestamps, canonical bytes,
  digests, signatures, and compatibility histories.
- User trust in statements about availability, ownership, control, activity,
  safety, maliciousness, remediation, and cryptographic assurance.

## Actors and capabilities

### Untrusted investigated target

Controls DNS responses, public services, redirects, certificates, headers,
HTML, protocol timing, large or malformed payloads, and some published registry
or hosting metadata. It may attempt SSRF, rebinding, slow responses, parser
exhaustion, terminal escape injection, misleading evidence, or cross-source
contradiction.

### Malicious imported artefact

Controls local file bytes, archive paths, manifests, object keys, nesting,
counts, strings, claimed versions, digests, signatures, timestamps, source
states, identifiers, and relationships. It may attempt path traversal,
decompression or allocation abuse, duplicate-key ambiguity, schema confusion,
claim elevation, or active-content execution.

### Untrusted upstream or provider

May be unavailable, stale, partial, rate-limited, inconsistent, compromised, or
incorrect. Provider assertions remain attributed observations and do not become
authority merely because they are structured or signed by the transport.

### Untrusted browser-local state

May be malformed, from an older version, partially committed, concurrently
changed, manually modified, quota constrained, or restored from a portable
archive. It is validated like external input rather than trusted because it is
same-origin.

### Authenticated but mistaken or malicious analyst

Can request permitted operations and deliberately export or retain evidence.
Authentication is not proof that a target is owned, an action is authorised, a
claim is correct, or a disclosure is necessary. High-impact actions therefore
retain confirmation, scope, review, and audit semantics.

### Dependency or build compromise

May attempt install-time execution, source substitution, licence drift,
vulnerable transitive code, generated-file tampering, package-boundary escape,
or publication of different bytes from those reviewed.

## Trust boundaries and execution planes

| Boundary | Trusted responsibility | Untrusted input | Required controls |
| --- | --- | --- | --- |
| Public browser to protected Console | Session establishment and route access | Password attempts, tokens, navigation, form input | Rate limits, signed sessions, bounded bodies, CSRF-resistant same-site design, no secret reflection |
| Console to hosted API | Authenticated operation request | Target, mode, options, cancellation, stale client policy | Server-side feature policy, operation admission, input validation, response bounds, explicit source states |
| Hosted runtime to public network | Bounded collection | DNS, addresses, redirects, protocol bytes, TLS, HTTP, registry and provider data | Public-address validation, DNS-rebinding resistance, pinned connections, redirect revalidation, deadlines, byte and attempt caps |
| Browser-local workspace | Deliberate analyst retention | IndexedDB, legacy local storage, concurrent tabs, quota and imported archives | Exact schemas, bounded normalisation, atomic updates, conflict retries, future-version refusal, reversible migration |
| CLI process | Local planning, collection, review, verification and files | Arguments, terminal bytes, environment, files, network responses | Command and execution-plane contracts, bounded input/output, private atomic writes, terminal sanitisation, explicit network plans |
| Portable evidence | Interoperability and review | JSON, archives, signatures, digests, timestamps and nested documents | Duplicate-key-aware bounded parsing, exact envelopes, version routing, canonicalisation, structural and semantic validation |
| Optional worker | Bounded monitoring or processing | Schedule, compact target set, store state and upstream responses | Separate configuration, encryption where promised, least data, budget and retry bounds, no general evidence custody |

## Principal threats and controls

### Server-side request forgery and rebinding

All outbound address selection must use the established public-address and safe-
fetch primitives. Every redirect and resolved candidate is revalidated. A
target cannot select a private resolver, alternate protocol, socket command, or
follow-up endpoint outside an explicitly reviewed contract. A collector must
not bypass these primitives for convenience.

Residual risk includes changes in public address allocation, upstream DNS
compromise, and protocol-specific behaviours that are outside the validated
connection. Evidence remains point-in-time.

### Resource exhaustion

Requests, bodies, decompression, arrays, objects, keys, strings, nesting,
redirects, sockets, concurrency, retries, deadlines, caches, files, archive
entries, aggregate bytes, browser stores, and rendered output require limits
before accumulation or expensive parsing. A post-parse or post-read size check
is not sufficient.

Residual risk is bounded process disruption within the configured limit. The
limits are therefore chosen with the deployment and local runtime in mind and
must be reviewed when formats or environments change.

### Evidence confusion and false certainty

Registry, registrar, WHOIS, DNS, routing, certificate, TLS, HTTP, page,
provider, imported, analyst, browser-local, and derived evidence retain separate
source identities. Unsupported, skipped, partial, stale, unavailable,
contradictory, and not-observed states are not collapsed into absence or a
favourable conclusion. Availability remains authority-aware. Risk and
Opportunity are heuristic, versioned, explainable, and non-authoritative.

### Stored-state corruption and concurrency

Browser-local writes validate exact supported schemas and byte ceilings before
commit, use atomic collection updates where required, and derive conflict
retries from the latest state. Failed writes must not be reported as committed,
and a post-write failure must not overwrite a concurrent successful update.
Future versions fail closed without mutation.

Plain browser storage does not protect against a compromised device, browser
profile, extension, same-origin script, or someone with local access. The
privacy notice states that limitation. Portable encryption protects only the
promised archive bytes under its key-lifecycle limits.

### Import, export, and cryptographic overclaim

An envelope, structure, digest, signature, trust chain, timestamp, DNSSEC proof,
RPKI state, DANE association, and PKIX result are independent assurances. Each
report names the exact checks performed and any projection-only scope.
Cryptographic success does not establish ownership, intent, safety, current
activity, or factual correctness of the signed content.

Imported paths are confined, archives and JSON are bounded before expansion,
active content is not executed, and raw credentials or session material are not
retained. Exporters and their strict readers must form a tested closure.

### Active-operation abuse

Active mail, DNSSEC, or future protocol actions require explicit operator scope,
disclosure, acknowledgement, bounded public targets, strict command and input
separation, deadlines, rate budgets, and fixture-only automated tests. They
must never send mail, authenticate, enumerate recipients, test relay, expand
into Fast or Compact, or retry automatically unless a later approved contract
explicitly says so.

### Authentication and hosted custody

The standard deployment uses one shared password and signed sessions. It does
not provide individual identity, role-based access, selective revocation, or an
audit trail of people. It is therefore unsuitable as a multi-tenant evidence
custody plane. Optional hosted monitoring retains only its documented compact
encrypted projection and does not imply general server-side case storage.

### Terminal and local-file safety

CLI input and output strip terminal control and bidirectional formatting
characters where they could affect rendering, bound UTF-8 before accumulation,
and restore terminal state on success, cancellation, EOF, resize, and failure.
Private output refuses unsafe paths and unintended overwrite. Offline commands
remain request-free, and networked commands disclose the plan before execution
where the contract requires it.

### Supply chain and release substitution

Locked dependencies, licence review, production dependency audit, architecture
checks, schema inventory, package boundary checks, staged secret scanning,
release-candidate assembly, archive digests, and installed-package workflows
must refer to the exact candidate. A passing source test does not prove that a
different package or deployment contains the reviewed bytes.

## Deliberate non-goals

WHOISleuth does not claim to provide:

- attribution, legal advice, guaranteed remediation, or automatic enforcement;
- exhaustive internet discovery, global historical coverage, or continuous
  surveillance;
- proof of ownership, control, intent, compromise, safety, or maliciousness
  from shared infrastructure or publisher claims;
- a multi-tenant collaboration service, individual account system, or general
  hosted investigation database;
- endpoint protection against a compromised analyst device or browser; or
- legal-grade time, identity, or evidence assurance beyond the exact supported
  cryptographic and provenance checks.

## Review triggers

Revisit this threat model before adding a collector, protocol, provider,
credential, dependency with a new execution role, hosted store, account model,
collaboration feature, background synchronisation, active action, automatic
submission, schema-removal policy, or new cryptographic assurance family. Also
review it after a material incident, security report, deployment change, or
evidence that an existing bound does not contain its intended threat.
