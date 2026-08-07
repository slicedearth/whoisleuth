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
SOA publication, HTTPS service-binding records published for the origin, and
the effective CAA policy found from the exact hostname or its nearest
publishing parent.
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

The Overview and At a glance assessment remain visible. Open **Detailed
assessment** when you need decision support, claim readiness, a portable
hand-off, or acquisition review. Every top-level evidence family starts
collapsed; its bounded summary, source count, and limitation count remain
visible. Open a family directly, follow a section or source-map link to reveal
its destination, or use **Expand all** and **Collapse all**. Long RDAP and WHOIS records and
secondary DNS, HTTP, page, passive-posture, technology, TLS, and
observed-network cards remain separately collapsed inside an open family.
Selecting an acquisition, brand, incident-response, or owned-domain task
reorders the section navigation without changing collection, automatically
opening evidence, or hiding any source. Expand a section before relying on its
evidence, collection time, or limitations.

The Registry interpretation panel classifies bounded `rdapConformance`
declarations already returned by registry and registrar RDAP. Recognised,
obsolete, and unclassified identifiers remain distinct. When `reverse_search`
is advertised, an analyst can deliberately reveal a bounded local preview of
the exact published entity field and value that a later request would disclose.
The preview makes no request, is not saved, does not fetch the server help
document, and cannot establish that the operator supports or authorises the
query. An individual response that omits the declaration is not treated as
proof that the server does not support it.

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
are normalised into a short transient health summary, with a 2 MiB response
bound, and are not merged into the original envelope. Repeated refreshes form
a bounded versioned display chain with explicit observation and supersession
times. That transient chain is cleared with the page and is not saved or
exported. Task-specific defaults use different review ages for registration,
network, and web evidence. The analyst can replace them with bounded one-to-365
day thresholds for the current result. The versioned policy is shown in the
quality panel and included in the downloaded investigation brief; custom values
are not saved. Thresholds organise review only and do not make an older
observation false or a newer observation complete. Run a complete Lookup before
saving, comparing, or exporting replacement evidence so observations collected
at different times are not silently combined.

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
network, web, derived, and analyst evidence, with an adjacent key. Colour,
shape, and icon identify those families consistently; sources in the same
family deliberately share an accent. The corresponding Registration,
Relationships and history, Web and DNS, Source quality, and Case and response
section headings use the same family accents. Red, amber, and green remain
exclusive to semantic status. Source state remains a separate dot and text
label, so colour does not replace success, partial, unavailable, or error
semantics. Each relationship also points to a bounded source-ledger entry
carrying the source label, section anchor, observation time, completeness, and
limitations. This supports traceability without copying raw responses into the
graph.

Risk and Opportunity cards show signed factor bars beside their exact factor
lists. Domain results can also show a connected registration-source agreement
plot, certificate validity and chain summary, and a bounded service and
technology map. The agreement plot joins each compared field across
publications and uses shape, glyph, and state colour together. Observed
lifecycle events use individual colours while their shapes retain the event
family. These visuals use only evidence already present in the response.
Source tables, status labels, collection times, provenance, and limitations
remain the complete review surface.

Deep domain Lookup also compares a currently observed certificate issuer with
the effective CAA publication found from the exact hostname or its nearest
publishing parent. Recognised issuer mappings can
produce an aligned or apparently-outside-current-policy review state. An
unknown issuer or incomplete DNS remains indeterminate. When the active Brand
Profile contains a reviewed expected issuer,
SAN pattern, or SPKI value for the official domain, the same panel compares that analyst
baseline without treating a difference as compromise or improper issuance.
Current CAA cannot establish the policy that applied when an existing
certificate was issued. The same panel lists recognised `accounturi` and
`validationmethods` parameters and flags unrecognized parameters for review.
Parameter publication is context only: WHOISleuth does not contact a certificate
authority account, validate account ownership, or establish whether an
authorisation was used for the observed certificate.

**Evidence coverage** summarises which requested source and analysis families
completed and which remained limited, unavailable, skipped, unsupported,
unknown, or not found. It preserves those states separately and shows endpoint
class, observation age, explicit truncation, retained limitations, branch
timing, downstream uses, and whether a deliberate refresh is available. It
never retries a source or converts incomplete collection into a clean finding.
Its freshness policy records the task, policy version, and separate
registration, network, and web thresholds used for refresh suggestions.

After a successful Lookup, **Download report** creates a readable Markdown
summary locally in the browser. Domain reports include registry, registrar,
WHOIS, Risk, and limitation context. IP reports include normalised network
registration and reverse-DNS evidence. ASN reports include normalised routing
registration evidence. Each report preserves source health, collection time,
partial states, and limitations while deliberately excluding raw RDAP and
WHOIS responses, expanded contacts, provider payloads, scripts, and remote
assets.
Readable Lookup reports include a quiet WHOISleuth version and source footer by
default. The browser export control can omit that presentation footer without
changing the evidence, source-health states, or limitations in the report.

**Download brief** creates a shorter deterministic decision packet from the
current task view. It keeps verified normalised facts, explicit
contradictions, unknowns, source-quality counts, observed relationship types,
and suggested manual next steps separate. It does not add analyst assertions,
make an attribution, or turn an incomplete source into a negative conclusion.
The brief can be downloaded or copied locally. When a case is already open,
the analyst can deliberately record that a brief was prepared as a handoff
event; this records summary metadata in the case trail without copying the
brief or changing any evidence.
The Identity & trust graph lens classifies observed destinations as the same
origin, within the queried registrable domain, a reviewed Brand Profile
relationship, external, or unresolved. These are routing and declaration
relationships, not proof that data was submitted or that two hosts share
ownership or control.
The Certificate lens connects the requested hostname to the observed leaf,
runtime trust and hostname-match results, validity window, bounded SAN scope,
public-key digest, issuer and any reviewed Brand Profile certificate baseline.
Each edge retains its own source health and limitations; a failed or incomplete
TLS check is not shown as an absent certificate relationship.

The collapsed **Replay exported evidence** control accepts only a current
first-party Lookup evidence JSON document of up to 5 MB. The browser validates
the schema, nesting, and structured entry count, calculates a SHA-256 file
digest, and can compare it with a trusted checksum pasted before import. It
displays a bounded normalised source and fact summary, historical review brief,
and relationship graph without uploading the file or contacting the target.
Replay time is not observation time. Raw source payloads in the export are not
rendered, and future or foreign schemas fail closed.

When a domain case is open, **Retain selected normalised facts** lets you save
only the fields needed for later review. Each field keeps source, observation
time, collection depth, source state, completeness, truncation, schema version,
and limitations. A later Lookup compares those fields without converting an
unavailable or incomplete source into a change or an absent finding.

**Export evidence JSON** remains the separate full-fidelity option. It can
include normalised and raw registration sources, supporting observations,
diagnostics, comparisons, and provenance. It can contain public contact data,
so review and store it accordingly. Offline replay intentionally exposes only
its bounded normalised review projection.

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
ownership, or maliciousness. It also groups names observed together in each
retained public certificate record. Cross-domain issuance and wildcard groups
are review leads only; shared certificates can reflect ordinary hosting,
platform, or certificate-management arrangements. The issuance-group cap is
independent of the registrable-domain result cap, so one projection cannot
silently change the completeness of the other. Structured certificate-log
results initially sort by latest retained observation. **Reset view** restores
that default for certificate-log results and restores review-cue ordering for
local generation.

**Nameservers** is a separate, deliberate hosted pivot. Enter one nameserver
hostname and one registry suffix. WHOISleuth uses IANA RDAP bootstrap data to
select that suffix's registry and requests the registry's RFC 9082
`nsLdhName` domain search. It inspects a bounded response, retains at most 200
normalised domains, and exposes unsupported, rate-limited, unavailable,
partial, and no-result states without broadening them. The result is a lower
bound for that one registry, not a passive-DNS dataset or internet-wide reverse
nameserver inventory. A shared nameserver is an investigation pivot, not proof
of common ownership, control, intent, activity, or maliciousness. Selected
domains can continue through the ordinary reviewed Discover-to-Bulk handoff;
the nameserver query and raw registry response are not saved in the browser
workspace.

Filtered and sorted candidate lists are paginated locally. Selecting all
filtered entries operates on the complete bounded filtered set, not only the
visible page. New result sets start unselected so moving hundreds or thousands
of candidates into Bulk always requires an explicit review choice.

### Bulk

Bulk checks each canonical domain through a separate bounded Lookup request.
It supports pasted domains, text files, common delimited files, and handoffs
from Discover. Results can be filtered and sorted without changing the saved or
exported scan data.

One browser or CLI Bulk job accepts at most 500 Fast targets or 50 Deep
targets. The Standard pacing option runs at most eight Fast or three Deep
lookups concurrently; Gentle and Balanced apply lower pressure. These are
per-job safety and resource ceilings, not authorisation to scan domains. Each
target remains subject to deployment, provider, and source limits.

Bulk sessions are saved only when the analyst names and saves the current
investigation. Each bounded browser-local session retains the input domain
order, scan mode, compact settled rows, and per-source completion states so it
can be loaded, compared with another saved session, or resumed for domains that
never reached a settled row. Saving never retains raw source payloads or
expanded contact records, and resuming does not repeat failed rows unless the
analyst separately selects **Retry failed**.

Compact Deep rows also retain a versioned comparison envelope built only from
evidence already collected for that row. It contains at most 12 normalised
technology identifiers, one bounded TLS issuer label, one exact SPKI SHA-256
fingerprint, and the independent technology and TLS source states. The
two-domain workspace, peer-outlier review, saved-session change summary, and
CSV export can use those fields without another request. Empty or incomplete
fields retain their source state and are not treated as evidence of absence.
The complete technology evidence, certificate profile, page markup, script
references, and raw TLS material remain excluded. Saved session schema 3 adds
this envelope; schema 1 and 2 sessions remain readable and show the new fields
as not recorded.

The peer-outlier matrix derives a per-dimension cohort baseline only from rows
with comparable evidence. It reports baseline share, strong, moderate, or
fragmented consensus, observed share, contrast, and a bounded review score.
That score orders review within the current result set; it is not Risk and does
not imply maliciousness. Rows excluded by partial or unavailable evidence stay
explicit rather than being treated as outliers.

The lookalike mail-exposure review groups the currently filtered compact rows
without another request. It keeps receiving mail with SPF and DMARC, receiving
mail with an authentication gap, incomplete authentication evidence, null MX,
no explicit MX, and incomplete DNS evidence separate. When a Brand Profile is
active, the review compares those observations with its configured standard,
defensive-no-mail, or parked mail posture. That profile is analyst-configured
context rather than a live observation. The review never opens an SMTP
connection, sends a message, tests a mailbox or catch-all behaviour, or treats
mail configuration as evidence of use, control, intent, safety, or abuse.
Selecting one classification adds only those visible domains to the existing
browser-local selection so the ordinary reviewed export, case, disposition,
rescan, and Monitor actions remain explicit.

Bulk relationship evidence compares only observations already collected in the
current scan. It can highlight exact nameserver sets, addresses, tracking
identifiers, favicons, official asset hosts, and native certificate hashes. A
shared observation is a pivot for investigation, not proof of common ownership,
control, intent, coordination, or abuse.
The bounded relationship map summarises those same groups and member domains;
the exact normalised values and methods remain in the cards beneath it.

Relationship groups remain transient with the Bulk result unless the analyst
selects **Retain observation**. That action saves only the normalised value,
member domains, method, collection time, completeness, truncation, and stated
limitations in the current browser. It does not save the complete Bulk result,
raw lookup responses, or expanded contacts. Retained observations can be
reviewed and deleted under Monitor Relationships, included in the workspace
archive, found through local investigation search, and projected into the
relationship graph when at least two member domains also have local cases.
For projection-backed relationships, the table and graph inspector also show a
bounded discovery path from each retained case domain to the selected
infrastructure or identifier. The path records each comparison method,
classification, immediate parent, hop count, and scope distance using existing
local evidence only. Exported relationship graphs include the same minimised
path details. Distance is an explanation of the retained pivot, not evidence
of ownership, coordination, intent, maliciousness, or safety.
Each relationship also reports how many comparable cases in the current
browser workspace contain it. The resulting focused, shared, widespread, or
limited-sample label describes only this local collection. It is not an
internet-wide rarity estimate and does not strengthen an attribution claim.

Defensive registration coverage groups a generated scan by mutation family and
domain ending. It distinguishes protected or allowlisted domains, registered
exposures, available gaps, and unknown results without making extra requests.
Stacked bars summarise the same exact counts retained in the accompanying
tables. A deterministic next-action plan places available and unresolved rows
first, followed by registered candidates and profile-protected names. Its P1
through P3 labels describe review order only; they are not a risk or
maliciousness score. The CSV export includes the complete bounded plan.

Discover can optionally compare Unicode candidates with one analyst-selected
RFC 7940 LGR XML file. The file stays in the current browser tab, is capped at
2 MiB, rejects document types and entities, and retains only a normalised
single-code-point repertoire plus the local filename and SHA-256 digest. The
review reports whether candidate code points appear in the imported table for
the analyst-entered suffix. It does not evaluate contextual rules, variant
dispositions, eligibility, price, live acceptance, or availability, so
"listed by table" is never presented as registrable.
The two-domain workspace similarly adds a field matrix while preserving
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
external DMARC reporting authorisation, parses supported DKIM public-key
strength without retaining key material, checks whether configured retired
selectors remain published, and inventories bounded external nameserver,
mail, SPF, and reporting dependencies. Resolver failures and exhausted bounds
remain incomplete. External infrastructure is a review lead, not an ownership,
insecurity, or exploitability claim.

The **DMARC and SMTP TLS reports** workbench accepts deliberately selected
aggregate XML or JSON reports, including bounded gzip and ZIP containers. It
parses them entirely in the current browser tab and summarises sender IPs,
message volume, DKIM and SPF outcomes, dispositions, TLS delivery totals, MX
policy scope, and failure categories. Imported values are compared with the
active profile's official-domain list, but they are not added to the profile or
workspace. Leaving the page or selecting Clear removes the in-memory review.
The optional JSON download includes source-file and artefact digests; it does
not authenticate the report sender or turn an aggregate outcome into a current
safety or intent conclusion. XML document types and entities are rejected, and
file, decompression, entry, record, policy, and failure-detail limits are
enforced before presentation.

The profile can separately retain six expiring analyst attestations for
registrar MFA, recovery-email separation, registry lock, emergency contacts,
account audit logging, and zone backups. These statements are not inferred
from public evidence and must be reviewed by the analyst.

The browser-local **Domain Control Centre** organises every official domain
against the same analyst-authored operating context. A profile can record a
zone-intent label, lifecycle state, recovery dependency, and bounded approved
change windows. The summary highlights portfolio concentration, recovery
dependencies, nameserver-preflight coverage, planned changes, and retirement
state. These fields are planning context only: they neither change DNS nor
infer provider control. Approved windows label matching retained changes as
expected while preserving the underlying observations and their limitations.

An official-site baseline can retain bounded page identity and fingerprint
data without keeping page HTML, URL paths, query strings, credentials, or
complete email addresses. Comparison results remain contextual evidence and do
not prove common ownership or intent.

When an active Brand Profile is available, **Brand mimicry review** organises
exact or perceptual favicon relationships, official-domain asset references,
independent page-component comparisons, credential-surface context, and
bounded review-language matches. Each cue retains its own method and
provenance. Reviewed page-language packs cover a small fixed set of English,
Spanish, French, German, Portuguese, Italian, and Dutch account-pressure
phrases. A match retains only its fixed language and category label, not the
matched phrase or surrounding page text. WHOISleuth does not combine them into a mimicry or maliciousness
score, and common infrastructure, templates, libraries, or analytics can
produce legitimate relationships.

**Service dependency review** reuses current CNAME, HTTPS alias-mode,
nameserver, mail-server, and final HTTP-origin evidence. A fixed, bounded local
catalogue can label recognised service families without making another
request. Each match can expose the catalogue evidence class, source treatment,
licence treatment, source date, review age, and SHA-256 catalogue digest.
The offline signature audit reports stale metadata, suffix collisions, and
digest changes before a reviewed catalogue update is accepted.
Exact matches against three bounded passive page-title phrases can add a
collision-prone deprovision cue, while evidence older than 30 days is labelled
stale and incomplete DNS stays inconclusive. Analysts can optionally enter reviewed expected targets or parent
namespaces and exact reviewed false-positive targets for the current Lookup
view; neither input is retained. Candidate, unresolved, active, unsupported,
and false-positive labels remain manual review states. “Active” means only
that the target also appeared in the already-observed final HTTP navigation
chain. WHOISleuth does not follow targets, query provider accounts, test
claimability, or label a service dangling or vulnerable. A catalogue, scope,
or navigation match does not verify provider configuration, account ownership,
service assignment, abandonment, or claimability. Complete current DNS
evidence with no dependency is reported only as a point-in-time
non-observation; incomplete DNS remains unavailable.

**Domain-control change rehearsal** is available under a completed authoritative
DNS health result in Deep Lookup. Enter the complete intended nameserver set,
optional in-bailiwick glue, intended DS, MX, CAA and critical address sets,
DNSSEC and registrar-lock intent, an optional replacement certificate public-key
fingerprint, and reviewed readiness confirmations. The local planner keeps
proposed values separate from the current observation, highlights unresolved
evidence, set changes, missing glue, unprepared authorities, TTL preparation,
DNSSEC ordering, short-lived transfer unlocks and certificate-key sequencing,
then presents an ordered change and rollback checklist. A deliberate JSON
download preserves the reviewed comparison, unknowns, provenance boundary, and
limitations. Entered values remain analyst assertions. Nothing is saved
automatically. The rehearsal makes no request, changes no DNS, registrar or
certificate state, and cannot guarantee propagation or correctness.

The same authoritative DNS result retains a bounded SOA projection for each
responding selected authority. Lookup compares the primary name and serial
published by those authorities and exposes disagreements without treating them
as propagation proof or record absence. Serial agreement is only a
point-in-time consistency check across the authorities reached during that
request; it does not validate every resolver or secondary server.

### Monitor

Monitor contains Cases, Campaigns, Relationships, and Watchlists.

- **Cases** retain analyst status, disposition, tags, notes, a bounded history
  of compact normalised evidence snapshots, analyst-selected evidence pins,
  source-qualified sightings, first/last-observed source chronologies, decision
  rationales, and reviewed response actions with follow-up outcomes. Sightings
  keep deployment observations,
  provider reports, and analyst-reviewed states separate. Pins, sightings,
  decisions, and actions stay separately typed so an analyst assertion is never
  presented as collected evidence. A deliberate case control can export the
  bounded source-qualified sightings as a local STIX 2.1 bundle. Affirmative
  states become separately attributed observations, while every state remains
  a note so not-reproduced or expired reviews cannot erase earlier evidence.
  The export does not publish or transmit the bundle.
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
  relationship inspectable, and qualifies common shared infrastructure. An
  exact IP relationship can also be checked locally against a pinned,
  attributed Common-infrastructure snapshot containing only fresh reviewed
  cloud, delivery, and public-resolver CIDRs. A match identifies a shared
  published range, not an origin host, tenant, account, operator, ownership,
  intent, safety, or maliciousness. A non-match remains inconclusive because
  the catalogue is deliberately incomplete.
  A separate website-profile view groups exact curated technology identifiers,
  identity digests, normalised resource hosts, tracking identifiers, and
  external form-action origins across explicitly saved compact observations.
  It also calculates bounded weighted relationships from compatible latest
  snapshots while listing every contributing field and weight. First and last
  dates describe only browser-local saved history. It can be searched by
  domain or evidence type, keeps partial snapshots visible, and can record a
  selected cluster as a separately typed analyst assertion in one case.
  Common software, services, templates, placeholders, trackers, and copied
  content mean these groups are pivots rather than attribution.
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
claim that the underlying evidence is complete. Evidence-gap items link both
to the owning case and to a prefilled Deep Lookup refresh. Detail filters can
narrow the transient projection by retained source, observation age, case
domain, priority, and next manual action. Every row states why it received its
position in the deterministic overdue, due-date, priority, observation-time,
and stable-identity order. An analyst can
dismiss the exact current gap only after choosing a fixed review outcome. The
dismissal is recorded in the case investigation trail; it does not resolve or
delete a pin or assertion. A changed gap receives a new fingerprint and returns
to the queue.

The Dashboard **privacy-safe browser handoff** accepts a pasted domain or
HTTP(S) URL and reduces it to either the normalised hostname or sanitised
HTTP(S) origin. Credentials, port, path, query, fragment, and browser-local
identifiers are omitted. The default destination is a prefilled Deep Lookup
that does not submit. An analyst can instead configure an exact loopback
companion endpoint or HTTPS external endpoint; WHOISleuth discovers neither.
The preview shows the exact disclosed value, destination URL, and visibility,
and a non-Lookup destination requires explicit confirmation before opening.
An optional separate action records only the prepared handoff and normalised
domain in a selected browser-local case trail. It never records the external
result.

Below the inbox, **Contact and lifecycle review** projects reporting routes
only from deliberately saved case actions. A due label means the saved due or
follow-up date has arrived; it does not prove that a route is reachable,
monitored, suitable, or responsible. Its browser-local timeline can filter
upcoming, overdue, 30-day, or 90-day review events by evidence type and links
each event back to its case and retained source class. The local iCalendar
export contains
bounded action-review and observed domain-expiry dates plus certificate and
security.txt expiry dates only when the analyst explicitly selected those
facts as case evidence pins. It excludes case notes, recipient values, and
other evidence values. Every observed expiry date remains point-in-time
evidence, not a current-state guarantee, release, deletion, availability, or
acquisition forecast.

When a selected Lookup includes security.txt, its disclosure-health summary
organises retained contact, policy, encryption, language, and expiry coverage.
Expired, expiring, partial, and unavailable states remain distinct. The summary
performs no reachability check and does not prove that a published contact is
monitored, suitable, responsive, or responsible.

Inside an expanded case, the response workspace keeps evidence pins, observed
facts, source-qualified sightings, analyst assertions, decisions, actions, and
manual investigation steps separately typed. **Not reproduced** and **expired**
are analyst review states; they do not delete or negate the underlying
observation. Its decision packet summarises required incident facts,
source freshness and limitations, open contradictions or unknowns, recipient
provenance, disposition, and follow-up state before a local export. It never
submits a report or treats a planned action as completed.

The complete evidence timeline remains depth-aware. A Fast observation does
not erase last-known Deep-only evidence, and score changes are compared only
when their explicit model versions match.

Monitor's custom-rule view includes optional reviewed static page-pattern
packs. The packs are fixed sets of the same bounded, inspectable rule
conditions available to an analyst. They keep generic patterns separate from
brand-relative comparisons, explicitly label confidence as **review
required**, and can use retained password-field, off-origin
form-action, favicon, official-asset, urgent-language, wallet-prompt, mail, and
availability cues. Only the boolean existence of an external form action is
copied into compact case evidence, not its destination. Packs contribute no
custom score and create review tags rather than maliciousness findings.
Built-in packs pass duplicate-id and equivalent-logic lint plus benign and
held-out fixtures. A local JSON pack must use the same bounded validator,
allowlisted fields and operators, zero-score contract, and declarative rule
format; it cannot execute code. Installing a pack makes a browser-local rule
copy that can be inspected, disabled, edited, exported, or deleted.

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
| **Deep single Lookup** | Complete review of one important target. | Can add WHOIS, registrar RDAP, DNS with SOA zone context, HTTPS service-binding publications, and effective inherited CAA, public-IP PTR context, HTTP, favicon, page identity, privacy-minimised credential-surface counts, TLS, technology, passive posture, observed IP network context, and explicitly selected optional sources. |
| **Deep Bulk** | Richer comparison across a bounded candidate set. | Uses a compact response with WHOIS, DNS, website, TLS, mail, up to 12 normalised technology identifiers, a bounded TLS issuer label, and an SPKI SHA-256 fingerprint. Full raw sources, rich technology and certificate records, and single-Lookup-only enrichments remain omitted. |

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

The [registry data contract](registry-data-contract.md) documents normalised
source shapes, attempt provenance, diagnostics, caps, and compatibility rules.

## Registration and availability

WHOISleuth discovers RDAP services through IANA bootstrap data, validates
successful responses against the requested object, and records bounded
endpoint-attempt diagnostics. Domain lifecycle events are normalised without
discarding the bounded source list.

WHOIS follows a bounded referral chain. Its authority model protects a
positive registry observation from contradictory or failed later referrals.
Registrar RDAP, when available in a Deep single Lookup, remains a separate
source and cannot decide registration availability.

A collapsed **Acquisition due diligence** workspace reuses the evidence already
present in a Deep result. It organises the authority and confidence behind the
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
Demo marks its equivalent artefact as synthetic.

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
bounded resource hosts, tracking identifiers, external form-action origins,
source health, collection completeness, and timestamps. It excludes form
paths and queries, raw RDAP, WHOIS, HTTP, HTML, contact, and provider payloads.
Select an earlier and later snapshot of the same domain to review added,
removed, changed, unavailable, or incomparable fields. Monitor can search
exact historical relationships and explainable weighted latest-snapshot
relationships across domains. Differences and similarity are leads for
review, not evidence of compromise, ownership, coordination, intent, or
maliciousness. Saving, comparing, clustering, deleting, exporting, and
importing snapshots make no network request.

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
  evidence families. Generic activity, mail, age, or registration-privacy
  context cannot create Risk on its own.
- **Opportunity** describes acquisition-review readiness across registration,
  listing, contactability, lifecycle, and current-use dimensions. It is not a
  valuation, availability decision, release prediction, or purchase
  recommendation.

Risk groups related evidence into contextual families so repeated observations
of the same kind do not manufacture independent corroboration. Optional
provider findings can contribute only through the explicit allowlist and
corroboration rules of the current scoring model. A provider miss, outage, or
unsupported target contributes nothing.

Each explanation also shows evidence quality separately from the numeric score:
source-state coverage, observed evidence families, scan depth,
observation-time availability, and any collection limitations. Missing or
failed evidence never lowers either score and does not become evidence of
absence. Stored cases, Bulk sessions, and
shortlist entries retain the relevant model version so unlike scores are not
presented as a change in the domain.

Always review the factor list and original evidence. A score does not establish
maliciousness, ownership, safety, or intent. The [CLI reference](cli-reference.md#offline-risk-calibration)
documents deterministic offline calibration against analyst-labelled fixtures.
Monitor can deliberately export explicitly selected cases with reviewed
dispositions and retained normalised evidence into that same offline dataset
contract. An optional reviewed reason code supports bounded stratification; a
page-language match is reduced to a fixed indicator rather than exported text.
The export excludes notes, tags, assertions, actions, contacts, raw source data,
provider payloads, and stored Risk scores. It does not train or change the
model.

## Guided investigations

Dashboard can coordinate three standard recipes:

- brand sweep;
- infrastructure pivot; and
- new-domain triage.

The public Guide includes one deterministic offline practice scenario for each
recipe. Each scenario uses reserved fictional domains, fixed evidence states
and limitations, and immediate decision feedback. It makes no request, writes
no browser storage, produces no finding, and can be reset or replayed at any
time.

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
steps have an outcome, a read-only handoff checklist summarises whether the
current browser-local case has a reviewed disposition, a typed analyst
decision, supporting evidence pins, and explicit unresolved unknowns or
contradictions. This checklist measures workflow structure only. It does not
validate an analyst conclusion or make a claim about the target.
Approval-gated steps show the same Collection preflight language used by
Lookup and Bulk before the analyst opens the tool. Approval applies only to
that bounded guide step. It is not general authorisation for active testing or
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

An individual template can also be exported as a restricted CACAO 2.0
investigation profile and imported through the same template control. The
profile accepts one connected linear sequence of manual analyst steps mapped
to existing allowlisted WHOISleuth stages. It rejects executable or encoded
commands, branching, targets, credentials, arbitrary routes, and unknown
capabilities. Importing it never executes a command or starts collection.

Monitor's **Inbox** projects one evidence-gap item per unresolved case when
that case retains an explicit partial, failed, stale, inconclusive, or
truncated evidence pin or an open analyst-authored unknown or contradiction.
It does not infer facts that were never saved. A fixed 7-day aging threshold
and 30-day stale threshold organise only the review queue; they do not assert
that the underlying fact changed. Resolving the queue requires reviewing the
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
fixed-column finding rows in CSV or JSON, sanitised web-capture summaries and
artefact manifests,
strict uncompressed WARC response archives, and bounded STIX 2.1 or MISP event
JSON. Every file is validated and previewed locally before a merge. Generic row
conversion accepts only domain, category, summary, observation time,
completeness, limitation, and reference columns.
Documented domain, DNS, and certificate observation rows additionally retain
their source schema and typed field, create source-qualified timeline
sightings, and contribute only valid direct A, AAAA, NS, CNAME, MX, or
certificate relationships to the local asset graph. Unsupported or malformed
relationship values remain observations and do not create graph edges.
The capture schemas accept bounded titles, normalised HTTP(S) origins,
technology labels, screenshot SHA-256 digests, optional version-2 perceptual
dHashes, artefact dimensions and sizes, completeness, and limitations;
it rejects raw HTML, screenshot content, cookies, request bodies, complete
URLs, and arbitrary fields. STIX and MISP previews separate accepted claims,
duplicates, conflicting identifiers, and exclusions, then require an existing
case to be selected. Merged claims become external `unknown` assertions with
their source-file SHA-256 digest, publisher, external identifier, timestamps,
confidence, labels, and markings. They do not become collected evidence and do
not create cases, start collection, change scores, publish events, or enable
correlation. See [External findings and intelligence import](external-findings-import.md).

WARC import is limited to an 8 MiB uncompressed archive, 100 bounded records,
1 MiB per record, and 25 retained HTML response findings. It excludes request
records, cookie and authorisation material, downloads, compressed response
bodies, non-HTML content, invalid targets, excessive bodies, and mismatched
supported block digests. Supported SHA-1 or SHA-256 block digests are verified
locally. Only the normalised domain, origin, title, status, observation time,
completeness, limitations, and archive SHA-256 digest reach the preview. Raw
archive bytes and paths, queries, fragments, headers, and bodies are discarded.
Bounded WACZ 1.x ZIP containers are also accepted through the same WARC privacy
filter when their manifest, safe resource paths, sizes, compression, and
SHA-256 digests validate. Screenshots, indexes, page lists, custom files, and
other package content are ignored rather than merged into a case.

Brand Profile posture results include a local **desired-state review**. It
organises the selected standard, defensive-no-mail, or parked profile into
registration, mail, transport, and certificate-policy groups while preserving
each server-returned check status. The external-dependency review keeps
observed and unavailable dependencies distinct. It never tests provider
accounts or claimability and never labels a dependency dangling, abandoned,
vulnerable, safe, or controlled by another party.

The **Owned-domain baseline** editor can additionally retain analyst-authored
expectations for nameservers, DS records, MX records, CAA policy, a reviewed
TLS issuer, SAN patterns or public-key digest, transfer-lock intent, and a renewal review
date. Later posture audits label each configured field as aligned, drifted,
unknown, unsupported, suppressed, or not configured. The analyst must
explicitly retain an audit before it becomes the previous comparison point.
Suppressions require a reason and can expire. Desired state and retained
observations are included in deliberate Brand Profile, workspace, or
single-baseline exports; they are never applied to registrar, DNS, mail, or
certificate-provider accounts.

## Browser-local storage and archives

Cases, campaigns, Brand Profiles, watchlists, shortlist entries, Certificate
Transparency history, detection rules, analyst-selected relationship
observations, explicitly saved Bulk sessions, website profile snapshots, and
investigation templates use bounded native IndexedDB stores. Relationship observations
are never retained automatically: Bulk writes one only after the analyst
selects **Retain observation**. Browser storage can still be cleared or evicted
and does not synchronise across devices.

An explicitly saved Deep Lookup can include a normalised leaf-certificate
observation in its website profile snapshot. The local Lookup inventory shows
the latest retained observation per domain and exact shared-fingerprint review
leads. These records contain bounded certificate metadata and digests, not
certificate bytes, and describe what this deployment observed at that time
rather than a current certificate inventory supplied by a third party.
The snapshot can also retain up to 20 normalised service-dependency rows from
the already displayed DNS and final-navigation review. Comparing two compatible
snapshots calls out active-to-unresolved and active-to-passive-deprovision-cue
transitions for manual review. It never follows the dependency, tests an
account, or treats a transition as proof of abandonment, vulnerability, or
claimability.

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
[offline artefact verification](cli-reference.md#offline-artefact-verification).

## Reports and exports

Exports are created locally and only after an explicit action. Depending on the
workflow they can contain public registration contacts, analyst notes, source
observations, or compact case history.

- Use a Lookup Markdown report for a bounded readable domain, IP, or ASN
  summary. It omits raw registration payloads and expanded contacts. A quiet
  generator footer is included by default and can be omitted from the readable
  presentation; structured JSON evidence always retains bounded generator
  metadata for provenance.
- Use the Lookup JSON evidence package when complete captured source material
  is required, and treat it as potentially containing public contact data.
- Use the portable investigation capsule when a recipient needs one manifest
  tying the current evidence-file digest to the bounded investigation brief,
  relationship graph, source schemas, and application version. The capsule
  does not embed the Lookup evidence file. A deliberate option can include
  bounded analyst decisions and assertions from the linked case; notes,
  contacts, actions, and raw payloads remain excluded. Checksums detect changed
  content but do not authenticate a signer.
- Build a case response packet only after recording the category, affected
  party, exact HTTP(S) URLs, observed harm, UTC observation time, and separately
  sourced contact routes. Select the intended audience first: the local preview
  identifies included and excluded evidence, required redactions, expected
  attachments, recipient gaps, and follow-up fields for registrar, registry,
  hosting/network, security-contact, browser/blocklist, or internal-SOC review.
  JSON, Markdown, and email-text outputs remain local, require review, and do
  not submit anything.
- When Registry RDAP declares redacted fields, use the disclosure planner to
  build a minimised JSON review packet from those bounded declarations and a
  separate analyst-authored purpose, justification, requested-field selection,
  and case reference. Its preflight requires review of available public
  evidence, data minimisation, affected-party rights, and the current request
  route, whether the domain is in the current gTLD service scope, registrar
  participation, and requester materials. When those checks are complete it
  links to the current ICANN Registration Data Request Service information and
  account portal for a separate manual handoff. It excludes raw RDAP, raw
  WHOIS, and discovered personal contacts, does not determine requester
  entitlement or registrar participation, does not send the prepared packet to
  ICANN or a registrar, and never submits a request.
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
