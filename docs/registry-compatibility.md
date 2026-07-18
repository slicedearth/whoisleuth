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

The version 9 explicit matrix is:

| Suffix | Current WHOIS parser/fallback or access profile | Coverage |
| --- | --- | --- |
| `.ar` | Colon fields with registered, changed, and expiry timestamps | Registered |
| `.at` | Colon fields with compact date-time values | Registered |
| `.au` | Eligibility and contact fields | Registered |
| `.be` | Sectioned registrar and nameserver fields with textual registration dates | Registered |
| `.bg` | Registry status, sectioned bare nameservers, and DNSSEC state | Registered |
| `.br` | Registry owner/contact handles, compact dates, status, and nameservers | Registered |
| `.ca` | Standard colon fields with year-first slash dates | Registered |
| `.ch` | IANA-referred WHOIS may be policy-restricted; IANA publishes no RDAP service, and official web and non-standard-port Domain Check are not integrated | Access documented |
| `.cl` | Named registrant and registrar fields with lifecycle dates and nameservers | Registered |
| `.cn` | CNNIC ROID, sponsoring registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.cz` | FRED contact-handle indirection | Registered |
| `.de` | First-referral domain-and-ACE query; alternate field labels | Registered |
| `.dk` | Punktum domain/DNS distinction, hostname nameservers, lifecycle, DNSSEC, and multi-word status | Registered |
| `.edu` | Indented contact blocks | Registered |
| `.ee` | Section-scoped domain, contacts, registrar, lifecycle, status, and nameservers | Registered |
| `.es` | Plain WHOIS syntax; registry requires advance source-IP authorization; IANA publishes no RDAP service | Access documented |
| `.eu` | Sectioned registrar and nameserver fields | Registered |
| `.fi` | Dot-leader fields, dates, DNSSEC, registrar, status, and nameservers | Registered |
| `.fr` | AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered |
| `.gt` | Bounded registry-web fallback into the normal WHOIS parser | Registered, not found, unavailable |
| `.hr` | Standard colon lifecycle, registrar, contact, and nameserver fields | Registered |
| `.hu` | Minimal domain and record-created fields | Registered |
| `.id` | PANDI domain ID, sponsoring registrar organisation, lifecycle, status, DNSSEC, and nameservers | Registered |
| `.ie` | Standard colon fields with registry/contact identifiers, lifecycle, status, DNSSEC, and nameservers | Registered |
| `.il` | ISOC-IL validity date, DNSSEC, nameservers, changed date, and multi-word status | Registered |
| `.in` | Standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.is` | ISNIC registrant-handle role resolution, lifecycle, DNSSEC, and nameservers | Registered |
| `.it` | Alternate field labels and bare nameserver section | Registered |
| `.jp` | First-referral English-output query; bracketed fields | Registered |
| `.kr` | Dot-leader fields and host-name nameservers | Registered |
| `.lt` | Tab-aligned lifecycle, registrar, status, and nameserver fields | Registered |
| `.lv` | Bracketed domain and holder sections with nameservers | Registered |
| `.mx` | Colon fields with an indented registrant block and nameserver section | Registered |
| `.my` | Standard bounded domain, registrar, lifecycle, status, DNSSEC, and nameserver fields; public-query policy applies | Registered |
| `.nl` | Indented registrar, abuse-contact, and domain-nameserver sections with lifecycle and DNSSEC | Registered |
| `.no` | Norid dot-leader fields with separately scoped domain and registrar handles | Registered |
| `.nz` | Structured underscore fields, numeric registry states, contacts, dates, DNSSEC, and numbered nameservers | Registered, available, temporary failure, restricted/inconclusive |
| `.pl` | NASK sectioned nameservers and registrar with dotted lifecycle dates | Registered, malformed |
| `.pt` | Domain, owner, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.ro` | Colon fields with one-word nameserver labels, lifecycle, registrar, and DNSSEC | Registered |
| `.rs` | Multi-word status, local lifecycle timestamps, contacts, DNSSEC, and DNS nameserver fields | Registered |
| `.ru` | TCI domain state, registrant organisation, registrar handle, dates, and nameservers | Registered |
| `.se` | Registry state, holder handle, registrar, lifecycle, DNSSEC, and nameservers | Registered |
| `.sg` | Standard colon fields with day-month-name timestamps, status, DNSSEC, and nameservers | Registered |
| `.si` | Domain, privacy-preserving holder, registrar, lifecycle, status, and nameserver fields | Registered |
| `.sk` | Domain, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.tr` | Prefixed dot-leader fields and bare nameserver section | Registered |
| `.tw` | TWNIC record dates, registration service provider, status, registrant, and nameservers | Registered |
| `.ua` | Domain, registrar, source, lifecycle, status, and nameserver fields | Registered |
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

Version 7 adds fixture-backed compatibility for `.at`, `.be`, `.cl`, `.eu`,
`.ie`, `.in`, `.mx`, `.no`, `.ro`, and `.sg`. The shared date parser now
normalizes compact timestamps, day-month-name timestamps, and the bounded
English textual registration date used by the Belgian fixture while retaining
each source value unchanged. Sectioned registrar names are read only from an
exact indented `Name` subfield, Belgian multi-word statuses remain intact, and
Norid domain and registrar handles are interpreted only when the response has
the documented domain-information markers. Nameserver handles are deliberately
not promoted to hostnames. These are additive parsing changes: IANA discovery,
referral authority, response limits, and availability decisions are unchanged.

The batch is grounded in official service, policy, or field-publication
material for [`.at`](https://www.nic.at/en/my-at-domain/domain-search/whois),
[`.be`](https://www.dnsbelgium.be/en/our-role/registry-registrar-registrant),
[`.cl`](https://www.nic.cl/normativa/politica-publicacion-de-datos-cl.pdf),
[`.eu`](https://eurid.eu/d/22380/whois_policy_en.pdf),
[`.ie`](https://www.weare.ie/wp-content/uploads/2023/12/WHOIS-Services-Policy-2023.pdf),
[`.in`](https://www.registry.in/policies),
[`.mx`](https://www.dominios.mx/whois/),
[`.no`](https://teknisk.norid.no/uploads/2018/08/Whois_DAS_Interface_Specification.10e1.pdf),
[`.ro`](https://www.rotld.ro/reguli-de-inregistrare/), and
[`.sg`](https://www.sgnic.sg/docs/default-source/policies-and-agreements/whois-policy.pdf),
plus their IANA delegation records for endpoint discovery. Norid publishes an
exact port-43 response specification; the other sources establish public
service and field expectations, while the sanitized fixtures test only the
bounded parser behavior represented here. They do not prove current registry
reachability, completeness, ownership, activity, safety, or maliciousness.

Version 8 adds fixture-backed compatibility for `.ar`, `.cn`, `.dk`, `.id`,
`.il`, `.my`, `.si`, `.sk`, `.tw`, and `.ua`. Distinctive aliases are enabled
only by bounded marker sets: CNNIC `ROID`, PANDI `Domain ID`, ISOC-IL
`validity`, and TWNIC record dates and service-provider fields cannot be
promoted in unrelated responses. Punktum's `DNS:` line identifies the queried
`.dk` domain rather than a nameserver, so the profile deliberately collects
only its sectioned `Hostname:` values. The shared date parser adds the
unambiguous day-first `DD-MM-YYYY` shape while retaining every raw source value,
and token statuses now preserve bounded digits, underscores, and hyphens.

The batch is grounded in official service, policy, or field-publication
material for [`.ar`](https://nic.ar/index.php/en/whois),
[`.cn`](https://www2.cnnic.cn/2/3/index.html),
[`.dk`](https://punktum.dk/en/articles/additional-services),
[`.id`](https://pandi.id/public/files/2024/9/kebijakan-umum-nama-domain-versi-7-0-bilingual-1727681641.pdf),
[`.il`](https://en.isoc.org.il/whois),
[`.my`](https://mynic.my/WHOIS),
[`.si`](https://www.register.si/en/disclosure-of-information-about-a-si-domain-holder/),
[`.sk`](https://sk-nic.sk/en/faq-en/general/),
[`.tw`](https://www.twnic.tw/dnservice/policy/?lang=en), and
[`.ua`](https://www.hostmaster.ua/policy/Reglament_UA_1.0_EN.pdf), plus their
IANA delegation records for endpoint discovery. MYNIC's public policy limits
query volume and warns that a missing result does not establish availability;
WHOISleuth preserves bounded requests and authority-aware interpretation. As
with every compatibility profile, sanitized fixtures prove parser behavior
only, not current registry reachability, completeness, ownership, activity,
safety, or maliciousness.

Version 9 adds fixture-backed compatibility for `.bg`, `.ee`, `.hr`, `.hu`,
`.is`, `.lt`, `.lv`, `.nl`, and `.rs`, plus an access-documented `.ch`
profile. New aliases remain marker-gated: generic `name`, `role`, `org id`,
`record created`, `registration status`, and bracketed holder fields are read
only from their registry's distinctive bounded sections. ISNIC contact handles
remain separately typed and resolve only to an adjacent matching role block;
SIDN and Register.BG bare nameserver sections are capped by the existing
nameserver limit. The shared date parser now accepts ISNIC's bounded English
month form and the space before a numeric timezone published by the Estonian
registry. Raw dates remain unchanged beside additive ISO companions.

The fixture-backed profiles are grounded in official service or
field-publication material for [`.bg`](https://www.register.bg/),
[`.ee`](https://www.internet.ee/domains/whois-terms-and-conditions),
[`.hr`](https://domene.hr/en/portal/home),
[`.hu`](https://www.domain.hu/domain-search/),
[`.is`](https://www.isnic.is/en/about/copyright),
[`.lt`](https://www.domreg.lt/en/faq/for-domain-registrants/how-to-access-public-information-on-domains/),
[`.lv`](https://www.nic.lv/whois?lang=en),
[`.nl`](https://www.sidn.nl/en/nl-domain-name/looking-up-a-domain-name), and
[`.rs`](https://www.rnids.rs/en/domain-names), plus their IANA delegation
records for endpoint discovery. These sources describe the public services and
published evidence; sanitized fixtures verify bounded parser behavior only.
They do not prove current reachability, completeness, ownership, activity,
safety, or maliciousness.

For `.ch`, IANA still publishes the registry's port-43 referral, but the
registry can deny ordinary clients and direct them to its
[official lookup](https://www.nic.ch/whois/). SWITCH separately documents an
automated [Domain Check](https://www.nic.ch/whois/domaincheck/) on port 4343;
WHOISleuth does not replace IANA's referral with that non-standard endpoint or
scrape the browser lookup, and IANA publishes no RDAP service for the suffix.
The catalogue therefore records the policy
restriction without claiming fixture verification, and a denied or absent
response remains inconclusive.

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
