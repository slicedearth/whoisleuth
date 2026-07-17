# Registry compatibility

WHOISleuth discovers domain RDAP services through the live IANA DNS bootstrap
registry and starts WHOIS referral chains at `whois.iana.org`. Those discovery
mechanisms remain the source of truth. The compatibility metadata in
`lib/registry-capabilities.mts` cannot replace an IANA endpoint or decide
whether a domain exists. A fixture-backed profile may format only the first
WHOIS query sent to the registry referred by IANA; later referrals always
receive the canonical plain domain. Every hop records the applied query profile
and response encoding without duplicating the query value in the response.

## Coverage states

- **Discovery only** means WHOISleuth can attempt normal IANA bootstrap and
  referral discovery, but has no suffix-specific fixture proving an exceptional
  query, encoding, or parser profile. It is not a claim that the registry is
  reachable or that it publishes any particular field.
- **Fixture verified** means synthetic, bounded fixtures exercise a parser or
  fallback profile already implemented by WHOISleuth. It does not prove current
  live-registry availability, policy, completeness, or deployment reachability.
- **Access documented** means an authoritative registry or IANA source documents
  a machine-access constraint or publishes no machine endpoint. It describes
  collection conditions only and is never evidence about domain availability.

The version 5 explicit matrix is:

| Suffix | Current WHOIS parser/fallback or access profile | Coverage |
| --- | --- | --- |
| `.au` | Eligibility and contact fields | Registered |
| `.cz` | FRED contact-handle indirection | Registered |
| `.de` | First-referral domain-and-ACE query; alternate field labels | Registered |
| `.edu` | Indented contact blocks | Registered |
| `.es` | Plain WHOIS syntax; registry requires advance source-IP authorization; IANA publishes no RDAP service | Access documented |
| `.gt` | Bounded registry-web fallback into the normal WHOIS parser | Registered, not found, unavailable |
| `.it` | Alternate field labels and bare nameserver section | Registered |
| `.jp` | First-referral English-output query; bracketed fields | Registered |
| `.kr` | Dot-leader fields and host-name nameservers | Registered |
| `.tr` | Prefixed dot-leader fields and bare nameserver section | Registered |
| `.uk` | Sectioned indented domain, registrant, registrar, status, date, and nameserver fields | Registered, not found, malformed |
| `.vn` | IANA publishes no domain WHOIS or RDAP service; official browser lookup is not integrated | Access documented |

The exceptional query formats are grounded in the registries' own protocol
guidance: the [`.de` WHOIS service guide](https://www.denic.de/en/services/whois-service/)
documents the domain-and-ACE query type, while the [`.jp` command-line
guide](https://jprs.jp/about/dom-search/jprs-whois/whois-guide-usage.html)
documents `/e` as the English-output suffix. The automated suite represents
both with synthetic responses and never contacts either registry.

The [`.uk` WHOIS instructions](https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/query-tools/whois/whois-basic-instructions/)
document a sectioned port-43 response with indented domain, registrar,
registration-status, date, and nameserver values. The registry now describes
that WHOIS service as
[end of life](https://registrars.nominet.uk/uk-namespace/registration-and-domain-management/query-tools/whois/),
so this profile preserves transitional response compatibility while RDAP
remains the preferred source. It uses only the normal IANA referral path and
existing request budgets; WHOISleuth does not automate the registry website.

The [IANA `.es` delegation record](https://www.iana.org/domains/root/db/es.html)
publishes WHOIS but no RDAP service, while the registry's
[port-43 policy](https://www.dominios.es/es/sobre-dominios/valores-anadidos/whois-43)
requires the querying source IP to be registered in advance and applies strict
rate limits. The [IANA `.vn` delegation record](https://www.iana.org/domains/root/db/vn.html)
publishes neither domain WHOIS nor RDAP; VNNIC provides an
[official browser lookup](https://whois.vnnic.vn/) that is deliberately not
scraped or treated as a machine endpoint. These access states explain missing
registry evidence but do not establish that a domain is unregistered or safe.

Generic fixtures also verify registered, authoritative-not-found, and
rate-limited WHOIS states. RDAP normalization has separate fixture coverage for
thick and thin domain objects plus IPv4, IPv6, and autonomous-system objects;
suffix coverage remains dynamic because TLD managers publish their services in
the IANA bootstrap registry.

Authenticated users can browse the same explicit matrix in the **Registry
support** console reference. Its text and coverage filters run locally over the
embedded catalogue and make no registry or application API request. The page
does not test current reachability and does not turn compatibility metadata
into a registration, availability, ownership, safety, or maliciousness claim.

## Adding a registry adapter

An exceptional adapter should be added only after a sanitized fixture proves a
real gap. Record the suffix, required query profile, response encoding, parser
dialect, authority semantics, and covered outcomes in the capability registry.
Then add fixture cases for registered, unregistered, partial or redacted,
rate-limited, and malformed responses where those states can be represented.

Production integration must preserve IANA discovery, use existing SSRF-safe
transport and byte/time bounds, keep the source separately attributed, and
leave failed or unsupported enrichment inconclusive. Query profiles are scoped
to the first registry referral and require a fixture plus authoritative
protocol documentation. A non-UTF-8 response decoder additionally requires
fixture evidence before it can replace the default UTF-8 profile. Live
registries are never contacted by automated tests.
