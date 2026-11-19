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
for a single target, or [Bulk](#bulk) for a list. [Brands](#brands) organises
candidate review, and [Workspaces and encryption](#workspaces-and-encryption)
explains where saved work lives and how to protect it.

Appearance controls offer comfortable or compact density; compact uses the full
width in console workspaces. Turn off decorative effects for plain backgrounds
without scanlines or glows. The console command palette lists keyboard shortcuts
below its results, and **Show brief keyboard hints** adds hints beside the page
search for this visit. Its **Documentation** scope searches the public guides and
command reference, not your saved Cases.

The command reference's **Build this command** editor checks arguments against
the CLI's grammar and quotes them for Bash, zsh, sh or PowerShell. Lookup's
**Continue in the CLI** starts with an offline plan for the current target and
depth; optional browser source selections do not carry over to the CLI.

Public guides share documentation search, section navigation and print layouts.
In **Methodology**, **Analyst field cards** is a compact reference for scope,
source states, comparison and handoff; select **Print field cards only** before
**Print this guide** to print just the cards.

[Practise with fictional evidence](#practise-with-fictional-evidence) before
working with your own records.

## Review and compare

Brand candidates, the Review Inbox, Bulk's Review view and the Case list share an
**Inspect** workflow. On wide screens the queue stays beside the current item; on
narrow screens one pane shows at a time. **Back to queue** returns without clearing
filters or selections, and Escape closes inspection when you are not editing.
Inspecting an item does not select it for a batch action.

Open **Presentation** in the console context to choose a layout for this tab:

- **Analyst Desk** is the balanced default.
- **Evidence Bench** gives the evidence inspector more room and shows pinned
  checkpoints beside the current task on wide screens.
- **Field Journal** stacks the inspector and gives timelines a more spacious
  reading layout.

The layout lasts while the console is open in this tab and changes nothing else.

Brand candidate **Explainable pattern groups** shows the candidates behind each
matching rule, with their review status, declarations and exceptions. Groups follow
the current filters and may overlap; **Inspect** opens a candidate and returns you
to the same group page. Every candidate also stays in the main queue.

Case inspection is a read-only preview; **Open Case workspace** opens the editor.
In the Case list, **Organise Case tags** lets you select Cases across pages, preview
exactly which tags will be added or removed, then apply the change once. If any
selected Case conflicts or the change would remove stored evidence, nothing is
changed. If a save's outcome is unclear, reload and check the saved tags before
trying again.

In **Retained change review**, choose a comparison, select the rows you want and
use **Download selected rows** for a plain-text report of those values, their
source states, times and limitations. Nothing is selected for you. Selected values
may still be private, so review the file before sharing. The report is for reading,
not for importing, and it reflects the comparison on screen; reload to include
changes made elsewhere.

## Prepare a handoff

In a prepared response packet, **Recipient reading view** offers the full report,
a brief, the selected evidence and its timeline, all from the packet's own
contents; printing uses the full report and optional JSON appendix. **Compare
disclosures — analyst only** sets your ordinary Case report beside the recipient's
JSON so you can see what the recipient will not receive. It can show private
fields, so it is never printed or exported.

See [Cases and response preparation](#cases-and-response-preparation) for the
response workflow and [Reports, imports and exports](#reports-imports-and-exports)
for portable files.

## Resume and recover

**Pin checkpoint** in a Case evidence timeline keeps up to four references in the
current tab. Open **Tab references**, then **Pinned checkpoints**, to reopen them
or set two from the same Case side by side. **Navigation trail** lists up to eight
recent Case and infrastructure views and returns you to each with its filters and
pages. **Favourites in this tab** keeps up to eight links to Case sections, Monitor
views, tools and reference pages; a favourite opens the current records rather
than a saved snapshot. All of these clear when you reload, lock, sign out or leave
the console, and a deleted Case shows as unavailable.

Review Inbox forms keep their drafts while you inspect other items; save a review
position to keep them across a reload.

Each recovery tool has its own job: a saved review position resumes your queue,
filters and selection in this browser; a pinned checkpoint revisits exact evidence
in this tab; a workspace backup moves saved records to another workspace. Finish
and save Case forms before a backup if their contents need to travel with it. See
[Browser-local storage and archives](#browser-local-storage-and-archives) for
backup, restore and original-file recovery.

## Dashboard

Dashboard is the authenticated starting point. A new workspace offers a few
first actions: explore the demo, investigate a target, start a guide or import an
existing workspace. Once you have saved work, it shows what needs attention,
what is overdue or changed since review, and your Case and watchlist counts, each
linking to the matching review. Viewing Dashboard does not mark anything reviewed.

**Search saved work** finds Cases, Lookups and other retained records in this
browser. Results are paged, and the coverage note lists any collection that
could not be searched. Open **Retained history** on a result to see each saved
observation and its sources; its first and last dates describe when evidence was
saved, not when an indicator appeared or disappeared.

**Browse retained infrastructure** lists saved domains, hostnames, addresses,
certificates, nameserver sets and HTTP origins. Filter by text, source or date,
then inspect an identity to see its dated sources and direct relationships.
**Topology and list** arranges up to 50 of those relationships as a diagram,
with arrows showing direction; **List only** shows the same links without the
diagram. Source links open the saved Case, campaign or Brand record rather than
starting a Lookup. These views show saved evidence only; a shared address or
certificate does not by itself show current hosting or common ownership.

Campaign and template editors protect your draft if another tab saves the same
record first: the save is refused and your draft stays open so you can refresh
and reapply it. A draft whose record was deleted can be saved as a new record.

### Workspaces and encryption

**Browser workspaces** separates saved work without moving the default workspace.
Choose **Encrypt saved workspace records** when creating a named workspace to
require a passphrase in each tab. **Lock workspace**, reloading or leaving the
console clears its unlocked state. **Auto-lock** is off by default; choose an
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

The console context bar shows the current task, workspace and backend. Expand its
storage disclosure for browser or filesystem details; filesystem storage is
plaintext, and encrypted backups are separate exports. Workspace lock controls
and unavailable-state messages always stay visible.

Starting a guide opens its current step. When you open a tool directly, an active
guide appears as a compact disclosure above it, where you can choose a step,
review what it would send or record an outcome. Choosing a step neither approves
collection nor marks the step complete. Outcome notes you have not confirmed stay
with their step until you reload; confirmed progress lasts for the current tab.

#### Practise with fictional evidence

Choose **Explore an example investigation** on the public homepage to open the
demo. It uses fixed fictional evidence, makes no live requests, needs no sign-in
and keeps progress in the current tab only; **About this demo** explains this
again at any time. Start with a suspicious-domain, brand-lookalike or
reported-change task, after which the tool navigation appears. **Reset demo**
returns to the task choices. Demo HTTP examples keep only the origin, so their
URL rows read **Not retained**. In the Case step, **Explore the retained
investigation timeline** groups the fictional observations by evidence family.

**Practise with real case forms**, below the demo workspace or from the Resources
practice link, offers incident, conflicting-source and provider-response
scenarios. Pin an observation, record a conclusion linked to evidence, and review
an incomplete later capture using the same forms and validation as the console.
The practice Case and drafts exist only on that page, and nothing is collected,
submitted or exported. Changing scenario asks before discarding your work.
Feedback checks the relationships and states you recorded, not the quality of
your written reasoning.

**Larger practice reading** and **Show practice companion** change the layout.
**Present selected fictional evidence** lets you put supplied observations in an
order to read through with their sources, times and limitations, without changing
their chronology. The timeline also offers a **Field journal reading layout**.

Scenario exercises include:

- **Find the weak inference** in **Record a conclusion**: pick the statement that
  goes beyond the supplied evidence, then **Explain this choice** to see why.
- **Source reuse**: record a conclusion citing a provider's reused report, then
  follow it under **Trace sources for** without counting repeated material as
  independent support.
- **Credential page**: rehearse separate recipient reviews, simulated deliveries
  and closing only the page, using **Exact incident-object coverage**; the
  advertisement stays open.
- **Compare fictional response drafts**: compare two draft packets that differ in
  recipient, page or advertisement scope and selected evidence. Neither draft is
  authorised, downloaded or delivered.
- **Compromised page, shared form and related hosts**: practise keeping each
  affected object and observation separate.
- **Changing landing page**: compare declared capture conditions, including an
  incomplete later attempt, with **Compare capture conditions**.
- **Requested evidence**: prepare a drafting amendment and follow an edited image
  back through its declared parents with **Review fictional image history**.

Other examples separate reported account actions from observed effects, an
organisation's existence from a claimed campaign endorsement, and a provider
result that simply reuses a submitted report.

## Lookup

Lookup accepts one domain, IP address or ASN. A pasted URL is reduced to its
hostname; credentials, unsupported schemes and ambiguous input are rejected.

**Collection preflight** lists the sources that will run for the target and this
deployment, with optional providers shown separately. Each source's **Data and
recipients** disclosure shows exactly what is sent: the registrable domain, the
DNS names and record types, and any URL path you chose to collect. Opening the
preflight does not select optional sources. Deep Lookup shows each source as it
finishes; a finished source can still be partial, failed or unsupported. Only
the final validated result can be saved, and cancelling discards an incomplete
response.

In the detailed assessment, **Next reviews for your question** suggests a few
relevant next steps for the question you choose, with the full list of evidence
gaps below. **Before you continue** explains prerequisites and what a step would
send. Opening a review path does not start a request.

Under **Source quality**, **Compare source outcomes** lists each source's state,
time and provenance; expand **Limitations and scope** on a record for its
detailed notes. New Lookups also keep an **Original collection choices** receipt
of the optional sources you selected, and **Collector execution** shows what each
source family attempted. Changing a checkbox after submitting does not change the
receipt, and later source refreshes are kept as separate observations.

**What each source describes** shows the hostname you submitted beside the
domains each registry, registrar and WHOIS publication returned, along with the
DNS records, HTTP request and final URLs, and the TLS hostname and certificate
names. Each source keeps its own time. WHOIS referrals that were not followed are
shown as **Not queried**. A certificate wildcard or inherited CAA policy does not
mean every matching host was observed.

### Fast and Deep collection

To check a link or pasted text without signing in, use the public
[Link Inspector](https://www.whoisleuth.com/link-inspector). It reviews
destinations locally without opening them and does not read or save a workspace.

In the console, **Review a message, link or selected file** accepts pasted text,
MIME email, calendar invitations and still PNGs. It shows each real destination
beside the URL displayed in the message, expands redirect parameters and flags
authorisation-request fields. Choosing a destination fills Lookup without
starting a request. Exact URLs stay in a private disclosure and are left out of
the review download. Email authentication results are grouped by message part;
**Review reported authentication sources** shows the reporting service and any
malformed or duplicated values, and the receiver-trust checkboxes record your
judgement of those exact headers.

PDF and DOCX files are scanned for links and embedded QR images, with each link
traced to its source part or page; no scripts, macros or external resources run.
HAR files show request order, origins, statuses and timings without replaying
anything, and the report leaves out headers, cookies, bodies and private URL
parts. **Request order** switches between archive order and reported start time,
and **Reported timings** breaks each request into phases. **Hosts contacted**
groups the requests by registrable domain and separates the page's domain from
other domains. The page is the first recorded document request; when request
types were not recorded, it is inferred from the first HTML response and labelled
as an inference. Without a document request you can choose which recorded
origin was the page; the summary labels it as your choice, and it is not added to
the report or its download. IP addresses have no registrable domain and are not
compared.
The summary counts POST, PUT, PATCH and DELETE requests to other domains; the
method alone does not show what those requests sent or changed.

Plain-text review can also pick out phone numbers for you to select, keeping the
original spelling, source time and whether the text was transcribed or read by
OCR. For an advert or search result, you can compare the displayed destination
with separately supplied destination evidence. See
[selected-input review](offline-intake-context.md) for supported formats and
disclosure controls.

**Identity events** accepts an Entra sign-in export (`value` array) or an Okta
System Log array and replaces actor identifiers with labels local to that file.
**Compare an application and time window** lists exact matches, differing fields
and missing context. A reported result is not a compromise verdict on its own.

The same review is available in a Case's **Evidence** section, where you can save
the minimised report and source hash and, separately, the private original. In
**Response**, **Account and device recovery** suggests follow-ups based on
reported actions such as entering a password, granting consent or running a
command. Selected suggestions become open follow-ups that you complete and record
yourself.

- **Fast** is registration-led triage: RDAP, with authoritative DNS where
  needed. It skips WHOIS, website and TLS collection.
- **Deep, compact** is used for selected Bulk work. It adds the registration,
  DNS, website and TLS fields needed to compare domains side by side.
- **Deep, full** collects registrar, WHOIS, DNS, HTTP, TLS, page, technology,
  posture and network context for one target.

Open **Optional sources** to add security.txt or external intelligence; choosing
Deep does not select them. The CLI's DNSSEC and mail-transport checks are
separate commands and never run from the browser.

In **DNS evidence**, **Compare selected resolvers** asks two public HTTPS
resolvers for the hostname's A and AAAA records, using at most four requests. It
appears only where the deployment operator has enabled it; otherwise the panel
says so and sends nothing. Hostnames answered through a CNAME chain stay
comparable, with each resolver's alias path shown. Failed or unfollowed answers
are marked incomplete rather than counted as agreement.

### Reading the result

The result header shows the completed target, collection depth and observation
time, even after you edit the form. **Open saved Case** opens the matching Case,
and its **Return to Lookup** link brings back this result without collecting again
(within the current browser session).

**Key facts** opens the Overview with the registrar, registration dates, statuses
and nameservers, then the IP addresses, final website origin, HTTP status and TLS
certificate. Each value names its source and state; registration values come from
registry RDAP before WHOIS, and a value that was not collected or not reported
says so. The CLI shows the same list under **Key facts** in terminal Lookup and
`view` output.

**Questions needing evidence** links your chosen question to incomplete sources
and local reviews; following a link does not collect anything new.

A pasted HTTP(S) URL collects its hostname only, not its port, path, query or
fragment, and URLs containing credentials are rejected. Keeping the exact URL in
a Case is a separate choice. To collect a specific page, select Deep and
**Collect the selected URL instead of the homepage**; this sends the path and
query (not the fragment) to the website. Editing the input or depth clears the
choice. Compact Case and website snapshots record that a selected page was used
but leave out its path and query, so they cannot show a change on that exact page.

In **HTTP evidence**, **Requested URL** and **Final URL** are shown separately; a
failed attempt may have a requested URL and no final URL. Both omit query strings.

Registration uses the registrable domain, while Deep DNS, TLS and web checks use
the hostname you entered; the header names both. Supporting DNS, website, TLS,
certificate, network and provider evidence never replaces the registry's answer
on registration.

Each source shows its state, observation time and limitations. Tables and text
contain the full detail; charts summarise them. Web & DNS includes the IP RDAP
record for the observed address. IPv4 (A) and IPv6 (AAAA) results distinguish an
empty answer, no records of that type, a missing name and a failed query, so a
missing IPv4 answer never hides a working IPv6 answer.

The evidence graph keeps every supported relationship from the Lookup; lenses,
grouping and the searchable list change only the view. Bulk public-infrastructure
groups leave out non-public DNS answers.

**Registration history** in Relationships and history shows the creation date used
for comparison, from a successful and complete registration source, and lists any
other source date with the reason it was not used. **Read certificate history**
sends the domain to the certificate-search service once, when you select it, and
shows the earliest and latest logged certificate; contradictory first and last
dates are shown but not compared. The section compares the eligible certificate
and archive observations with the creation date in one place.
`whoisleuth prior-registration` makes the same comparison offline from saved
results.

Where the deployment enables it, **Web archive history** in the same section
shows when the Internet Archive first and last recorded the homepage, with links
to browse the archive at each capture time. It sends the domain to the archive
only when you select **Read archive history**. If the earliest capture is more
than 48 hours before the creation date, the panel says the name was observed
before the current registration; that suggests an earlier registration, not who
owned it.

A full Deep domain result can include:

- registry RDAP and a separate registrar RDAP follow-up;
- WHOIS referral evidence;
- recursive and authoritative DNS evidence;
- HTTP redirects, response metadata and page details;
- TLS connection and certificate evidence;
- technology, page-role and passive-posture indicators;
- IP RDAP context for one observed public address; and
- security.txt or provider results you selected.

Passive posture uses **Needs review** for a missing control or potential exposure
and **Could not assess** when the evidence was unavailable.

Raw registration payloads, contacts and provider records are not copied into
compact browser stores. The raw view and full saved Lookup are more sensitive
than the normalised reports, so handle them with care.

### Retaining a Lookup

Use the pin control beneath a source to select its normalised facts. Each pin
keeps the source's observation time and limitations; undated values cannot be
saved as dated checkpoints. If a save fails, your selection stays for another try;
a new Lookup clears it.

In **Source quality**, open the source-record review to refresh a source and
compare it with the original Lookup or its previous refresh. **Original and
refreshed observations** shows the original fact times beside the latest refresh
for each source; a failed latest refresh is shown as failed rather than replaced
by an earlier success. The review lasts until you leave or reload Lookup, so save
selected facts to a Case or download a review first. Refreshing registration
sources does not repeat a selected-page request.

Creating or refreshing a Case is always deliberate. A Case keeps the exact
hostname you submitted and, for new Deep observations, the DNS, TLS and web
hostname on each evidence snapshot, alongside the Case's own registrable domain.
Older migrated Cases may have no recorded hostname. Case reports and response
packets do not include the snapshot hostname; full Case, workspace and trusted
Case-pack exports can, so review them before sharing. Selected evidence pins keep
their own observation hostname, which is included when you add those pins to a
response packet.

## Discover

Discover offers three ways to find candidates:

- generate lookalikes from a domain, Brand Profile or your own dictionary;
- search Certificate Transparency logs and compare the returned names; and
- search one registry's RDAP service by nameserver.

Generation accepts a brand label or registrable domain, including multi-part
suffixes such as `co.uk`; it does not quietly shorten a subdomain or URL to a
different seed. Each candidate records how it was generated. A custom dictionary
stays in the current tab, and only the candidates you select continue to Bulk.

**Popularity list** marks candidates that appear in a ranked domain list you have
downloaded, such as a Tranco CSV, with the rank the list gives them. The list
stays in the tab and is never uploaded. Candidates that continue to Bulk carry
their rank and the list's SHA-256, which the CLI reports for the same file, so a
rank can be cited against the exact list. Creating a Case from a ranked Bulk row
records the rank and digest under **Analyst context** in the Case, separate from
its evidence; public packs leave it out. A rank shows only what the selected list
asserts: it does not make a candidate safe or connect it to the brand.

**Excluded by exact profile match** lists candidates hidden by the active
profile's official, partner or allowlist entries, with the matching declaration
for each. Exclusions match exact names only, and an excluded domain is not marked
as safe.

A certificate log entry shows that a certificate was issued for a name, not that
it is in use today or who controls it. Shared certificates and similar names are
leads to review. Nameserver search covers only the selected registry, so it is a
partial list rather than a complete reverse lookup.

## Bulk

Bulk compares many domains at once: up to 500 in Fast mode and up to 50 in
compact Deep mode. Each domain is a separate request, so progress and pacing stay
visible.

Filters separate registered, unregistered, inconclusive, failed and
source-limited results. Candidates from a Certificate Transparency search show
their earliest and latest certificate observations, and are marked **Certificate
logged before current registration** when the earliest predates the registry
creation date by more than 48 hours.

Relationship summaries name the exact field behind a shared address, nameserver,
mail server or certificate; shared infrastructure is common and does not by itself
link domains.

You can save Bulk sessions, named views and per-domain review state. Saved
sessions contain your targets, so treat them as investigation data.

- **Load** restores a saved session's results without collecting again.
- **Resume unstarted** keeps those results and collects only the domains that
  have none.
- **Retry failed** collects failed rows again.

Selected rows can continue to Cases, exports or response preparation; selecting
them does not contact any provider.

**Save selected** previews adding the selected domains to a Monitor watchlist
while keeping its other members. **Save to Monitor** previews replacing the
watchlist, listing exactly which members are kept, added or removed. Both need
your confirmation, and a watchlist changed in another tab needs a fresh review.

Selected CSV exports include a manifest with the exact selection, filters, source
states and observation times. Exporting does not refresh evidence.

## Brands

A Brand Profile records what you own or approve and how it should be configured:
official domains, approved partners, allowlists, mail expectations, certificate
baselines, protection attestations, suppressions and change windows.

Start a profile with its name and official domains; matching, mail, rights,
official channels and official-site identity are optional sections. **Overview**
holds the allowlist and review summary, **Assets** lists the profile's domains,
and **Tools** opens the domain, mail, certificate and account-control reviews.
Use the Brand profiles disclosure to switch the active profile.

**BIMI certificate and logo review** checks a certificate PEM, a CA-anchor PEM and
an optional SVG in the browser, reporting path, validity, hostname, purpose and
logo checks separately. It sends nothing, and the downloadable report leaves out
the original files. It does not confirm trademark rights or mailbox acceptance.

**Choose Brand review references** lets you pick the saved page baseline and up
to four PNG files from Cases associated with the Brand, and label them Desktop,
Mobile, Regional, Campaign or Login for this review. An original is read only when
you preview it, and the choices clear when you close the panel or leave the page.

**Review domain feed candidates** matches a local list of domains against chosen
terms or exact hostnames, then lets you pick which results to keep before handing
them to a Watchlist. See the [candidate-review guide](brand-candidate-review.md).

Drafts in the allowlist, expected-setting, portable-setting and account-control
tools survive switching views, but clear when you change profile or leave Brands.
A failed save keeps the draft; if someone else saved first, review their values
before saving yours.

**Preview domain exclusions** compares the saved and draft allowlists against up
to 200 example domains, which you can also pick from saved Cases. Registrar
entries do not affect Discover filtering. Account controls keep their own review
dates; saving or reconfirming one updates only that statement.

Profile values are your expectations, not live observations. Settings reviews
show each target with the time and completeness of its DNS and registry sources,
and filters only change what is displayed, not what is exported.

**SPF.** Collection completeness is reported separately from whether the policy
is sound. A completed expansion that can reach a permissive `+all` through an
include or redirect needs review even if the root record ends in `-all`. The
review follows [SPF include semantics](https://www.rfc-editor.org/rfc/rfc7208#section-5.2):
a matching negative include does not authorise senders, mechanisms after `all`
are unreachable, and `redirect` is ignored when `all` is present. Failed or
budget-limited branches are marked incomplete.

For nameservers, DS, MX and CAA, choose no expectation, an expected empty set,
specified records, or observation only. A null MX (`0 .`) counts as a specified
record. An incomplete or stale observation cannot confirm an expected absence.

In **Current settings**, **Include inherited DMARC and direct parent delegation**
is off by default. Turning it on adds checks of parent-domain DMARC policies and
reporting destinations (up to 32 extra TXT queries within ten seconds) and samples
the parent's nameservers when you start **Review official domains**. A parent
sample is not full delegation or DNSSEC validation. Ordinary Lookup and
monitoring never use this option, and its results are not saved to Brand
observations, Case snapshots or exports.

Other Brand views include:

- a posture matrix across saved baselines and observations;
- domain-control passports and desired-state review;
- DMARC and TLS aggregate-report summaries from local files;
- an inbox of Cases associated with the Brand; and
- a read-only **Brand asset register** joining profile scope, associated Cases
  and direct leads from saved evidence.

Mail reports stay in the current tab; their rows and policies are searchable,
and exports keep every parsed row. Saved page baselines keep their original
fingerprint method until you refresh them. See the
[storage compatibility reference](browser-local-data.md) for supported formats.

## Review inbox and monitoring

**Review inbox** brings together changes, evidence gaps and due follow-ups, with
Campaigns and Relationships alongside. **Monitoring** holds Watchlists, Timeline,
Certificates and Custom rules. When Cases exist, Case reporting, decision
summaries and the follow-up calendar sit under **Case reports and follow-up
tools**.

**Waiting on** lists open evidence requests, provider follow-ups and pending
decisions, each with its reason and a link to the record. An item can appear here
and in **Needs action** at the same time, and only recorded deadlines are shown.

Each view names the saved records it opens. If a collection cannot be read, its
counts show as unavailable rather than zero; reload to try again. Use **Search**
(Ctrl/⌘ K) anywhere in the console to find a page or a saved record.

Watchlist History includes a monitoring workload plan. Set a default purpose and
cadence, then override individual domains without changing the saved watchlist.
Download the plan for the CLI's `monitor-tick`, which previews it offline and, only
with explicit network approval, runs one collection cycle with private resumable
state. No background schedule is installed, and the resulting Watchlist export
can be imported back here. Hosted monitoring is configured separately and uses
Fast collection.

**Relationships** finds groups and similar pairs across saved website snapshots,
with paged results that keep every domain in each group.

The **Retained evidence gallery** compares PNG images or text files saved in
different Cases. Search Case titles, references, domains, file names or declared
sources (file contents are not indexed), then choose **Use as reference** and
**Use as candidate**. The **Comparison pair** stays above the results while you
search for the other side, and **Swap reference and candidate** reverses it. Open a
file's details to check its attachment ID, hash and stored times before comparing.
**Compare selected text** or **Open selected PNGs** reads only the two chosen
files. If an original cannot be opened, use **Reference Case files** or
**Candidate Case files** to inspect or restore it, matching by hash rather than
file name. Changing either file or its source clears the comparison. Comparisons
do not save anything or classify threats.

In **Timeline**, **Choose Case checkpoints** lets you pick two or three snapshots
from one Case and compare any two of them, including snapshots that are not next
to each other. Only the two selected points are compared, and the selection clears
when you leave the page.

### Cases and response preparation

Open **Cases** from the Respond navigation and select a Case to open its
workspace; **All Cases** returns to the list with your filters. A direct Case link
opens that record in your own browser workspace. If saved Cases cannot be read,
the page says so and suggests reloading rather than showing an empty list.

Times in the Case header, **Case options** and **History** are shown in UTC, and
their **Copy** controls keep the exact stored value.

**Saved Case views** keep a status, disposition, search and sort combination.
Name a view and choose **Save as new view**; **Apply view** filters the current
Cases, and **Update selected view** renames or changes it. Views travel in
workspace backups, not individual Case exports.

A domain can have several separate incidents. **Create a separate incident Case**
gives the new investigation its own title and permanent Case ID, and can reuse one
saved observation without copying the original Case's notes or decisions. When
several Cases share a domain, Lookup and Bulk ask which one to use. Search the
list by title, domain or full Case number.

Each Case has five sections:

- **Summary** shows saved records and next work.
- **Evidence** holds captures, pins and relationships.
- **Assessment** holds conclusions and alternative explanations.
- **Response** holds recipient review, packets, delivery and outcomes.
- **History** holds notes and manual steps, including **Record lessons from this
  investigation** for what helped, what misled and what to change next time.

**Use a saved lesson to revise a template** turns a lesson note into a new revision
of a saved investigation template: edit its steps and completion criteria, add an
applicability statement and reason, and save. The original template is kept, and
the revision records its source template, not the Case or the lesson text.

The Summary's decision overview keeps the latest conclusion beside its supporting
and contrary observations, incomplete evidence and next review. New evidence asks
for another review but never changes a conclusion by itself. **Before pausing or
closing this Case** suggests up to three next reviews, each linking to its place
in the full checklist. **Case completion review** gathers open incident objects,
unresolved assessment links and outstanding follow-ups, such as undelivered
requests and undated observations; it advises but does not close the Case.
**Check referenced files** reads the Case's original and derived files to confirm
they are present and unchanged. Ordinary JSON backups contain file references, not
the files themselves.

**Evidence relationships and shared sources** records that one saved pin derives
from another or shares its source, with your reason. A relationship can be
withdrawn with a reason, and its original record is kept. **Trace sources for**
starts from a conclusion, decision or pin and follows those relationships back
towards their sources; **Observation and reference trail** shows each pin's
observation and saving times. Recording a relationship does not change the
evidence or its observation time. If a later report reuses one you submitted,
record that link; if you cannot tell how a source was produced, leave its
independence unknown. Response material carries the relevant shared-source note
without copying your private relationship notes.

**Copy citation** on a pin or Lookup checkpoint copies just that fact, its source,
observation time and completeness. **Preview report** shows the selected notes and
any imported sharing restrictions before you download an ordinary Case report;
the download uses exactly the previewed bytes. **Decision brief** focuses the
report on recorded conclusions and next steps, **Inspect linked evidence** opens
the evidence each conclusion cites, and **Full report** returns to the complete
view. **Print or save PDF** prints the complete report with every section
expanded. These reports are separate from authorised response packets.

Section links work with the browser's back and forward buttons. On wide screens,
Assessment shows saved evidence beside the conclusion form, and in Advanced,
**Compare explanations** sets two saved conclusions side by side with their
evidence. **Consider another explanation** offers optional prompts while you write
a conclusion. Use **Evidence considered** to include observations that weaken it,
and explain their effect in your rationale.

Case forms keep recovery drafts in the workspace. After reopening a Case, restore a
draft explicitly and review it before submitting; drafts from other tabs are never
overwritten. **Draft inventory**, then **Read saved drafts**, lists recovery copies
across the workspace, and **Open Case** takes you to the form without restoring or
submitting anything. If the app cannot confirm that a save finished, the form stays
open and further saves are blocked: copy any later edits, reload, check the saved
record and do not repeat the submission until you know its outcome.

For a second opinion, open **Response → Review with another analyst** and select
the originals the reviewer needs. **Check handoff contents** confirms the files and
the complete Case, lists anything missing, and enables an encrypted package
download. The package contains the full Case, including notes, incident links,
file names and response records, but not unfinished forms; changing the Case
requires a fresh check. **Recipient verification steps** lists what the reviewer
should check. Send the passphrase separately.

The reviewer unlocks the package in Dashboard's saved-work tools.
**Open temporary Case review** shows the Case and its originals without touching
their saved work, and closing the package clears it from the page. To make
changes, the reviewer imports the Case JSON into a separate workspace, then returns
a Case export or encrypted package. Back in the original Case, select the return
and review each addition before saving. New pins must be selected together with
the claims that cite them, and conflicting IDs never overwrite your records.
Status, actions, authorisations, closures, snapshots and file bytes are not copied
back. CLI Case packs can supply Case data; verify their checksums with the CLI.

**Compare Case exports or response packets** compares two Case exports, or two
response packets, for the same Case. It shows changed content, records found in
only one copy, recipient routes and scope, matching records by ID. A record missing
from an export has not necessarily been deleted from the Case. It accepts the same
Case and packet versions as the CLI, including older files, but not CLI packs,
encrypted containers or a mix of the two kinds. Nothing is saved, and closing the
comparison releases the copies.

An open Case stays selected while you move between console tools, with its
hypotheses, pins, decisions, response history and follow-up dates close at hand.
**Clear** deselects it without deleting anything. The selection lasts until you
reload or sign out.

Cases can hold evidence snapshots, pins, checkpoints, conclusions, decisions,
contact routes, actions, observed-effect reviews, closures and investigation
branches. Your own records are always kept separate from collected evidence. If
changing a Brand association would exceed Case storage, you are shown which
snapshots would be affected and can export, cancel or remove those snapshots;
notes and decisions are never removed to make space.

Evidence choices show their source and observation time, and selecting a pin shows
its value and limitations. **Linked evidence** opens the facts behind a decision,
assertion, response event or sighting.

Sightings can include optional encounter and capture context: channel, device
class, a declared two-letter country code, whether a reviewed path was supplied,
and a saved capture file. These are your declarations, not verified location or
distribution. They are kept in private Case and workspace backups and internal
packs, and left out of ordinary reports and shared packs. If the capture file is
later removed, the sighting shows it as unavailable.

The **Decision overview** suggests reviews for the open conclusion, such as missing
links, opposing observations, incomplete or undated evidence, and unclassified
relationships, and takes you to the matching section to act on them.

The investigation timeline includes every record across pages, and its domain and
source filters search all of them. Undated evidence stays visible, and when
snapshots share a time or lack one, no single latest snapshot is chosen. Bulk
session activity is labelled separately from observation times, and decisions
appear with links to their review. **Evidence family coverage** groups the same
records into registration, DNS, TLS and certificate, HTTP and page, external
report and decision lanes; select a lane to read its records. The earliest and
latest times describe saved records, not continuous coverage.

The review inbox explains why each item is queued, and **Earlier decisions** shows
past reasoning and dates. Expand an item to review it, or move through the
filtered queue with **Previous item** and **Next item**; unfinished decision forms
are kept as you move around. Before leaving, open **Pause and resume review** and
choose **Save current position** to keep your forms and filters without
submitting them, optionally with a **Question for your next review**.
**Resume saved review** restores them against the current records, keeps any newer
drafts, and flags evidence that changed or became unavailable; its
**Return-to-work briefing** summarises what changed in the saved view since you
paused. A draft whose evidence changed must be reviewed before it can be
submitted. Saved positions are not included in backups or exports. Review dates
and evidence times use UTC, and **Copy** keeps the exact stored value.

Bulk saved views apply filters, List columns, grouping and sort order to the loaded
results without collecting anything; choose **List columns** in the List view,
then save the view. Hidden columns do not change exports.

Evidence gaps uses each source's own date and pages through every record.

The calendar shows every matching follow-up across all Cases, with completed
actions and earlier reviews under its history filter. Event times use your
browser's time zone. Select events to export them (up to 32 MiB); conflicting or
unknown expiry dates need review before they can be scheduled. Event identifiers
are stable, so replace an older calendar import instead of adding a duplicate.

Guides list matching Cases in their Case selector; a Case for a different target
does not supply the current guide's handoff assessment.

**Quick response** covers observation, conclusion, recipient review, packet,
manual delivery record, independent recheck and closure, with each stage linking
to its form. **Advanced** adds assertions, branches, manual steps and detailed
action changes, and switching between them keeps unfinished drafts. The response
queue orders active actions by their next due date and opens the selected action
or recheck question; completed actions are under a view filter. A provider's reply
never counts as an independent outcome.

The summary links straight to open evidence requests. Before authorising a packet,
**What this recipient will receive** shows the exact URLs, contacts, evidence
references and response history to be sent; pin values and file contents are not
attached, and editing this view leaves your Case unchanged. Response forms recover
after a reload, but unfinished drafts are not included in exports or backups, so
submit or copy them before moving to another browser. Response dates and times use
UTC.

Receipts record an event time, reference, optional evidence pin and limitations.
**Prepare a recheck** opens Lookup without collecting anything. In **Record a
recheck**, select a saved pin to use its source, observation time and
completeness, or clear **Use selected source details** and choose **Enter a manual
observation** instead. Undated pins cannot date a recheck.

**Recheck questions** save a next step: a hostname, an optional baseline pin and
the conditions for comparing them. Each answer keeps the question as it was when
answered. "Not reproduced" needs a complete observation under comparable
conditions; a failed source or a different target is not enough, and Lookup leaves
the outcome for you to choose. An **Independently not reproduced** closure needs a
complete linked review. When assessing DNS removal, repeat observations of the same
hostname and compare both IPv4 and IPv6: no address records is not the same as a
missing name, and a timeout shows neither.

The reporting-route review lists every saved route, including platform reports.
Filter by review state or search by domain, recipient or source, and use
**Refresh local review** to recheck the saved dates.

External imports open a paged review of every accepted finding or claim. Select
the records you want and check **Retained fields** before importing; unselected
records change nothing. Intelligence claims need an existing Case for their target.

Each Case has a stable `WS-` reference derived from its permanent ID, so it stays
the same across exports. Case types, incident links and investigation context are
structured fields, separate from free-form tags. Exact public incident links, for
example to web or social content, can be resolved without losing their history and
carried into a response packet.

**Exact incident-object coverage** shows, for each link, your status, the actions
bound to it and any independent observations. Delivery receipts record each
packet's generation time, version, audience and digest separately from the
delivery time; preparing a packet alone records no delivery. One reporting action
can cover up to 20 objects (domains, hostnames, pages, adverts, social or
messaging posts, storefronts, apps and others). For each provider response, choose
which objects it covers: acknowledgement is not removal, and a partial fix applies
only to the objects you select. Closing one object leaves the others and the Case
status unchanged, and closing the whole Case remains a separate decision. No
control submits a report or starts collection.

Operations reports and campaigns offer a drill-down to the Cases behind each count.
Provider outcomes stay separate from independent reviews, and downloaded reports
contain counts only.

For supported platforms, the Case shows official safety or rights-reporting routes
for the selected Case types, each with a preparation checklist. For a custom host or
advert, choose its platform yourself for this visit. Always confirm the current
route before opening it; WHOISleuth only drafts the action and never submits a
complaint.

Packet preflight checks the selected evidence, recipient scope, privacy,
redactions, authority, freshness and contradictions, and drafts stay available
with cautions. Authorisation covers the exact inputs you reviewed: changing a
confirmation, or any material change, means authorising again.
**Packet authorisation status** explains the next step and links to it, and
**View full readiness matrix** shows every check. Generating a packet is a local
export; WHOISleuth does not send it, and neither preparing nor exporting a packet
or file package records delivery.

In the packet's **Review** phase, **Prepare original files separately** lets you
choose original files, then **Check selected originals** against their recorded
size and SHA-256 (or **Check all Case originals**). Only checked files can go into
the package, and a check covers exactly the files you chose. The package contains
just those files with their existing source declarations, not the full Case
backup, and packet redaction does not alter file contents, so review them for the
recipient. Changing the selection or the packet clears the check, and exporting
checks the files again without recording a submission.

**Trace selected evidence to its source** follows a selected pin back to its
original observation and collection choices; missing context is shown as
unavailable. The same view is under **Collection context for selected checkpoints**
in Case observations.

In **Local handoff**, JSON is the main export, and **Other export formats** offers
Markdown, an email download and an email copy, all from the same reviewed packet.
**Preview manual complaint** shows the exact text that Copy and the email download
will use. **Preview printable report** shows the same packet as a readable report
for printing or saving as PDF, optionally with the JSON appendix; its **Reading
guide** suggests starting points for analysts, domain managers and external
reviewers. Recording a receipt is always a separate step, and a provider's
acknowledgement or reported fix is your record of their claim, not an independent
observation.

In **Requested evidence and amendments**, choose a recorded packet delivery,
confirm its SHA-256 digest (**Copy digest** copies it in full), and record the
provider's request and any UTC deadline. Answer it from saved pins or record why the
evidence is unavailable. **Create drafting amendment** starts a linked action;
review its recipient and include every prepared pin before authorising it, and
record its delivery separately. Each request shows whether evidence is still
requested, prepared, unavailable or delivered, and the original delivery is never
changed. Case exports, reports and CLI Case packs keep this history; public Case
packs leave it out.

To fix your own mistake, prepare a **correction or withdrawal request** against one
recorded delivery: select its packet receipt, state what is changing and why,
choose supporting evidence, and keep to the original delivery's objects. Review
the recipient, authority and disclosure again before preparing it. Older delivery
records that only hold a digest cannot support a linked correction, and a prepared
withdrawal is not a sent one.

A saved Incident URL can be handed to the
[optional capture companion](../packages/web-capture/README.md). Select its manifest
to import the capture's metadata and digests into the Case, and optionally select
the screenshot and DOM-digest files to check them and view them locally. Originals
are not saved unless you choose **Retain this manifest and verified matching
files**. For a capture with a URL sequence, **Selected navigation steps** shows each
selected origin, its capture, and any blocked or skipped step; each URL opens in a
fresh page without clicks or form submission, within one shared collection budget.

**Page behaviour and dependencies** shows navigation, script and frame responses,
form destinations, script hashes and requested-action wording, and
**Request-channel coverage** adds images, styles, fonts, media, fetch, XHR and
beacon requests, noting which were refused or unavailable. **Compare another
capture** compares two manifests, and **Compare capture conditions** sets 2 to 20
observations side by side by observer, vantage, browser, viewport, scale, locale,
timezone and colour scheme before you choose which two pages to compare. For a page
you own or are authorised to review, **Record an expected change** adds your reason
to the Case assessment.

**Temporary analyst session declarations** lets you mark each selected capture as
signed out, signed in or unknown for this comparison. These notes stay in the page
only: they are never saved, printed or exported, they do not affect comparison
results, and they clear when you close the review, change either file or leave.

**Specialist evidence reviews**, also in Evidence, help you lay out incident stages
from reported actions, compare domain changes with expected maintenance, follow a
platform object across versions, compare an authorised official storefront, or
inspect connector configuration without running it. Save the report to keep its
observations and a Case summary; incident, platform and storefront inputs can be
reloaded later, and connector secrets are left out. See
[contextual reviews](contextual-reviews.md) for fields and CLI examples.

**Retained files** also accepts original files without a capture manifest. Check the
file name, optional source and observation time, then choose **Retain selected
files**. The workspace stores the exact bytes (encrypted when workspace encryption
is on), and downloads are checked against their recorded size and digest. JSON
backups contain only file references, so after preparing a backup, open **Back up
referenced files separately** and export every listed group, with **Encrypt package
download** if needed.

To test recovery, review the downloaded backup and open **Rehearse recovery in a
separate workspace**. Create a destination and restore the backup's evidence
packages or original files; your active workspace is not changed.
**Backup contents and recovery limits** lists what the backup contains, including
sections, record counts and the original files it needs. Saved review positions,
unfinished Case forms, certificate search history and temporary comparisons are
not backed up. Recovery is reported as verified only when every section and
referenced file matches. **Recovery set index** identifies the backup and its
evidence packages by digest and size; **Download recovery set inventory** saves an
unencrypted plain-text copy of that list, which contains digests only, so review
it before sharing. Keep the files themselves, not just their digests. **Verify
restored data** checks the destination again without repeating the restore. The
**Original-file recovery checklist** lists each missing or unverified file by
digest and size; file names are only a guide, since a renamed file with the same
bytes matches and a same-named file with different bytes does not. Restore groups
until the checklist is empty, then keep or delete the rehearsal workspace.

**Select files for export** packages chosen originals or edited copies with their
sources and observation times; a missing file stops the export. Edited images
record their immediate parent, editing method and operations, and **Review edited
images** and **Inspect declared links** follow that chain within the Case. These
records describe the edits; they do not prove how an image was made. **Write new
evidence folder** creates and checks a new folder where supported; otherwise,
extract the ZIP locally. Neither is a full workspace backup. **Review evidence
folder** on Dashboard checks a folder without importing it.

**Compare retained text** finds shared runs of five or more words between two saved
`.txt` or `.text` files (up to 1 MiB and 65,536 words each), showing excerpts,
offsets, word counts and file digests. Shared wording is a lead to review, not proof
of authorship or copying.

Preview a saved PNG to compare it with another image. **Compare image regions**
checks every pixel without resizing and maps the changes; draw exclusion rectangles
to ignore areas such as timestamps (exclusions are not redactions). **Compare
another capture** accepts a second manifest and PNG without importing them, showing
both sets of capture conditions. **Create edited PNG** lets you add opaque
redactions and outlines, review the result and save it as a separate file; the
original stays unchanged, and unsaved edits prompt before you leave.

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
the stable case reference by default; investigated domains, recipients, case
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
**Reopen acquisition review** and choose the original JSON (up to 15 MiB). Its
version, structure, digest and target are checked before a preview appears, and
**Cancel** leaves your current work unchanged.

**Accept historical manual fields** restores only the decision, rationale and
selected checks; the current Lookup evidence and its observation time stay in
place. Keep the original file for its history. Before preparing a new packet,
reconfirm the decision and checks against the current evidence, since changing
either clears that confirmation. Nothing is looked up, bought, contacted or
submitted automatically, and synthetic packets are for demonstration only.

### Source states

Sources report states such as ready, partial, unavailable, blocked, rate-limited,
unsupported, stale, skipped, malformed and inconclusive. Incomplete evidence is
always shown as incomplete: a source that published nothing is different from one
that could not be queried, returned an unreadable answer or was not selected.
Truncation is flagged wherever the missing records could matter.

**Unsupported** RDAP or WHOIS means the registry publishes no such service for
that target, not that the lookup failed. **Skipped** means the chosen mode left the
query out or the registry requires permission. Timeouts and incomplete referral
chains are shown separately.

### Registration and availability

Only the registry decides whether a domain is registered. Registrar RDAP, WHOIS,
DNS, HTTP, certificate, page, provider and analyst evidence can support or
question that answer, but cannot declare a domain available.

In Lookup's Registration section, **Explain a lifecycle date** shows the original
text the parser used for Created, Expires or Last updated, its ISO form and a
conversion check. **Selection and provenance** explains which rule chose the
value. A date with no time is not treated as an exact event time.

For IP addresses and ASNs, registration and routing use their own records, and
domain availability does not apply.

### Risk and Opportunity

Risk is versioned, explainable triage. A low score does not mean a domain is safe,
and missing evidence never counts in a domain's favour. Each score shows its
contributing factors, uncertainty and changes.

Opportunity appears only in acquisition review and says nothing about whether a
domain is available, affordable or transferable.

Offline Risk calibration measures the model against your own reviewed data and
does not change the running model; see the
[CLI risk-calibrate command](https://www.whoisleuth.com/cli#command-risk-calibrate).
The Case export for calibration is a snapshot taken when you open its review, with
a separate Case ID for each incident; reopen the review to include later edits.
For a fair measurement, label examples from independent evidence before looking
at their scores, and include authorised lookalikes, ordinary domains, confirmed
incidents and incomplete collections, not only cases that agree with the model.
Suspicious, unreviewed and closed-without-action dispositions are left out of the
binary metrics. Keep the examples you use to adjust a rule separate from those you
use to evaluate it. The repository's synthetic examples test the method; they are
not an estimate of real-world accuracy.

## Browser-local storage and archives

Use **Manage browser workspaces** on the Dashboard to keep investigations apart.
A new workspace leaves the default one unchanged. Save your edits before switching,
because switching reloads the Dashboard; other tabs keep their own workspace. The
current workspace is named above console pages and beside the backup and import
controls.

Export each workspace separately, and open the destination workspace before
reviewing an import. Workspace names and tab state are not part of a backup. To
delete a workspace, switch away, close its other tabs and confirm its name.
Workspaces share the browser's storage quota, and names do not create separate
permissions.

Ordinary workspaces are stored as plaintext in this browser profile (IndexedDB);
encrypted workspaces need their own passphrase. Clearing site data removes the
workspace, while downloaded files stay wherever you saved them. Read failures,
quota errors and unsupported versions are always reported rather than hidden.

Import checks the whole archive before merging, and a section missing from the
archive never deletes local data. Encrypted archives protect the downloaded file;
they do not protect an open console. See the
[Case and workspace contracts](case-contracts.md) for supported versions and
[browser-local data](browser-local-data.md) for migration, concurrency, quota,
recovery and deletion.

## Reports, imports and exports

To import existing reconnaissance results, choose the dnsx or httpx format. The
preview keeps exact hostnames, supplied observation times and a digest of each
original row, and marks collection completeness as unknown. Review the proposed
Case facts before saving; the
[external-findings guide](external-findings-import.md#existing-reconnaissance-results)
covers the matching CLI conversion.

In the external-findings preview, **Explain a field** compares an accepted value
with the exact Case field it would become. For findings JSON or CSV, **Show in
selected original** highlights the exact source text and its location in the file;
for WACZ, **Show selected archive provenance** shows the package, member and record
it came from. These views are temporary and are never printed or exported.

Exports are always deliberate. Review them before sharing:

- a full saved Lookup can include the target, endpoints, raw RDAP publications,
  WHOIS bodies and publicly published contact data;
- Lookup evidence exports leave out raw registration payloads and expanded
  contacts (current schema 31 and supported schemas 27–30; the older schema 26
  can contain public contact fields);
- Case, workspace and every Case-pack audience can identify investigated
  hostnames and contain your analyst records; even public packs keep Case, pin and
  decision identifiers, tags, decision summaries and rationale;
- graph, campaign and defensive exports identify their selected scope; and
- screenshots from authorised local capture show whatever was rendered on screen.

Importers check an entire file before previewing or merging it. Merges never
replace a local record with an older or undated one, and records that would exceed
capacity are skipped rather than evicting saved work; anything skipped is reported.
STIX, MISP and external findings stay attributed to their source, and future
schemas are refused before any partial import. The import preview separates
accepted claims from source objects and relationships, flags missing references
and conversion losses, and keeps the source file's digest.

The CLI can verify supported files, compare saved observations, inspect workspace
archives and prepare sharing reviews offline; see
[offline artefact verification](https://www.whoisleuth.com/cli#command-verify-artifact)
and the [interchange fidelity report](https://www.whoisleuth.com/cli#command-interchange-report).

### Browser and CLI handoffs

**Package and review evidence files** on Dashboard packages selected files, with
optional source declarations and observation times, as a ZIP, a new folder or a
**BagIt 1.0** package. BagIt keeps the bytes unchanged with SHA-512 manifests and
never downloads files listed in `fetch.txt`. **Encrypt package download** protects
the manifest and every file in a single `.wlep` file; keep its passphrase
separately, because it cannot be reset. Ordinary ZIPs, folders and capsule-only JSON
are unencrypted. Lookup's **Download evidence package** includes the capsule with
its Lookup JSON, and **Download capsule** keeps the standalone format.

Reviewing a package shows every entry, its digest and the packaging record before
anything is imported. Verified workspace files open the usual merge preview, JSON
can be read inline, PNGs can be viewed locally, and every verified file can be
downloaded. Packaging does not redact anything.

For each handoff, export deliberately, verify the file, read its interchange report
and then preview the import:

- For a browser workspace, run `verify-artifact workspace.json --json` and
  `interchange-report workspace.json --json` before using the Dashboard import
  preview.
- For a CLI Lookup, keep the private `lookup.json`, then run
  `whoisleuth export lookup.json --output evidence.json` and open it with
  **Replay exported evidence** in browser Lookup. The saved Lookup and the evidence
  export are different formats.
- To read evidence in the CLI, run `whoisleuth view evidence.json`, or
  `whoisleuth diff first.json second.json` for two exports of one target, whether
  they came from the CLI or **Export evidence JSON** in the browser. Both read the
  file exactly as browser replay does, and `diff` keeps the order you give.
- For a Case handoff, choose the audience, run `sharing-review` on the separate
  package and review its redaction manifest before sharing.

Maintainers can run `npm run interchange:roundtrip` to take one reserved-domain
workspace through browser export, CLI verification, browser merge and re-export.

## Limits of the product

WHOISleuth does not provide continuous global monitoring, a multi-user case
database, background workspace synchronisation, legal conclusions, guaranteed
source completeness, automatic takedown, domain acquisition or proof of
ownership, control, intent, safety or maliciousness.

Use the [privacy notice](../PRIVACY.md) for data-handling details and the
[threat model](threat-model.md) for security boundaries.
