# Registry data contract

This document describes the normalized WHOIS/RDAP data returned by the unified
Lookup API, the source-health semantics used for comparisons, and the boundary
between deliberate evidence exports and compact browser-local workflows.

The contract is additive: existing fields remain available when new normalized
metadata is introduced. Upstream registries vary widely, so most parsed fields
may be `null`, an empty array, or absent when a source does not publish them.
Missing data must not be interpreted as a negative observation without checking
the corresponding source diagnostics and truncation fields.

## Unified Lookup response

`GET /api/lookup?q=<query>` accepts a registrable domain, IPv4/IPv6 address, or
ASN. A full successful response contains:

- Query classification and, for domain input, submitted-hostname and
  registrable-domain context.
- `rdap`: raw and normalized registry RDAP source data or a source error. A
  successful deep non-compact domain result may include a separately
  attributed `registrarRdap` child.
- `whois`: the raw referral chain and normalized WHOIS data or a source error.
- `availability`: the derived domain-registration assessment, or a
  non-applicable result for IP/ASN input.
- `diagnostics`: independent source status and provenance.

`compact=1` returns only `availability` and `diagnostics`. Bulk uses this mode;
raw RDAP JSON, WHOIS response bodies, and expanded registry contacts are not
downloaded into Bulk or copied into watchlists and analyst cases.

Fast mode is WHOIS-free. It uses RDAP first and may perform a bounded NS lookup
when RDAP is unsupported or inconclusive. A positive authoritative DNS
delegation can confirm that a domain is registered, with medium confidence, but
cannot provide registrar, lifecycle, or contact data. A missing delegation is
never treated as availability because registered domains may be undelegated.
The WHOIS diagnostic status remains `skipped`; this is not a WHOIS failure or
an observation that WHOIS data is absent.

For a deep, non-compact domain Lookup only, a successful registry RDAP object
may publish a complete `rel="related"` HTTPS domain-object link at the
sponsoring registrar. Lookup follows at most one eligible link, validates the
returned object against the same canonical domain, and exposes it as
`rdap.registrarRdap`. Its status is `success`, `not_found`, `unsupported`,
`skipped`, or `error`. Registrar data remains separately attributed: it never
overwrites registry fields and is not an input to availability, Risk scoring,
registry/WHOIS comparison, Bulk, watchlists, or analyst cases. The extra
request has its own seven-second bound and can add latency when it does not
fully overlap the WHOIS referral chain.

Deep registered-domain assessments additionally expose a bounded
`availability.dns` observation. The collector runs A, AAAA, CNAME, NS, MX,
SPF, DMARC, and CAA queries in parallel, reusing the existing mail-policy
queries rather than running a second mail scan. Each record family has an
independent `success`/`not_found`/`error` diagnostic, malformed neighbours are
counted and discarded, and capped inventories set their truncation flag.
Resolver failure produces `null` for the compatible `hasMx`, `hasSpf`, or
`hasDmarc` signal; authoritative absence produces `false`. DNSSEC remains
registry-derived because recursive-resolver validation is not equivalent to
delegation data.

The observation is point-in-time context. CNAME targets are not followed
recursively, unrelated TXT records are not retained, and shared DNS
infrastructure is not proof of common ownership or maliciousness. Full Lookup
and deliberate evidence exports retain the bounded observation. Compact Bulk
responses may display or export it, but watchlists and analyst cases continue
to store only their existing compact compatibility fields.

## Shared observation envelope

New network-derived evidence can add a version-1 `observation` envelope (or,
for DNS compatibility, expose the same envelope fields on
`availability.dns`) with:

- Established source status: `success`, `partial`, `not_found`, `skipped`,
  `error`, `unsupported`, or `not_applicable`.
- Canonical `observedAt`, optional measured `durationMs`, and `source`.
- `scanMode` only when the existing `fast` or `deep` mode applies; otherwise
  it is `null` rather than an invented profile.
- Explicit `complete` and `truncated` booleans.
- Bounded, control-safe `limitations` and shallow source diagnostics.

The envelope is additive and never replaces a source's existing payload or
compatibility fields. Readers distinguish absent envelopes (legacy data),
supported version 1, malformed values, and unsupported future versions. An
absent envelope must not cause an otherwise valid legacy record to be rejected
or rewritten. DNS and Certificate Transparency are the first adopters; other
registry diagnostics retain their existing versioned contract until an
additive migration provides material value.

## Capability discovery

Authenticated clients can request `GET /api/capabilities`. Version 1 returns a
server-authoritative runtime identifier and a bounded feature list using
`supported`, `disabled`, `unavailable`, or `local_only`. Each entry identifies
its execution location and only the existing `fast`/`deep` modes it actually
supports. The report deliberately marks scheduled monitoring and distributed
budgets unavailable until those services exist.

Hosted feature status is derived from the same environment policy enforced by
Express and each direct Netlify Function. A disabled top-level network feature
returns HTTP `503` with `errorCode: FEATURE_DISABLED`, the requested `feature`,
and the effective `disabledBy` feature. Dependency shutdown is explicit: for
example, disabling DNS intelligence also disables the DNS-dependent posture
audit. Frontend controls are advisory reflections of this report, not the
enforcement boundary.

The optional version-1 `controls.concurrency` object reports the active
operation classes and their per-session and per-runtime ceilings. The default
uses `mode: in_memory`, `distributed: false`, and a `process` or
`serverless_instance` scope. An explicitly configured shared REST provider
uses `mode: redis_rest`, `distributed: true`, and `scope: deployment`.
Incomplete or invalid shared-provider configuration uses `mode: unavailable`,
never silently falls back to local enforcement, and causes network-heavy work
to fail closed. Older version-1 reports without `controls` remain valid.

The nested `controls.concurrency.usage` object reports whether durable usage
accounting is `disabled`, `unavailable`, or
`distributed_fixed_windows`. Usage model version 1 uses
`windowModel: utc_epoch_fixed`, publishes the configured global 24-hour and
30-day ceilings, and lists only explicitly configured feature ceilings. These
are application controls rather than live counts or provider billing metrics.
Older version-1 reports without `usage` remain valid.

Consumers must reject malformed or unsupported future reports conservatively;
the browser labels capability status unavailable without hiding otherwise
usable local workflows. Runtime limitations distinguish process-local Express
state from per-instance serverless state and must not be presented as globally
enforced usage accounting.

When concurrency is exhausted, network endpoints return HTTP `429`, a
short `Retry-After` value, and `errorCode: NETWORK_CONCURRENCY_LIMITED` with a
bounded operation class and `session` or `runtime` scope. An unavailable
configured provider instead returns HTTP `503`,
`errorCode: NETWORK_BUDGET_UNAVAILABLE`, and `provider` scope. These are
temporary application-control responses, not upstream registry results or
evidence about the queried domain. Current endpoint denials also include the
server-derived `operationFeature` and `operationFeatureModelVersion: 1`.
Version 1 distinguishes fast/deep ordinary Lookup, fast/deep compact Bulk,
direct RDAP, direct WHOIS, fast/deep availability, Certificate Transparency,
and domain-posture requests. The feature is accounting provenance rather than
proof of the browser workflow: compact mode is the Bulk contract, but a custom
client can select a different compatible response shape, so future durable
enforcement must also retain deployment-wide totals.

When a configured fixed-window allowance is exhausted, the endpoint returns
HTTP `429`, `errorCode: NETWORK_USAGE_LIMITED`, a bounded `Retry-After`, and a
`limitScope` of `global_daily`, `global_30_day`, `feature_daily`, or
`feature_30_day`. The response includes `usageWindow` (`24_hour` or `30_day`),
`usageModelVersion: 1`, and the same server-derived operation attribution. The
30-day window is fixed and UTC-epoch-aligned; it is not a calendar month,
rolling window, or hosting-provider billing statement.

## Diagnostics version 4

`diagnostics.version` is `4`. Version 4 retains the version-3 source fields,
including the explicit `disabled` state and `FEATURE_DISABLED` code, and adds
an optional `diagnostics.rdap.registrar` child for the separately attributed
registrar follow-up. Consumers that do not recognize version 4 must fail
conservatively rather than reinterpret a disabled, skipped, unsupported, or
failed source as upstream absence. The source objects use explicit status
values:

- RDAP: `success`, `not_found`, `unsupported`, `disabled`, or `error`.
- WHOIS: `complete`, `partial`, `skipped`, `disabled`, or `error`.
- Availability: `complete`, `not_applicable`, `disabled`, or `error`.

RDAP diagnostics may include the selected endpoint, transport (`https` or
`http`), upstream HTTP status, fetch time, and up to three bounded endpoint
attempts. Each attempt records endpoint, transport, status, outcome, selected
state, and a control-safe detail of at most 240 characters.
Registrar diagnostics may include its status, endpoint, HTTPS transport,
upstream status, fetch time, and one bounded attempt. Registrar `not_found` is
diagnostic only and never an availability signal.

WHOIS diagnostics may include query time, authoritative hop, failed hop, and
conflicting hop. A partial chain can still contain useful published values;
field comparison uses those values but does not treat a missing field in a
partial chain as proof that WHOIS omitted it.

Stable source error codes include `RDAP_UPSTREAM_FAILED`, `RDAP_UNSUPPORTED`,
`WHOIS_UPSTREAM_FAILED`, `AVAILABILITY_CHECK_FAILED`, and `FEATURE_DISABLED`.
A disabled source was deliberately not queried and must not be interpreted as
upstream absence, failure, redaction, or evidence about the domain.

Deep domain availability includes `deepScanComplete: false` when deployment
policy skipped RDAP, WHOIS, DNS intelligence, or website probing. The live
response may still contain useful enabled-source evidence, but browser-local
watchlist and case baselines conservatively treat that capture as non-deep so
skipped values cannot erase or contradict an earlier complete deep snapshot.

## Normalized RDAP data

All supported RDAP object types share these bounded fields:

- `objectClassName`, `language`, `port43`, and `parentHandle`.
- `conformance` and `conformanceTruncated`.
- `links` and `linksTruncated` (HTTP(S) links only).
- `notices`/`remarks`, their bounded registered `type` values, and their
  corresponding `*Truncated` flags.
- `serverTruncated` and bounded, deduplicated `serverTruncationReasons` when a
  typed notice or remark uses an RFC 9083 registered object/result-set
  truncation value.
- `statuses` and `statusesTruncated`.
- `events`, `eventsTruncated`, and deterministic `lifecycle`.
- `redactions` and `redactionsTruncated`.
- `entitiesByRole`, `entitiesTruncated`, and `truncatedEntityRoles`.

Lifecycle selection does not trust upstream array order. Registration uses the
earliest valid `registration` event; expiration, last-change, transfer,
deletion, reregistration, and reinstantiation summaries use the latest valid
event of their respective type. The bounded original event list remains
available for provenance. Every raw lifecycle summary has an additive
`*DateIso` companion containing a canonical UTC ISO-8601 timestamp, or `null`
when the upstream value cannot be normalized. `lifecycle.databaseUpdatedDate` separately exposes
the latest valid `last update of RDAP database` event as the server's own data
freshness claim; `databaseUpdatedDateIso` is its canonical companion, not the
application's fetch time.

Server-declared truncation is distinct from local normalization caps. Only the
registered typed notice/remark values set `serverTruncated`; prose containing
the word "truncated" does not. Local `*Truncated` flags continue to report data
that exceeded this application's display/storage bounds. Neither state is an
availability or Risk signal.

### Domain objects

Domain parsing additionally exposes:

- `domain`, `unicodeDomain`, registry `handle`, and registrar IANA ID.
- Bounded nameserver names and glue addresses through `nameservers` and
  `nameserverDetails`.
- `nameserversTruncated` and `nameserverAddressesTruncated`.
- DNSSEC delegation/zone state, bounded `dsData`, and `dsDataTruncated`.
- Bounded IDN variant groups and `variantsTruncated`.
- Primary compatibility contacts (`registrar`, `registrant`,
  `administrative`, `technical`, `billing`, and `abuse`) plus the complete
  bounded role inventory.

Glue values must match their published IPv4/IPv6 family. DS entries are retained
only when key tag, algorithm, digest type, and an even-length hexadecimal digest
are all valid; malformed neighbours do not remove valid records.

### IPv4 and IPv6 network objects

Network parsing additionally exposes:

- `handle`, `name`, `startAddress`, `endAddress`, `country`, and `networkType`.
- Valid, address-family-matched `cidrs` from the CIDR0 extension and
  `cidrsTruncated`.
- Primary organization and abuse contacts selected from the bounded role
  inventory.

The endpoint response is accepted only when the requested address lies within
the returned start/end range. A successful response for a different range or
object class is rejected and the next bounded bootstrap endpoint is attempted.

### Autonomous-system objects

ASN parsing additionally exposes:

- `handle`, `name`, `startAutnum`, `endAutnum`, `country`, and `autnumType`.
- Primary organization and abuse contacts selected from the bounded role
  inventory.

The response is accepted only when the requested ASN lies within the returned
autnum range.

### RDAP normalization limits

The principal collection limits are:

| Collection | Limit |
|---|---:|
| Response body | 2,000,000 bytes |
| Bootstrap endpoints attempted | 3 |
| Top-level links | 20 |
| Status values | 100 |
| Events | 100 |
| Notice or remark blocks | 12 |
| Descriptions per notice/remark | 6 |
| Description text | 800 characters |
| Server truncation reasons | 8 |
| RDAP entities traversed | 100 |
| Nested entity depth | 6 |
| Entities retained per recognized role | 5 |
| vCard entries per entity | 100 |
| Repeated values per contact field | 8 |
| Entity links | 10 |
| Redaction entries | 100 |
| IDN variant groups | 20 |
| Names per variant group | 50 |
| Domain nameservers | 200 |
| Glue addresses per nameserver | 20 |
| DS records | 50 |
| CIDR0 entries | 200 |

The `*Truncated` fields disclose when relevant upstream input exceeded these
normalized limits. Invalid values are discarded without discarding valid
neighbours. The raw source remains available only in full Lookup and deliberate
evidence export.

## Normalized WHOIS data

WHOIS starts at the IANA root and follows a bounded registry referral chain.
One chain shares a 25-second deadline; each hop has a 12-second DNS/connect/body
ceiling, tries at most three validated public addresses, and caps its response
at 200,000 bytes.

`parseWhoisChain` exposes compatibility scalars and normalized structures:

- `registrationStatus`: `registered`, `not_found`, or `inconclusive`.
- `chainStatus`: `complete` or `partial`.
- `notFound`, `notFoundSource`, `authoritativeHop`, `failedHop`, and
  `conflictingHop`.
- Domain/registry identifiers, registrar metadata, reseller, lifecycle dates,
  DNSSEC, statuses, and nameservers when published.
- Bounded registrant, administrative, technical, billing, and registrar-abuse
  contacts in `contactsByRole`, while retaining existing primary scalar fields.
- `fieldsTruncated`, naming the normalized fields whose content or collection
  exceeded local limits.

The IANA root hop supplies delegation/referral information and never supplies
the queried domain's registrant or existence decision. Positive authoritative
registry evidence is not overridden by a failed, throttled, or contradictory
later registrar hop. Rate-limit and temporary failure responses remain
inconclusive rather than becoming availability evidence.

WHOIS scalar values are capped at 1,000 characters unless a narrower
field-specific limit applies. Nameservers are capped at 200 and statuses at
100. Control-bearing values are rejected.

Raw `createdDate`, `expiryDate`, and `updatedDate` strings remain available at
their compatibility locations and in `lifecycle`. Additive `*DateIso`
companions use the same deterministic parser as availability analysis, support
the documented ccTLD formats, and are `null` for invalid or unsupported input.
Availability likewise retains its raw creation/expiry values while publishing
`createdDateIso` and `expiryDateIso`; compact consumers may store the canonical
form without losing full-Lookup provenance.

## RDAP/WHOIS comparison

Domain comparison normalizes harmless differences in case, punctuation,
timestamp precision, status formatting, nameserver order, and set order while
retaining the original display values. Lifecycle comparisons prefer canonical
ISO companions when present and fall back to legacy raw-value normalization.
Each field is classified as one of:

- `equivalent` or `conflict` when both sources provide comparable values.
- `rdap_only` or `whois_only` for a genuinely unpublished opposite value.
- `rdap_redacted` or `whois_redacted` for explicit privacy/redaction markers.
- `rdap_unavailable` or `whois_unavailable` when a source failed, was
  unsupported/skipped, or returned no matching object.
- `rdap_incomplete` or `whois_incomplete` when a value was not observed in a
  partial source response.

The comparison includes `sourceHealth`, preserving the original diagnostic
status and the derived `complete`, `incomplete`, or `unavailable` condition.
Source unavailability is not counted as a registry conflict or a source-only
publication difference.

## HTTP observation provenance

Deep availability analysis reuses its existing SSRF-protected homepage request
to publish a bounded `availability.http` object. The shared request engine
validates and pins every redirect hop; HTTP provenance does not trigger another
request. Its version-1 observation envelope distinguishes successful, partial,
error, and policy-skipped collection.

The type-specific payload includes the sanitized request and final URLs, up to
five redirects, response status, HTTPS or cleartext transport, selected bounded
headers, declared content length, captured body bytes, and whether the retained
body prefix was capped. It also records cross-origin redirects and HTTPS-to-HTTP
downgrades as context. Query strings and fragments are not retained, response
bodies are never included, and overlong paths fall back to bounded origin-only
provenance. Failed HTTPS/HTTP attempts remain distinct from proof that no site
exists.

Selected security headers are observations only. Their absence is not a
maliciousness verdict and does not contribute to Risk scoring. A response can
still establish web-service activity when its body is unavailable for HTML
inspection.

## Evidence export and privacy boundary

Lookup evidence uses schema `whoisleuth.lookup-evidence`, version `11`. It
contains query context, diagnostics, normalized sources, raw RDAP data, the raw
WHOIS referral chain, availability analysis, and the source-health-aware
registry comparison. Version 11 retains optional bounded, versioned browser-side
IDN/script/confusable analysis, additive network-observation provenance supplied
by deep Lookup, and bounded HTTP response/redirect, page-identity, DNS, and TLS
evidence derived from the requested collection. URL query strings are
deliberately omitted from retained HTTP provenance. It is intentionally rich
and may contain public registry
contact data. The file is generated locally and is the user's responsibility
after download.

The local CLI `export` command can convert one bounded version-1
`whoisleuth.cli.lookup` domain document into the same evidence schema without
making another request. CLI conversion retains the source material already in
that saved document but cannot add browser-only profile context, so its optional
IDN analysis is `null`.

The optional CLI Markdown and self-contained HTML renderings share one bounded
human-readable view of that JSON contract rather than defining additional
evidence schemas. Both escape upstream strings, disclose omitted list values,
and exclude raw RDAP JSON and full WHOIS responses. HTML adds no scripts,
forms, active links, or external resources and includes a restrictive embedded
Content Security Policy. The versioned JSON package remains the authoritative
machine-readable export when complete captured source material is required.

Lookup evidence is a downloadable report contract, not a browser-local case
storage schema. Consumers must check `schema` and `schemaVersion`; an unknown
future version must not be silently interpreted as an older version.

Bulk responses, watchlists, and case snapshots retain compact derived evidence
only. Expanded contact inventories, raw RDAP JSON, raw WHOIS bodies, and endpoint
response payloads do not enter those browser-local stores. Existing case and
watchlist schemas remain readable because registry enrichment does not rewrite
their storage shape.

## Compatibility rules

- New normalized fields are additive.
- Existing compatibility scalars and arrays retain their established meaning.
- Missing fields remain valid because registries publish different subsets.
- Malformed neighbours do not invalidate valid data.
- Cap flags describe normalized output completeness; they do not modify the raw
  evidence source.
- Fast mode remains WHOIS-free; its positive-only DNS-delegation fallback does
  not classify an absent delegation as availability. Compact mode remains
  raw-source-free.
- Unsupported future stored/exported schema versions must not overwrite local
  data.
