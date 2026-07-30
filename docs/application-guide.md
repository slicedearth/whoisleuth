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
Press **Ctrl+Enter** or **Command+Enter** in the query field to start the same
validated submission as the Run lookup button.

Before starting, expand **Collection preflight** to review the target count,
selected profile, included, optional, or policy-disabled source families,
retention boundary, cancellation controls, and important limitations. The same
summary appears in Bulk and at approval-gated guided-investigation steps. It
describes planned source families rather than promising an exact request count:
redirects, referrals, source eligibility, and bounded retries can change the
number of requests that actually run.

The primary assessment, source health, and material registration conflicts
remain expanded. Long RDAP and WHOIS records and secondary DNS, HTTP, page,
passive-posture, technology, TLS, and observed-network cards start collapsed.
Their state and summary remain visible. Expand a section before relying on its
evidence, collection time, or limitations.

During collection, Lookup identifies the requested source families and shows
elapsed time plus a 40-second browser deadline. Every core Express and Netlify
deployment currently uses one buffered response and keeps each source pending
until the final envelope arrives. The repository has an offline incremental
protocol and qualification harness, but no core deployment adapter enables it.
If a future custom adapter passes the documented staging and proxy gates,
bounded per-source updates would remain temporary display state, not saved
evidence or claims that missing data is absent.
**Cancel lookup** stops the browser from waiting and discards any incomplete
response; already-admitted server work can still finish within its existing
bounds. Leaving Lookup applies the same browser cancellation.

If a completed result contains limited Registry RDAP, WHOIS, or domain-evidence
states, **Evidence coverage** offers an explicit source-family refresh. Results
are normalized into a short transient health summary, with a 2 MiB response
bound, and are not merged into the original envelope. A result that is at
least seven days old can offer the same reviewed refreshes for otherwise
complete sources. Run a complete Lookup before saving, comparing, or exporting
replacement evidence so observations collected at different times are not
silently combined.

After a successful deep full response, **Collection timing** reports total
request time plus the duration and settle offset of each source branch that
actually ran. Branches overlap, so their durations are not additive. A settled
branch can still have a partial, unavailable, not-found, or error state; use
the source card for that evidence status. The waterfall shows the retained
duration and settle offset without repeating the same rows below it; an
equivalent exact list remains available to assistive technology. It is not a
progress trace. Fast and compact responses retain their existing diagnostics
and omit this timing object.

Once a result is available, the sticky section rail tracks the current
evidence group. The topology uses separate visual families for registry,
network, web, derived, and analyst evidence, with an adjacent key. Shapes and
icons identify those families, while a stable distinct colour marks each source
inside the topology. Evidence cards retain neutral borders and headings so the
source palette does not compete with the content. The palette uses cyan, blue,
violet, magenta, and cool neutral tones with deliberately varied lightness.
Red, amber, and green remain exclusive to semantic status. Source state remains
a separate dot and text label, so colour does not replace success, partial,
unavailable, or error semantics.

Risk and Opportunity cards show signed factor bars beside their exact factor
lists. Domain results can also show a connected registration-source agreement
plot, certificate validity and chain summary, and a bounded service and
technology map. The agreement plot joins each compared field across
publications and uses shape, glyph, and state colour together. Observed
lifecycle events use individual colours while their shapes retain the event
family. These visuals use only evidence already present in the response.
Source tables, status labels, collection times, provenance, and limitations
remain the complete review surface.

**Evidence coverage** summarizes which requested source and analysis families
completed and which remained limited, unavailable, skipped, unsupported,
unknown, or not found. It preserves those states separately, lists retained
limitations, and never retries a source or converts incomplete collection into
a clean finding.

After a successful Lookup, **Download report** creates a readable Markdown
summary locally in the browser. Domain reports include registry, registrar,
WHOIS, Risk, and limitation context. IP reports include normalized network
registration and reverse-DNS evidence. ASN reports include normalized routing
registration evidence. Each report preserves source health, collection time,
partial states, and limitations while deliberately excluding raw RDAP and
WHOIS responses, expanded contacts, provider payloads, scripts, and remote
assets.

When a domain case is open, **Retain selected normalized facts** lets you save
only the fields needed for later review. Each field keeps source, observation
time, collection depth, source state, completeness, truncation, schema version,
and limitations. A later Lookup compares those fields without converting an
unavailable or incomplete source into a change or an absent finding.

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
complete-result counts, including a **Has review cues** scope for candidates
with at least one visible contextual cue. Candidate scope, mutation-family,
text, and certificate-history filters operate on the complete bounded result,
as do generated-order, alphabetical, generation-path, reference, script, and
review-cue sorting. Local candidate sets initially place visible review cues
first, then use generation-path count and domain as deterministic tie-breakers.
Sorting changes presentation only and does not change candidate generation,
evidence, scoring, or selection.

Certificate Transparency search is a separate hosted action. It groups
observed hostnames by canonical registrable domain and retains bounded first
and last observation times plus certificate counts. These timestamps describe
public-log observations. They do not prove registration time, website activity,
ownership, or maliciousness. Structured certificate-log results initially sort
by latest retained observation. **Reset view** restores that default for
certificate-log results and restores review-cue ordering for local generation.

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

The lookalike mail-exposure review groups the currently filtered compact rows
without another request. It keeps receiving mail with SPF and DMARC, receiving
mail with an authentication gap, incomplete authentication evidence, null MX,
no explicit MX, and incomplete DNS evidence separate. When a Brand Profile is
active, the review compares those observations with its configured standard,
defensive-no-mail, or parked mail posture. That profile is analyst-configured
context rather than a live observation. The review never opens an SMTP
connection, sends a message, tests a mailbox or catch-all behavior, or treats
mail configuration as evidence of use, control, intent, safety, or abuse.
Selecting one classification adds only those visible domains to the existing
browser-local selection so the ordinary reviewed export, case, disposition,
rescan, and Monitor actions remain explicit.

Bulk relationship evidence compares only observations already collected in the
current scan. It can highlight exact nameserver sets, addresses, tracking
identifiers, favicons, official asset hosts, and native certificate hashes. A
shared observation is a pivot for investigation, not proof of common ownership,
control, intent, coordination, or abuse.
The bounded relationship map summarizes those same groups and member domains;
the exact normalized values and methods remain in the cards beneath it.

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
Stacked bars summarize the same exact counts retained in the accompanying
tables. The two-domain workspace similarly adds a field matrix while preserving
source state, values, evidence links, conflicts, one-sided evidence, and
limitations in its table.

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

When an active Brand Profile is available, **Brand mimicry review** organizes
exact or perceptual favicon relationships, official-domain asset references,
independent page-component comparisons, credential-surface context, and
bounded review-language matches. Each cue retains its own method and
provenance. WHOISleuth does not combine them into a mimicry or maliciousness
score, and common infrastructure, templates, libraries, or analytics can
produce legitimate relationships.

**Service dependency review** reuses current DNS evidence to surface CNAME and
HTTPS alias-mode targets. External targets are manual review leads. WHOISleuth
does not follow them, query provider accounts, test claimability, or label a
service dangling or vulnerable. Complete current DNS evidence with no alias is
reported only as a point-in-time non-observation; incomplete DNS remains
unavailable.

**DNS change rehearsal** is available under a completed authoritative DNS
health result in Deep Lookup. Enter the complete intended nameserver set,
optional in-bailiwick glue, intended DS, MX, CAA and critical address sets, the
DNSSEC change type, and reviewed readiness confirmations. The local planner
keeps proposed values separate from the current observation, highlights
unresolved evidence, set changes, missing glue, unprepared authorities, TTL
preparation, and DNSSEC ordering, then presents an ordered change and rollback
checklist. A deliberate JSON download preserves the reviewed comparison,
unknowns, provenance boundary, and limitations. Entered values remain analyst
assertions. Nothing is saved automatically. The rehearsal makes no request,
changes no DNS or registry state, and cannot guarantee propagation or
correctness.

### Monitor

Monitor contains Cases, Campaigns, Relationships, and Watchlists.

- **Cases** retain analyst status, disposition, tags, notes, a bounded history
  of compact normalized evidence snapshots, analyst-selected evidence pins,
  decision rationales, and reviewed response actions with follow-up outcomes.
  Pins, decisions, and actions stay separately typed so an analyst assertion is
  never presented as collected evidence.
- **Campaigns** group existing case domains without duplicating their evidence
  or implying attribution. An expanded campaign projects bounded counts for
  password fields, official-identity relationships, redirect or transport
  review, and mail routing from each linked case's latest retained snapshot.
  It keeps unavailable cases, limited evidence, and unreviewed dispositions
  visible. Cue overlap is expected and the projection is not a score,
  ownership claim, campaign-attribution finding, or maliciousness
  determination.
- **Relationships** review analyst-selected Bulk observations and project
  typed, provenance-backed links across those records, stored case evidence,
  and campaign membership without another network request. The Evidence
  clusters review layer groups connected cases, keeps every contributing
  relationship inspectable, and qualifies common shared infrastructure.
  A separate website-profile view groups exact curated technology identifiers
  and page-identity digests across the latest explicitly saved compact
  snapshot for each domain. It can be searched by domain or evidence type and
  keeps partial snapshots visible. Common software, templates, placeholders,
  and copied content mean these groups are pivots rather than attribution.
  Split, merge, label, and dismiss controls alter only the current review view;
  export the reviewed view if it needs to be retained.
- **Watchlists** retain bounded material-change timelines and can be rescanned
  deliberately. A selected domain can show a capped evidence-category timeline
  across retained checks; the exact before and after values remain listed below
  it.

The **Investigation timeline** projects deliberately retained Lookup website
snapshots, saved Bulk sessions, watchlist checks, case evidence, individual
pins, and relationships. Filter by area and freshness to find old observations
across the workspace. The displayed age is measured from the retained
observation time using an explicit bounded threshold. It does not perform a
refresh or establish the current state of a domain.

The **Review inbox** is a bounded local queue projected from retained cases,
planned case actions, material watchlist changes, and incomplete saved Bulk
sessions. Its filters and due-state labels help an analyst resume work; opening
an item does not start collection, change a disposition, submit a response, or
claim that the underlying evidence is complete.

The Dashboard **hostname-only handoff** accepts a pasted domain or HTTP(S) URL
and constructs a Deep Lookup link from the normalized hostname only.
Credentials, port, path, query, and fragment are omitted. Opening the link
fills Lookup but does not submit it, so the analyst still reviews the target
and collection plan.

Below the inbox, **Contact and lifecycle review** projects reporting routes
only from deliberately saved case actions. A due label means the saved due or
follow-up date has arrived; it does not prove that a route is reachable,
monitored, suitable, or responsible. The local iCalendar export contains
bounded action-review and observed-expiry review dates without case notes or
recipient values. An observed expiry date remains point-in-time evidence, not
a release, deletion, availability, or acquisition forecast.

Inside an expanded case, the response workspace keeps evidence pins, observed
facts, analyst assertions, decisions, actions, and manual investigation steps
separately typed. Its decision packet summarizes required incident facts,
source freshness and limitations, open contradictions or unknowns, recipient
provenance, disposition, and follow-up state before a local export. It never
submits a report or treats a planned action as completed.

The complete evidence timeline remains depth-aware. A Fast observation does
not erase last-known Deep-only evidence, and score changes are compared only
when their explicit model versions match.

Monitor's custom-rule view includes optional reviewed static page-pattern
packs. The packs are fixed sets of the same bounded, inspectable rule
conditions available to an analyst. They use retained password-field, favicon,
official-asset, language, mail, and availability cues; contribute no custom
score by default; and create review tags rather than maliciousness findings.
Installing a pack makes a browser-local copy that can be inspected, disabled,
edited, exported, or deleted.

An open domain case can also turn a selected Lookup checkpoint into a reviewed
acquisition-transition plan. Mark each fact as expected to stay the same,
expected to change, or requiring manual review. After a later Lookup, the
comparison keeps unavailable, conflicting, missing, and uncollected evidence
indeterminate instead of presenting it as successful change. The plan verifies
only the selected observable facts and does not establish acquisition,
ownership, service health, or cutover completion.

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

A collapsed **Acquisition due diligence** workspace reuses the evidence already
present in a Deep result. It organizes the authority and confidence behind the
registration decision, published lifecycle dates and EPP statuses, interpreted
transfer constraints, current web and mail dependencies, and separately
attributed contact routes. It then maps the observed nameserver, web, mail, and
TLS dependencies that may need continuity during a transition. Registry
eligibility, lifecycle, and transfer-policy entries remain manual confirmation
prompts rather than locally inferred policy claims. The workspace makes no
extra request and does not determine valuation, legal rights, registry
eligibility, registrar terms, price, release timing, or acquisition success.
Unavailable and partial source states remain visible rather than being
converted into a clean finding.

The **Analyst decision workspace** can download a versioned, integrity-stamped
JSON review containing the bounded evidence projection, current analyst
decision, short rationale, completed manual checks, outstanding checks, and
explicit limitations. A packet remains `draft` while its decision is unresolved
or any manual check is outstanding. A `reviewed` packet records checklist
completion only. It does not verify a counterparty or external statement and
does not reserve, value, purchase, submit, or transfer the domain. The public
Demo marks its equivalent artifact as synthetic.

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
- explainable page-role labels and fixed client-side behaviour indicators
  derived from capped static HTML and inline-script prefixes, without fetching
  referenced scripts, executing code, or retaining matched source;
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
headers. It also compares an allowlist of already-observed passive response
headers against fixed runtime, framework, commerce, and delivery signatures;
only the curated match and evidence class survive, not the header value.
Static collection does not execute JavaScript, and sites can conceal
or remove distinctive indicators. Site-builder and commerce signatures do not
identify the host platform from a retained third-party resource origin alone;
they require a page, generator, or additional storefront marker. Delivery
origins can still appear as separately attributed delivery evidence. WHOISleuth
does not fetch referenced scripts.
A browser-library advisory match is a lead for review, not proof that the
component is loaded, reachable, vulnerable in context, or exploitable. A
non-match does not establish that no vulnerable component exists.

Page-role and client-behaviour profiles are similarly review aids. A role is a
bounded heuristic, and an observed browser API can be normal application
behaviour. Neither profile establishes page purpose, legitimacy, tracking,
credential theft, vulnerability, execution, ownership, intent, safety, or
maliciousness.

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
Monitor can deliberately export explicitly selected cases with reviewed
dispositions and retained normalized evidence into that same offline dataset
contract. The export excludes notes, tags, assertions, actions, contacts, raw
source data, provider payloads, and stored Risk scores. It does not train or
change the model.

## Guided investigations

Dashboard can coordinate three standard recipes:

- brand sweep;
- infrastructure pivot; and
- new-domain triage.

The guide shows one current action, concrete instructions, expected evidence,
completion criteria, request implications, and reviewed, partial, or skipped
outcomes. A partial or skipped outcome requires a short reason so deferred,
unavailable, or inapplicable work is visible in the full plan and compact
export. It can carry one canonical target, an explicitly selected candidate,
and a bounded set of reviewed Bulk domains between tools. Tool links focus the
relevant input, and a return control keeps the current guide step reachable
beside long results.

The guide stores only compact progress in the current tab's `sessionStorage`.
It does not decide when evidence is sufficient, create a case automatically,
or infer a finding from navigation. Analysts remain responsible for starting
each collection action and marking its outcome. At a case stage and after all
steps have an outcome, a read-only handoff checklist summarizes whether the
current browser-local case has a reviewed disposition, a typed analyst
decision, supporting evidence pins, and explicit unresolved unknowns or
contradictions. This checklist measures workflow structure only. It does not
validate an analyst conclusion or make a claim about the target.
Approval-gated steps show the same Collection preflight language used by
Lookup and Bulk before the analyst opens the tool. Approval applies only to
that bounded guide step. It is not general authorization for active testing or
an assurance that every named source will succeed.

The Console also offers a short in-tab undo after changing a Bulk review state,
shortlist membership, case tags, or a temporary evidence-cluster label. The
notice identifies the action and affected record and expires after 12 seconds.
Undo never starts a request, reverses an import or export, restores a confirmed
deletion, changes case disposition, or rewrites collected source evidence.
Reloading the page clears the pending undo action.

Dashboard also provides a browser-local template manager. A custom template
must start from one of the three standard guides. It can rename instructions,
clarify expected evidence and completion criteria, omit an existing step, or
add an approval gate. It cannot introduce a new route or operation, execute
code, start a request, submit evidence, alter a case, or remove an approval
gate required by the standard guide. Starting a custom guide copies a bounded
template snapshot into that tab's guide state so later template edits do not
silently change work already in progress.

Investigation templates are stored in the current browser's IndexedDB
collection. They can be exported or imported as a strict versioned JSON
document and are included in the deliberate workspace archive. They contain
analyst-authored workflow guidance, so review them before sharing.

Monitor's **Inbox** projects one evidence-gap item per unresolved case when
that case retains an explicit partial, inconclusive, unknown, or truncated
evidence pin or an open analyst-authored unknown or contradiction. It does not
infer facts that were never saved. Resolving the queue requires reviewing the
owning case rather than treating a source failure as absence.

Monitor's **Timeline** view combines a bounded projection of deliberately
retained case snapshots, evidence pins and checkpoint facts, website-profile
snapshots, watchlist checks, and relationship observations. Filters cover
entity, case, source, evidence versus change, and observation age. Every event
shows observation time separately from browser storage time, preserves
completeness, truncation, derivation, and source state, and links back to its
owning record. The projection does not copy raw payloads, pin values, analyst
notes, or relationship values, and it never starts collection.

The Cases view also accepts the strict WHOISleuth external-findings schema,
fixed-column finding rows in CSV or JSON, sanitised web-capture summaries, and
bounded STIX 2.1 or MISP event JSON. Every file is validated and previewed
locally before a merge. Generic row conversion accepts only domain, category,
summary, observation time, completeness, limitation, and reference columns.
The capture schema accepts bounded titles, normalized HTTP(S) origins,
technology labels, screenshot SHA-256 digests, completeness, and limitations;
it rejects raw HTML, screenshot content, cookies, request bodies, complete
URLs, and arbitrary fields. STIX and MISP previews separate accepted claims,
duplicates, conflicting identifiers, and exclusions, then require an existing
case to be selected. Merged claims become external `unknown` assertions with
their source-file SHA-256 digest, publisher, external identifier, timestamps,
confidence, labels, and markings. They do not become collected evidence and do
not create cases, start collection, change scores, publish events, or enable
correlation. See [External findings and intelligence import](external-findings-import.md).

Brand Profile posture results include a local **desired-state review**. It
organizes the selected standard, defensive-no-mail, or parked profile into
registration, mail, transport, and certificate-policy groups while preserving
each server-returned check status. The external-dependency review keeps
observed and unavailable dependencies distinct. It never tests provider
accounts or claimability and never labels a dependency dangling, abandoned,
vulnerable, safe, or controlled by another party.

## Browser-local storage and archives

Cases, campaigns, Brand Profiles, watchlists, shortlist entries, Certificate
Transparency history, detection rules, analyst-selected relationship
observations, explicitly saved Bulk sessions, website profile snapshots, and
investigation templates use bounded native IndexedDB stores. Relationship observations
are never retained automatically: Bulk writes one only after the analyst
selects **Retain observation**. Browser storage can still be cleared or evicted
and does not synchronize across devices.

Dashboard can create one deliberate workspace archive for the supported
collections and preferences, including retained relationship observations and
compact saved Bulk sessions. Version 2 added Bulk sessions, version 3 added
website profile snapshots, version 4 added investigation templates, and version
5 adds the current website-profile snapshot section contract. Versions 1
through 4 remain readable and do not invent missing later sections.
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
The local CLI's `verify-artifact` command can check archive structure and
checksums without displaying evidence. An encrypted archive requires a separate
passphrase file before the command can authenticate its ciphertext and inspect
the inner checksums; without one, only the envelope is checked. See
[offline artifact verification](cli.md#offline-artifact-verification).

## Reports and exports

Exports are created locally and only after an explicit action. Depending on the
workflow they can contain public registration contacts, analyst notes, source
observations, or compact case history.

- Use a Lookup Markdown report for a bounded readable domain, IP, or ASN
  summary. It omits raw registration payloads and expanded contacts.
- Use the Lookup JSON evidence package when complete captured source material
  is required, and treat it as potentially containing public contact data.
- Build a case response packet only after recording the category, affected
  party, exact HTTP(S) URLs, observed harm, UTC observation time, and separately
  sourced contact routes. Select the intended audience first: the local preview
  identifies included and excluded evidence, required redactions, expected
  attachments, recipient gaps, and follow-up fields for registrar, registry,
  hosting/network, security-contact, browser/blocklist, or internal-SOC review.
  JSON, Markdown, and email-text outputs remain local, require review, and do
  not submit anything.
- Defensive domain lists require an explicit reviewed selection and eligible
  analyst disposition. Review their exclusions, expiry, provenance manifest,
  and paired rollback instructions before applying them. Wildcard RPZ coverage
  is opt-in.
- Export a selected reviewed-case calibration dataset only when the case
  domains and dispositions are appropriate to include in an offline evaluation
  corpus. Confirm the local review showing included and excluded counts, domain
  names, dispositions, and excluded evidence classes before download. The file
  is not anonymous and does not alter Risk automatically.
- Review each file before sharing it.
- Keep sensitive analyst notes out of reports unless needed.
- Treat source timestamps and fingerprints as provenance and deduplication
  context, not proof of legal custody or ownership.
- Do not confuse a whole-workspace archive with a single-case evidence report.
- Do not treat a response packet as a submitted abuse report or a defensive
  export as an applied control.

The synthetic demo has a separate export schema marked `synthetic: true`. It
cannot be imported as live evidence.
