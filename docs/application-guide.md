# Application guide

WHOISleuth supports a domain-intelligence workflow from initial discovery to a
documented case. The public `/guide` page provides the shortest introduction.
Its task cards link directly to the relevant tool and interpretation sections,
and the public synthetic demo identifies the current, completed, available, and
upcoming stage of its six-step workflow. Its Lookup and Monitor stages also use
the production source-topology, lifecycle, retained-activity, and evidence-card
components with fixed reserved fixtures. This document explains the same
workflow with additional source, storage, and interpretation detail.

## A practical workflow

1. Create a Brand Profile when the investigation depends on official domains,
   products, partners, or allowlisted infrastructure.
2. Use Discover to generate bounded candidates or search public Certificate
   Transparency observations.
3. Send a focused candidate set to Bulk for comparable Fast or compact Deep
   triage.
4. Open important or uncertain candidates in Lookup for complete source-level
   evidence and optional enrichments.
5. Save useful findings as cases or watchlists in Monitor.
6. Review later observations, document an analyst decision, and export only the
   evidence needed for the intended audience.

Each network action remains deliberate. Opening a tool, starting a guided
investigation, filtering results, or opening a saved record does not silently
start a lookup or submit a target to another service.

## Tools

### Dashboard

Dashboard is the landing page inside the signed-in Console. It provides:

- starting points for the five investigation tools;
- bounded counts from browser-local cases, watchlists, and Brand Profiles;
- a disposable search across known case, campaign, and profile fields;
- guided investigations for a brand sweep, infrastructure pivot, or new-domain
  triage; and
- deliberate encrypted or unencrypted export and reviewed import of the
  versioned workspace archive.

While the Console opens, it distinguishes session confirmation, browser-local
workspace preparation, and destination loading. Those phases describe the
current boundary only; they do not imply that an evidence source has been
queried or completed.

Search does not contact a provider or create a persistent index. An empty
result means only that the bounded local projection had no match.

Press `Ctrl+K` or `Cmd+K` anywhere in the signed-in Console to search its
destinations without opening the mobile navigation drawer. This changes pages
only; it does not submit a target, run a lookup, or search retained
investigation data.

### Lookup

Lookup accepts one domain, IPv4 or IPv6 address, or ASN. A domain Lookup keeps
registry, registrar, WHOIS, DNS, HTTP, TLS, page, network, and optional provider
evidence separately attributed. Deep domain Lookup can add the zone's bounded
SOA publication and HTTPS service-binding records published for the origin.
Deep public-IP Lookup can add separately attributed PTR names. None of these
sources decides domain availability, Risk, ownership, or hosting control.

The primary assessment, source health, and material registration conflicts
remain expanded. Long RDAP and WHOIS records and secondary DNS, HTTP, page,
passive-posture, technology, TLS, and observed-network cards start collapsed.
Their state and summary remain visible. Expand a section before relying on its
evidence, collection time, or limitations.

During collection, Lookup identifies the requested source families without
pretending that any one source has completed before the bounded unified
response arrives. It shows elapsed time and a 40-second browser deadline.
**Cancel lookup** stops the browser from waiting and discards any incomplete
response; already-admitted server work can still finish within its existing
bounds. Leaving Lookup applies the same browser cancellation.

After a successful deep full response, **Collection timing** reports total
request time plus the duration and settle offset of each source branch that
actually ran. Branches overlap, so their durations are not additive. A settled
branch can still have a partial, unavailable, not-found, or error state; use
the source card for that evidence status. Fast and compact responses retain
their existing diagnostics and omit this timing object.

Once a result is available, the sticky section rail tracks the current
evidence group. The topology uses separate visual families for registry,
network, web, derived, and analyst evidence, with an adjacent key; source
status remains an independent label and colour.

After a successful single-domain Lookup, **Download report** creates a readable
Markdown summary locally in the browser. It includes registry, registrar, and
WHOIS source health and collection time, normalized findings, the explainable
Risk assessment, and limitations. It deliberately excludes raw RDAP and WHOIS
responses, expanded contacts, provider payloads, scripts, and remote assets.
IP and ASN results retain the JSON evidence action but do not offer this first
domain-focused readable report.

**Export evidence JSON** remains the separate full-fidelity option. It can
include normalized and raw registration sources, supporting observations,
diagnostics, comparisons, and provenance. It can contain public contact data,
so review and store it accordingly.

### Discover

Discover generates bounded candidates locally from typo, keyboard, confusable,
plural, separator, word-order, WWW-style, dictionary, and selected-TLD
families. Presets narrow the generation families, while **Custom families**
lets an analyst select the exact families required for a run. Neither choice
changes the global safety limits. The keyboard selector can use one supported
layout or the bounded union of all supported layouts, including adjacent
number-row keys.

The optional custom dictionary accepts pasted terms or one local text file.
It retains at most 100 unique terms of up to 32 characters inside the existing
4,096-character input and 2,000-candidate limits. The terms stay in the current
browser tab, are not uploaded or saved, and are used only when the analyst
selects Generate candidates. Candidate provenance remains attached when
several algorithms produce the same domain. For an explicitly hyphenated seed,
the separate token-replacement family can replace its first or last token with
those analyst-supplied terms without adding the built-in term list.

Discover deliberately does not create dotted subdomain permutations. Registry
lookups validate the registrable parent, so attaching that authoritative result
to a generated hostname could imply that the hostname itself was observed.
Certificate Transparency search remains the separately attributed route for
finding publicly logged hostnames.

Unicode-confusable generation and Lookup skeleton comparison share a
versioned, checked-in projection of Unicode UTS #39 data. The projection is
generated offline from a pinned source file, limited to reviewed domain-label
scripts, and capped per ASCII letter. It does not download Unicode data, send
the seed anywhere, or load the complete upstream table in the browser. A
skeleton match is visual-similarity evidence, not a claim about ownership,
intent, activity, or maliciousness.

The Impersonation and All presets can also add a small set of same-script
whole-label candidates when every ASCII letter has an eligible replacement.
This generation is capped at one candidate per reviewed non-Latin script and
six candidates overall. It is not a formal Unicode whole-script verdict and
does not add a new Risk contribution.

Custom selection exposes a separate advanced family that replaces exactly two
ASCII letters with confusable characters from the same reviewed script. It is
excluded from every preset and from the initial Custom selection, ranks curated
mappings before projected additions, and retains at most 256 candidates.
Discover reports cross-script or invalid combinations excluded by policy and
lower-ranked label variants omitted by that independent family or overall
generation budget.

Discover shows the DNS-safe ASCII domain as the selectable value and adds the
readable Unicode form, observed scripts, and contextual mixed-script or
source/profile visual-match badges. A matching candidate names up to three
matched references and discloses any additional bounded matches without
displaying the internal comparison skeleton. Candidate-scope options show
complete-result counts. Candidate scope, mutation-family, text, and
certificate-history filters operate on the complete bounded result, as do
generated-order, alphabetical, and most-indicators sorting.

Certificate Transparency search is a separate hosted action. It groups
observed hostnames by canonical registrable domain and retains bounded first
and last observation times plus certificate counts. These timestamps describe
public-log observations. They do not prove registration time, website activity,
ownership, or maliciousness.

Filtered and sorted candidate lists are paginated locally. Selecting all
filtered entries operates on the complete bounded filtered set, not only the
visible page. New result sets start unselected so moving hundreds or thousands
of candidates into Bulk always requires an explicit review choice.

### Bulk

Bulk checks each canonical domain through a separate bounded Lookup request.
It supports pasted domains, text files, common delimited files, and handoffs
from Discover. Results can be filtered and sorted without changing the saved or
exported scan data.

Bulk sessions are saved only when the analyst names and saves the current
investigation. Each bounded browser-local session retains the input domain
order, scan mode, compact settled rows, and per-source completion states so it
can be loaded, compared with another saved session, or resumed for domains that
never reached a settled row. Saving never retains raw source payloads or
expanded contact records, and resuming does not repeat failed rows unless the
analyst separately selects **Retry failed**.

Bulk relationship evidence compares only observations already collected in the
current scan. It can highlight exact nameserver sets, addresses, tracking
identifiers, favicons, official asset hosts, and native certificate hashes. A
shared observation is a pivot for investigation, not proof of common ownership,
control, intent, coordination, or abuse.

Relationship groups remain transient with the Bulk result unless the analyst
selects **Retain observation**. That action saves only the normalized value,
member domains, method, collection time, completeness, truncation, and stated
limitations in the current browser. It does not save the complete Bulk result,
raw lookup responses, or expanded contacts. Retained observations can be
reviewed and deleted under Monitor Relationships, included in the workspace
archive, found through local investigation search, and projected into the
relationship graph when at least two member domains also have local cases.

Defensive registration coverage groups a generated scan by mutation family and
domain ending. It distinguishes protected or allowlisted domains, registered
exposures, available gaps, and unknown results without making extra requests.

### Brands

A Brand Profile stores official domains, product names, selected domain
endings, approved partners, allowlists, active and retired DKIM selectors, a
standard, defensive-no-mail, or parked mail profile, and an optional
official-site baseline. Profiles stay in the current browser by default.

The official-domain posture audit checks configured DNS and mail controls such
as registry transfer restrictions, nameserver delegation, SPF, DMARC, MX,
DNSSEC, CAA, MTA-STS, TLS-RPT, BIMI, and explicitly supplied DKIM selectors.
It recursively expands only literal SPF include and redirect branches within
fixed query, depth, void-answer, cycle, and time bounds. It also validates
external DMARC reporting authorization, parses supported DKIM public-key
strength without retaining key material, checks whether configured retired
selectors remain published, and inventories bounded external nameserver,
mail, SPF, and reporting dependencies. Resolver failures and exhausted bounds
remain incomplete. External infrastructure is a review lead, not an ownership,
insecurity, or exploitability claim.

The profile can separately retain six expiring analyst attestations for
registrar MFA, recovery-email separation, registry lock, emergency contacts,
account audit logging, and zone backups. These statements are not inferred
from public evidence and must be reviewed by the analyst.

An official-site baseline can retain bounded page identity and fingerprint
data without keeping page HTML, URL paths, query strings, credentials, or
complete email addresses. Comparison results remain contextual evidence and do
not prove common ownership or intent.

### Monitor

Monitor contains Cases, Campaigns, Relationships, and Watchlists.

- **Cases** retain analyst status, disposition, tags, notes, a bounded history
  of compact normalized evidence snapshots, analyst-selected evidence pins,
  decision rationales, and reviewed response actions with follow-up outcomes.
  Pins, decisions, and actions stay separately typed so an analyst assertion is
  never presented as collected evidence.
- **Campaigns** group existing case domains without duplicating their evidence
  or implying attribution.
- **Relationships** review analyst-selected Bulk observations and project
  typed, provenance-backed links across those records, stored case evidence,
  and campaign membership without another network request.
- **Watchlists** retain bounded material-change timelines and can be rescanned
  deliberately.

The complete evidence timeline remains depth-aware. A Fast observation does
not erase last-known Deep-only evidence, and score changes are compared only
when their explicit model versions match.

## Fast and Deep collection

Fast and Deep are collection profiles, not confidence ratings.

| Profile | Intended use | Collection boundary |
| --- | --- | --- |
| **Fast Lookup or Bulk** | Lower-request registration-first triage. | Uses RDAP-led registration analysis and a bounded authoritative DNS-delegation fallback where needed. WHOIS, website, TLS, and Deep enrichments are skipped explicitly. |
| **Deep single Lookup** | Complete review of one important target. | Can add WHOIS, registrar RDAP, DNS with SOA zone context and HTTPS service-binding publications, public-IP PTR context, HTTP, favicon, page identity, privacy-minimized credential-surface counts, TLS, technology, passive posture, observed IP network context, and explicitly selected optional sources. |
| **Deep Bulk** | Richer comparison across a bounded candidate set. | Uses a compact response with WHOIS, DNS, website, TLS, and mail context needed for triage. Full raw sources and single-Lookup-only enrichments remain omitted. |

Deep single Lookup is the default in the Lookup page. Bulk keeps its own
explicit mode selection and safety limits.

## Understanding source states

| State | Meaning |
| --- | --- |
| **Observed or success** | The named source returned usable evidence. |
| **Partial** | Some evidence was collected, but a stated failure or cap prevents a complete result. |
| **Not found** | The named authoritative source reported no object within its own scope. It does not establish overall absence or safety. |
| **Skipped** | The selected profile or policy deliberately did not run the source. |
| **Disabled** | Deployment policy prevents the source from running. |
| **Rate limited** | A source or hosted budget temporarily refused the request. |
| **Unsupported** | The source or operation is not available for this target. |
| **Unavailable or error** | The source could not return usable evidence. |
| **Inconclusive** | The available evidence cannot support a reliable yes or no conclusion. |

The [registry data contract](registry-data-contract.md) documents normalized
source shapes, attempt provenance, diagnostics, caps, and compatibility rules.

## Registration and availability

WHOISleuth discovers RDAP services through IANA bootstrap data, validates
successful responses against the requested object, and records bounded
endpoint-attempt diagnostics. Domain lifecycle events are normalized without
discarding the bounded source list.

WHOIS follows a bounded referral chain. Its authority model protects a
positive registry observation from contradictory or failed later referrals.
Registrar RDAP, when available in a Deep single Lookup, remains a separate
source and cannot decide registration availability.

A missing delegation, failed provider, absent website, or unavailable registrar
source never means that a domain is available. Registry compatibility metadata
also remains descriptive. Use the [registry compatibility catalogue](registry-compatibility.md)
to understand tested parsing and access constraints.

## Website, platform, hosting, and posture evidence

Deep single Lookup can derive several views from one bounded homepage response:

- response status, redirects, MIME type, selected response and security-header
  presence, and a captured-body digest;
- static page identity, forms, external origins, public tracking identifiers,
  and bounded fingerprints;
- curated publisher-declared JSON-LD identity fields, reduced to schema types,
  labels, declared origins, and `sameAs` hostnames;
- fixed semantic input-purpose, form-method, and action-relationship counts
  that describe a credential collection surface without retaining field
  metadata or complete form destinations;
- curated technology indicators for common content, commerce, site-building,
  framework, server, and delivery products;
- apparent browser-library versions and bounded advisory references inferred
  from script names, versions, hashes, or capped inline signatures that were
  already present in the captured page; and
- passive security-posture findings from already-collected HTTP, page, TLS,
  DNSSEC, and CAA evidence, including bounded checks of selected CSP, HSTS,
  referrer-policy, and response-cookie attributes.

Technology indicators are evidence-backed clues, not a complete software
inventory. The bounded catalogue uses generator metadata and tokenized live
elements, attributes, static-asset paths, resource origins, and selected server
headers. Static collection does not execute JavaScript, and sites can conceal
or remove distinctive indicators. Site-builder and commerce signatures do not
identify the host platform from a retained third-party resource origin alone;
they require a page, generator, or additional storefront marker. Delivery
origins can still appear as separately attributed delivery evidence. WHOISleuth
does not fetch referenced scripts.
A browser-library advisory match is a lead for review, not proof that the
component is loaded, reachable, vulnerable in context, or exploitable. A
non-match does not establish that no vulnerable component exists.

After a completed Deep Lookup, **Save current snapshot** creates one bounded
browser-local website profile only when the analyst chooses it. The snapshot
keeps curated technology identifiers, posture states, page-identity digests,
source health, collection completeness, and timestamps. It excludes raw RDAP,
WHOIS, HTTP, HTML, contact, and provider payloads. Select an earlier and later
snapshot of the same domain to review added, removed, changed, unavailable, or
incomparable fields. Differences are leads for review, not evidence of
compromise, ownership, intent, or maliciousness. Saving, comparing, deleting,
exporting, and importing snapshots make no network request.

Response-policy checks use the same selected homepage response and make no
extra request. They retain fixed finding identifiers and bounded counts rather
than complete policies or cookies. A finding is a response-scoped review lead,
not proof that a vulnerability is reachable or exploitable, and it does not
change availability or Risk.

Structured identity metadata is also a clue, not verification. WHOISleuth
examines only bounded JSON-LD already present in the captured response, does
not fetch referenced metadata, and discards raw JSON, contact fields, URL
paths, queries, and arbitrary properties. A declaration does not prove
identity, ownership, control, safety, or maliciousness.

Credential-surface evidence is a static semantic summary, not a vulnerability
or phishing finding. It classifies capped input elements from `type` and
`autocomplete` declarations and counts form methods plus action relationships.
External submission can be legitimate, category counts can overlap, and
JavaScript-rendered or non-semantic controls may be absent. WHOISleuth retains
no field names, values, labels, placeholders, arbitrary attributes, complete
action URLs, paths, queries, or fragments. It does not interact with forms,
make another request, or affect availability or Risk scoring.

Observed network context maps one public endpoint address to its registered IP
network. A delivery network, proxy, shared host, load balancer, or
location-dependent DNS response may hide the origin. Neither the technology
profile nor network registration identifies a hosting account or proves
control.

When the submitted target is a public IP address, Deep Lookup can make one
bounded reverse-DNS query and show the returned PTR names as operator-published
routing context. A PTR name can be stale, generic, delegated, or shared. It
does not prove that the named party owns or controls the address or any hosted
service.

Passive posture is not vulnerability scanning. WHOISleuth does not deliver
payloads, authenticate to the target, crawl for flaws, enumerate every
supported protocol, or confirm exploitability.

## Risk and Opportunity

Risk and Opportunity are separate, versioned heuristic scores:

- **Risk** helps prioritise registered candidates using explainable observed
  factors.
- **Opportunity** helps prioritise apparently available candidates. It is not a
  valuation or purchase recommendation.

Risk groups related evidence into contextual families so repeated observations
of the same kind do not manufacture independent corroboration. Optional
provider findings can contribute only through the explicit allowlist and
corroboration rules of the current scoring model. A provider miss, outage, or
unsupported target contributes nothing.

Always review the factor list and original evidence. A score does not establish
maliciousness, ownership, safety, or intent. The [CLI guide](cli.md#offline-risk-calibration)
documents deterministic offline calibration against analyst-labelled fixtures.

## Guided investigations

Dashboard can coordinate three fixed recipes:

- brand sweep;
- infrastructure pivot; and
- new-domain triage.

The guide shows one current action, concrete instructions, request implications,
and reviewed, partial, or skipped outcomes. It can carry one canonical target,
an explicitly selected candidate, and a bounded set of reviewed Bulk domains
between tools. Tool links focus the relevant input, and a return control keeps
the current guide step reachable beside long results.

The guide stores only compact progress in the current tab's `sessionStorage`.
It does not decide when evidence is sufficient, create a case automatically,
or infer a finding from navigation. Analysts remain responsible for starting
each collection action and marking its outcome.

## Browser-local storage and archives

Cases, campaigns, Brand Profiles, watchlists, shortlist entries, Certificate
Transparency history, detection rules, analyst-selected relationship
observations, and explicitly saved Bulk sessions use bounded native IndexedDB
stores. Relationship observations
are never retained automatically: Bulk writes one only after the analyst
selects **Retain observation**. Browser storage can still be cleared or evicted
and does not synchronize across devices.

Dashboard can create one deliberate workspace archive for the supported
collections and preferences, including retained relationship observations and
compact saved Bulk sessions. Version 2 adds the Bulk-session section while
version 1 archives remain readable and do not invent that missing section.
The recommended download wraps the ordinary checksummed archive in
passphrase-based browser-local authenticated encryption. The passphrase is
never stored or sent to the server and cannot be recovered. A separately
labelled unencrypted download remains available for compatibility. Import
detects either format, unlocks encrypted files locally, previews changes, and
uses the existing non-destructive merge rules. Both formats exclude login sessions,
passwords, API credentials, hosted-monitor keys, raw upstream payloads, tab
state, and unrelated browser storage.

The active IndexedDB codec remains plaintext JSON. Archive encryption protects
the downloaded file while locked, not an open Console or the active browser
database. See [browser-local data architecture](browser-local-data.md) for the
full threat model, migration, rollback, capacity, and encryption boundaries.

## Reports and exports

Exports are created locally and only after an explicit action. Depending on the
workflow they can contain public registration contacts, analyst notes, source
observations, or compact case history.

- Use a domain Lookup Markdown report for a bounded readable registry,
  registrar, and WHOIS source summary. It omits raw registration payloads and
  expanded contacts.
- Use the Lookup JSON evidence package when complete captured source material
  is required, and treat it as potentially containing public contact data.
- Build a case response packet only after recording the category, affected
  party, exact HTTP(S) URLs, observed harm, UTC observation time, and separately
  sourced contact routes. JSON, Markdown, and email-text outputs remain local,
  require review, and do not submit anything.
- Defensive domain lists require an explicit reviewed selection and eligible
  analyst disposition. Review their exclusions, expiry, provenance manifest,
  and paired rollback instructions before applying them. Wildcard RPZ coverage
  is opt-in.
- Review each file before sharing it.
- Keep sensitive analyst notes out of reports unless needed.
- Treat source timestamps and fingerprints as provenance and deduplication
  context, not proof of legal custody or ownership.
- Do not confuse a whole-workspace archive with a single-case evidence report.
- Do not treat a response packet as a submitted abuse report or a defensive
  export as an applied control.

The synthetic demo has a separate export schema marked `synthetic: true`. It
cannot be imported as live evidence.
