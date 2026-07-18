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

The version 6 explicit matrix is:

| Suffix | Current WHOIS parser/fallback or access profile | Coverage |
| --- | --- | --- |
| `.au` | Eligibility and contact fields | Registered |
| `.br` | Registry owner/contact handles, compact dates, status, and nameservers | Registered |
| `.ca` | Standard colon fields with year-first slash dates | Registered |
| `.cz` | FRED contact-handle indirection | Registered |
| `.de` | First-referral domain-and-ACE query; alternate field labels | Registered |
| `.edu` | Indented contact blocks | Registered |
| `.es` | Plain WHOIS syntax; registry requires advance source-IP authorization; IANA publishes no RDAP service | Access documented |
| `.fi` | Dot-leader fields, dates, DNSSEC, registrar, status, and nameservers | Registered |
| `.fr` | AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered |
| `.gt` | Bounded registry-web fallback into the normal WHOIS parser | Registered, not found, unavailable |
| `.it` | Alternate field labels and bare nameserver section | Registered |
| `.jp` | First-referral English-output query; bracketed fields | Registered |
| `.kr` | Dot-leader fields and host-name nameservers | Registered |
| `.nz` | Structured underscore fields, numeric registry states, contacts, dates, DNSSEC, and numbered nameservers | Registered, available, temporary failure, restricted/inconclusive |
| `.pl` | NASK sectioned nameservers and registrar with dotted lifecycle dates | Registered, malformed |
| `.pt` | Domain, owner, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.ru` | TCI domain state, registrant organisation, registrar handle, dates, and nameservers | Registered |
| `.se` | Registry state, holder handle, registrar, lifecycle, DNSSEC, and nameservers | Registered |
| `.tr` | Prefixed dot-leader fields and bare nameserver section | Registered |
| `.uk` | Sectioned indented domain, registrant, registrar, status, date, and nameserver fields | Registered, not found, malformed |
| `.us` | Standard colon fields, registrar, lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.vn` | IANA publishes no domain WHOIS or RDAP service; official browser lookup is not integrated | Access documented |

The exceptional query formats are grounded in the registries' own protocol
guidance: the [`.de` WHOIS service guide](https://www.denic.de/en/services/whois-service/)
documents the domain-and-ACE query type, while the [`.jp` command-line
guide](https://jprs.jp/about/dom-search/jprs-whois/whois-guide-usage.html)
documents `/e` as the English-output suffix. The automated suite represents
both with synthetic responses and never contacts either registry.

The [`.nz` WHOIS protocol](https://docs.internetnz.nz/whois/) documents its
underscore field names, numbered nameservers, contact layout, and numeric
query states. WHOISleuth treats only `220 Available` as authoritative absence;
`200 Active` and `210 PendingRelease` remain positive registry existence
evidence, while prohibited, conflicted, reserved, and resolved states stay
inconclusive rather than being mislabeled as available. Temporary `4xx`
registry states are retained as failed-hop provenance and never as absence.

Version 6 adds one fixture-backed compatibility batch for ten ccTLDs: `.br`,
`.ca`, `.fi`, `.fr`, `.nz`, `.pl`, `.pt`, `.ru`, `.se`, and `.us`. The
registry-specific parsers remain narrow: terse `owner`, `org`, `holder`, and
`state` fields are interpreted only when the same response contains the
registry's distinguishing markers, preventing contact/address fields in an
unrelated dialect from being mislabeled. The `.pl` registrar and nameserver
sections retain their source text, while `.br` compact dates and `.ca`
year-first slash dates retain raw values and receive additive canonical ISO
companions. Per-source field, list, response-byte, and referral bounds are
unchanged.

The batch is grounded in the registries' own public service descriptions for
[`.br`](https://registro.br/tecnologia/ferramentas/whois/),
[`.ca`](https://www.cira.ca/en/ca-domains/whois/),
[`.fi`](https://www.traficom.fi/en/fi-domains/point-contact-and-contact-channels/whois-shows-public-information-domain-name),
[`.fr`](https://www.afnic.fr/en/domain-names-and-support/everything-there-is-to-know-about-domain-names/find-a-domain-name-or-a-holder-using-whois/),
[`.pl`](https://www.dns.pl/en/whois),
[`.pt`](https://www.dns.pt/fotos/editor2/pt_registration_rules_apos_consulta.pdf),
[`.ru`](https://cctld.ru/en/service/whois/),
[`.se`](https://internetstiftelsen.se/domaner/registrera-ett-domannamn/regler-och-beskrivning-av-domannamnssokningar/),
and [`.us`](https://www.about.us/faqs), plus IANA delegation records for
machine-service discovery. These sources describe the service and published
data; the synthetic fixtures verify parser behavior only and make no live
reachability or completeness claim.

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
embedded catalogue, and its local inspector resolves one domain or suffix to an
explicit profile or the generic IANA discovery-only fallback. Neither feature
makes a registry or application API request. The page does not test current
reachability and does not turn compatibility metadata into a registration,
availability, ownership, safety, or maliciousness claim.

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
