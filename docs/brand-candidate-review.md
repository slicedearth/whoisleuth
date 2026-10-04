# Review candidates before monitoring

In Discover, select exact domains and choose **Retain selected for Brand review**.
This saves a nomination and its bounded source context, not a Lookup result.
In Brands, **Candidate review** shows matching reasons, full observed hostnames,
source intervals, unknown revisions and coverage gaps. Pattern groups disclose
their contributing rows; they do not establish common ownership.

Select individual candidates to shortlist, dismiss with a reason and expiry,
defer until review, or preview an exact Watchlist destination. Selections across
filters remain explicit in the preview. Duplicate and rejected domains are
reported separately. Adding a candidate-only watch makes zero requests and
does not invent availability, a score, a successful check or a baseline.

Watch priorities are analyst urgency: P1 immediate, P2 prompt, P3 routine,
P4 background or unassigned. They are not Risk, confidence, Case severity,
collection depth or scheduling. A watch reason and optional next-review date
belong to one exact domain/Brand context. A shared domain can have different
reasons for different Brands. Existing manual priority is preserved unless
explicit replacement is selected. In Monitor, open the list's History view to
review contexts and preview field-scoped bulk edits. Changed contexts invalidate
stale edits; unrelated contexts and evidence remain intact. Search or page through
all retained contexts without raising the 200-row render bound; selections remain
exact across pages and filters. Shared-domain controls identify their Brand context.
Context labels, searches and edit previews use readable saved Brand names, with
exact identifiers available separately. If names cannot be read or a Brand is
missing, an explicit name-unavailable label preserves usable context review.

Source-qualified registration, DNS, mail and page transitions can produce a
focused review item against the retained concern. Incomplete checks do not erase
the last comparable baseline. Scores alone do not create an activation review.
Suggestions do not change manual urgency, create Cases, enable monitoring or
run collection. Before/after values remain in retained history; when the exact
earlier field clock is unavailable, the review says so.

Scoped exceptions apply to one Brand, exact domain and matching rule. Preview
their scope, then record a reason, expiry and purpose: irrelevant matching
pattern, deferred investigation or accepted temporary change. They do not alter
official or partner declarations, imply safety or hide monitored security
changes. Expired exceptions, changed source revisions/material observations and
new independent rules restore eligibility. Inspect excluded candidates and
use **Re-evaluate retained candidates without collection** in Discover.
Disable an exception to reverse it; up to eight previous revisions are retained.
Conflicting copies of the same exception revision reject an import. Renewing or
re-enabling an exception cannot move its retained review clock backwards; disabling
under a rolled-back clock preserves the existing clock guard. A committed exception
remains saved if the visible Brand refresh fails, with drafts retained and further
mutations disabled until saved context can be reread.

## Time-bounded keyword campaigns

In Brands, open **Time-bounded keyword campaigns**, then create or edit a campaign.
Give it a name, positive and optional negative literals, explicit start/end
timestamps with timezones, a pause state and a default review priority. Preview
the revision before saving. These are local matching intentions, not collection
jobs: saving, pausing, reaching a start date or expiring makes no request and
does not automatically retain a candidate or create a Watchlist.

Any positive literal matches a substring of a lowercased canonical ASCII/punycode
hostname. Any negative literal vetoes that campaign, before the 200-match feed
bound. Matching is not a regular expression or token matcher: `launch` also
matches `prelaunch.example`, but not `launc-h.example`. Unicode text is not
expanded to punycode variants, visually confusable characters or typos. Discover's
existing typo and confusable generation remains a separate explicit workflow.
The optional example-host preview reuses the exact Brand domain preview, shows
canonical hostname text, positive/negative outcomes and separate official,
partner or allowlist declarations. It makes no request and keeps examples only
in page memory. A literal match or declaration is not a safety finding.

The start is inclusive and the end exclusive. The dates describe the analyst's
review window, not a domain's registration or source-observation time. Scheduled,
paused, expired and unavailable-clock campaigns cannot create new nominations.
Already retained candidates remain visible. Edits create a new immutable numbered
revision; eight prior revisions are retained with an explicit older-omission
count. Imports reject conflicting copies of the same revision, even behind a
newer revision, and do not silently reassign campaigns to a different Brand ID.
Concurrent edits must reopen the saved revision before retrying.

Each Brand supports 20 campaigns, each with at most 20 positive and 20 negative
literals of 3–80 characters. Empty positive lists, identical positive/negative
literals, invalid clocks and over-capacity campaigns reject rather than discard
intent. Existing Brand store/export byte budgets still apply. Campaigns have no
separate store and do not change the unrelated Case-grouping Campaign format.

Choose a saved active revision under **Matching intent** in feed review, scan an
explicit local file or explicitly query an available cache, then select individual
nominations to retain. The exact campaign ID, revision and literal are retained
as matching context; the source edition digest and source clocks stay separate.
Changed campaign revisions invalidate staged results. Retention rechecks the
current revision, pause and window inside the local transaction. Existing source
and matching-rule bounds reject overflow without losing prior provenance.

Watchlist handoff may prefill a priority only when all selected matching context
resolves to one agreed default in retained campaign revisions. An omitted old
revision, mixed defaults or manual matching context produces no inferred default.
Later edits never rewrite earlier candidate attribution. The analyst can change
the draft priority; existing manual Watchlist priorities remain untouched unless
the existing explicit replacement control is selected. Review and apply the
normal zero-request Watchlist preview before retaining any watch context.

## Review a domain feed

In Brands, open **Review domain feed candidates**. Select the source, enter
literal terms or exact hostnames, optionally add negative literals, or select a
saved active campaign revision, then scan a downloaded plain-domain file.
The file is processed locally without uploading it or querying its domains.
Select individual results to retain in Candidate review, then use the existing
Watchlist preview to choose a destination and priority.

The source catalogue covers threat-intelligence feeds, recent-registration
cohorts and high-entropy subsets. These are different nomination sources, not
interchangeable abuse findings. Open **Source details and coverage** for the
file digest, publisher declaration, local read time and omitted-match count.
Per-domain registration and source-observation dates remain unknown.

The equivalent CLI commands are offline:

```sh
whoisleuth domain-feed review nrd7 feed.txt --select term:example --json
whoisleuth domain-feed review nrd7 feed.txt --select term:launch --select exclude:excluded --json
whoisleuth domain-feed watch-input nrd7 feed.txt context.json --select host:login.example --json
```

`context.json` uses the candidate-watch input below with an empty `candidates`
array. The `watch-input` command emits that existing format with the matched nominees;
review it with `watchlist-review plan` before exporting a Watchlist. These commands
do not download feeds or change saved work. Use installed `domain-feed --help`
for selection and file bounds.
`exclude:` is a literal veto, including for an explicitly selected exact host.
At least one positive term or exact host is still required. These CLI selectors
do not import a browser campaign or infer its saved revision or priority.

An operator can also configure the [optional cached feed service](domain-feed-service.md).
Opening its disclosure reads cache status. **Query selected feed cache** and
explicit retained-edition requests send the selected feed, positive/negative
literals and exact hostnames; history requests also send the review cursor. The Brand
Profile, campaign identity, dates, priority and retained revision history stay local.
Stale or unconfirmed-refresh warnings remain visible alongside retained results.
Manual file review does not require this service.

Within the optional cache disclosure, **Retained editions and catch-up** opens a
separate explicit review. **Start retained-edition review** begins at the oldest
available edition; **Continue after reviewing this page** requests the next
bounded page without changing selectors. Select individual staged nominations to
retain, or deliberately leave them unretained before advancing. Previously
retained or dismissed candidates are not deleted or silently admitted.

The panel distinguishes source edition/publication/acquisition clocks from dated
refresh outcomes, and shows metadata-only or no-longer-retained gaps. A gap needs
**Acknowledge gap and continue**; it is not an empty source edition or evidence
of removal. A completed range offers **Check for newer retained editions**.
Neither action schedules a later check. Failed requests or local staging failures
leave the last reviewed page and cursor unchanged; selection changes cancel late
replies. Negative filtering applies before each bounded page, not afterwards.

Progress stays in page memory unless deliberately downloaded with **Download
progress after reviewed page** (or the explicit gap-acknowledgement variant).
Paste that JSON under **Resume from a saved cursor** to resume. Cursors bind the
source, retained cache identity and literal rules; they do not authenticate an
analyst decision or record a Brand/campaign identity. They can include the last
reviewed hostname, so review them before sharing. Changed matching rules or a
replaced cache reject a stale cursor. Missing earlier editions remain disclosed.

## Offline Watchlist handoff

`whoisleuth watchlist-review plan selection.json --json` previews the same bounded
selection without network requests. `watchlist-review export selection.json`
emits a portable Watchlist document to stdout for deliberate import; it does not
write browser storage or enable collection. `selection.json` uses
`whoisleuth.candidate-watch-input` version 1 with `watchlists` (a supported portable
Watchlist export or `null`) and `selection`: `name`, `brandProfileId` or `null`,
`priority`, `reason`, `candidates`, optional `reviewDueAt`, and optional explicit
`replaceExistingContext`. Candidate records contain `domain`, `matches` and
`sources`; the retained fixture demonstrates reserved-value input:
[`candidate-watch-input-v1.json`](../test/fixtures/brand-candidate-workflow/candidate-watch-input-v1.json).
Run `plan` before `export` to inspect each duplicate/rejected outcome.

## Storage and sharing

Brand Profile schema 11 adds revisioned keyword campaign intent to the existing
candidate observations and scoped exceptions. Versions 6–10 remain readable
without invented campaign intent; versions 6–9 receive no invented candidate
provenance. Watchlist schema 6
retains context metadata, nullable local password-form attribution and paused
[membership recovery](browser-local-data.md) for older over-capacity records.
Versions 2–5 remain readable; older evidence receives no invented context. New fields
declared under an older epoch are rejected. Future epochs fail closed.
Historical fixture bytes remain independent of current writers.

Campaign literals, dates, revisions, candidate provenance, watch reasons and
exception decisions can be sensitive.
They remain in the current browser workspace until deliberately exported; review
Brand, Watchlist and workspace exports before sharing. Hosted monitoring receives
only its existing compact whitelist, not these local review fields. Priority,
expiry and review dates never authorise requests or promise continuous coverage.
