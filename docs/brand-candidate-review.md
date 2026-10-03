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

## Offline CLI

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
versions 6–9 remain readable without invented provenance. Watchlist schema 5
retains context metadata and nullable local password-form attribution; versions
2–4 remain readable with unassigned urgency and unknown new evidence. New fields
declared under an older epoch are rejected. Future epochs fail closed.
Historical fixture bytes remain independent of current writers.

Candidate provenance, watch reasons and exception decisions can be sensitive.
They remain in the current browser workspace until deliberately exported; review
Brand, Watchlist and workspace exports before sharing. Hosted monitoring receives
only its existing compact whitelist, not these local review fields. Priority,
expiry and review dates never authorise requests or promise continuous coverage.
