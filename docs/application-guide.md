# Application guide

WHOISleuth organises work under three analyst jobs:

- **Investigate** collects and compares evidence.
- **Respond** records decisions and prepares response material.
- **Assure** reviews later observations, watchlists and owned-domain controls.

Network collection and external actions remain explicit. The generated
[privacy/data-flow catalogue](privacy-data-flow-catalogue.md) lists request,
recipient, retention and export boundaries.

The public demo uses fixed fictional evidence and does not write protected
workspace data.

## Dashboard

Dashboard is the authenticated starting point. It waits for the required
browser-local collections before deciding whether the workspace is new,
returning or unavailable.

For an empty workspace it offers a small set of first actions: explore the demo,
investigate a target, start a guide or import an existing workspace.
For retained work it shows bounded attention, overdue, changed-since-review,
Case and watchlist counts. A nearby disclosure identifies the records behind a
summary; viewing Dashboard does not mark anything reviewed.

Saved-work search, templates and archive maintenance are secondary tools.
Search stays in the browser and operates over bounded normalised fields; it does
not start collection or inspect raw upstream payloads.

## Lookup

Lookup accepts one domain, IP address or ASN. URL-like input is normalised only
under the explicit supported rules; credentials, unsupported schemes and
ambiguous targets are rejected.

Before collection, Lookup shows the selected target and source families. During
collection it displays elapsed time and source status. Current Express and
Netlify deployments return one buffered final envelope, so pending sources
settle together when that envelope arrives. Cancelling stops the browser from
waiting and discards an incomplete response; already-admitted server work may
finish inside its existing bounds.

### Fast and Deep collection

- **Fast** is registration-led triage. It uses RDAP and bounded authoritative
  DNS fallback where required, while explicitly skipping richer WHOIS, website
  and TLS work.
- **Deep, compact** is available for selected Bulk work. It adds the bounded
  registration, DNS, website and TLS fields needed for comparison without the
  complete single-target detail.
- **Deep, full** collects the declared registrar, WHOIS, DNS, HTTP, TLS, page,
  technology, posture and observed-network context applicable to one target.

Optional security.txt and external intelligence lookups are separate selections
and never run merely because Deep was chosen. The CLI's authorised DNSSEC and
mail-transport actions are separate again and never run through browser Lookup.

### Reading the result

The result starts with registration and availability because those decisions
have specific authority rules. Supporting DNS, website, TLS, certificate,
network and provider evidence cannot silently replace registry authority.

Each source shows its state, observation time and limitations. Long supporting
sections use disclosures, while important unavailable or contradictory evidence
remains visible. Tables and text remain the complete accessible review surface;
charts are summaries only.

A full Deep domain result can include:

- registry RDAP and a separately attributed registrar RDAP follow-up;
- bounded WHOIS referral evidence;
- recursive and selected-authority DNS evidence;
- HTTP redirects, selected response metadata and page publication summaries;
- one-connection TLS and certificate evidence;
- bounded technology, page-role and passive-posture indicators;
- one observed public-address IP RDAP context; and
- explicitly selected security.txt or provider results.

Raw registration payloads, contacts, endpoints and provider records are not
silently copied into compact browser stores. The deliberate raw view and full
saved Lookup are more sensitive than normalised reports and require separate
handling.

### Retaining a Lookup

Creating or refreshing a Case is deliberate. Case schema 14 retains the exact
normalised submitted hostname on the new point-in-time evidence snapshot while
the Case remains keyed by canonical registrable domain. Different hostnames can
therefore remain attached to different snapshots. Published v2 schema-13 and
public v1 schema-12 Cases migrate directly and may retain a null hostname;
WHOISleuth does not reconstruct one from URLs, certificates, redirects or other
weaker evidence.

Ordinary transient Lookups create no hostname history. Case report v10 and
response packet v8 do not add the snapshot hostname, while ordinary Case,
workspace and trusted Case-pack exports can contain it and require sharing
review.

## Discover

Discover provides three bounded paths:

- local candidate generation from a domain, Brand Profile or optional custom
  dictionary;
- Certificate Transparency search and local comparison of returned names; and
- one explicit registry-scoped RDAP nameserver search.

Generated candidates retain their mutation provenance. A custom dictionary
stays in the current tab and is not uploaded; only deliberately selected
candidate domains and bounded provenance continue to Bulk through a one-use
handoff.

Certificate publication is evidence that a log recorded a certificate, not
proof of current deployment, ownership, control or maliciousness. Co-issuance,
shared names and visual similarity are review leads. Registry nameserver search
is a suffix-scoped lower bound rather than a global reverse inventory.

## Bulk

Bulk performs comparable bounded triage over an explicit list. Fast accepts up
to 500 targets; compact Deep accepts up to 50. Each target is a separate
request, so pacing and concurrency remain visible.

Filters distinguish registered, unregistered, inconclusive, failed and source-
limited states. They do not rewrite evidence. Relationship summaries identify
the exact source field behind a shared address, nameserver, mail server,
certificate or other observation; shared infrastructure does not establish
common ownership or coordination.

Bulk can retain compact sessions, named review views and per-domain review
state. Checkpoints and saved sessions contain targets and must be handled as
investigation data. Resume requires the exact original input and mode, and a
partial later observation does not erase an earlier usable component.

Selected rows can continue to Cases, exports or response preparation. Selection
does not submit a target to a provider or apply a control.

## Brands

A Brand Profile records analyst-authored owned or approved scope, protection
context and desired posture. It can include official domains, approved partners,
allowlists, mail expectations, reviewed certificate baselines, protection
attestations, suppressions and approved change windows.

These values express analyst intent. They do not prove the live state of a
registry, account, DNS zone, certificate or service. Observed evidence,
desired-state baselines and analyst attestations remain separate.

Brand views can provide:

- a cross-domain posture matrix over saved baselines and retained observations;
- domain-control passports and local desired-state review;
- transient DMARC or TLS aggregate-report summaries from selected local files;
- an inbox of explicitly associated Cases; and
- a transient Brand Asset Register joining profile scope, associated Cases and
  bounded one-hop retained leads.

The register is a read-only view. One-hop candidates do not become authored
scope or further anchors. Missing or partial sources remain explicit.

Brand Profile version 7 is current. Exact public version 6 remains readable and
receives deterministic identifiers for approved windows without inventing an
analyst decision.

## Monitor, Respond and Assure

Monitor groups existing browser-local records into Respond and Assure views.

### Cases and response preparation

Cases can retain bounded evidence snapshots, pins, checkpoints, analyst
assertions, decisions, contact routes, actions, observed-effect reviews,
closures and investigation branches. Analyst-authored records remain separate
from collected evidence.

Each Case has a stable `WS-` reference derived from its complete immutable local
UUID, so it remains stable across browser exports without relying on a shared
counter.
Controlled Case types classify the reviewed issue separately from free-form
tags. Exact public incident links can be retained for web or social-platform
content, resolved without erasing history, and carried into a response packet.

For supported platform hostnames, the Case workspace shows freshness-bounded
official safety or rights-reporting routes matched to the selected Case types.
The analyst must verify the current route and authority before opening it.
WHOISleuth creates only a drafting action and never submits the complaint.

Response packet preflight checks the selected evidence, recipient scope,
privacy, redactions, analyst authority, freshness and contradictions. Drafts
remain available with cautions. Reviewed authorisation is bound to the exact
canonical inputs and is invalidated by material change. Packet generation is a
local export; WHOISleuth does not send it or promise a provider outcome.

Provider acknowledgement or reported resolution remains analyst-recorded state,
not independently observed remediation.

A retained exact Incident URL can also be handed to the authorised repo-local
rendered-capture command. The browser validates the selected manifest and can
import its sanitised metadata and declared digests into that Case; screenshots
and other capture artefact bytes remain in the local output directory.

### Retained change and review

Timelines, watchlists, certificate review, evidence-gap queues and Analyst
Review Items derive from retained or imported records. The absence of a retained
source record remains different from an explicit skipped collection. Expiry,
review-due state or a material fingerprint change can return an item to review;
viewing it does not resolve it.

Later comparison is explicit. It preserves collection-condition changes,
unavailable components and incompatible model versions instead of treating
omission as removal.

### Defensive and assurance outputs

Defensive domain exports require deliberate reviewed selection and contain
expiry, provenance, exclusions and rollback guidance. They are not uploaded or
applied automatically.

Cryptographic assurance keeps DNSSEC, route-origin, DANE/TLSA, PKIX, signatures
and timestamps independent. A valid digest or signature proves only its named
content and key relationship; it does not establish evidence accuracy, signer
identity or target safety.

## Understanding evidence

### Source states

Common states include ready, partial, unavailable, blocked, rate-limited,
unsupported, stale, skipped, malformed and inconclusive. Their exact names vary
by source contract, but the rule is stable: incomplete evidence remains
incomplete.

A source that publishes no value is different from a source that could not be
queried, returned an unreadable result or was not selected. Truncation is
reported wherever omitted records could change a conclusion.

### Registration and availability

Registry authority decides domain registration availability. Registrar RDAP,
WHOIS, DNS, HTTP, certificate, page, provider and analyst evidence can explain
or challenge a review but cannot declare a domain available on their own.

For IP addresses and ASNs, registration and routing evidence use their own
normalised contracts; domain availability language does not apply.

### Risk and Opportunity

Risk is versioned explainable triage. A low value does not mean safe, legitimate
or complete, and missing evidence does not silently contribute a favourable
zero. The interface exposes contributing factors, uncertainty and material
changes.

Opportunity is shown only for acquisition review and does not imply that a
domain is available, affordable, transferable or suitable. Neither score
performs enforcement or acquisition.

Offline Risk calibration uses deliberately reviewed local data. Its summary
contains aggregate model performance only and does not train or change
the running model. See the [CLI risk-calibrate command](https://www.whoisleuth.com/cli#command-risk-calibrate).

## Browser-local storage and archives

Ordinary workspace state stays in IndexedDB as bounded plaintext JSON in the
current browser profile. Failed reads, quota errors and unsupported versions
remain explicit. Clearing site data removes the workspace; downloaded files
remain under the user's control.

Workspace archive version 7 is current and accepts exact versions 5 and 6.
Version 5 contains public Case schema 12 and gains an empty Analyst Review Item
section during migration. Version 6 retains its existing sections, while the
current writer stores Case schema 14 in version 7. Import validates the full
checksummed envelope before a non-destructive merge, and an omitted section
never deletes local data.

The encrypted envelope remains version 1 and uses browser-local password-based
authenticated encryption. It protects the downloaded file while locked, not an
open Console or active IndexedDB. A checksummed Case schema 14 or later section
is isolated as unsupported.

See [browser-local data](browser-local-data.md) for migration, concurrency,
quota, recovery and deletion details.

## Reports, imports and exports

Exports are deliberate local actions. Review them before sharing:

- a full saved Lookup can include target, endpoints, raw RDAP publications,
  WHOIS bodies and publicly published contact data;
- normalised Lookup evidence excludes raw registration payloads and expanded
  contacts. Current schema 28 and published v2 schema 27 retain that boundary;
  exact v1 schema 26 can contain public contact fields;
- Case, workspace and trusted Case-pack files can identify investigated
  hostnames and contain analyst records;
- graph, campaign and defensive exports identify their selected scope; and
- screenshots from authorised local capture preserve visible rendered content.

Local importers bound and validate an entire file before preview or merge.
STIX, MISP and external-finding inputs remain analyst-supplied evidence; import
does not refresh them or establish their truth. Unsupported future schemas fail
before partial interpretation.

The CLI can verify supported envelopes, compare saved observations, inspect
workspace archives and prepare sharing reviews offline. See
[offline artefact verification](https://www.whoisleuth.com/cli#command-verify-artifact)
and the [interchange fidelity report](https://www.whoisleuth.com/cli#command-interchange-report).

## Limits of the product

WHOISleuth does not provide continuous global monitoring, a multi-user case
database, background workspace synchronisation, legal conclusions, guaranteed
source completeness, automatic takedown, domain acquisition or proof of
ownership, control, intent, safety or maliciousness.

Use the [privacy notice](../PRIVACY.md) for data-handling details and the
[threat model](threat-model.md) for security boundaries.
