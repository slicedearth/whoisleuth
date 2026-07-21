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
  an endpoint or collection constraint without fixture-verified parser behavior,
  or publishes no machine endpoint. It describes collection conditions only and
  is never evidence about domain availability.

## Generic TLD service coverage

Generic TLDs use live IANA RDAP bootstrap discovery and shared bounded RDAP
parsing. WHOISleuth does not create a duplicate parser profile for each suffix.
The version 26 catalogue includes an official-source snapshot verified on 19
July 2026: all 1,113 current generic and generic-restricted TLDs were present in
the IANA RDAP bootstrap, as were 12 of 14 sponsored TLDs. `.edu` and `.mil` are
the sponsored exceptions, while the infrastructure suffix `.arpa` has no RDAP
bootstrap service. The dated snapshot describes published coverage only. It is
not a live reachability, registration, availability, ownership, safety, or
maliciousness result.

The version 26 explicit matrix is:

| Suffix | Current WHOIS parser/fallback or access profile | Coverage |
| --- | --- | --- |
| `.ac` | Shared standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.ad` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered, not found |
| `.ae` | Registry domain, registrar, contact identifiers, status, and nameservers | Registered |
| `.af` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.ag` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.ai` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.al` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.am` | Indented registrant and contact blocks with lifecycle, status, registrar, and DNS-server section | Registered |
| `.ao` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.aq` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ar` | Colon fields with registered, changed, and expiry timestamps | Registered, not found |
| `.arpa` | Infrastructure suffix with IANA WHOIS metadata and no RDAP bootstrap service; not ordinary public registration space | Access documented |
| `.as` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.at` | Colon fields with compact date-time values | Registered, not found |
| `.au` | Eligibility and contact fields | Registered |
| `.aw` | Authoritative free-domain response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.ax` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.az` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ba` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.bb` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.bd` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.be` | Sectioned registrar and nameserver fields with textual registration dates | Registered |
| `.bf` | Standard colon fields with registry identity, lifecycle, registrar, status, and nameservers; IANA publishes no RDAP service | Registered |
| `.bg` | Registry status, sectioned bare nameservers, and DNSSEC state | Registered, not found |
| `.bh` | Standard colon fields with lifecycle, registrar, contacts, status, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.bi` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.bj` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.bm` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.bn` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.bo` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.br` | Registry owner/contact handles, compact dates, status, and nameservers | Registered, not found |
| `.bs` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.bt` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.bv` | Registration is not open and IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.bw` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.by` | Colon fields with organisation identifier, lifecycle, registrar, and nameservers | Registered |
| `.bz` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ca` | Standard colon fields with year-first slash dates | Registered, not found |
| `.cc` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered, not found |
| `.cd` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.cf` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.cg` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ch` | IANA-referred WHOIS may be policy-restricted; IANA publishes no RDAP service, and official web and non-standard-port Domain Check are not integrated | Access documented |
| `.ci` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.ck` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.cl` | Named registrant and registrar fields with lifecycle dates and nameservers | Registered, not found |
| `.cm` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.cn` | CNNIC ROID, sponsoring registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.co` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.cr` | Contact-handle indirection with lifecycle, registrar, and nameservers; IANA RDAP is also available | Registered, not found |
| `.cu` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.cv` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.cw` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.cx` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.cy` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.cz` | FRED contact-handle indirection | Registered, not found |
| `.de` | First-referral domain-and-ACE query; alternate field labels | Registered |
| `.dj` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.dk` | Punktum domain/DNS distinction, hostname nameservers, lifecycle, DNSSEC, and multi-word status | Registered |
| `.dm` | Standard colon fields with registry identity, lifecycle, registrar, status, and nameservers; IANA publishes no RDAP service | Registered |
| `.do` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.dz` | Compact colon fields with registrar and contact roles; IANA publishes no RDAP service | Registered, not found |
| `.ec` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.edu` | Sponsored WHOIS-only service with indented contact blocks; IANA publishes no RDAP service | Registered |
| `.ee` | Section-scoped domain, contacts, registrar, lifecycle, status, and nameservers | Registered, not found |
| `.eg` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.er` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.es` | Plain WHOIS syntax; registry requires advance source-IP authorization; IANA publishes no RDAP service | Access documented |
| `.et` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.eu` | Sectioned registrar and nameserver fields | Registered, not found |
| `.fi` | Dot-leader fields, dates, DNSSEC, registrar, status, and nameservers | Registered, not found |
| `.fj` | Standard colon fields with lifecycle, registrar, status, and nameservers; IANA RDAP is also available | Registered |
| `.fk` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.fm` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.fo` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.fr` | AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.ga` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gb` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gd` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.ge` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.gf` | Shared MediaServ object fields with changed date and nameservers | Registered, not found |
| `.gg` | Shared sectioned domain, registrant, registrar, ordinal registration date, status, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.gh` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.gi` | Shared standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers | Registered, not found |
| `.gl` | Standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.gm` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gn` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.gp` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.gq` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.gr` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gs` | Authoritative no-object response with separate RDAP availability; registered-field parsing is not claimed | Not found |
| `.gt` | Bounded registry-web fallback into the normal WHOIS parser | Registered, not found, unavailable |
| `.gu` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gw` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.gy` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.hk` | Sectioned domain, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered, not found |
| `.hm` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.hn` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.hr` | Standard colon lifecycle, registrar, contact, and nameserver fields | Registered, not found |
| `.ht` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.hu` | Minimal domain and record-created fields | Registered |
| `.id` | PANDI domain ID, sponsoring registrar organisation, lifecycle, status, DNSSEC, and nameservers | Registered |
| `.ie` | Standard colon fields with registry/contact identifiers, lifecycle, status, DNSSEC, and nameservers | Registered, not found |
| `.il` | ISOC-IL validity date, DNSSEC, nameservers, changed date, and multi-word status | Registered |
| `.im` | Authoritative domain-not-found response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.in` | Standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.io` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.iq` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.ir` | IRNIC contact-handle indirection, nameservers, and separately typed role identifiers | Registered |
| `.is` | ISNIC registrant-handle role resolution, lifecycle, DNSSEC, and nameservers | Registered, not found |
| `.it` | Alternate field labels and bare nameserver section | Registered |
| `.je` | Shared sectioned domain, registrant, registrar, ordinal registration date, status, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.jm` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.jo` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.jp` | First-referral English-output query; bracketed fields | Registered |
| `.ke` | Standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.kg` | Marker-gated sectioned domain status, record lifecycle, and bounded bare nameservers; IANA RDAP is also available | Registered |
| `.kh` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ki` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.km` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.kn` | Standard colon fields with registry identity, lifecycle, registrar, status, and nameservers; IANA publishes no RDAP service | Registered |
| `.kp` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.kr` | Dot-leader fields and host-name nameservers | Registered |
| `.kw` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ky` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.kz` | Dot-leader lifecycle, registrar, multi-word status, and primary/secondary nameservers | Registered |
| `.la` | Shared standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers | Registered, not found |
| `.lb` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.lc` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.li` | Official registry lookup and non-standard-port Domain Check are not integrated; IANA publishes no RDAP service | Access documented |
| `.lk` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.lr` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.ls` | Contact-handle indirection with lifecycle, registrar, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.lt` | Tab-aligned lifecycle, registrar, status, and nameserver fields | Registered |
| `.lu` | Hyphenated registrar fields, domain type, and nameservers | Registered |
| `.lv` | Bracketed domain and holder sections with nameservers | Registered, not found |
| `.ly` | Standard colon fields with registry identity, lifecycle, registrar, status, and nameservers; IANA RDAP is also available | Registered |
| `.ma` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.mc` | Aligned colon fields with lifecycle, registrar, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.md` | Spaced domain label, lifecycle, domain state, DNSSEC, and nameservers | Registered |
| `.me` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.mg` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.mh` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.mil` | Sponsored suffix with no IANA-published public domain WHOIS or RDAP service | Access documented |
| `.mk` | Shared MARNET contact-handle indirection, lifecycle, registrar, and nameservers | Registered, not found |
| `.ml` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.mm` | Standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.mn` | Standard colon fields with lifecycle, contacts, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered |
| `.mo` | Shared MONIC domain, record-created timestamp, and nameserver section | Registered, not found |
| `.mp` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.mq` | Shared MediaServ object fields with changed date and nameservers | Registered, not found |
| `.mr` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered |
| `.ms` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.mt` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.mu` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.mv` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.mw` | Contact-handle indirection with lifecycle, registrar, and nameservers; IANA publishes no RDAP service | Registered |
| `.mx` | Colon fields with an indented registrant block and nameserver section | Registered |
| `.my` | Standard bounded domain, registrar, lifecycle, status, DNSSEC, and nameserver fields; public-query policy applies | Registered |
| `.mz` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.na` | IANA publishes RDAP but no domain WHOIS referral | Access documented |
| `.nc` | Authoritative registry no-entry response; registered-field parsing is not claimed | Not found |
| `.ne` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.nf` | Authoritative no-object response with separate RDAP availability; registered-field parsing is not claimed | Not found |
| `.ng` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.ni` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.nl` | Indented registrar, abuse-contact, and domain-nameserver sections with lifecycle and DNSSEC | Registered, not found |
| `.no` | Norid dot-leader fields with separately scoped domain and registrar handles | Registered, not found |
| `.np` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.nr` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.nu` | Shared Internetstiftelsen state, holder, lifecycle, registrar, DNSSEC, and nameserver fields; IANA publishes no RDAP service | Registered |
| `.nz` | Structured underscore fields, numeric registry states, contacts, dates, DNSSEC, and numbered nameservers | Registered, available, temporary failure, restricted/inconclusive |
| `.om` | Standard colon fields with registry identity, registrar, registrant, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.pa` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.pe` | Standard colon fields with registrar, status, registrant, and nameservers; IANA publishes no RDAP service | Registered |
| `.pf` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.pg` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.ph` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.pk` | Compact domain, lifecycle, status, and nameserver fields | Registered |
| `.pl` | NASK sectioned nameservers and registrar with dotted lifecycle dates | Registered, malformed |
| `.pm` | Shared AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.pn` | IANA publishes RDAP but no domain WHOIS referral | Access documented |
| `.pr` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.ps` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.pt` | Domain, owner, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.pw` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.py` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.qa` | Aligned colon fields with modified date, registrar, status, and nameservers; IANA publishes no RDAP service | Registered |
| `.re` | Shared AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.ro` | Colon fields with one-word nameserver labels, lifecycle, registrar, and DNSSEC | Registered |
| `.rs` | Multi-word status, local lifecycle timestamps, contacts, DNSSEC, and DNS nameserver fields | Registered, not found |
| `.ru` | TCI domain state, registrant organisation, registrar handle, dates, and nameservers | Registered, not found |
| `.rw` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.sa` | Compact domain, registrant, DNSSEC, and nameserver fields | Registered |
| `.sb` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.sc` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.sd` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.se` | Registry state, holder handle, registrar, lifecycle, DNSSEC, and nameservers | Registered, not found |
| `.sg` | Standard colon fields with day-month-name timestamps, status, DNSSEC, and nameservers | Registered |
| `.sh` | Authoritative no-record response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.si` | Domain, privacy-preserving holder, registrar, lifecycle, status, and nameserver fields | Registered, not found |
| `.sj` | Registration is not open and IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.sk` | Domain, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered, not found |
| `.sl` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.sm` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.sn` | Authoritative registry not-found response with separate RDAP availability; registered-field parsing is not claimed | Not found |
| `.so` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.sr` | Colon fields with lifecycle, sponsoring registrar, status, contacts, and nameservers; IANA RDAP is also available | Registered |
| `.ss` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.st` | Standard colon fields with lifecycle, registrar, status, and nameservers; IANA publishes no RDAP service | Registered |
| `.su` | Shared TCI domain state, registrant organisation, registrar handle, dates, and nameservers | Registered, not found |
| `.sv` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.sx` | Standard colon fields with registry identity, lifecycle, registrar, status, and contacts; IANA publishes no RDAP service | Registered |
| `.sy` | Standard colon fields with lifecycle, sponsoring registrar, status, DNSSEC, and nameservers; IANA publishes no RDAP service | Registered |
| `.sz` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.tc` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.td` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.tf` | Shared AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.tg` | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.th` | Holder organisation/address, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.tj` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.tk` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.tl` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.tm` | Authoritative available-for-purchase response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.tn` | Dot-leader domain, lifecycle, registrar, status, and DNSSEC fields | Registered |
| `.to` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.tr` | Prefixed dot-leader fields and bare nameserver section | Registered |
| `.tt` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.tv` | Standard colon fields with registry identity, lifecycle, registrar, and status; IANA RDAP is also available | Registered |
| `.tw` | TWNIC record dates, registration service provider, status, registrant, and nameservers | Registered |
| `.tz` | Contact-handle indirection with lifecycle, registrar, and nameservers; IANA RDAP is also available | Registered |
| `.ua` | Domain, registrar, source, lifecycle, status, and nameserver fields | Registered |
| `.ug` | Aligned colon fields with lifecycle, status, contacts, and nameservers; IANA publishes no RDAP service | Registered |
| `.uk` | Sectioned indented domain, registrant, registrar, status, date, and nameserver fields | Registered, not found, malformed |
| `.us` | Standard colon fields, registrar, lifecycle, contacts, status, DNSSEC, and nameservers | Registered |
| `.uy` | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.uz` | Standard colon fields with lifecycle, registrar, status, and nameservers; IANA RDAP is also available | Registered |
| `.va` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.vc` | Shared standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers | Registered, not found |
| `.ve` | Contact-handle indirection with lifecycle, registrar, and nameservers; IANA publishes no RDAP service | Registered |
| `.vg` | Authoritative registry object-missing response with separate RDAP availability; registered-field parsing is not claimed | Not found |
| `.vi` | IANA publishes WHOIS and RDAP discovery, but WHOIS response behavior is not fixture verified | Access documented |
| `.vn` | IANA publishes no domain WHOIS or RDAP service; official browser lookup is not integrated | Access documented |
| `.vu` | Authoritative no-data response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.wf` | Shared AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.ws` | Standard colon fields with registry identity, lifecycle, registrar, contacts, and status; IANA publishes no RDAP service | Registered |
| `.xn--2scrj9c` (`.ಭಾರತ`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--3e0b707e` (`.한국`) | Shared KISA dot-leader fields and host-name nameservers | Registered |
| `.xn--3hcrj9c` (`.ଭାରତ`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--45br5cyl` (`.ভাৰত`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--45brj9c` (`.ভারত`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--4dbrk0ce` (`.ישראל`) | Shared ISOC validity, lifecycle, multi-word status, and nameserver fields | Registered |
| `.xn--54b7fta0cc` (`.বাংলা`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--80ao21a` (`.қаз`) | Shared NIC.KZ dot-leader lifecycle, registrar, status, and nameserver fields | Registered |
| `.xn--90a3ac` (`.срб`) | Shared RNIDS multi-word status, lifecycle, contact, DNSSEC, and nameserver fields | Registered, not found |
| `.xn--90ae` (`.бг`) | First-referral Unicode-domain query with sectioned status, DNSSEC, and nameserver fields; IANA publishes no RDAP service | Registered, not found |
| `.xn--90ais` (`.бел`) | Shared Belarusian organisation identifier, lifecycle, registrar, and nameserver fields | Registered |
| `.xn--clchc0ea0b2g2a9gcd` (`.சிங்கப்பூர்`) | Shared SGNIC standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--d1alf` (`.мкд`) | Shared MARNET contact-handle indirection, lifecycle, registrar, and nameservers | Registered, not found |
| `.xn--e1a4c` (`.ею`) | Shared EURid sectioned registrar and nameserver fields | Registered, not found |
| `.xn--fiqs8s` (`.中国`) | Shared CNNIC ROID, sponsoring registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.xn--fiqz9s` (`.中國`) | Shared CNNIC ROID, sponsoring registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered |
| `.xn--fpcrj9c3d` (`.భారత్`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--fzc2c9e2c` (`.ලංකා`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--gecrj9c` (`.ભારત`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--h2breg3eve` (`.भारतम्`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--h2brj9c` (`.भारत`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--h2brj9c8c` (`.भारोत`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--j1amh` (`.укр`) | Authoritative no-match response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.xn--j6w193g` (`.香港`) | Shared HKIRC sectioned domain, registrar, lifecycle, status, DNSSEC, and nameserver fields | Registered, not found |
| `.xn--kprw13d` (`.台湾`) | Shared TWNIC record dates, service provider, status, registrant, and nameserver fields | Registered |
| `.xn--kpry57d` (`.台灣`) | Shared TWNIC record dates, service provider, status, registrant, and nameserver fields | Registered |
| `.xn--l1acc` (`.мон`) | Shared standard colon fields from the exact `.mn` WHOIS service; IANA publishes no RDAP service | Registered |
| `.xn--lgbbat1ad8j` (`.الجزائر`) | Shared Algerian compact colon fields with registrar and contact roles; IANA publishes no RDAP service | Registered, not found |
| `.xn--mgb9awbf` (`.عمان`) | Shared Omani standard colon fields with registry identity, registrar, registrant, and nameservers; IANA publishes no RDAP service | Registered, not found |
| `.xn--mgba3a4f16a` (`.ایران`) | Shared IRNIC contact-handle indirection and nameservers | Registered |
| `.xn--mgbaam7a8h` (`.امارات`) | Shared standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers | Registered |
| `.xn--mgbah1a3hjkrd` (`.موريتانيا`) | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.xn--mgbai9azgqp6j` (`.پاکستان`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--mgbayh7gpa` (`.الاردن`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--mgbbh1a` (`.بارت`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--mgbbh1a71e` (`.بھارت`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--mgbc0a9azcg` (`.المغرب`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--mgbcpq6gpa1a` (`.البحرين`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--mgberp4a5d4ar` (`.السعودية`) | Shared compact domain, registrant, DNSSEC, and nameserver fields | Registered |
| `.xn--mgbgu82a` (`.ڀارت`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--mgbpl2fh` (`.سودان`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--mgbtx2b` (`.عراق`) | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.xn--mgbx4cd0ab` (`.مليسيا`) | Shared standard bounded domain, registrar, lifecycle, status, DNSSEC, and nameserver fields; public-query policy applies | Registered |
| `.xn--mix891f` (`.澳門`) | Shared MONIC domain, record-created timestamp, and nameserver section | Registered, not found |
| `.xn--node` (`.გე`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--o3cw4h` (`.ไทย`) | Shared THNIC holder, lifecycle, registrar, status, DNSSEC, and nameserver fields | Registered |
| `.xn--ogbpf8fl` (`.سورية`) | Authoritative no-object response; registered-field parsing is not claimed and IANA publishes no RDAP service | Not found |
| `.xn--p1ai` (`.рф`) | Shared TCI domain state, registrant organisation, registrar handle, dates, and nameservers | Registered, not found |
| `.xn--pgbs0dh` (`.تونس`) | Shared dot-leader domain, lifecycle, registrar, status, and DNSSEC fields | Registered |
| `.xn--q7ce6a` (`.ລາວ`) | Shared LANIC standard colon fields with lifecycle, registrar, status, DNSSEC, and nameservers | Registered, not found |
| `.xn--qxa6a` (`.ευ`) | Shared EURid sectioned registrar and nameserver fields | Registered, not found |
| `.xn--qxam` (`.ελ`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--rvc1e0am3e` (`.ഭാരതം`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--s9brj9c` (`.ਭਾਰਤ`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--wgbh1c` (`.مصر`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--wgbl6a` (`.قطر`) | Shared standard colon fields and authoritative no-data response from the exact `.qa` WHOIS service; IANA publishes no RDAP service | Registered, not found |
| `.xn--xkc2al3hye2a` (`.இலங்கை`) | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.xn--xkc2dl3a5ee0h` (`.இந்தியா`) | Shared NIXI standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--y9a3aq` (`.հայ`) | Shared AMNIC registrant/contact blocks with lifecycle, status, registrar, and DNS servers | Registered |
| `.xn--yfro4i67o` (`.新加坡`) | Shared SGNIC standard colon fields with lifecycle, status, DNSSEC, and nameservers | Registered |
| `.xn--ygbi2ammx` (`.فلسطين`) | IANA publishes a WHOIS referral, but response behavior is not fixture verified and IANA publishes no RDAP service | Access documented |
| `.ye` | Standard colon fields with registrar and nameservers; IANA RDAP is also available | Registered |
| `.yt` | Shared AFNIC contact handles, EPP status, lifecycle dates, and nameservers | Registered, not found |
| `.za` | IANA publishes no domain WHOIS or RDAP service | Access documented |
| `.zm` | Standard colon fields with registry identity, lifecycle, registrar, status, DNSSEC, and nameservers; IANA RDAP is also available | Registered |
| `.zw` | IANA publishes no domain WHOIS or RDAP service | Access documented |

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

Version 10 adds a 25-suffix batch. Nineteen fixture-backed profiles cover
`.ae`, `.af`, `.ai`, `.am`, `.by`, `.co`, `.hk`, `.io`, `.ir`, `.ke`, `.kz`,
`.lu`, `.md`, `.me`, `.mn`, `.pk`, `.sa`, `.th`, and `.tn`. Conventional
ICANN-style responses continue through the existing bounded colon parser;
only ambiguous departures receive new marker-gated handling. Those departures
include AMNIC contact/DNS-server sections, HKIRC's commencement date and bare
nameserver section, IRNIC handle-linked contacts, Kazakhstan's dot-leader
server and registrar labels, Luxembourg's hyphenated fields, Moldova's spaced
domain label and state, and THNIC holder fields. Terse `org`, `person`,
`registrar-name`, `Current Registar`, and holder labels are not interpreted
unless the surrounding registry markers are all present.

The shared date parser now validates and normalizes three additional bounded
forms while preserving the raw values: Kazakhstan's parenthesized GMT offset,
Tunisia's explicit GMT offset, and THNIC's day-month-name date. Calendar and
offset components are range-checked before an additive ISO companion is
created. Registry response, referral, field, contact-block, nameserver, status,
and string caps are unchanged.

IANA currently publishes no domain WHOIS or RDAP service for `.al`, `.ba`,
`.cy`, `.gr`, `.ph`, or `.za`. Version 10 records those six suffixes as
access-documented rather than claiming parser coverage or interpreting missing
data as availability. IANA bootstrap remains authoritative for every endpoint;
the `.ai`, `.ke`, and `.th` profiles retain their published RDAP paths alongside
WHOIS, while the remaining fixture-backed profiles use the published WHOIS
referral. The service inventory is grounded in the corresponding
[IANA root-zone records](https://www.iana.org/domains/root/db), with additional
registry documentation linked from the embedded capability catalogue.
Sanitized fixtures prove only the represented parser behavior, not current
reachability, completeness, ownership, activity, safety, or maliciousness.

Version 11 adds authoritative negative-response fixtures for twelve existing
ccTLD profiles: `.at`, `.br`, `.ca`, `.cz`, `.eu`, `.fi`, `.fr`, `.ie`, `.nl`,
`.no`, `.ru`, and `.se`. Each fixture keeps IANA referral discovery intact and
places the negative dialect only at the referred registry hop. Downstream
registrar text still cannot overturn a registry decision, and a timeout,
restriction, malformed response, undocumented phrase, or missing service
remains inconclusive.

Ten dialects use the existing bounded negative vocabulary. Two additional
line-oriented forms are deliberately exact: NIC.AT's percent-prefixed
`nothing found` response and SIDN's `<domain> is free` response. They match only
complete bounded lines, so descriptive prose about a free service or an empty
cache cannot become availability evidence. The fixture shapes are grounded in
the registries' public WHOIS services and the official service or protocol
material linked from the capability catalogue. Automated tests remain wholly
offline and retain no third-party registration data.

Version 12 adds a second authoritative negative-response batch for eleven
existing ccTLD profiles: `.ar`, `.bg`, `.cl`, `.ee`, `.hk`, `.hr`, `.is`,
`.lv`, `.rs`, `.si`, and `.sk`. Nine dialects remain inside the established
bounded vocabulary for explicit not-found, no-entry, `Status: available`, or
`Status: free` responses. The Argentine Spanish response and Hong Kong
unregistered response are recognized only as complete lines; longer prose that
contains the same words remains non-authoritative context.

As with version 11, each synthetic response appears only at the IANA-referred
registry hop. The fixtures add no endpoint overrides or network requests, and
do not change fast, compact, or deep lookup budgets. A denied, empty,
rate-limited, malformed, or undocumented response remains inconclusive, and
automated verification never contacts a registry.

Version 12 also hardens two legacy parser edges without broadening authority.
Repeated Kazakhstan primary or secondary server lines are retained only up to
the existing nameserver cap with explicit truncation, and indented legacy
registrant headers are recognized case-insensitively like the adjacent contact
roles. Bare numeric hyphen dates remain deliberately day-first for the
currently profiled sources; a future month-first source requires a separately
gated parser rather than changing that shared interpretation.

Version 13 extends twelve existing fixture-backed registry families to 27
additional active country-code suffixes. Twenty-six are IDN A-labels, and
`.su` shares the same published WHOIS endpoint as the existing `.ru` family.
Each added suffix has its own IANA delegation reference, resolves from Unicode
or A-label input to a suffix-correct catalogue row, and reuses the bounded
parser fixture for the same official WHOIS endpoint. The catalogue does not
hard-code those endpoints: live discovery still follows IANA bootstrap and
referral data, and fixture coverage does not claim current reachability or
field completeness.

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

Version 14 adds twelve suffix-correct profiles from independently verified
operator families. AFNIC documents one WHOIS service for `.fr`, `.re`, `.tf`,
`.yt`, `.pm`, and `.wf`; SGNIC documents separate port-43 and RDAP services for
`.sg`, `.சிங்கப்பூர்`, and `.新加坡`; and IANA identifies `.ac` and `.io` under
the same registry operator with published port-43 services. The eight new
fixture-backed suffixes reuse only their family's existing bounded parser.
Discovery still follows the live IANA referral or bootstrap entry for the
queried suffix, so the catalogue does not substitute a shared hard-coded
endpoint.

The supporting sources are the registries' official
[AFNIC WHOIS scope](https://www.afnic.fr/en/domain-names-and-support/everything-there-is-to-know-about-domain-names/find-a-domain-name-or-a-holder-using-whois/),
[SGNIC registrar service guide](https://www.sgnic.sg/faq/being-a-registrar),
and the relevant [IANA root-zone records](https://www.iana.org/domains/root/db).
Manager commonality alone is not treated as parser evidence. Synthetic fixture
reuse is declared only where the operator documentation and IANA service data
support the same family relationship.

Four additional access-only rows keep missing collection explicit. SWITCH's
[official lookup](https://www.nic.ch/whois/) covers both `.ch` and `.li`, while
the non-standard Domain Check is not integrated. IANA publishes no domain
WHOIS or RDAP service for `.ελ`.
[Norid documents](https://www.norid.no/en/omnorid/) that `.bv` and `.sj` have
not been opened for registrations, and IANA publishes no domain machine
service for either suffix. These facts are context only; WHOISleuth does not
convert a missing response or closed policy into a live availability result.

Version 14 also narrows WHOIS throttle detection to explicit, bounded response
lines. A registry can describe throttling in its terms of use without causing
the current query to be classified as rate-limited. Explicit messages such as
query-limit errors still take precedence over echoed domain fields, while
policy prose no longer overrides positive or authoritative not-found evidence.
This changes interpretation only; request budgets, endpoint discovery, and
stored evidence remain unchanged.

Version 15 records 20 additional active country-code suffixes for which the
current IANA root records publish neither a domain WHOIS server nor an RDAP
bootstrap service: `.ao`, `.az`, `.bb`, `.bd`, `.bs`, `.bt`, `.bz`, `.cd`,
`.cg`, `.ck`, `.cu`, `.cw`, `.dj`, `.eg`, `.et`, `.fk`, `.gm`, `.gu`, `.jo`,
and `.kh`. Each row links to its suffix-specific IANA delegation record and is
classified as access documented, not fixture verified. WHOISleuth does not
substitute a registry website or registration URL for a machine endpoint.
Missing registry evidence for these suffixes therefore remains inconclusive
and cannot decide availability, ownership, activity, safety, or maliciousness.

Version 16 added access documentation for 34 further active country-code
delegations whose IANA records published neither domain WHOIS nor RDAP at that
audit: `.aq`, `.er`, `.ga`, `.gb`, `.gw`, `.jm`, `.km`, `.kp`,
`.kw`, `.lc`, `.lk`, `.lr`, `.mh`, `.mp`, `.mt`, `.mv`, `.ne`, `.ni`,
`.np`, `.nr`, `.pa`, `.ps`, `.py`, `.sl`, `.sv`, `.sz`, `.tj`, `.tt`,
`.va`, `.বাংলা`, `.ලංකා`, `.გე`, `.இலங்கை`, and `.zw`. Each ASCII or IDN
suffix keeps its own IANA delegation record as provenance. This classification
describes the absence of a published machine endpoint at the 18 July 2026
audit; it is not a claim that the registry has no browser service, that the
suffix is closed, or that any queried domain is available.

Version 17 adds fixture-backed coverage for ten ccTLD delegations across five
shared port-43 services: `.gf` and `.mq`, `.gi` and `.vc`, `.mk` and `.мкд`,
`.mo` and `.澳門`, and `.la` and `.ລາວ`. Each family is backed by its exact
shared WHOIS endpoint in the current IANA delegation records and by sanitized
registered and authoritative-not-found response fixtures. The MediaServ object
layout and MARNET contact-handle layout reuse existing bounded field parsing;
MONIC's unlabelled record-created timestamp and nameserver section are enabled
only behind the service's complete response-marker set.

Version 18 adds fixture-backed compatibility for eleven further active ccTLD
delegations: `.ad`, `.bh`, `.cc`, `.cr`, `.dz`, `.gg`, `.gl`, `.je`, `.ls`,
`.mc`, and `.mm`. Sanitized registered and authoritative-not-found fixtures
exercise every declared profile. The standard colon and contact-indirection
layouts reuse the existing bounded parser. `.gg` and `.je` share one exact
Channel Islands service and sectioned layout; its unlabelled ordinal
registration timestamp and domain-status section are interpreted only when
the complete section and response-marker set is present. The ordinal date has
a narrow deterministic UTC normalization while the original text remains the
source value.

IANA currently publishes RDAP bootstrap services for `.ad`, `.cc`, and `.cr`.
The other suffixes in this batch remain WHOIS-only in the IANA inventory, so
their profiles expose that RDAP discovery is unavailable rather than implying
a failed lookup is negative evidence.

Version 19 adds twenty active country-code delegations from a fresh 19 July
2026 IANA inventory. Ten IDN suffixes reuse an existing fixture-backed parser
only because their delegation records publish the exact WHOIS endpoint already
used by that profile: `.ישראל`, `.الجزائر`, `.ایران`, `.امارات`, `.بارت`,
`.بھارت`, `.السعودية`, `.ڀارت`, `.مليسيا`, and `.تونس`. Each alias is reparsed
from its family's sanitized fixture using the alias A-label, and both the
Unicode and A-label forms resolve to the same suffix-correct capability.
The ten aliases remain separate from their parser family's base profile because
IANA publishes no RDAP bootstrap service for them; shared WHOIS infrastructure
does not justify inheriting a different suffix's RDAP coverage.

`.om` and `.عمان` add one new shared standard-colon family backed by sanitized
registered and authoritative `No Data Found` fixtures. That terse absence form
is accepted only as a complete response line, so policy prose cannot become an
availability claim. `.na` and `.pn` document the inverse service boundary:
IANA publishes RDAP bootstrap entries but no domain WHOIS referral. Finally,
`.پاکستان`, `.الاردن`, `.المغرب`, `.البحرين`, `.سودان`, and `.مصر` document
delegations for which IANA currently publishes neither domain WHOIS nor RDAP.
All eight access-only profiles remain contextual and cannot decide domain
existence.

The catalogue does not hard-code those endpoints into lookup routing. Live
queries still begin with IANA referral discovery for the requested suffix, and
the fixtures do not prove current reachability or publication of any field.
Shared manager identity alone is not parser evidence, and a missing or failed
response remains inconclusive rather than becoming an availability claim.

Version 20 adds fixture-backed registered-response coverage for 25 more active
country-code delegations: `.as`, `.bm`, `.cm`, `.cv`, `.cx`, `.ec`, `.fm`,
`.fo`, `.gd`, `.gy`, `.hn`, `.ht`, `.ky`, `.lb`, `.mg`, `.ml`, `.ms`, `.mu`,
`.ng`, `.pw`, `.rw`, `.sd`, `.sr`, `.ss`, and `.to`. At the 19 July 2026
inventory, every suffix published both an official port-43 referral and an
RDAP bootstrap service through IANA. The catalogue records those access paths
without embedding their current endpoints into lookup routing.

Twenty-four profiles use the existing bounded standard-colon fixture family.
The `.sr` fixture separately models its `Domain:` and sponsoring-registrar
labels while remaining inside the same bounded field parser. All fixtures use
reserved names and sanitised values, retain no live registration data, and run
without network access. They establish deterministic parsing of a registered
response only. No authoritative absence dialect is claimed for this batch, so
an empty, denied, timed-out, malformed, or undocumented response remains
inconclusive and cannot decide availability.

Version 21 adds another 25 active country-code delegations while narrowing
each claim to its represented fixture state. Twenty-three profiles cover
registered responses for `.bf`, `.dm`, `.fj`, `.kg`, `.kn`, `.ly`, `.mr`,
`.mw`, `.nu`, `.pe`, `.pg`, `.qa`, `.st`, `.sx`, `.sy`, `.tv`, `.tz`, `.ug`,
`.uz`, `.ve`, `.ws`, `.ye`, and `.zm`. The `.nc` and `.vg` profiles cover only
their authoritative object-missing responses; they do not claim registered
field compatibility. Current IANA metadata records RDAP for ten members of the
batch and WHOIS-only access for the other fifteen without transferring service
availability between suffixes.

Most registered fixtures reuse bounded standard-colon or contact-indirection
parsing. `.nu` exercises the existing holder and registry-state family. The
`.kg` response needs one marker-gated adapter for its unlabelled
`Domain NAME (STATUS)` header, textual record dates, and bare nameserver
section. That adapter requires the registry banner, domain header, creation
line, and nameserver heading together; incomplete lookalikes remain
inconclusive. Its nameserver collection retains the existing 200-entry cap and
explicit truncation state. All fixtures are sanitized, reserved, offline, and
retain no sampled registration data.

Version 22 adds authoritative-negative-only coverage for 27 more assigned
country-code delegations: `.ag`, `.aw`, `.ax`, `.bi`, `.bn`, `.ci`, `.gh`,
`.gn`, `.gs`, `.im`, `.ki`, `.ma`, `.mz`, `.nf`, `.pr`, `.sc`, `.sh`, `.sn`,
`.so`, `.tc`, `.td`, `.tg`, `.tm`, `.vu`, `.xn--j1amh`,
`.xn--mgbah1a3hjkrd`, and `.xn--ogbpf8fl`. Current official metadata records
RDAP for `.gs`, `.nf`, and `.sn`; the other 24 profiles remain explicitly
WHOIS-only. Registered-field parsing is not claimed for any member of this
batch.

The fixture phrases were reduced from bounded manual registry samples to
reserved names and the minimum authoritative response lines. Existing
authority analysis covers all but the available-for-purchase dialect, which is
accepted only as a complete line containing one bounded domain name. Similar
wording embedded in policy prose remains inconclusive. Unreachable,
restricted, prohibited, and undocumented responses were excluded rather than
converted into fixture claims, and automated tests remain fully offline.

Version 23 completes an explicit catalogue row for all 309 country-code
delegations assigned in the 2026-07-19 IANA root-database snapshot. `.bj` and
`.do` add authoritative-negative-only fixtures for their clear no-object
responses.
The remaining 20 profiles document an IANA-published WHOIS referral without
claiming fixture-verified response parsing: `.bo`, `.bw`, `.cf`, `.ge`, `.gp`,
`.gq`, `.hm`, `.iq`, `.pf`, `.sb`, `.sm`, `.tk`, `.tl`, `.uy`, `.vi`,
`.xn--90ae`, `.xn--l1acc`, `.xn--mgbtx2b`, `.xn--wgbl6a`, and
`.xn--ygbi2ammx`. IANA also publishes RDAP discovery for `.vi`; no other member
of this batch inherits that service state.

A bounded manual referral audit on 2026-07-19 found unavailable, restricted,
prohibited, reserved, or otherwise inconclusive behavior for those 20 WHOIS
services.
Those observations are not stored as parser fixtures and do not become absence
claims. Runtime lookup still discovers current endpoints from IANA, while the
embedded catalogue records only the verified fixture or access-documentation
boundary. Automated tests remain offline and use sanitized responses only.

Version 24 deepens three alternate-script delegations without relaxing that
boundary. The Bulgarian IDN service accepts a Unicode domain at the first
registry referral while rejecting the equivalent A-label query as invalid, so
its suffix-scoped query profile converts only that one hop to Unicode and keeps
the IANA root and any later referral on the canonical A-label. Sanitized
registered and authoritative-available fixtures cover its sectioned response.
The Mongolian and Qatari IDNs use the exact IANA-published WHOIS services of
`.mn` and `.qa`; their bounded parser families are reused, with an additional
complete-line no-data fixture for the Qatari IDN. IANA publishes no RDAP service
for these five related suffixes, and the catalogue now records that state for
`.mn` explicitly. Seventeen version 23 referrals remain access documented
because their manual responses were unavailable, restricted, prohibited,
reserved, or otherwise inconclusive.

Version 26 reconciles suffix-specific RDAP access metadata with the official
domain bootstrap observed on 20 July 2026. A bounded manual audit found 81
explicit rows that had inherited the catalogue's default bootstrap profile even
though the official bootstrap published no service for those suffixes. The 54
ASCII suffixes are `.ac`, `.ae`, `.af`, `.am`, `.at`, `.be`, `.bg`, `.by`,
`.cl`, `.cn`, `.co`, `.de`, `.dk`, `.ee`, `.eu`, `.gf`, `.gi`, `.gt`, `.hk`,
`.hr`, `.hu`, `.ie`, `.il`, `.io`, `.ir`, `.it`, `.jp`, `.kr`, `.kz`, `.la`,
`.lt`, `.lu`, `.lv`, `.md`, `.me`, `.mk`, `.mo`, `.mq`, `.mx`, `.my`, `.nz`,
`.pk`, `.pt`, `.ro`, `.rs`, `.ru`, `.sa`, `.se`, `.sk`, `.su`, `.tn`, `.tr`,
`.us`, and `.vc`. The remaining 27 rows are the corresponding A-label
delegations recorded in the versioned catalogue and its deterministic fixture.

The shared WHOIS parser families remain unchanged. `.in`, `.tw`, and
`.xn--kpry57d` retain their separately published RDAP bootstrap coverage, while
the related suffixes without a bootstrap entry use suffix-specific capability
rows. Runtime lookup still discovers endpoints from the live validated
bootstrap and does not consult this metadata for routing or availability. A
catalogue row that says no RDAP service is collection context at the stated
audit date, not evidence that a domain is unregistered, available, inactive,
safe, or malicious.

Generic fixtures also verify registered, authoritative-not-found, and
rate-limited WHOIS states. RDAP normalization has separate fixture coverage for
thick and thin domain objects plus IPv4, IPv6, and autonomous-system objects;
suffix coverage remains dynamic because TLD managers publish their services in
the IANA bootstrap registry.

Authenticated users can browse the same explicit matrix on the **Registry
support** reference page. Its text and coverage filters run locally over the
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
