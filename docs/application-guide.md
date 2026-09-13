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
Case and watchlist counts, with links to the corresponding retained reviews.
The summary refreshes when you return to the tab or change saved work here;
viewing Dashboard does not mark anything reviewed.

Saved-work search, templates and archive maintenance are secondary tools.
Search results are paged; every indexed match is reachable. The coverage
disclosure identifies unavailable collections and omitted fields or records.
Search stays in the browser and operates over bounded normalised fields; it does
not start collection or inspect raw upstream payloads.

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
Console clears its unlocked state. Names and storage counts remain visible;
there is no passphrase reset.

To move existing work, download an encrypted backup, create and unlock the new
workspace, then review and add the backup. Verify its contents before deleting
the original. Backup and workspace passphrases are independent, so a tested
backup remains a recovery path if a workspace passphrase is lost.

### Guided investigations

Starting a guide opens its current step. On ordinary tool entry, the retained
guide appears as a compact disclosure above the tool. Open it to select a step,
review request permissions or record an outcome. Selecting a step does not
approve collection or mark it complete.

Unconfirmed outcome notes remain separate for each step while the guide is
open. Collapsing it or changing steps preserves those drafts; reloading the
page discards them. Confirmed progress stays in the current tab.

## Lookup

Lookup accepts one domain, IP address or ASN. URL-like input is normalised only
under the explicit supported rules; credentials, unsupported schemes and
ambiguous targets are rejected.

Before collection, Lookup shows the selected target and source families. Deep
Lookup reports source states as they arrive; connections that buffer responses
show them together. A finished source can still be partial, failed or unsupported.
Only the final validated result can be saved. Cancelling discards the incomplete
response; already-admitted requests may finish within their existing bounds.

### Fast and Deep collection

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

The evidence graph retains every supported relationship from the admitted
Lookup evidence. Lenses, visual grouping and the searchable, paginated list
change the view, not the retained data. Projection input coverage distinguishes
admitted values, duplicates, invalid input and capacity omissions. Source
observation times remain separate from the time an export was created.

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

Allowlist, expected-setting, portable-setting and account-control drafts are
preserved when switching views or tools. Selecting or saving another
profile, or leaving Brands, clears the previous profile's tool drafts. A failed
save preserves the draft; a successful save with a failed refresh offers a
read-only refresh, not another write. Conflicting edits require reviewing the
current saved values.

Account controls keep individual review dates. Saving changed controls or
explicitly reconfirming one updates only those statements.

These values are analyst-authored expectations. They do not prove the live
state of a registry, account, DNS zone, certificate or service. Observed evidence,
desired-state baselines and analyst attestations remain separate.

Retained settings reviews include their target, collection context and the
observation time and completeness of comparable DNS and registry sources.
Report completion is not a source observation time. The history preserves
equal-time records; missing context or ambiguous ordering remains unknown.

For nameservers, DS, MX and CAA, choose no expectation, an expected empty set,
specified records, or observation only. A null MX (`0 .`) is a specified record,
not an empty set. Portable settings preserve these choices; an import changes
only the selected fields. Missing, incomplete or stale observations cannot
confirm an expected absence.

Brand views can provide:

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

The Dashboard links its attention count and recent Cases to the corresponding
saved work. Use **Search** (Ctrl/⌘ K) anywhere in the console to find a page or
search browser-local records. Opening a destination does not collect evidence.

**Relationships** searches exact website-profile groups and weighted pairs
across saved snapshots. Results are paginated, with a page-number control and
all admitted domains retained in each group. Similarity uses complete,
compatible saved fields; source limits remain separate from pagination.

### Cases and response preparation

Open **Cases** from the Respond navigation. Older Monitor Case links still work.
Select a Case to open its workspace. **All Cases** returns to the retained list
filters. Direct Case links open that record in this browser, not in another
person's workspace.

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
**History** holds notes and manual investigation steps. Section links support
browser back and forward and remember reading positions while that Case remains
open; resizing the viewport clears those positions. On wide screens, Assessment
places retained evidence beside the conclusion form. Case response forms save workspace-local recovery
drafts. Their status distinguishes a recovery copy from a submitted Case
record. After reopening a Case, restore a saved draft explicitly and review it
before submitting. Copies from other tabs are not silently overwritten.

For a second opinion, open **Response → Review with another analyst** and
export this Case for review. The full copy includes notes, incident links and
evidence: share it deliberately. The reviewer imports it into a separate
workspace, adds notes, pins, decisions or assertions, then exports that Case.
Select the returned file in the original Case and review each addition before
saving. Linked new pins must be selected with their claims; conflicting IDs
never overwrite retained content. Status, actions, authorisations, closures and
snapshots are not copied back. A changed destination requires another preview.
Preview selections survive changing Case sections, but not leaving the page.
The handoff trail identifies the file and selected entries, not the reviewer's
identity. CLI packs can supply Case data; use CLI verification separately for
their checksums and report binding.

Opening a Case keeps it selected while moving between Console tools. The
compact Case context exposes retained hypotheses, pins, decisions, response
history and follow-up dates. **Clear** removes the selection, not the Case.
Selection lasts until the page is reloaded or the protected session ends.

Cases can retain bounded evidence snapshots, pins, checkpoints, analyst
assertions, decisions, contact routes, actions, observed-effect reviews,
closures and investigation branches. Analyst-authored records remain separate
from collected evidence.

Evidence choices show their source and observation time; selecting a pin shows
its retained value and limitations. **Linked evidence** opens the actual facts
behind a decision, assertion, response event or sighting. Supporting and
contradicting relationships remain explicit; a missing reference is not
replaced with another observation.

If snapshots share the latest capture time, or any snapshot is undated, the
timeline retains them without selecting a latest assessment. Record updates do
not refresh evidence capture times. The investigation timeline includes all
admitted records across pages; domain and source filters search the complete
projection. Undated evidence remains visible, and Bulk session activity is
labelled separately from source observation time. Analyst decisions and their
retained history appear as local activity, with links to the review and its
currently associated Cases. Unavailable Case identifiers remain visible.
The review inbox explains each queue assignment; **Earlier decisions** shows
the retained rationale and dates. Historic omissions are stated explicitly.
Expand an item to review its evidence and decision, or use **Previous item** and
**Next item** within the current page. Switching between items preserves their
open drafts. Changing pages or filters discards drafts for items that leave the
view. Displayed review times use UTC. **Copy** keeps the exact stored timestamp,
including fractional seconds.

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
stage drafts for the open Case. Evidence, conclusions, assertions, branches,
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
Controlled Case types classify the reviewed issue separately from free-form
tags. Exact public incident links can be retained for web or social-platform
content, resolved without erasing history, and carried into a response packet.

For supported platform hostnames, the Case workspace shows freshness-bounded
official safety or rights-reporting routes matched to the selected Case types.
Each route includes a preparation checklist from its reviewed guidance.
The analyst must verify the current route and authority before opening it.
WHOISleuth creates only a drafting action and never submits the complaint.

Response packet preflight checks the selected evidence, recipient scope,
privacy, redactions, analyst authority, freshness and contradictions. Drafts
remain available with cautions. Reviewed authorisation is bound to the exact
canonical inputs and is invalidated by material change. Packet generation is a
local export; WHOISleuth does not send it or promise a provider outcome.
**Preview manual complaint** shows the exact text used by Copy and the email
download. JSON and Markdown describe the same prepared packet. Changed inputs
or freshness require a new preview; receipt recording remains a separate action.
**Preview printable report** presents the same audience-filtered packet with
incident context, source references, UTC times, readiness and response state.
Print or save it as PDF through the browser, optionally including the exact JSON
appendix. Printing rechecks the prepared inputs; it does not confirm a saved file
or record delivery. The report digest identifies the packet JSON, not the PDF.

Provider acknowledgement or reported resolution remains analyst-recorded state,
not independently observed remediation.

A retained exact Incident URL can also be handed to the [optional capture companion](../packages/web-capture/README.md).
The browser validates the selected manifest and can
import its sanitised metadata and declared digests into that Case. Optionally
select the screenshot and DOM-digest files to check their byte counts and
digests, then view matched JSON or PNG files locally. Metadata import does not
save originals by default. Select **Retain this manifest and verified matching
files** to save them together; unmatched selections remain excluded. Existing
capture manifests can be reviewed without a retained Incident URL.

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
once while each Case's provenance remains in the JSON. File packages are
unencrypted even when the JSON backup is encrypted.

To test recovery, review the downloaded JSON and open **Rehearse recovery in a
separate workspace**. Create a destination, then restore the downloaded evidence
packages or original files. The active workspace is not switched or modified.
Section checksums and Case identities are compared with the selected backup;
every referenced file must match before recovery is reported as verified.
Migrated formats are labelled for review rather than claimed byte-equivalent.
Preferences are reviewed but not applied. Keep the rehearsal workspace, or
explicitly delete it after checking the result. Leaving the page preserves it.

Use **Select files for export** to package selected retained originals or
derivatives with their declared sources and observation times. Missing bytes
stop the export. The ZIP uses generated entry names; Case metadata, filenames
and editing instructions stay in the separate JSON backup. Where supported,
**Write new evidence folder** creates and verifies a new child inside the
folder you choose. Otherwise, extract the ZIP locally. Neither option is a
complete workspace backup. **Review evidence folder** on Dashboard checks the
same manifest and files without importing them or granting ongoing access.

Preview a retained PNG to compare it with another retained image. Source,
observation time, dimensions and byte identity remain separate; an appearance
change is not proof of a site change when capture conditions are unknown.
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
deletions can be refreshed and retried. Workspaces share browser quota and are
not encrypted or access-controlled from one another.

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

Exports are deliberate local actions. Review them before sharing:

- a full saved Lookup can include target, endpoints, raw RDAP publications,
  WHOIS bodies and publicly published contact data;
- normalised Lookup evidence excludes raw registration payloads and expanded
  contacts. Current schema 29 and published v2 schemas 27 and 28 retain that boundary;
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

### Browser and CLI handoffs

Lookup's **Download evidence package** includes the capsule and its exact
linked Lookup JSON together. **Download capsule** retains the standalone format.
In Dashboard saved-work tools, **Package and review evidence files** can also
include selected screenshots and opaque files, with optional source declarations
and observation times. Unknown times stay blank; packaging time is separate.

Review shows all entries, their digests and the local packaging event before any
import. It does not upload files or change saved data. Verified workspace files
open the existing merge preview. JSON text is fully reachable in paged inline
review; PNGs can be decoded locally, and all verified files remain downloadable.
No document scripts or links run. Capture manifests are checked against every
included attachment's exact bytes. Browser import and CLI format verification
remain separate from those byte checks.
Packaging keeps selected bytes unchanged and does not encrypt or redact them.

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
