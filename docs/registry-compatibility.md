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

The version 2 explicit matrix is:

| Suffix | Current WHOIS parser/fallback profile | Fixture coverage |
| --- | --- | --- |
| `.au` | Eligibility and contact fields | Registered |
| `.cz` | FRED contact-handle indirection | Registered |
| `.de` | First-referral domain-and-ACE query; alternate field labels | Registered |
| `.edu` | Indented contact blocks | Registered |
| `.gt` | Bounded registry-web fallback into the normal WHOIS parser | Registered, not found, unavailable |
| `.it` | Alternate field labels and bare nameserver section | Registered |
| `.jp` | Bracketed bilingual fields | Registered |
| `.kr` | Dot-leader fields and host-name nameservers | Registered |
| `.tr` | Prefixed dot-leader fields and bare nameserver section | Registered |

Generic fixtures also verify registered, authoritative-not-found, and
rate-limited WHOIS states. RDAP normalization has separate fixture coverage for
thick and thin domain objects plus IPv4, IPv6, and autonomous-system objects;
suffix coverage remains dynamic because TLD managers publish their services in
the IANA bootstrap registry.

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
