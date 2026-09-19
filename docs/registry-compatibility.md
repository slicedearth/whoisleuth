# Registry compatibility

WHOISleuth discovers domain RDAP services through the live IANA DNS bootstrap
and starts WHOIS referral chains at `whois.iana.org`. The reviewed catalogue
describes service access, exceptional query formats and fixture coverage. It
does not select a replacement endpoint or decide whether a domain exists.

## Coverage states

- **Discovery only:** normal IANA discovery is attempted, without a
  suffix-specific fixture for an exceptional query, encoding or parser profile.
- **Fixture verified:** bounded fixtures exercise the declared parser outcomes.
  Registered-response coverage does not imply not-found coverage, or vice versa.
- **Access documented:** an official source records a service or collection
  restriction without fixture-verified parsing, or records no machine endpoint.

These states are not live reachability, field-completeness or registration
results. A failed, restricted, empty or undocumented response remains
inconclusive.

## Generic TLD service coverage

Generic TLDs use IANA RDAP bootstrap discovery and shared bounded RDAP parsing.
The catalogue's dated coverage snapshot distinguishes published RDAP, WHOIS
and documented access restrictions, including suffixes with only one service.
Related suffixes do not inherit each other's RDAP coverage merely because they
share a registry operator or WHOIS parser.

The current suffix matrix, source references, review dates and covered outcomes
are available from the same catalogue through:

- the Console's [Registry support reference](https://www.whoisleuth.com/registry-support),
  with local text and coverage filters;
- the offline CLI, including a domain-or-suffix inspector:

  ```bash
  whoisleuth registry-support
  whoisleuth registry-support example.test --json
  ```

Neither view tests a registry or sends the inspected domain to a service. An
unlisted suffix uses the explicit discovery-only fallback.

## Runtime admission and referrals

The shared service-admission check runs before domain WHOIS or RDAP transport
from Express, hosted functions, the CLI, Bulk, availability or monitoring.
RDAP discovery follows the current IANA bootstrap, within its existing cache,
deadline and endpoint bounds. A retained no-service hint does not suppress
discovery or a newly published service; no discovered endpoint means no RDAP
object request. Documented absent, policy-restricted and source-IP-authorised
WHOIS profiles remain blocked; the current runtime has no configured
authorisation override. Access metadata cannot establish registration or availability.

Query profiles apply only to the first registry hop referred by IANA. The root
query and subsequent referrals receive the canonical plain domain. Each hop
records its query profile and response encoding, not another copy of the query.
Exceptional profiles cover the domain-and-ACE query, English-output suffix and
suffix-scoped Unicode query where the official protocol and fixtures require
them. They cannot change endpoint selection, referral depth or authority.

Reviewed manual links are separate from machine endpoints. The analyst opens
the official lookup and chooses whether to enter the domain there; WHOISleuth
does not append the target, scrape the page or substitute a non-standard-port
service for IANA discovery. Selecting a manual link does not change evidence,
source status or scoring.

## Parser and authority boundaries

Generic colon fields use the shared bounded parser. Ambiguous fields such as
`owner`, `holder`, `state`, `name` or an unlabelled timestamp require the
appropriate response markers or section. Contact identifiers and nameserver
handles are not promoted to hostnames. Dates keep their source text beside a
validated canonical timestamp; unsupported or ambiguous values remain unknown.

Authoritative negative responses are matched at the registry hop using bounded
complete-line rules. Policy prose, an echoed domain, a timeout or a later
registrar response cannot become authoritative absence or erase positive
registry evidence. Numeric protocol states distinguish availability from
reserved, prohibited, pending-release and temporary-failure states. Explicit
throttling takes precedence over echoed fields; prose describing a rate policy
is not itself a throttle response.

RDAP separately verifies domain, IP-range and ASN-range object identity. The
[registry data contract](registry-data-contract.md) defines normalised fields,
source diagnostics, bounds, comparison and export behaviour. Only the existing
positive authoritative-delegation fallback can supplement inconclusive
registration evidence; missing DNS does not prove availability.

## Catalogue and fixture ownership

| Surface | Owner |
| --- | --- |
| Reviewed suffix profiles, official references and coverage snapshot | [`lib/registry-capability-catalogue.mts`](../lib/registry-capability-catalogue.mts) |
| Domain/suffix resolution and transport admission | [`lib/registry-capabilities.mts`](../lib/registry-capabilities.mts) |
| WHOIS parser scenarios | [`fixtures/whois-registry-fixtures.mts`](../fixtures/whois-registry-fixtures.mts) |
| RDAP parser scenarios | [`fixtures/rdap-registry-fixtures.mts`](../fixtures/rdap-registry-fixtures.mts) |
| Fixture source references, review dates and digests | [`fixtures/registry-fixture-provenance.mts`](../fixtures/registry-fixture-provenance.mts) |

Fixtures contain reserved names and minimised parser-relevant values. Synthetic
or reconstructed responses test their declared behaviour, not a live service.
Shared fixture families require evidence of the same protocol and service;
manager identity alone is insufficient. Each alias keeps suffix-correct
discovery, access and provenance.

## Adding a registry adapter

1. Reproduce the gap with a bounded, sanitised fixture and its official protocol
   or service reference.
2. Update the catalogue's suffix, query profile, encoding, dialect and covered
   outcomes. Reuse the shared parser where the response shape already fits.
3. Add independent positive, negative, partial, throttled and malformed cases
   for the outcomes actually supported by the source. Do not invent a missing
   response dialect or label reconstructed input as a captured observation.
4. Record source provenance and the exact minimised fixture digest. Exclude
   personal data, operational tokens and unrelated response text.
5. Run the focused parser, admission, fixture and consumer checks. Automated
   tests remain offline.

Transport integration uses the existing public-address, pinned-connection,
byte and deadline controls. An exceptional query or non-UTF-8 decoder requires
its own fixture and protocol evidence before runtime use.

## Freshness and drift

```bash
npm run sources:health
npm run registry:fixtures
```

These commands inspect retained source health and fixture integrity offline.
Review age is not the time of the analyst's Lookup and does not prove current
upstream publication. A stale or mismatched record requires source review, not
an arbitrary timestamp change.

`npm run registry:drift` is a separate, explicit network operation comparing the
fixed official catalogues. It does not perform domain investigations or apply
changes. Review its differences and source identity before updating retained
metadata; a failed or missing upstream response is not an empty catalogue.
