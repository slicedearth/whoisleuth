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
- `rdap`: raw and normalized RDAP source data or a source error.
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

## Diagnostics version 2

`diagnostics.version` is `2`. The source objects use explicit status values:

- RDAP: `success`, `not_found`, `unsupported`, or `error`.
- WHOIS: `complete`, `partial`, `skipped`, or `error`.
- Availability: `complete`, `not_applicable`, or `error`.

RDAP diagnostics may include the selected endpoint, transport (`https` or
`http`), upstream HTTP status, fetch time, and up to three bounded endpoint
attempts. Each attempt records endpoint, transport, status, outcome, selected
state, and a control-safe detail of at most 240 characters.

WHOIS diagnostics may include query time, authoritative hop, failed hop, and
conflicting hop. A partial chain can still contain useful published values;
field comparison uses those values but does not treat a missing field in a
partial chain as proof that WHOIS omitted it.

Stable source error codes include `RDAP_UPSTREAM_FAILED`, `RDAP_UNSUPPORTED`,
`WHOIS_UPSTREAM_FAILED`, and `AVAILABILITY_CHECK_FAILED`.

## Normalized RDAP data

All supported RDAP object types share these bounded fields:

- `objectClassName`, `language`, `port43`, and `parentHandle`.
- `conformance` and `conformanceTruncated`.
- `links` and `linksTruncated` (HTTP(S) links only).
- `notices`/`remarks` and their corresponding `*Truncated` flags.
- `statuses` and `statusesTruncated`.
- `events`, `eventsTruncated`, and deterministic `lifecycle`.
- `redactions` and `redactionsTruncated`.
- `entitiesByRole`, `entitiesTruncated`, and `truncatedEntityRoles`.

Lifecycle selection does not trust upstream array order. Registration uses the
earliest valid `registration` event; expiration, last-change, transfer,
deletion, reregistration, and reinstantiation summaries use the latest valid
event of their respective type. The bounded original event list remains
available for provenance.

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

## RDAP/WHOIS comparison

Domain comparison normalizes harmless differences in case, punctuation,
timestamp precision, status formatting, nameserver order, and set order while
retaining the original display values. Each field is classified as one of:

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

## Evidence export and privacy boundary

Lookup evidence uses schema `whoisleuth.lookup-evidence`, version `3`. It
contains query context, diagnostics, normalized sources, raw RDAP data, the raw
WHOIS referral chain, availability analysis, and the source-health-aware
registry comparison. It is intentionally rich and may contain public registry
contact data. The file is generated locally and is the user's responsibility
after download.

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
