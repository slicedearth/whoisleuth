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

## Review a domain feed

In Brands, open **Review domain feed candidates**. Select the source, enter
literal terms or exact hostnames, then scan a downloaded plain-domain file.
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
whoisleuth domain-feed watch-input nrd7 feed.txt context.json --select host:login.example --json
```

`context.json` uses the candidate-watch input below with an empty `candidates`
array. The second command emits that existing format with the matched nominees;
review it with `watchlist-review plan` before exporting a Watchlist. Neither
command downloads a feed or changes saved work. Use installed `domain-feed --help`
for selection and file bounds.

An operator can also configure the [optional cached feed service](domain-feed-service.md).
Opening its disclosure reads cache status; only **Query selected feed cache**
sends the selected feed, terms and exact hostnames. The Brand Profile stays local.
Stale or failed-refresh warnings remain visible alongside retained results.
Manual file review does not require this service.

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

Brand Profile schema 10 retains candidate observations and scoped exceptions;
versions 6–9 remain readable without invented provenance. Watchlist schema 6
retains context metadata, nullable local password-form attribution and paused
[membership recovery](browser-local-data.md) for older over-capacity records.
Versions 2–5 remain readable; older evidence receives no invented context. New fields
declared under an older epoch are rejected. Future epochs fail closed.
Historical fixture bytes remain independent of current writers.

Candidate provenance, watch reasons and exception decisions can be sensitive.
They remain in the current browser workspace until deliberately exported; review
Brand, Watchlist and workspace exports before sharing. Hosted monitoring receives
only its existing compact whitelist, not these local review fields. Priority,
expiry and review dates never authorise requests or promise continuous coverage.
