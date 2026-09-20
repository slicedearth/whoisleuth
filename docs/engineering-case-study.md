# Engineering overview

WHOISleuth has a shared TypeScript collection and analysis core, browser-local
investigation storage, Express and Netlify HTTP adapters, and a separately
packaged CLI. The [architecture guide](architecture.md) contains the component
map and request pipeline. This page follows evidence through the implementation.

## Collection and source identity

`lib/lookup.mts` selects the Fast, Deep or compact collection contract and
combines source results into one validated response. Registry RDAP, registrar
RDAP, WHOIS, DNS, HTTP, TLS and observed-network data retain separate source
states and observation times. A supporting source cannot erase authoritative
registration evidence.

RDAP validates bootstrap entries and returned object identity. WHOIS follows
IANA referrals through bounded, source-specific query and parser profiles.
HTTP, DNS and TLS collectors use the shared public-address policy; HTTP
connections are pinned to validated addresses and redirects are revalidated.

A homepage capture is reused for static page, technology, form, fingerprint
and passive-posture analysis. Those analyses do not execute the page or fetch
its scripts. Proxy/CDN, application and embedded-resource indicators remain
separate; an observed endpoint does not establish the origin host.

See the [registry data contract](registry-data-contract.md) for response fields
and the [threat model](threat-model.md) for trust boundaries and residual risks.

## Retained evidence and comparison

Pure domain modules validate, normalise, compare and project records. Browser
adapters own IndexedDB transactions, quota handling, conflict recovery and
downloads. Case response forms own temporary drafts and use one workspace
mutation coordinator. A committed write followed by a failed refresh is
reported separately from a failed write.

Source observations, analyst assertions and response actions remain distinct.
Comparisons retain depth, source completeness, observation time and model
version. An uncollected value is not a removal; a changed parser or scoring
model is not a change in the target. Page comparison reports its individual
components and their limitations, not one combined verdict.

Workspace archives validate their complete envelope before a non-destructive
merge. Published fixtures independently exercise supported readers. The
[browser-local data guide](browser-local-data.md) covers storage, migration,
recovery and encryption; the [privacy notice](../PRIVACY.md) covers disclosure
and deletion.

## Code entry points

| Area | Owner |
| --- | --- |
| Lookup orchestration | [`lib/lookup.mts`](../lib/lookup.mts) |
| Registry collection | [`lib/rdap.mts`](../lib/rdap.mts), [`lib/whois.mts`](../lib/whois.mts) |
| HTTP connections and bounded reads | [`lib/safe-fetch.mts`](../lib/safe-fetch.mts) |
| Static HTML and technology evidence | [`lib/static-html-analysis.mts`](../lib/static-html-analysis.mts), [`lib/website-technology.mts`](../lib/website-technology.mts) |
| Operation admission | [`lib/operation-budget.mts`](../lib/operation-budget.mts) |
| Case records, migration and projections | [`packages/cases/case-model.mts`](../packages/cases/case-model.mts), [`case-record-projection.mts`](../packages/cases/case-record-projection.mts) |
| Investigation projection and search | [`packages/investigation/investigation-projection.mts`](../packages/investigation/investigation-projection.mts), [`investigation-search.mts`](../packages/investigation/investigation-search.mts) |
| Command grammar and discovery | [`cli/command-reference.mts`](../cli/command-reference.mts) |
| Browser test isolation | [`e2e/fixtures.ts`](../e2e/fixtures.ts) |

## Verification

Tests cover parsers, hostile inputs, authority, privacy, migrations and
independent historical fixtures. Browser tests cover rendered behaviour and
persistence while denying off-origin requests. Package checks build and
exercise the exact CLI archive; hosted checks apply to their recorded revision.

Use [Contributing](../CONTRIBUTING.md) to trace an ordinary change and select
local checks. The [verification guide](getting-started.md#verification) and
[release guide](releasing.md) describe the complete acceptance boundaries.
