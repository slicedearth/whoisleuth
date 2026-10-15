# Application guide

WHOISleuth organises work under three analyst jobs:

- **Investigate** collects and compares evidence.
- **Respond** records decisions and prepares response material.
- **Assure** reviews later observations, watchlists and owned-domain controls.

Network collection and external actions remain explicit. The generated
[privacy/data-flow catalogue](privacy-data-flow-catalogue.md) lists request,
recipient, retention and export boundaries.

- [Start work](#start-work): choose a tool and reading setup.
- [Review and compare](#review-and-compare): inspect queues and retained evidence.
- [Prepare a handoff](#prepare-a-handoff): check the recipient's actual view.
- [Resume and recover](#resume-and-recover): return to a context or saved checkpoint.

## Start work

Open [Dashboard](#dashboard) for saved work and first actions, [Lookup](#lookup)
for a single target, or [Bulk](#bulk) for a selected list. [Brands](#brands)
organises candidate review. [Workspaces and encryption](#workspaces-and-encryption)
explains where saved work lives and how to protect it.

Appearance controls offer comfortable or compact reading density. Compact uses
the full available width for console workspaces; public prose remains constrained.
Turn off decorative effects for plain card backgrounds without scanlines or glows.
Reference pages use a plain reading surface in either theme. The console command
palette includes a keyboard-shortcut reference below its results. Enable
**Show brief keyboard hints** there for hints beside the page-search field when
matching destinations are available. The choice lasts for this Console visit;
reloading or leaving the Console resets it. No keyboard-use history is saved. Its
**Documentation** scope searches the same public guides and command reference,
without searching saved Cases. Queries stay in memory and are cleared on close.
The command reference's **Build this command** editor checks arguments against
the current application's command grammar and quotes them for Bash/zsh/sh or PowerShell.
Values stay in memory. Lookup's **Continue in the CLI** starts with an offline
plan for the current target and depth; optional browser source selections are
not transferred to the CLI's separate configuration.

Public guides share documentation search, section navigation and print layouts.
Search finds tasks, commands, examples and glossary terms without reading saved
work. Direct links open the relevant tool guidance or glossary section.

In **Methodology**, open **Analyst field cards** for a compact scope, source-state,
comparison and handoff reference. Select **Print field cards only**, then use
**Print this guide** to print or save a PDF without the longer methodology topics.
Leave the option clear to print the full guide. The reference identifies the
application version and contains no saved investigation data.

[Practise with fictional evidence](#practise-with-fictional-evidence) before
working with your own records.

## Review and compare

Brand candidates, the Review Inbox, Bulk's Review view and the saved Case list
share an **Inspect** workflow. The queue stays beside the current item on wide
screens; narrow screens show one pane at a time. **Back to queue** returns to the
inspection control without clearing filters or checked candidates. Escape closes
inspection when focus is outside an editing control.
Inspection makes no request and does not select an item for a batch action.

Open **Presentation** in the Console context to change **Presentation in this tab**:

- **Analyst Desk** keeps the balanced queue and evidence layout.
- **Evidence Bench** gives the evidence inspector more room and opens the existing
  tab references. On wide screens the pinned checkpoint references sit beside the
  current task; on smaller screens they remain above it in the same disclosure.
- **Field Journal** stacks the inspector and gives Case and investigation timeline
  entries a more spacious reading layout. Their order, filters and evidence remain
  unchanged.

The choice lasts while the Console is open in this tab. It does not save a
preference, reset drafts, change themes or alter collection permissions. Select
Analyst Desk to return to the default arrangement. The public demo retains its
independent journal preview.

Brand candidate **Explainable pattern groups** shows the contributors to each
retained matching rule, with individual review status, exact declarations and
rule exceptions. Contributors are paged independently of the candidate queue;
**Inspect** opens that domain's retained evidence and returns to the same group
page. Groups reflect the current filters, may overlap and never select or admit
their members to a watchlist. Every candidate remains reachable in the queue.
Case inspection is a read-only preview; **Open Case workspace** opens its editor.
In the Case list, **Organise Case tags** enables a separate checked selection
across pages and filters. Preview the exact add/remove result, then apply it once.
Inspection and calibration selection do not change these targets. Conflicting or
missing records, excessive tags and storage changes that would prune evidence
block the whole batch. Tags organise records; they do not change conclusions.
The draft stays on this page until saved or discarded. After an unknown write
outcome, reload and inspect saved tags before attempting another batch.

In **Retained change review**, choose one retained comparison, then select the
individual rows to include in **Download selected rows**. Nothing is selected
automatically. The plain-text file contains the selected normalised values,
source states, separate observation/publication/retention times, limitations and
omission counts. It excludes unselected values, Case notes and owning records,
but selected values and labels may still be private. Missing endpoint or algorithm
references remain unavailable; this readable report is not an original-evidence
package or another portable import format. Selection stays in page memory and
clears when the displayed comparison changes or the page is left. The download
rechecks the current displayed details and makes no collection or upload request.
It does not reread the latest saved state. Reload the page to include
changes made elsewhere.

## Prepare a handoff

In a prepared response packet, **Recipient reading view** offers the full report,
brief emphasis, selected evidence and its contained timeline. These views contain
only the packet's existing projection; printing still uses its full report and
the optional exact JSON appendix. **Compare disclosures — analyst only** compares
the actual prepared ordinary report and recipient JSON from the same Case and
time. It can reveal private fields absent from the packet, so it is excluded from
printing and every recipient export. Notes enter the internal side only when
explicitly selected. Closing it, refreshing the packet or changing source, options or section clears
the comparison; different representations do not establish deletion or redaction.

See [Cases and response preparation](#cases-and-response-preparation) for the
response workflow and [Reports, imports and exports](#reports-imports-and-exports)
for portable files and their disclosure boundaries.

## Resume and recover

**Pin checkpoint** in a Case evidence timeline keeps up to four exact references
in the current tab. Open **Tab references** in the Console context, then
**Pinned checkpoints** to re-open
their evidence and stage two same-Case checkpoints in the existing comparison.
Unavailable references remain explicit; another checkpoint is never substituted.
**Navigation trail** lists up to eight successful Case or retained-infrastructure
visits. Return to an infrastructure identity with its exact search, filters,
inventory/history/source pages and topology view. Sources are read again;
missing identities and expired tab references remain unavailable. The trail is
navigation, not an observed relationship or investigation log. These views store no duplicate evidence and
clear on lock, sign-out, workspace replacement or leaving the Console.

**Favourites in this tab** keeps up to eight exact links to Case sections,
Monitor views, tools and reference pages. Choose a destination in the Console
sidebar and add it explicitly. A view favourite opens that view with current
records; it does not save its filters, copy evidence or start collection. These
links also clear when the tab reloads. A deleted Case remains labelled unavailable
until its reference is removed.

Review Inbox forms retain their drafts while another item is inspected; use the
existing explicit review checkpoint to retain them across a reload.

Choose the recovery tool for the task: a saved review position resumes the
question, filters and selected item in this browser; a pinned checkpoint revisits
exact retained evidence in this tab; a workspace backup moves saved records to
another workspace. None substitutes for the others. Finish and save Case forms
before a backup when their contents need to travel with it.

Use [Browser-local storage and archives](#browser-local-storage-and-archives)
for backup, restore and original-file recovery.

## Dashboard

Dashboard is the authenticated starting point. It waits for the required
browser-local collections before deciding whether the workspace is new,
returning or unavailable.

For an empty workspace it offers a small set of first actions: explore the demo,
investigate a target, start a guide or import an existing workspace.
For retained work it shows bounded attention, overdue, changed-since-review,
Case and watchlist counts, with links to the corresponding retained reviews.
The summary refreshes when you return to the tab or change saved work here;
viewing Dashboard does not mark anything reviewed.

Saved-work search, templates and archive maintenance are secondary tools.
Search results are paged; every indexed match is reachable. The coverage
disclosure identifies unavailable collections and omitted fields or records.
Search stays in the browser and operates over bounded normalised fields; it does
not start collection or inspect raw upstream payloads.
Open **Retained history** on a result to see its separate observations and source
records. Every admitted observation is pageable, including separate Cases for the
same indicator. The first and last dates describe saved evidence, not an
indicator's creation or disappearance.

Open **Browse retained infrastructure** to filter admitted domains/hostnames,
addresses, certificates, nameserver sets and HTTP origins by indexed text,
source collection or retained observation date. Filters run before pagination;
every admitted match remains reachable. Inspect an identity to see its separate
dated sources and explicitly supported one-hop relationships. Source links open
retained Cases, campaigns, Brand Profiles or relationship records, never an
automatic Lookup. The inventory and its selections stay disposable in page
memory; no second evidence store is created.

Choose **Topology and list** in an identity's relationships to arrange the current
source page by retained identity type. Arrowheads preserve each relationship's
From → To direction; grouping and namespace similarity are not extra observed
connections. Independent sources remain separate, even for coinciding links.
Diagram references distinguish abbreviated labels. Use **Focus diagram identity**
for the full name, **Show exact source rows** to focus its attributable evidence,
or **Inspect retained evidence** to pivot to that identity's own one-hop view.
The diagram search narrows only the current diagram, not the exact source list.
Page controls reach the remaining source rows; diagram omissions and partial
coverage are explicit. **List only** provides the same source links and pivots
without a diagram. Neither view performs collection or establishes a complete
multi-host, DNS-alias or routing-origin topology.

Counts are not organisation-wide coverage, and retained address or certificate
relationships do not establish current resolution, origin, ownership or common
control. Imported DNS observations can be linked to a Case domain when their
exact queried owner was not retained. Missing provider roles, routing ASN,
wildcard patterns, precise collection scope and comparable infrastructure
snapshots stay unknown; this view does not infer removals or enrol monitoring.

Campaign and investigation-template editors keep later typing when an earlier
save completes. If another tab changes the fields being edited, the save is rejected
and the draft remains open. Refresh the saved records, then reopen the record to
replace the draft with its current version. A refresh failure after a successful
write offers a read retry, not another write. Rule actions and saved-view
deletion also check the selected record before changing it.
Drafts whose campaign or template was deleted can be saved explicitly as a new
record. This does not recreate the deleted identity or restore campaign membership.

### Workspaces and encryption

**Browser workspaces** separates saved work without moving the default workspace.
Choose **Encrypt saved workspace records** when creating a named workspace to
require a passphrase in each tab. **Lock workspace**, reloading or leaving the
Console clears its unlocked state. **Auto-lock** is off by default; choose an
idle interval for this tab and workspace if needed. Locking keeps saved encrypted
drafts but loses other unsaved page state. Cancelling a leave-page prompt keeps
the tab unlocked; suspended browser execution can delay automatic locking.
Names and storage counts remain visible; there is no passphrase reset.

Use **Create an encrypted replacement** to protect existing saved work or change
its passphrase. This makes a new workspace, including saved recovery drafts and
original files, then checks it independently. Missing files or changed source
records prevent a fully verified result. **Copy missing originals** retries only
missing file bytes, not the saved records. Finish verification, then open the new
workspace with its new passphrase. The old workspace remains unchanged and its
passphrase still works.

Keep a separate, tested encrypted backup before deleting the original. A copy in
the same browser shares its quota and deletion risks. Backup and workspace
passphrases are independent, so a tested backup remains a recovery path if a
workspace passphrase is lost.

### Guided investigations

The Console context bar keeps the current task, workspace identity and reported
backend together. Expand the storage disclosure for browser or filesystem
details; filesystem storage is plaintext and encrypted backups are separate
exports. A selected Case keeps its own expandable evidence context. Workspace lock controls and
unavailable-state messages remain visible rather than being hidden in details.

Starting a guide opens its current step. On ordinary tool entry, the retained
guide appears as a compact disclosure above the tool. Open it to select a step,
review request permissions or record an outcome. Selecting a step does not
approve collection or mark it complete.

Unconfirmed outcome notes remain separate for each step while the guide is
open. Collapsing it or changing steps preserves those drafts; reloading the
page discards them. Confirmed progress stays in the current tab.

#### Practise with fictional evidence

Choose **Explore an example investigation** on the public homepage to enter the
demo. Its adjacent note identifies fictional evidence and no live collection.
The demo uses fixed fictional evidence and does not write protected workspace
data. Its HTTP examples retain an origin when available, but not full
requested or final URLs. Those URL rows therefore say **Not retained**; an origin
does not identify the page path, and an inconclusive example has no observed
response or final origin.
The demo's **Source quality** view uses the same source-scope display as Lookup;
missing query outcomes, connection hostnames and source times stay unknown.
In its Case step, **Explore the retained investigation timeline** groups the
existing fictional observations by evidence family without opening saved Cases.
Combined snapshots do not supply separate clocks for each family.

Use **Practise with real Case forms** in the demo to choose a supplied incident,
conflicting-source or provider-response scenario. Pin an observation,
record an evidence-linked conclusion and review an incomplete later capture.
The forms and validation match the Console, but the practice Case and drafts
remain only on that page. Restarting, reloading or leaving discards them. The
exercise makes no collection, submission or export. The credential-page exercise
rehearses separate recipient reviews, simulated deliveries and page-only closure;
the requested-evidence exercise prepares a drafting amendment. Changing scenario
requires confirming that its Case and drafts should be discarded. Feedback
checks retained relationships and states, not the quality of free-text reasoning.

Optional **Larger practice reading** and **Show practice companion** choices are
page-local presentation aids. They do not change the fictional records, grade
decisions or appear in evidence exports. **Present selected fictional evidence**
lets you choose and order original supplied observations, then read them one at a
time with their sources, times and limitations. Earlier/later buttons change the
walkthrough order, not the observations or their chronology. It is an unmasked
fictional walkthrough, not an export or broadcast. Closing it, collapsing
practice, restarting or changing scenario clears the selection without writing
saved work. Source-reuse and campaign-authority
exercises explain why repeated reports or an organisation directory entry do
not establish independent observation or authority for a separate offer.
The retained investigation timeline also offers a **Field journal reading
layout**, using the same entries, filters, pagination and separately labelled
clocks. It does not reconstruct missing observations or change the theme.

For related hosts, conflicting sources and provider-reported resolution, open
**Find the weak inference** in **Record a conclusion**. Inspect the original
supplied evidence, choose the statement that exceeds it and select **Explain
this choice**. The explanation distinguishes the observation from the unsupported
conclusion; it does not score you or record a Case decision. Closing the exercise,
changing steps or collapsing practice clears the choice without changing your drafts.

In the source-reuse exercise, record a conclusion citing the provider's reused
report, then select that conclusion under **Trace sources for** in **Evidence
relationships and shared sources**. Follow its declared derivation without
counting repeated material as independent support. The credential-page exercise
also uses **Exact incident-object coverage**: inspect each recipient's drafting,
simulated delivery and response history, then the independently reviewed page.
The advertisement stays unresolved. Packet identity remains unknown for those
simulated deliveries; no prepared packet is attached to their history.

**Compare fictional response drafts** is a separate, optional exercise. Choose
**Compare supplied fictional drafts** to inspect two in-memory draft packets
from a fresh copy of the supplied Case. They change recipient, exact page or
advertisement scope, and selected evidence. Open a difference to inspect both
complete values. A pin absent from one packet is still retained in the source
Case. The normal packet writer, validation and comparison are used, but neither
draft is authorised, downloaded, delivered or imported. Your practice edits and
simulated delivery history are unchanged. Clearing or closing the comparison,
closing practice, changing steps or scenario, restarting or leaving discards
the temporary pair.

Choose a compromised-page or shared-form scenario to practise exact object scope;
the related-host scenario keeps different affected identities and observations
separate. The changing landing-page exercise leaves the ad and replacement URL
open to review. Conditional captures retain their different paths and conditions.
Their **Compare capture conditions** view compares declared fictional viewport
and browser context, including an incomplete later attempt with unknown settings.
The exercise includes no image bytes or page-comparison inputs.
In the requested-evidence scenario, **Review fictional image history** follows
an outline's declared parent to a redacted image and then a parent with no edit
declaration. The shared review uses supplied metadata only, not saved work or
image bytes. Following those links does not authenticate their creation history.
Other examples distinguish reported account actions, an organisation's existence
from its claimed campaign endorsement, insufficient logo/edge evidence, and a
later provider result that reuses a submitted report. Inspect the evidence and
its qualifications before recording a conclusion.

## Lookup

Lookup accepts one domain, IP address or ASN. URL-like input is normalised only
under the explicit supported rules; credentials, unsupported schemes and
ambiguous targets are rejected.

Before collection, Lookup shows source families for the entered domain, address
or ASN and the current deployment configuration. Optional providers are listed
separately. Deep Lookup reports source states as they arrive; connections that
buffer responses show them together. A finished source can still be partial,
failed or unsupported.
Within **Collection preflight**, each source's **Data and recipients** disclosure
distinguishes the registrable-domain query, DNS owner and record type, and any
explicitly selected URL path and query. It describes the browser-to-application
boundary separately from downstream recipient classes. Optional, disabled and
unavailable sources do not become selected by opening this view. Exact services,
referrals and redirects are not resolved by this offline plan. The same disclosure
in Brand feed review distinguishes device-local file matching from a deliberate
query that sends the selected feed, hostnames and literal terms to the configured
service. It does not expose entered URLs or search terms in another preview.
Only the final validated result can be saved. Cancelling discards the incomplete
response; already-admitted requests may finish within their existing bounds.

In the detailed assessment, **Next reviews for your question** narrows evidence
gaps to a few relevant steps. Select a question to change that shortlist; the
full evidence-gap details remain below it. Each step explains its expected
benefit; **Before you continue** covers prerequisites and request disclosure. Unsupported, uncollected
or unbound sources remain gaps, not available collection actions. Opening a
review path starts no request and does not change saved evidence.

Under **Source quality**, expand **Compare the completed plan and source outcomes**
for the finished target and mode, separately dated source records and diagnostic
states. Older results have no original optional selections; missing output does
not establish that a source was declined or had no findings.
New completed Lookups include an **Original collection choices** receipt. It
keeps the submitted optional selections separate from policy admission,
collector starts and source outcomes. Changing a checkbox after submitting does
not rewrite that receipt. Expand **Collector execution** for each source family;
a started collector is not proof of network delivery, and incomplete child
records remain incomplete. Cancelling before a valid final response leaves no
completed receipt. Deliberate source refreshes remain separate observations.

**What each source describes** separates the submitted hostname and registration
request from the domains actually returned by registry, registrar and WHOIS
publications. It also shows retained DNS collection context and record outcomes,
HTTP request and final URLs, and the TLS connection hostname and certificate
names. Each source keeps its own time; WHOIS referrals retain separate hop times.
Explicitly unissued referrals remain visible as **Not queried**, including the
final marker after the request limit. A missing historical query time alone
does not mean that no request was issued.
Missing identities and times remain unavailable. Most DNS record families do not
retain individual answer owners, so a returned record value is not presented as
its owner. Certificate wildcards and inherited CAA policies do not establish
direct observations of all matching hosts. Opening the disclosure makes no
request and changes no saved evidence.

### Fast and Deep collection

For a supplied link or pasted plain text without sign-in, the public
[Link Inspector](https://www.whoisleuth.com/link-inspector) reviews destinations
locally without opening them. Broader file intake and retained Case work remain
in the Console. The public tool does not read or save a workspace.

Before collecting, **Review a message, link or selected file** accepts pasted text,
MIME email, calendar invitations and still PNGs. It shows the actual destination
beside a URL displayed in the message, expands supplied redirect parameters and
identifies authorisation-request fields. Choosing a destination fills Lookup;
it does not start a request. Exact URLs are available in a private disclosure
and omitted from the minimised review download.
Excluded destinations and unsupported QR payloads are counted by category;
the preview remains partial and does not turn them into collection targets.
Email authentication is grouped by message part and physical header position.
Expand **Review reported authentication sources** to inspect the reporting
service, evaluated domains and malformed or duplicated values. Receiver-trust
checkboxes record your assessment of those exact headers; matching names and
nested messages do not inherit the selection.

Select PDF or DOCX to extract document links and supported embedded raster QR
images. Each link references its source part and PDF page where available.
Coverage distinguishes encrypted, unsupported and partially decoded content;
no document scripts, macros or external resources run. Select HAR to inspect
request order, origins, statuses and timings without replaying requests. The
minimised report excludes headers, cookies, bodies and private URL components.
The timing track compares reported starts and total durations. **Request order**
switches between archive position and reported start time; original request
numbers stay visible and the download keeps archive order. Undated records and
unavailable durations remain explicit. Expand **Reported timings** for phase
values; TLS timing is part of connect and is not added twice to a total.

Plain-text review also offers possible phone numbers for explicit selection.
Keep the original spelling, declared source time and whether the text was
transcribed or OCR-derived. A contact role describes the supplied claim, not
verified ownership. Unselected candidates are not saved. For an ad or search
result, compare a displayed destination with separately supplied destination
evidence; this does not open either link or reconstruct an unobserved redirect.
See [selected-input review](offline-intake-context.md) for supported formats,
source spans and disclosure controls.

Select **Identity events** for an Entra sign-in export (`value` array) or an Okta
System Log array. The preview replaces actor identifiers with labels local to
that file. **Compare an application and time window** records exact matches,
different fields and missing context separately. An event's reported result is
not an account-compromise verdict. Saving keeps only the previewed report unless
you separately select the private original.

The same review is available in Case Evidence. Save its minimised report and
source hash, optionally retaining the private original separately. In Case
Response, **Account and device recovery** provides guidance from reported
actions such as entering a password, granting consent or running a command.
Selected recommendations can become open follow-ups with optional evidence links;
they are not completed recovery actions. Expand a retained follow-up to inspect
its linked observations, dates and supporting or contrary context. Recorded
internal actions remain separate; the current records do not bind them to a
particular follow-up. Incoming notices can be compared locally
with a selected action's recipient and delivery reference. This comparison stays
in page memory and does not authenticate the sender or enter the saved intake.

- **Fast** is registration-led triage. It uses RDAP and bounded authoritative
  DNS fallback where required, while explicitly skipping richer WHOIS, website
  and TLS work.
- **Deep, compact** is available for selected Bulk work. It adds the bounded
  registration, DNS, website and TLS fields needed for comparison without the
  complete single-target detail.
- **Deep, full** collects the declared registrar, WHOIS, DNS, HTTP, TLS, page,
  technology, posture and observed-network context applicable to one target.

Open **Optional sources** to select security.txt or external intelligence.
Neither runs merely because Deep was chosen. The CLI's authorised DNSSEC and
mail-transport actions are separate again and never run through browser Lookup.

### Reading the result

The result header identifies the completed target, collection depth and observation
time, even when the form has since changed. **Open saved Case** opens the matching
retained Case. Its **Return to Lookup** link restores the current result without
collecting again; this return context lasts only within the current browser session.

**Questions needing evidence** links the selected analyst question to incomplete
sources and local reviews. Opening a link does not collect another observation.

By default, a pasted HTTP(S) URL selects its full hostname for collection, not its port,
path, query or fragment. URLs containing credentials are rejected. Retaining
an exact Incident URL in a Case is a separate, deliberate choice.

For a specific page, select Deep and **Collect the selected URL instead of the
homepage**. This sends its path and query to the website, without the fragment.
Editing the input or depth clears that choice. The request uses default HTTP(S)
ports and the same bounded redirect and address checks, with no fallback to a
different path or scheme. The original registration result remains independent.
Review retained paths and page text before sharing. Compact Case and website
snapshots identify selected-page observations but omit paths and queries, so
their web fields cannot establish a same-page change.

In **HTTP evidence**, **Requested URL** and **Final URL** are separate retained
values. A failed attempt can retain its requested URL without a final destination;
the missing field says **Not retained**, rather than repeating the requested URL.
These values omit query strings and do not recover a pasted URL from the input
form. Review redirect and capture limitations alongside the response.

Registration queries use the registrable domain. Deep DNS, TLS and web probes
use the selected hostname; registration-delegation checks keep their own domain.
The header identifies this scope. Older exports keep their original
registrable-domain observations rather than being relabelled as a subdomain.

The result starts with registration and availability. Supporting DNS, website,
TLS, certificate, network and provider evidence cannot silently replace
registry authority.

Each source shows its state, observation time and limitations. Long supporting
sections use disclosures, while important unavailable or contradictory evidence
remains visible. Tables and text remain the complete accessible review surface;
charts are summaries only.

Web & DNS includes the selected endpoint's IP RDAP record, separate from domain
registration. Its summary names sources with partial, unavailable or unknown
evidence.

IPv4 (A) and IPv6 (AAAA) results distinguish an empty answer, no data for that
record type, a resolver-reported missing name, and a failed query. A missing
IPv4 answer does not hide a working IPv6 answer. Selected Case checkpoints keep
each family's result and source time; older unspecified negative answers remain
unspecified.

The evidence graph retains every supported relationship from the admitted
Lookup evidence. Lenses, visual grouping and the searchable, paginated list
change the view, not the retained data. Projection input coverage distinguishes
admitted values, duplicates, invalid input and capacity omissions. Source
observation times remain separate from the time an export was created.

Bulk public-infrastructure groups exclude non-public DNS answers. Those answers
remain in the underlying evidence. Older retained IP groups remain readable but
are labelled as equal non-public answers, not evidence of shared public hosting.

A full Deep domain result can include:

- registry RDAP and a separately attributed registrar RDAP follow-up;
- bounded WHOIS referral evidence;
- recursive and selected-authority DNS evidence;
- HTTP redirects, selected response metadata and page publication summaries;
- one-connection TLS and certificate evidence;
- bounded technology, page-role and passive-posture indicators;
- one observed public-address IP RDAP context; and
- explicitly selected security.txt or provider results.

Passive posture findings state the specific result. **Needs review** marks a
missing control or a potential exposure; **Could not assess** means the required
evidence was unavailable. Other findings are observations, not a safety verdict.

Raw registration payloads, contacts, endpoints and provider records are not
silently copied into compact browser stores. The deliberate raw view and full
saved Lookup are more sensitive than normalised reports and require separate
handling.

### Retaining a Lookup

Use the pin control beneath a source to select its normalised facts. Each
pin keeps that source's observation time and limitations; undated values cannot
be saved as dated checkpoints. Published registration nameservers and resolver
nameservers remain separate. A failed save keeps the selection for a deliberate
retry; a new Lookup clears it.

In **Source quality**, open the source-record review to refresh a source and
compare its normalised facts with the original Lookup or its previous refresh.
Source timestamps remain distinct from request times, including cached results.
**Original and refreshed observations** summarises the original fact times beside
the latest retained refresh for each source in this review. Mixed times and undated
facts stay explicit. While a latest unsuccessful attempt remains retained, its
missing observation is not replaced by an earlier success. Removing that attempt
reveals the next latest retained entry, not the latest request ever made. Removed
and cancelled requests are not represented; **No refresh retained in this review**
does not mean a source was never requested.
The review survives collapsing sections, but not leaving or reloading Lookup.
Retain selected dated facts in a Case or download a readable review before
leaving. A selected URL must be selected again in a new Deep lookup; refreshing
registration sources does not repeat that page request.

Creating or refreshing a Case is deliberate. A Case retains the exact
normalised submitted hostname and, for new Deep observations, the separately
identified DNS, TLS and web hostname on the point-in-time evidence snapshot while
the Case retains its own incident ID and canonical registrable domain.
Different hostnames can remain attached to different snapshots. Migrated Cases may retain a
null hostname; WHOISleuth does not reconstruct one from URLs, certificates,
redirects or other weaker evidence.

Ordinary transient Lookups create no hostname history. Case reports and
response packets do not add the snapshot hostname, while ordinary Case,
workspace and trusted Case-pack exports can contain it and require sharing
review.

Selected evidence pins keep their own observation hostname, which is included
when those pins are deliberately selected for a response packet.

## Discover

Discover provides three bounded paths:

- local candidate generation from a domain, Brand Profile or optional custom
  dictionary;
- Certificate Transparency search and local comparison of returned names; and
- one explicit registry-scoped RDAP nameserver search.

Generation accepts a brand label or registrable domain, including multi-part
public suffixes such as `co.uk`. Subdomains and URLs are not silently reduced
to a different seed. The complete suffix remains in candidate provenance.

Generated candidates retain their mutation provenance. A custom dictionary
stays in the current tab and is not uploaded; only deliberately selected
candidate domains and bounded provenance continue to Bulk through a one-use
handoff.

Open **Excluded by exact profile match** to inspect candidates omitted by the
active profile's official, approved-partner or domain allowlist entry. Each row
identifies the exact declaration. The disclosure also remains available when
every admitted candidate was excluded; it does not select those rows for Bulk.
An exclusion is not a safety verdict, and a domain entry does not cover suffixes
or subdomains.

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
Saving retained results uses their admitted targets and collection mode, even
when the queue has already been edited for the next run. A loaded partial
session keeps its full original membership during a selected-subset refresh.

**Load** restores the selected session's recorded rows without collection.
**Resume unstarted** keeps those rows and collects only queued domains without
a recorded result. Failed rows remain recorded; use **Retry failed** to collect
them again. Starting a new Lookup or Bulk run requests collection instead.
Selected Case context and guide progress provide context, not a replayed result;
they do not imply that saved evidence or a cache has been reused.

Selected rows can continue to Cases, exports or response preparation. Selection
does not submit a target to a provider or apply a control.

**Save selected** previews a scoped Monitor merge, preserving unrelated current
members without presenting them as rechecked. **Save to Monitor** previews full
snapshot replacement, including exactly which current members are retained,
added or removed. Confirm the reviewed change explicitly; a destination changed
in another tab requires a fresh review. Removed current members are not included
in future rescans, and retained bounded change events are not full snapshots.

Selected CSV exports include a review manifest containing the exact selection,
filters, source states and separate batch, row and source observation times.
Unknown observation times stay unknown; exporting does not refresh evidence.

## Brands

A Brand Profile records analyst-authored owned or approved scope, protection
context and desired posture. It can include official domains, approved partners,
allowlists, mail expectations, reviewed certificate baselines, protection
attestations, suppressions and approved change windows.

Start a profile with its name and official domains. Matching and mail settings,
rights and official channels, and official-site identity are optional
disclosures. Closing a disclosure preserves its unsaved fields.

Overview contains the allowlist and review summary; Assets lists the profile's
domain relationships; Tools opens domain, mail, certificate and account-control
reviews. The Brand profiles disclosure switches the explicitly active profile.

**Choose Brand review references** optionally selects the saved compact page
baseline and PNG files from explicitly associated Cases. Up to four references
can be labelled Desktop, Mobile, Regional, Campaign or Login for the current
review. Those labels do not verify capture conditions or legitimacy. Source,
observation time, retention time and missing context remain separate; an
original is read and verified only when you choose its preview. Closing the
panel, refreshing its Brand or Case sources, switching views or leaving the page
clears the choices. This does not create a durable variation library or change
saved evidence, exports or Brand matching.

**Review domain feed candidates** matches a local plain-domain file against
selected terms or exact hostnames. Choose which results to retain before
preparing a Watchlist handoff. The [candidate-review guide](brand-candidate-review.md)
covers manual import, source coverage and the separately configured feed cache.

Allowlist, expected-setting, portable-setting and account-control drafts are
preserved when switching views or tools. Selecting or saving another
profile, or leaving Brands, clears the previous profile's tool drafts. A failed
save preserves the draft; a successful save with a failed refresh offers a
read-only refresh, not another write. Conflicting edits require reviewing the
current saved values.

Open **Preview domain exclusions** in the allowlist to compare saved and draft
domain lists against up to 200 entered example domains. You can select domains
from Cases already retained in the current workspace; this is not an inferred
Brand association. The preview identifies exact declarations before and after
the draft and stays in page memory. Invalid or oversized input is rejected as a
whole. Unavailable profile or Case sources remain explicit.

Registrar entries do not affect this domain-only preview or Discover's domain
filtering. Product names are discovery defaults, not automatic matching rules or
time-bounded campaigns. Existing custom-rule previews separately evaluate
retained Case evidence; neither preview rewrites earlier analyst decisions.

Account controls keep individual review dates. Saving changed controls or
explicitly reconfirming one updates only those statements.

These values are analyst-authored expectations. They do not prove the live
state of a registry, account, DNS zone, certificate or service. Observed evidence,
desired-state baselines and analyst attestations remain separate.

Retained settings reviews include their target, collection context and the
observation time and completeness of comparable DNS and registry sources.
Report completion is not a source observation time. The history preserves
equal-time records; missing context or ambiguous ordering remains unknown.
View-only filters show configured expectations, differences or unknown settings;
history filters separate changed sources from unknown comparisons. All retained
rows remain available through **All**, and filtering does not change exports.

SPF collection completeness is separate from sender-authorisation quality. A
completed expansion containing potentially reachable permissive `+all` evidence
through positive include or redirect paths needs review even when the root ends
in `-all`. Include qualifiers and mechanism order matter: a matching negative
include does not authorise senders, mechanisms after `all` are unreachable, and
redirect is ignored in a record containing `all`. The bounded review follows
[SPF include semantics](https://www.rfc-editor.org/rfc/rfc7208#section-5.2), but
does not evaluate an individual sender or claim that every nested `+all` permits
every sender. Unknown, failed or budget-limited branches remain incomplete.

For nameservers, DS, MX and CAA, choose no expectation, an expected empty set,
specified records, or observation only. A null MX (`0 .`) is a specified record,
not an empty set. Portable settings preserve these choices; an import changes
only the selected fields. Missing, incomplete or stale observations cannot
confirm an expected absence.

In **Current settings**, **Include inherited DMARC and direct parent delegation**
is off by default. Selecting it adds ancestor-policy and reporting-destination
boundary reviews, sharing at most 32 additional TXT queries within ten seconds,
and a direct parent-server sample when you start **Review official domains**.
Each result identifies its queried owner and source. Inherited policy distinguishes
existing from nonexistent names without deciding which applies; a parent sample
is not complete delegation or DNSSEC validation. Ordinary Lookup and monitoring
do not enable this option. Reporting destinations are in the same organisational
scope only when their DNS-derived boundaries agree. Unknown boundaries do not
make a missing optional authorisation record a configuration error.

The current inherited-policy result includes structured discovery completeness,
selected owner, observation time and policy values with DMARC defaults applied.
Incomplete discovery
keeps the selected policy undetermined. This live review context is not added
to saved Brand observations, Case snapshots or portable exports; historical
records without it remain unqualified rather than reconstructed from prose.

Other Brand views include:

- a cross-domain posture matrix over saved baselines and retained observations;
- domain-control passports and local desired-state review;
- transient DMARC or TLS aggregate-report summaries from selected local files;
- an inbox of explicitly associated Cases; and
- a transient Brand Asset Register joining profile scope, associated Cases and
  bounded one-hop retained leads.

Mail report rows and policies are searchable and paginated. Exports retain all
parsed rows and identify uninspected records, policies and archive entries.
Partial report totals cover retained evidence only. Reports remain in the
current tab; importing or exporting them does not update the Brand Profile.

The register is a read-only view. One-hop candidates do not become authored
scope or further anchors. Missing or partial sources remain explicit.

Published Brand Profiles remain readable. Saved page baselines keep their
original fingerprint algorithm; refresh one deliberately to adopt the current
parser. Different algorithms are not treated as equivalent evidence. See the
[storage compatibility reference](browser-local-data.md) for supported formats.

## Review inbox and monitoring

**Review inbox** brings together changes, evidence gaps and due follow-ups,
with Campaigns and Relationships alongside it. **Monitoring** contains
Watchlists, Timeline, Certificates and Custom rules. Case reporting, decision
summaries and the follow-up calendar are under **Case reports and follow-up
tools** when Cases are retained.

**Waiting on** shows current evidence requests, provider follow-ups, reviewed
times and analyst decisions, with reasons and a link to the underlying record.
It overlaps the action queues: waiting for evidence does not remove an item
from **Needs action**. Only recorded deadlines are shown; preparing evidence is
not delivery, and a provider reply is not an independent observation.

Each view names the saved records it is opening. Counts remain unavailable until
the required records are readable; an unsuccessful read is not an empty result.
If a collection is unavailable, reload to retry the read. Other readable
collections remain available in their own views.

The Dashboard links its attention count and recent Cases to the corresponding
saved work. Use **Search** (Ctrl/⌘ K) anywhere in the console to find a page or
search browser-local records. Opening a destination does not collect evidence.

**Relationships** searches exact website-profile groups and weighted pairs
across saved snapshots. Results are paginated, with a page-number control and
all admitted domains retained in each group. Similarity uses complete,
compatible saved fields; source limits remain separate from pagination.

The **Retained evidence gallery** keeps that profile review alongside selected
PNG and UTF-8 text comparisons across Cases. Choose an evidence component and
search Case titles, references, domains, filenames or declared sources; file
contents are not indexed. Search covers the currently read Case metadata; rows
are paged, and selectors show the current page plus already-selected references.
Use **Use as reference** and **Use as candidate** on a row, or choose from the
selectors. The **Comparison pair** keeps both selections above the results,
including files outside the current search or results page. Search for one side,
select it, then search for the other; search and pagination do not close a prepared
comparison. Selecting a file leaves the current page in place and does not read
its original. Use **Swap reference and candidate** to reverse the pair, or clear
either side independently. Selecting the same row action again also clears that side.
Selector labels identify the Case and exact attachment reference, including
separate observations with the same filename and content hash. Open the selected file's
details to check and copy its complete attachment ID, hash and exact stored
timestamps before opening the originals. Readable timestamps use UTC; an unknown
observation time stays unknown. These details describe retained metadata, not a
new verification of the original bytes.
The comparison control explains missing selections, identical attachment references
and files above the existing comparison byte bounds before opening any original.
Two distinct references may still contain identical bytes. If opening fails, use
**Reference Case files** or **Candidate Case files** to inspect the source Case or
recover originals from a backup; use the recorded hashes, not filenames alone.
The existing Case-store and attachment limits still apply, without a smaller
gallery sample cap. **Compare selected text** or **Open selected PNGs** reads only
the selected pair, with separate
Case identities, declared sources, observation times and original-file digests.
Unknown capture conditions remain unknown, and missing original bytes stop the
review rather than becoming an empty image or text result. PNG comparison does
not resize images; text comparison keeps the existing 1-MiB and word bounds.
Changing the pair, evidence component, workspace, selected file content or declared
provenance clears the prepared review. Missing or ambiguous exact references cannot
be replaced by a same-named file. Unrelated Case notes, tags and display-title edits
do not invalidate the comparison; displayed labels follow the currently read metadata.
Comparisons
do not save records, create evidence packages, collect evidence or classify threats.

In **Timeline**, open **Choose Case checkpoints** in the retained change review
to select two or three exact snapshots from one Case. Then choose the interval
to inspect, including nonadjacent snapshots. Only the two selected endpoints
are compared; no state or transition between them is inferred. Equal or unknown
times cannot establish a chronological direction. Field-specific collection,
hostname and model-version qualifications still apply. These selections are
temporary, clear on leaving the page, and do not save or collect evidence.

### Cases and response preparation

Open **Cases** from the Respond navigation. Older Monitor Case links still work.
Select a Case to open its workspace. **All Cases** returns to the retained list
filters. Direct Case links open that record in this browser, not in another
person's workspace.

**Opening saved Cases** identifies the workspace read. If that read fails, the
unavailable message explains how to retry by reloading the page; unreadable
records are not presented as an empty Case list.

The Case's update time, opening time under **Case options**, and note times in
**History** display in UTC. Their **Copy** controls keep the exact stored value,
including fractional seconds. Copying a time does not update the Case. If the
clipboard is unavailable, the exact value appears as selectable text.

**Saved Case views** retains the current status, disposition, search and sort
choices. Name a view, then select **Save as new view**. **Apply view** runs those
filters against the currently retained Cases; it does not collect evidence.
Rename or change a selected view with **Update selected view**. Views belong to
the current workspace and travel in workspace backups, not individual Case
exports. A conflicting edit in another tab must be reviewed before replacement.

A domain can have several independent incident Cases. **Create a separate
incident Case** gives the investigation a title and a new immutable Case ID.
Optionally reuse one retained observation; its timestamps remain unchanged and
the source Case's notes and decisions are not copied. Lookup and Bulk require
an incident selection when several Cases share a domain. Search the Case list
by title, domain or full Case number. Current imports match Case IDs; ID-less
partial or older imports can match a domain only when the destination is
unambiguous.

**Summary** shows retained records and next work; **Evidence** contains captures,
pins and relationships; **Assessment** holds conclusions and branches;
**Response** contains recipient review, packets, delivery and outcome records;
**History** holds notes and manual investigation steps, including
an optional **Record lessons from this investigation** form for useful or
misleading evidence, delays, returned complaints and changes for next time.
It saves a normal Case note; unanswered questions are omitted.
**Use a saved lesson to revise a template** lets you select one note and one
saved template, edit the step instructions and completion criteria, and preview
the changes. Add an applicability statement and reason, then save a new revision.
The original template stays unchanged. Revision provenance contains the source
template identity and content hashes, not the Case identity or lesson text;
anything you type into guidance is included in template exports. The active
guide uses the selected revision's guidance. JSON and restricted manual CACAO
exports retain its revision origin, including after later explicit edits.
The Summary's decision overview keeps the latest analyst conclusion, supporting
and contrary observations, incomplete evidence and next scheduled review together.
Evidence added later prompts another review; it does not change the conclusion.
**Before pausing or closing this Case** in Summary shows up to three next reviews
derived from the selected Case, with the remaining reviews available in a
disclosure. Each opens its exact section in the full checklist; opening it does
not collect data, check file bodies or change a decision. The explanations describe
what the review can establish and what it needs. Suggestions are not closure readiness.
**Case completion review** brings together analyst-open incident
objects, contrary or unresolved assessment links, and retained follow-up
commitments, including undelivered requests and incomplete or undated observations.
Domain and historical scopes without a current incident-link state
stay separate. This advisory review neither closes the Case nor adds a required
step. **Check referenced files** deliberately reads the current workspace's
original and derived files in bounded groups: missing bytes and unreadable storage
are distinct, and identical content is checked once while retaining each reference.
The result stays in the open review and clears when the Case changes, the review
closes or you leave Summary. Matching size and SHA-256 does not verify the declared
source or the accuracy of the contents; ordinary JSON backups contain references,
not those file bodies.
**Evidence relationships and shared sources** records which retained pin derives
from another, or shares its source, with an analyst-supplied basis. Shared source
labels, collection checkpoints and imported-content identities are listed
separately. A relationship can be withdrawn with a reason; its original record
remains. These declarations do not add confidence or establish independence.
**Trace sources for** starts from an assessment claim, recorded decision or
evidence pin. It follows active derivations towards their sources and declared
shared-source links in both directions, preserving cycles and missing references.
Context groups remain separate and are not traversed as declarations. Related
withdrawn links can be included as history, but do not extend the trace. This
read-only view changes neither the claim nor its evidence; a record without
linked pins cannot establish source independence.
Expand **Observation and reference trail** for each exact pin's observation and
saving times, checkpoint or imported-finding identity where retained, and unresolved
references. The list follows the declared relationships, not chronology. A
relationship's recording time is not an observation time, and copying or deriving
a fact does not make it independently collected. The fictional source-reuse
practice uses this same reader without touching saved Cases.
If a later flag reuses your submitted report, record that known relationship.
If its method is unknown, keep independence unknown rather than inferring either
corroboration or dependence. Separately documented new observations retain their
own sources and times. Selected response and internal handoff material carries
the relevant shared-source qualification without copying private relationship
notes into an unrelated recipient's packet.

**Copy citation** on a retained pin or Lookup checkpoint copies only that fact,
its source, observation time and completeness, not surrounding notes or raw data.
**Preview report** shows the selected notes and imported sharing restrictions
before an ordinary Case report download. Previewed downloads use the same
prepared bytes; changing the Case or options requires a fresh preview. These
reports are separate from authorised response packets.
Choose **Decision brief** to focus on a recorded assessment, the latest dated
conclusions, undated conclusions and recorded next steps. Equally timed
conclusions remain separate; undated decisions are not ranked as older.
**Inspect linked evidence** opens exact references within the prepared report,
including opposing, unresolved and unavailable links. It does not fetch evidence
or substitute a newer live Case value. **Full report** restores the complete
reading view. These choices do not change download bytes or printing; long
reasoning and limitations remain available without a one-page truncation.
**Print or save PDF** formats the complete prepared ordinary report, with
all sections expanded, selected notes, imported restrictions, source identities
and omission warnings intact. Long values wrap safely; ISO times ending in Z
remain UTC and unknown source times remain unknown. The print dialog does not
confirm saving or delivery, and report data digests are not PDF-byte hashes.
Due reviews refresh while the view is open without changing observation times.
Section links support
browser back and forward and remember reading positions while that Case remains
open; resizing the viewport clears those positions. On wide screens, Assessment
places retained evidence beside the conclusion form. In Advanced, **Compare
explanations** shows two retained assertions against their linked observations,
including opposing or unresolved relationships and shared source context.
**Consider another explanation** offers optional questions while writing a
conclusion: review contrary observations, their scope and unresolved alternatives.
The prompt does not select evidence or change a record. **Evidence considered**
can include observations that weaken the conclusion; explain their effect in the
rationale and retain unresolved hypotheses or unknowns as structured assertions.
Case response forms save workspace-local recovery
drafts. Their status distinguishes a recovery copy from a submitted Case
record. After reopening a Case, restore a saved draft explicitly and review it
before submitting. Copies from other tabs are not silently overwritten.
Open **Draft inventory** in Cases, then **Read saved drafts** to inspect recovery
copies across the current workspace. Saved values are shown only when selected;
**Open Case** returns to the existing forms without restoring or submitting them.
After the first read, the open inventory refreshes when Cases or drafts change.
An unavailable Case reference remains explicit, including copies whose form
version is no longer supported. Normal Case deletion still removes its drafts.
Unconfirmed writes from open forms are listed separately: a readable recovery
copy does not settle whether a submission succeeded. The inventory is read-only.
If a write cannot be confirmed, the form stays open and further writes are
blocked. Copy any later edits, then reload and inspect saved records before
continuing; do not repeat a submission whose outcome is unknown.

For a second opinion, open **Response → Review with another analyst** and
select the required originals. **Check handoff contents** verifies those bytes
and the complete Case, identifies missing selections, and enables an encrypted
package download. The full Case includes notes, incident links, filenames and
response records; unfinished forms are excluded. A changed Case requires a new
check. The checked view separates original-byte presence and digest matches
from format compatibility, source declarations and recipient access. It names
the current Case, manifest and encrypted-envelope versions; the recipient’s
software still needs to support them. File integrity does not authenticate
source claims, and a download proves neither delivery nor recovery. Open
**Recipient verification steps** for the receiving-side checks. Send the
passphrase separately.

The reviewer unlocks the package in Dashboard’s saved-work tools and checks the
original-file matches. **Open temporary Case review** reads the Case and matched
originals without accessing or changing saved work. Closing the package clears
its decrypted contents from the page. To make edits, download its Case JSON for
an explicit import into a separate workspace and retain needed originals there.
Supported Lookup entries also open a temporary, read-only replay. Select the
entry explicitly; its source states and observation times remain historical.
Return a current Case export or encrypted package.
The unencrypted Case-only copy remains available when deliberately needed.
Select the return in the original Case and review each addition before saving.
Linked new pins must be selected with their claims; conflicting IDs
never overwrite retained content. Status, actions, authorisations, closures,
snapshots and file bytes are not copied back. A changed destination requires another preview.
Preview selections survive changing Case sections, but not leaving the page.
The handoff trail identifies the file and selected entries, not the reviewer's
identity. CLI packs can supply Case data; use CLI verification separately for
their checksums and report binding.

**Compare Case exports or response packets** is a separate read-only view.
Select two ordinary Case exports or two response packets for the same Case;
saved work is not used as an implicit baseline. Inspect changed content, records present in only one copy,
recipient routes, limitations and exact scope. Records align by their IDs, not
their position or hostname. A record absent from an export is not proven deleted
from the Case. Full selected values use the paged local file viewer.
This comparison accepts the same exact ordinary Case versions as CLI Case
editing and the response-packet versions supported by CLI verification, including
historical files. Packets must pass semantic, reviewed-input binding and integrity
checks before comparison; historical packets without an inner review digest keep
that original contract. Generation times, authorisations and integrity changes
describe packet state, not new evidence, delivery, acceptance or permission to act.
Do not mix a Case export with a response packet. CLI packs and encrypted
containers are not accepted. Clear the comparison, close it or
leave the Case to release the temporary copies. It never adds import permissions
or includes its internal differences in a recipient attachment.

Opening a Case keeps it selected while moving between Console tools. The
compact Case context exposes retained hypotheses, pins, decisions, response
history and follow-up dates. **Clear** removes the selection, not the Case.
Selection lasts until the page is reloaded or the protected session ends.

Cases can retain bounded evidence snapshots, pins, checkpoints, analyst
assertions, decisions, contact routes, actions, observed-effect reviews,
closures and investigation branches. Analyst-authored records remain separate
from collected evidence.

If changing a Brand Profile association would exceed Case storage capacity,
review the affected snapshots before saving. Export the reviewed Cases, cancel,
or explicitly remove the listed snapshots. A concurrent Case change requires
a fresh review; notes and decisions are not removed to make space.

Evidence choices show their source and observation time; selecting a pin shows
its retained value and limitations. **Linked evidence** opens the actual facts
behind a decision, assertion, response event or sighting. Supporting and
contradicting relationships remain explicit; a missing reference is not
replaced with another observation.

The selected Case's **Decision overview** suggests local reviews for the open
assessment: missing links, opposing observations, incomplete or undated evidence,
and unclassified relationships. Suggestions use only that assessment's linked
records. They navigate to the existing Evidence or Assessment section; any
evidence collection, relationship edit or decision remains deliberate.

If snapshots share the latest capture time, or any snapshot is undated, the
timeline retains them without selecting a latest assessment. Record updates do
not refresh evidence capture times. The investigation timeline includes all
admitted records across pages; domain and source filters search the complete
projection. Undated evidence remains visible, and Bulk session activity is
labelled separately from source observation time. Analyst decisions and their
retained history appear as local activity, with links to the review and its
currently associated Cases. Unavailable Case identifiers remain visible.
**Evidence family coverage** groups those same records into registration, DNS,
TLS/certificate, HTTP/page, external-report and analyst-decision lanes. Select a
lane to read its records across all pages. Other filters still apply. Combined
snapshots keep their capture clock rather than inventing separate source times;
unclassified pin categories remain separate. Earliest/latest times and undated
counts describe retained records, not continuous coverage. Equal-time records
are not merged, missing records do not prove absence, and later-retained old
observations do not reconstruct what was known at a past date.
The review inbox explains each queue assignment; **Earlier decisions** shows
the retained rationale and dates. Historic omissions are stated explicitly.
Expand an item to review its evidence and decision, or use **Previous item** and
**Next item** across the complete filtered queue. Switching items, pages or
filters preserves unfinished decision forms for this visit. Open **Pause and
resume review** before leaving. **Current review** describes the current selection
and unfinished review forms; **Saved for later** describes the separate saved
copies. Choose **Save current position** to retain those forms and the filters
in this workspace without submitting them. The collapsed control shows whether
a checkpoint is saved and when. Later navigation and edits do not update it.
**Resume saved review** restores it against current records, keeps newer open
drafts and flags changed or unavailable evidence. Its **Return-to-work briefing**
shows the saved queue, the selection's current match, matching retained items,
restored forms and any newer forms kept open. These are results at resume, not a
count of new observations. Add an optional **Question for your next review** before
saving. The checkpoint also keeps a small baseline of subject identities, material
fingerprints, sources and completeness for the filtered view. Resume distinguishes
unchanged, changed, newly matching, ambiguous and unavailable subjects. Newly
matching means present in the current retained view, not newly collected. Incomplete
views and changed source context qualify the comparison; an older checkpoint has
no question or baseline, rather than an invented empty one. No earlier evidence
values are copied. An unavailable item may be filtered, outside the admitted results or
removed; no other item is substituted. Changed-evidence drafts require
explicit review before submission. A draft with an uncertain write outcome stays
blocked until the current decision is inspected and the draft is discarded.
Saved positions are not included in backups or exports. Case form recovery is
separate. Review date inputs and displayed evidence times use UTC. A source
containing only a calendar date keeps that date without acquiring a time or
timezone. **Copy** keeps the exact stored timestamp, including fractional seconds.

Bulk saved views apply their filters, List columns, grouping and sort order to the currently
loaded results. They do not retain targets, select a Brand Profile or authorise
a scan. Loading a view makes no collection request. Choose **List columns** in
the List view, then save the view to reuse the selection. Domain and actions
remain available. Hidden columns do not remove evidence or alter exports.

Evidence gaps uses each retained source's own date. Equal-time disagreements
and undated observations remain available; session-save times do not establish
freshness. The queue and source-state table are paginated without dropping
admitted records. Strictly older dated Bulk observations remain in their saved
sessions.

The calendar
shows every matching follow-up from the admitted Case store across pages;
completed actions and earlier effect reviews are available through its
historical filter. Event times display in the browser's time zone. Select
matching events or individual rows to export.
Conflicting or unknown expiry dates need review before a calendar date can be
selected. Exports include every selected event, with a 32-MiB file limit.
Calendar event identifiers are stable digests, separate from displayed Case
references. Replace an older calendar import if its original identifiers would
otherwise create duplicate events.
Guides show matching retained Cases in their Case selector. A selected Case for
another target does not supply the current guide's handoff assessment.

Quick response includes observation, conclusion, recipient review, packet,
manual delivery record, independent recheck and closure. Stage links open the
relevant form. Advanced adds assertions, branches, manual investigation steps
and detailed action transitions. Switching presentations preserves unfinished
stage drafts. The response queue orders active actions by their next due date,
keeps receipt references beside recipient provenance and opens the selected
action or saved recheck question. Completed actions remain available through a
view filter. Equally timed independent observations remain separate; a provider
reply never becomes an independent outcome. Route freshness updates while the
view is open; catalogue review dates do not claim a live contact check.
The summary opens outstanding evidence requests directly, keeping provider
deadlines, concurrent preparations and recorded delivery separate. Before packet
authorisation, **What this recipient will receive** shows the selected URLs,
contacts, evidence references and response history. Its expandable fields come
from the packet writer; pin values and file contents are not attached. The final
preview also includes the export envelope. Editing this copy leaves private
Case originals unchanged.
Evidence, conclusions, assertions, branches,
actions, outcomes, closure and manual-step forms support recovery after reload.
Unfinished drafts are excluded from exports and backups; submit or copy any
unfinished work before moving to another browser. A failed recovery save warns
before navigation and leaves the form available for retry.
Recipient review retains the source observation and review deadline separately
from operational follow-ups. Updating that evidence invalidates prior approval.
Case response date and time fields use UTC and retain seconds and milliseconds.
Receipts retain an original event time, reference, optional evidence pin and
limitations. **Prepare a recheck** opens Lookup without starting collection.
In **Record a recheck**, select a retained pin to use its source, observation
time and completeness. Its original limitations remain on the linked evidence;
the form accepts any additional review qualifications. Undated pins cannot date
a recheck. Clear **Use selected source details** to link the pin as context for
a separate manual observation. **Enter a manual observation** restores that
draft without a pin link.

**Recheck questions** saves a next step with a target hostname, optional baseline
pin and comparison conditions. Select that question when recording a Case or
Lookup recheck. Each answer keeps the question and conditions as they were when
answered; resolving the question does not rewrite those answers. Non-reproduction
requires a complete observation under comparable conditions. A failed source,
different target or another review of the baseline cannot establish it. Lookup
leaves the outcome and completeness for the analyst to select; unchanged fields
do not select a verdict. Follow-up times are entered in UTC.

An **Independently not reproduced** closure needs a complete linked review;
limited reviews remain in the history and can support other closure reasons.
For a DNS-removal assessment, repeat observations of the same hostname and
compare both address families under comparable conditions. No address data is
not the same as a missing name, and a timeout establishes neither. The review
history retains the observations; it does not calculate a takedown time or
automatically classify removal.

The saved reporting-route review includes platform reports. Filter by source
review state or search by domain, recipient or source; pagination exposes all
routes in the admitted Case store. Source observation and review dates remain
separate from action updates and follow-ups. **Refresh local review** re-evaluates
saved dates against the displayed clock without starting collection.

External imports open a paged review of every accepted finding or claim. Select
records across pages and inspect **Retained fields** before importing; shortened
values and omitted qualifications are identified. Unselected records do not
change Cases. Intelligence claims require an existing target Case.

Each Case has a stable `WS-` reference derived from its complete immutable local
UUID, so it remains stable across browser exports without relying on a shared
counter.
Controlled Case types, incident links and investigation context are typed Case
fields, separate from free-form tags and assertions. Historical tags and
assertions remain retained when their metadata is migrated. Exact public incident
links can be retained for web or social-platform
content, resolved without erasing history, and carried into a response packet.
**Exact incident-object coverage** keeps each link's analyst status separate from
explicit action binding and independent observation coverage. Expand action and
recipient context to inspect current routes, review events and recorded
deliveries. Current route details are not historical recipient snapshots.
Exact delivery receipts show each packet's generation time, format version,
audience and canonical JSON digest separately from the delivery time. Preparing
a packet alone creates no retained delivery; older references without an exact
receipt leave those details unknown. Linked corrections identify the original
action, delivery and packet for the affected object subset. Competing retained
response events remain visible even when not applied to the current action state.
Manually reviewed
actions can bind up to 20 typed domain, hostname, page, advertisement, social,
messaging, storefront, app or other objects in one shared reporting record.
Choose the affected subset on each provider result; acknowledgement is not
removal. Partial-remediation and resolution reports require an explicit nonempty
subset; a ticket-wide partial response does not mark every object remediated.
Provider-reported closure uses the latest applicable outcome for that exact
object, not a later response about another object. Conflicting same-time claims
cannot support closure. Event snapshots remain immutable, and already-retained historical
identities stay selectable after a link edit without binding to its replacement.
Missing historical bindings remain unknown. Pins, saved recheck questions and
independent reviews can concern the same exact object. Technical outcomes need
complete later evidence, a complete exact-object baseline and comparable
conditions. Procedural disputes and warnings retain their source separately.
Deliberate object closure leaves other objects and the Case status unchanged;
whole-Case closure remains a separate analyst decision. No control submits a
report or starts collection. An imported conflicting receipt does not erase an
earlier authored closure. The Case view and Markdown report qualify that
historical decision; JSON preserves its authored fields and source receipts.
Malformed or dangling closure links are counted separately as unretained history.
Operations reports
offer a local contributor drill-down and a paged Case scope view, independent of
the report's time window. Campaigns show the same view for Cases matching their
domains; same-domain incidents remain separate. Provider outcomes remain separate
from independent reviews and recorded closure dates. Downloaded reports remain
aggregate-only.

For supported platform hostnames, the Case workspace shows freshness-bounded
official safety or rights-reporting routes matched to the selected Case types.
Each route includes a preparation checklist from its reviewed guidance.
For a custom host or advertisement, select its reporting platform explicitly when
supported by the evidence. The selection lasts only for this visit; it does not
classify the host or change the saved incident link.
The analyst must verify the current route and authority before opening it.
WHOISleuth creates only a drafting action and never submits the complaint.

Response packet preflight checks the selected evidence, recipient scope,
privacy, redactions, analyst authority, freshness and contradictions. Drafts
remain available with cautions. Reviewed authorisation is bound to the exact
canonical inputs and the current confirmation decision. Changing a confirmation
during authorisation cancels that attempt, even if you select it again before
the check finishes. Review the current confirmations and authorise again.
Material changes also invalidate authorisation. Packet generation is a
local export; WHOISleuth does not send it or promise a provider outcome.
**Packet authorisation status** explains the next review needed and takes you to
its existing control: missing readiness, changed material, confirmations or
explicit authorisation. **View full readiness matrix** keeps every row available.
If a pending authorisation loses its review context, the status explains that it
stopped; returning to the packet does not complete that earlier attempt.
In the packet's **Review** phase, **Prepare original files separately** checks
retained files against their recorded size and SHA-256 before you select any.
Missing or unverified files remain visible but cannot be selected. A packet
capture reference matches only an equal digest and byte length, not a filename.
The separate package contains only the files you select with their existing
source and image-derivation declarations, not the full Case backup. Packet
redaction rules do not change those file contents; review them for the recipient.
Changing packet inputs or leaving or closing this review clears the temporary
check and selection. Export rechecks the bytes and current Case, without changing
the packet, authorising delivery or recording a submission.
In **Local handoff**, JSON export is the primary action. **Other export formats**
contains Markdown, email download and email copy; all use the same packet review
and freshness checks.
**Preview manual complaint** shows the exact text used by Copy and the email
download. JSON and Markdown describe the same prepared packet. Changed inputs
or freshness require a new preview; receipt recording remains a separate action.
Closing the packet or leaving its phase or Case section cancels preparation that
has not yet started a download or clipboard request. Reopen the review to try again.
A download or clipboard request already handed to the browser cannot be recalled.
**Preview printable report** presents the same audience-filtered packet with
incident context, source references, UTC times, readiness and response state.
Print or save it as PDF through the browser, optionally including the exact JSON
appendix. Printing rechecks the prepared inputs; it does not confirm a saved file
or record delivery. The report digest identifies the packet JSON, not the PDF.
The report's **Reading guide** offers starting points for analysts, domain
managers and external reviewers. It moves to a section of the same prepared
report; it does not change the selected audience, hide evidence or alter an
export. The guide itself is not printed.

Provider acknowledgement or reported resolution remains analyst-recorded state,
not independently observed remediation.

In **Requested evidence and amendments**, choose a recorded packet delivery and
check its full SHA-256 digest beside the selector. Receipt labels show both ends
of the digest; **Copy digest** copies the complete value. Record the provider's
request and any stated UTC deadline. Review it against
retained pins, or record why the evidence cannot be provided. **Create drafting
amendment** starts a linked action: review its recipient and select all prepared
pins in its response packet before authorising it. Preparation is not delivery;
record the new packet's delivery separately. Each request shows whether evidence
is still requested, prepared but not delivered, unavailable, or delivered.
Concurrent preparations remain separate for review. Deadline and event times
can be copied exactly from their readable UTC display. The original digest and request
history remain unchanged. Case exports, reports and CLI Case packs preserve this
history; public Case packs exclude it.

For a self-discovered mistake, prepare a **correction or withdrawal request**
against one exact recorded delivery. Select its retained packet receipt, state
the assertion being changed and the reason, choose supporting evidence, and
keep the affected objects within the original delivery's scope. Review the
recipient, authority and disclosure again before preparing the new packet.
This path is separate from a provider-requested amendment.

Older delivery records that contain only a digest cannot establish the original
packet's version, recipient and object scope. They remain visible, but cannot
authorise an exact-linked correction. The original delivery and packet digest
stay unchanged when a new draft is created, cancelled or abandoned. Record any
later delivery separately; a prepared withdrawal does not mean it was sent or
accepted.

A retained exact Incident URL can also be handed to the [optional capture companion](../packages/web-capture/README.md).
The browser validates the selected manifest and can
import its sanitised metadata and declared digests into that Case. Optionally
select the screenshot and DOM-digest files to check their byte counts and
digests, then view matched JSON or PNG files locally. Metadata import does not
save originals by default. Select **Retain this manifest and verified matching
files** to save them together; unmatched selections remain excluded. Existing
capture manifests can be reviewed without a retained Incident URL.

Open **Page behaviour and dependencies** to inspect navigation, script and frame
responses, default form destinations, script hashes and requested-action wording.
**Request-channel coverage** also shows images, styles, fonts, media, fetch, XHR
and beacon attempts. Each request distinguishes a supplied, refused or unavailable
response and whether collection started. Disabled transports and interactions not
exercised are listed separately; an unseen request is not evidence of absence.
**Compare another capture** compares those records from two manifests before any
PNG is selected. **Compare capture conditions** lets you select 2–20 observations
from either manifest, with all available observations listed across pages. Review
declared observers, vantages, browser versions, viewports, scale, locale, timezone
and colour scheme side by side, then deliberately choose the first and second
page observations. Entries without retained page observations remain available for
condition review, not page comparison. Condition selections do not select image
files or import evidence. Exact capture URLs and observed login/session state are
not retained in these manifests; image dimensions do not establish a viewport. Missing
observations remain qualified, and historical manifests have no page-observation
data. For a page you own or are authorised to review, **Record an expected
change** adds your reason and a digest of the selected observations to the Case
assessment. It does not approve future changes automatically.

**Temporary analyst session declarations** lets you mark each selected capture as
signed out, signed in or explicitly unknown. Leaving **No declaration** selected
records nothing. Your statement and annotation time are separate from the capture's
declared conditions and observation time: matching statements do not prove actual
authentication, equal privileges or equivalent environments, and never change
comparison eligibility or results. No account details are collected. Declarations
stay in page memory and are not saved, printed, included in application copy actions,
downloads or reports. Deselecting a capture removes its declaration. Closing or
leaving the review, replacing either input (even with the same file), changing Case
or workspace, locking, navigation and reloading clear them all. The fictional
capture-condition exercise offers the same temporary controls without saving work.

**Specialist evidence reviews** in the same Evidence section lets you arrange source-qualified
incident stages without treating a reported action as an observed event. Compare retained domain
changes with expected maintenance, follow a stable platform object across
versions and per-object outcomes, compare an authorised official storefront,
or inspect connector configuration without running it. Save the report to keep
its observations and a source-qualified Case summary. Incident, platform and storefront
inputs can be reloaded for a later review; connector secrets are excluded.
See [contextual reviews](contextual-reviews.md) for fields and CLI examples.

**Retained files** also accepts deliberately selected originals without a
capture manifest. Review the filename, optional source and observation time,
then choose **Retain selected files**. The workspace stores exact bytes and
separate provenance references, using its encryption when enabled. Shared
content remains until its last Case reference is removed. Downloads verify the
full byte count and digest. A missing file is not evidence of absence; restore
or retain its matching original. JSON backups carry references only, so keep
the original files separately. After preparing a workspace backup, open
**Back up referenced files separately** and export every listed group. Groups
retain all required content across bounded operations; shared bytes are exported
once while each Case's provenance remains in the JSON. Enable **Encrypt package
download** for each file group when needed; JSON backup encryption is separate.

To test recovery, review the downloaded JSON and open **Rehearse recovery in a
separate workspace**. Create a destination, then restore the downloaded evidence
packages or original files. The active workspace is not switched or modified.
**What this backup can recover** is available after preparing or reviewing a
backup. It lists reviewed sections, recorded counts, unsupported sections and
historical migration explanations. It separates Case file references from distinct
required originals and their declared byte counts; unreadable references remain
unknown, not zero. Saved review positions, unfinished Case forms and certificate
search history are not archive sections. Temporary comparisons and tab references
are not backed up either. This overview does not check original-file availability,
confirm a completed download or replace destination verification.
Section checksums and Case identities are compared with the selected backup;
every referenced file must match before recovery is reported as verified.
**Recovery set index** identifies the exact selected JSON or encrypted backup
and matching evidence packages by full-file SHA-256, byte length and format.
It stays in this review unless you choose **Download recovery set inventory**
to keep an unencrypted plain-text copy. Digests can correlate private files;
review before sharing. The copy contains no filenames, paths, Case details,
original contents or destination-verification result. It is not an importable
backup. Expected package groups remain unknown because the backup records
original-file references, not package membership. Each original uses its
latest matching selection; supplying it directly or in another package updates
the index without changing saved provenance. Failed reads or unmatched files do
not join the set. Selection and matching do not prove a completed download or
write: the separate recovery result reports the last completed destination
verification. Keep the downloaded files themselves, not just their digests.
The paged **Original-file recovery checklist** shows each missing or unverified
exact SHA-256 and byte length, plus the independent Case provenance references
for shared bytes. Filenames are locating hints only: renamed exact bytes match;
same-name different bytes do not. An unreadable storage group is labelled
unverified rather than absent. Copy a digest with the keyboard-operated copy
control, then restore bounded groups until the checklist is empty. The checklist
is transient and clears when the rehearsal is kept, deleted or closed.
Migrated formats are labelled for review rather than claimed byte-equivalent.
Preferences are reviewed but not applied. Keep the rehearsal workspace, or
explicitly delete it after checking the result. Leaving the page preserves it.

Use **Select files for export** to package selected retained originals or
derivatives with their declared sources and observation times. Missing bytes
stop the export. Edited images declare their immediate parent fingerprint,
editing method and operation kinds. The parent may itself be edited and need
not be selected. These declarations do not prove the edits; missing declarations
leave editing history unknown. **Review edited images** lists the declarations
for the current selection. **Inspect declared links** follows each exact parent
reference, fingerprint and size within this Case's already-loaded metadata.
It stops at a missing or conflicting parent, a repeated reference (cycle), or
the existing Case attachment limit. It does not read ancestor bytes or search
other Cases. A parent without an edit declaration does not establish an unedited
original, and even a matching chain does not authenticate how it was created.
Earlier links and the review sheet are not included in the package; each selected
image still exports only its immediate-parent declaration. The ZIP uses generated entry names; Case records,
filenames and edit coordinates stay in the separate JSON backup. Where supported,
**Write new evidence folder** creates and verifies a new child inside the
folder you choose. Otherwise, extract the ZIP locally. Neither option is a
complete workspace backup. **Review evidence folder** on Dashboard checks the
same manifest and files without importing them or granting ongoing access.

Open **Compare retained text** and choose two retained UTF-8 `.txt` or `.text` files,
up to 1 MiB and 65,536 words each. It finds shared runs of at least five words
after NFC Unicode normalisation and lowercasing. Review the original excerpts,
character offsets, matched-word counts, source labels and full-file digests.
The first 256 passages are paged; further passages are counted explicitly.
Long excerpts show a labelled preview while preserving the complete source
range and match counts. The complete original stays available in Retained files.
Correspondence is not proof of authorship or infringement. This browser-only
review neither rewrites the files nor adds a Case decision automatically.

Preview a retained PNG to compare it with another retained image. Source,
observation time, dimensions and byte identity remain separate; an appearance
change is not proof of a site change when capture conditions are unknown.
**Compare image regions** checks every pixel without resizing. The map groups
changes; its coordinate list gives exact changed counts in each cell. Exclude
rectangles explicitly to ignore selected areas in both images, then calculate
again. Exclusions do not redact files or become saved evidence. **Compare another
capture** accepts a second manifest and matching PNG without importing it into the
Case. Review its observation times and declared browser, viewport, locale and
vantage alongside the images; missing conditions remain unknown.
Choose **Create edited PNG** to draw or enter rectangular redactions and
outlines. Add each region, prepare the image, review its pixels, then retain it
as a separate file. Redactions are opaque, not blur effects. The original stays
unchanged, and the derivative records its source fingerprint and region
instructions. Image edits stay in memory until retained; leaving the Case or
closing the preview requires confirming their loss.

### Retained change and review

Timelines, watchlists, certificate review, evidence-gap queues and Analyst
Review Items derive from retained or imported records. The absence of a retained
source record remains different from an explicit skipped collection. Expiry,
review-due state or a material fingerprint change can return an item to review;
viewing it does not resolve it.

Later comparison is explicit. It preserves collection-condition changes,
unavailable components and incompatible model versions instead of treating
omission as removal.

The Monitor follow-up calendar exports only selected dated records. It names
the stable Case reference by default; investigated domains, recipients, Case
types and event details require separate disclosure choices.

### Defensive and assurance outputs

Defensive domain exports require deliberate reviewed selection and contain
expiry, provenance, exclusions and rollback guidance. They are not uploaded or
applied automatically.

For revisions, open **Bulk → Workspace tools → Indicator revisions**. Preview
a retained manifest, then choose whether to use it as the baseline. Explicitly
add eligible shortlisted candidates, renew selected review windows or withdraw
specific identities. Review the change list and download the manifest plus the
required STIX or MISP file. Nothing is saved to the browser workspace.

Keep each manifest: the next one links its predecessor's digest, not its full
history. Original observations and creation times stay unchanged by renewal.
Expired entries remain distinct from withdrawn entries; omission is not
withdrawal. A withdrawn domain can be reintroduced only with a new identity.
MISP expiry is a recipient review deadline, not an automatic removal rule.

Cryptographic assurance keeps DNSSEC, route-origin, DANE/TLSA, PKIX, signatures
and timestamps independent. A valid digest or signature proves only its named
content and key relationship; it does not establish evidence accuracy, signer
identity or target safety.

## Understanding evidence

### Reviewing an acquisition

**Acquisition due diligence** shows the target and the Lookup observation time
alongside registration/contact evidence, transition dependencies and manual
policy checks. Open **Review prompts** to jump to an area with missing evidence
or a manual check; its full source context remains beside the observation.
These shortcuts do not change your decision, complete a check or make a request.
Use the decision workspace to record the checks you have performed and any
remaining questions. The same presentation in the Demo stays fictional.

### Reopening an acquisition decision

In Lookup's **Acquisition due diligence → Analyst decision workspace**, select
**Reopen acquisition review** and choose the original JSON (up to 15 MiB).
The supported version, bounded structure, full canonical digest, current target
and synthetic/manual context are checked before a historical preview appears.
Cancel keeps the current manual edits and Lookup evidence unchanged.

**Accept historical manual fields** restores only the decision, rationale and
selected checks. It does not replace fresh Lookup evidence or promote an older
observation time. Keep the original packet for its historical provenance.
Before preparing a newly dated reviewed packet, explicitly reconfirm the
decision and selected checks against the current evidence; changing either the
evidence or manual fields invalidates that confirmation. A download is prepared,
not confirmed durably saved. There is no automatic lookup, purchase, contact or
submission, and synthetic packets remain demonstration-only.

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

In Lookup's Registration section, **Explain a lifecycle date** shows the
parser-selected text, its supplied ISO companion and a current conversion
check for Created, Expires or Last updated. Each publication remains separate.
Copy controls preserve the exact retained strings. Open **Selection and
provenance** for parser rules, incomplete-source details and unavailable
original field locations. A calculated value does not fill a missing retained
companion, and a date-only midnight is not an observed event time.

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
The Case export review and download share one immutable snapshot, including
separate Case IDs for distinct incidents on the same domain. Later Case edits
are not substituted into an already reviewed download; reopen the review to
include them.
Choose review labels from independent evidence before inspecting the score.
Include authorised lookalikes, ordinary domains, confirmed incidents and cases
where collection is incomplete—not only examples that agree with the model.
Suspicious, unreviewed and closed-without-action dispositions are excluded from
binary metrics; unscored records remain excluded even when reviewed.
Compare collection depths and review reasons, inspect the sample counts and
uncertainty intervals, and keep examples used to adjust a rule separate from
later evaluation. The repository's labelled synthetic examples test these
boundaries; they are not an estimate of real-world detection accuracy.

## Browser-local storage and archives

Use **Manage browser workspaces** on the Dashboard to separate investigations.
Creating a workspace leaves the default workspace unchanged. Open it deliberately
after saving current edits; switching reloads the Dashboard and leaves unsaved
forms and page results behind. Other tabs keep their own workspace. The current
workspace is shown above Console pages and beside backup/import controls.

Export each workspace separately. Open the intended destination before reviewing
an import. Names and tab state are not part of a backup. To delete a named
workspace, switch away, close its other tabs and confirm its name. Pending
deletions can be refreshed and retried. Workspaces share browser quota. Ordinary
workspaces are plaintext; separately encrypted workspaces require their own
passphrase. Workspace names do not create separate user permissions.

Ordinary workspace state stays in IndexedDB as bounded plaintext JSON in the
current browser profile. Failed reads, quota errors and unsupported versions
remain explicit. Clearing site data removes the workspace; downloaded files
remain under the user's control.

Import validates the full checksummed archive before a non-destructive merge;
an omitted section never deletes local data. The [Case and workspace contracts](case-contracts.md)
list supported versions and migrations.

Encrypted archives use browser-local password-based
authenticated encryption. It protects the downloaded file while locked, not an
open Console or active IndexedDB. A checksummed unsupported future Case section
is isolated as unsupported.

See [browser-local data](browser-local-data.md) for migration, concurrency,
quota, recovery and deletion details.

## Reports, imports and exports

In the external-findings preview, **Explain a field** compares the accepted
hostname, observation time, evidence value or source label with the exact
proposed Case field. Copy either value without saving. This uses the existing
Case projection, including its shortening rules. For directly selected findings
JSON or fixed-column CSV, **Show in selected original** reveals the exact string
token or cell, decoded value and parser-owned location, bound to the selected
file's byte digest. WACZ provides **Show selected archive provenance** instead:
package and verified member identities, plus record byte ranges in the expanded
member. These are not ZIP offsets or a verbatim location of the derived summary.
Duplicate source rows remain ambiguous; converted formats without a supported
location do not reconstruct one. Original text, locations, member paths/digests
and JSON/CSV file digests stay temporary, are excluded from printing and Case
exports, and clear when the preview closes, changes, is cancelled or imported,
or the page is left. WACZ retains its existing package-digest source reference
when findings are imported. Copy is deliberate and does not clear the device
clipboard when the preview closes.
The separate import content digest covers the complete
accepted finding, source name and source reference, not the original file bytes.

Exports are deliberate local actions. Review them before sharing:

- a full saved Lookup can include target, endpoints, raw RDAP publications,
  WHOIS bodies and publicly published contact data;
- normalised Lookup evidence excludes raw registration payloads and expanded
  contacts. Current schema 29 and published v2 schemas 27 and 28 retain that boundary;
  exact v1 schema 26 can contain public contact fields;
- Case, workspace and all Case-pack audiences can identify investigated
  hostnames and contain analyst records. Public packs retain Case, pin and
  decision identifiers, tags, decision summaries and rationale;
- graph, campaign and defensive exports identify their selected scope; and
- screenshots from authorised local capture preserve visible rendered content.

Local importers bound and validate an entire file before preview or merge.
Profile, watchlist, shortlist and template merges retain local records when the incoming
timestamp is older, equal or missing. An unknown local watchlist time also
prevents automatic replacement. Missing or invalid watchlist times stay unknown
in history and exports; they are not plotted as dated observations. Imported Bulk sessions, saved views,
review rows, website snapshots and templates that exceed capacity are skipped
without evicting saved work. Case imports fill available note and evidence-history
slots without displacing local entries; omitted imports and any workspace-wide
storage pruning are reported. Passport imports reject a selection that cannot
fit the destination profile before saving any of it. Saving a Bulk
session at capacity lists the affected sessions and offers export, cancellation
or explicit removal; a changed collection requires a fresh review.
STIX, MISP and external-finding inputs remain analyst-supplied evidence; import
does not refresh them or establish their truth. Unsupported future schemas fail
before partial interpretation.
The import preview separates accepted claims from source objects and relationships,
shows reference gaps and transformation losses, and keeps the source-file digest.
Relationship structures are preview-only; importing claims does not create those
relationships. Review each claim's retained fields and markings before saving.

The CLI can verify supported envelopes, compare saved observations, inspect
workspace archives and prepare sharing reviews offline. See
[offline artefact verification](https://www.whoisleuth.com/cli#command-verify-artifact)
and the [interchange fidelity report](https://www.whoisleuth.com/cli#command-interchange-report).

### Browser and CLI handoffs

On Dashboard, **Package and review evidence files** also offers **BagIt 1.0**
under **Export format** and **Review format**. BagIt keeps selected bytes
unchanged in an unencrypted ZIP or new folder with SHA-512 manifests.
Verification accepts SHA-256 or SHA-512 and distinguishes complete, missing,
mismatched and unsupported checks. It never retrieves files from `fetch.txt`.
File integrity does not establish factual accuracy. Use the ordinary encrypted
package option when the handoff needs encryption.

Lookup's **Download evidence package** includes the capsule and its exact
linked Lookup JSON together. **Download capsule** retains the standalone format.
In Dashboard saved-work tools, **Package and review evidence files** can also
include selected screenshots and opaque files, with optional source declarations
and observation times. Unknown times stay blank; packaging time is separate.

**Encrypt package download** protects the manifest and every selected file in
one `.wlep` download. Keep its passphrase separately; it cannot be reset. Review
asks for the passphrase before showing contents, and clears it after the attempt.
Ordinary ZIPs, folder exports and capsule-only JSON remain unencrypted. Downloading
an entry after unlocking produces the original, unencrypted file.

Review shows all entries, their digests and the local packaging event before any
import. It does not upload files or change saved data. Verified workspace files
open the existing merge preview. JSON text is fully reachable in paged inline
review; PNGs can be decoded locally, and all verified files remain downloadable.
No document scripts or links run. Capture manifests are checked against every
included attachment's exact bytes. Browser import and CLI format verification
remain separate from those byte checks.
Packaging preserves the selected content without redaction. Ordinary ZIP and
folder exports are plaintext; the encrypted `.wlep` option protects the manifest
and all included files until unlocked.

Use the same short sequence for each handoff: export deliberately, verify the
selected file, inspect its interchange report, then preview the destination
import. These checks do not upload the file or establish that its observations
are true or current.

- For a browser workspace, run `verify-artifact workspace.json --json` and
  `interchange-report workspace.json --json` before using the Dashboard import
  preview.
- For a CLI Lookup, save `lookup.json`, verify it, then use **Replay exported
  evidence** in browser Lookup before retaining anything in a Case.
- For a Case handoff, choose the audience explicitly, run `sharing-review` on
  the separate package and review its redaction manifest before sharing it.

Repository maintainers can run `npm run interchange:roundtrip` to exercise one
reserved-domain workspace through the canonical browser export, CLI
verification, browser merge and canonical re-export path. It prints the digest
for that exact generated fixture and performs no request or durable workspace
write.

## Limits of the product

WHOISleuth does not provide continuous global monitoring, a multi-user case
database, background workspace synchronisation, legal conclusions, guaranteed
source completeness, automatic takedown, domain acquisition or proof of
ownership, control, intent, safety or maliciousness.

Use the [privacy notice](../PRIVACY.md) for data-handling details and the
[threat model](threat-model.md) for security boundaries.
