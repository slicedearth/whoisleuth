# Capability and Data-flow Contract

> Generated from `packages/contracts/capability-manifest.mts`. Run `npm run capabilities:check` to verify this file.

Contract: `whoisleuth.capability-manifest` version 1.

This catalogue describes existing execution, disclosure, retention and assurance boundaries. It does not enable a capability, make a request, grant authorisation, or replace the detailed privacy and operations guidance.

## Execution planes

| Plane | Boundary |
| --- | --- |
| Browser local | Local derivation, deliberate browser-profile retention and export. |
| Hosted bounded passive | Authenticated, feature-gated and budgeted collection through the hosted runtime. |
| Local CLI offline | Bounded local parsing, comparison, verification, reporting and planning with no request. |
| Local CLI network | Explicit bounded collection from the local CLI. |
| Local CLI authorised active | Isolated owned-or-authorised protocol action with an explicit acknowledgement. |
| Local tool offline | Optional repository-local processing with no network request. |
| Local tool authorised active | Optional repository-local active collection after a specific authorisation acknowledgement. |
| Optional worker | Separately configured bounded monitoring that is not general evidence custody. |

## Capability catalogue

| Capability | Job | Trigger | Planes | Scan modes | Network | Disclosure | Recipients | Credentials | Retention | Export | Scoring | Authorisation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lookup` — Unified Lookup and bounded multi-target collection | investigate | explicit browser action | hosted bounded passive | fast<br>compact<br>deep<br>monitor | bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>public ip address<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated explicit action |
| `rdap` — RDAP registration and allocation evidence | investigate | authenticated request | hosted bounded passive | fast<br>compact<br>deep<br>monitor | bounded passive | normalised target<br>registry query | registry service | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated request |
| `rdap_nameserver_search` — Registry-scoped RDAP nameserver search | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | normalised target<br>registry query | registry service | none | transient | none | none | authenticated explicit action |
| `whois` — Referral-aware WHOIS publication evidence | investigate | authenticated request | hosted bounded passive | deep<br>monitor | bounded passive | normalised target<br>whois query | registry service | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated request |
| `availability` — Authority-aware registration availability | investigate | authenticated request | hosted bounded passive | fast<br>compact<br>deep<br>monitor | conditional bounded passive | normalised target<br>registry query<br>dns question | registry service<br>dns resolver | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated request |
| `domain_evidence` — Bounded domain evidence collection | investigate | authenticated request | hosted bounded passive | fast<br>compact<br>deep<br>monitor | conditional bounded passive | normalised target<br>dns question<br>homepage request<br>tls handshake | dns resolver<br>target public service | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated request |
| `dns_intelligence` — DNS intelligence | investigate | authenticated request | hosted bounded passive | deep<br>monitor | bounded passive | normalised target<br>dns question | dns resolver | none | transient | deliberate bounded | bounded risk input | authenticated request |
| `website_probe` — Bounded homepage and static page evidence | investigate | authenticated request | hosted bounded passive | deep | bounded passive | normalised target<br>dns question<br>homepage request | dns resolver<br>target public service | none | transient | deliberate bounded | bounded risk and acquisition input | authenticated request |
| `tls_intelligence` — Bounded TLS connection and certificate evidence | assure | authenticated request | hosted bounded passive | deep | bounded passive | normalised target<br>dns question<br>tls handshake | dns resolver<br>target public service | none | transient | deliberate bounded | none | authenticated request |
| `certificate_transparency` — Certificate Transparency search | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | certificate search term | certificate transparency service | none | transient | deliberate bounded | none | authenticated explicit action |
| `security_txt` — Optional security.txt collection | respond | explicit browser action | hosted bounded passive | deep | bounded passive | normalised target<br>dns question<br>homepage request | dns resolver<br>target public service | none | transient | deliberate bounded | none | authenticated explicit action |
| `external_intelligence` — Selected optional intelligence providers | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | normalised registrable domain | configured intelligence provider | deployment optional | transient | none | bounded risk input | authenticated explicit action |
| `urlscan_search` — Archived public scan verdict search | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | normalised registrable domain | configured intelligence provider | deployment optional | transient | none | bounded risk input | authenticated explicit action |
| `urlhaus_host` — Archived malware-host search | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | normalised registrable domain | configured intelligence provider | deployment optional | transient | none | bounded risk input | authenticated explicit action |
| `threatfox_domain_ioc` — Retained malware-indicator search | investigate | explicit browser action | hosted bounded passive | deep | bounded passive | normalised registrable domain | configured intelligence provider | deployment optional | transient | none | bounded risk input | authenticated explicit action |
| `registrar_rdap` — Eligible registrar RDAP follow-up | investigate | authenticated request | hosted bounded passive | deep | conditional bounded passive | normalised registrable domain<br>registry query | registry service | none | transient | deliberate bounded | none | authenticated request |
| `network_context` — Observed endpoint network context | investigate | authenticated request | hosted bounded passive | deep | conditional bounded passive | public ip address<br>registry query | registry service | none | transient | deliberate bounded | none | authenticated request |
| `reverse_dns` — Public-address reverse DNS | investigate | authenticated request | hosted bounded passive | deep | conditional bounded passive | public ip address<br>dns question | dns resolver | none | transient | deliberate bounded | none | authenticated request |
| `domain_posture` — Owned-domain posture review | assure | explicit browser action | hosted bounded passive | deep | bounded passive | normalised target<br>registry query<br>dns question<br>mta sts policy request | registry service<br>dns resolver<br>target public service | none | transient | deliberate bounded | none | authenticated explicit action |
| `dnssec_validation` — Explicit DNSSEC validation | assure | explicit cli command | local cli authorised active | active | bounded authorised active | normalised target<br>dns question | selected public resolver | required public trust file | local output deliberate | local output | none | owned or authorised acknowledgement |
| `mail_transport_review` — Explicit mail transport review | assure | explicit cli command | local cli authorised active | active | bounded authorised active | normalised target<br>dns question<br>mail transport commands<br>tls handshake | selected public resolver<br>selected mail endpoint | required public trust file | local output deliberate | local output | none | owned or authorised acknowledgement |
| `rendered_web_capture` — Explicit local rendered web capture | investigate | explicit local tool | local tool authorised active | active | bounded authorised active | admitted resource request<br>dns question | target public service<br>dns resolver | none | local output deliberate | local output | none | authorised capture acknowledgement |
| `rendered_capture_comparison` — Offline rendered capture comparison | investigate | explicit local tool | local tool offline | offline | none | none | none | none | transient | local output | none | explicit action |
| `idn_confusables` — Browser-local IDN and confusable analysis | investigate | derived from current evidence | browser local | fast<br>deep<br>offline | none | none | none | none | transient | deliberate bounded | bounded risk input | inherited parent action |
| `analyst_cases` — Browser-local analyst cases and Review Item lifecycle | respond | explicit browser action | browser local | offline | none | none | none | none | browser deliberate | deliberate bounded | none | explicit action |
| `watchlists` — Browser-local watchlists and monitoring views | assure | explicit browser action | browser local | fast<br>deep<br>offline<br>monitor | none | none | none | none | browser deliberate | deliberate bounded | none | explicit action |
| `offline_review` — Bounded local CLI review and derivation | investigate | explicit cli command | local cli offline | offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `portable_evidence` — Portable evidence, verification and reviewed hand-off | assure | variant specific | browser local<br>local cli offline | offline | none | none | none | variant specific | local output deliberate | deliberate bounded | none | explicit action |
| `runtime_diagnostics` — CLI runtime diagnostics | platform | explicit cli command | local cli offline<br>local cli network | offline | conditional bounded passive | fixed diagnostic probe | dns resolver<br>target public service<br>registry service | none | local output deliberate | metadata only | none | explicit network approval |
| `workflow_execution` — Approved local CLI workflow execution | investigate | explicit cli command | local cli offline<br>local cli network | offline<br>fast<br>deep | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>public ip address<br>homepage request<br>tls handshake<br>mta sts policy request | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | none | explicit network approval |
| `scheduled_monitoring` — Optional scheduled monitoring worker | assure | operator schedule | optional worker | fast<br>compact<br>monitor | bounded passive | normalised target<br>registry query<br>dns question<br>encrypted compact watchlist | registry service<br>dns resolver<br>configured worker store | worker encryption key | worker compact encrypted | deliberate bounded | none | worker configuration |
| `distributed_budgets` — Optional distributed operation budgets | platform | deployment configuration | hosted bounded passive | None | conditional bounded passive | operation control metadata | configured control provider | deployment optional | control only | metadata only | none | deployment configuration |

## CLI operation catalogue

The public command catalogue keeps its version 1 offline/network label for all 47 installed CLI operations. These operation records retain the more precise plane, activation, credential, export and scoring contract.

| Operation | Capability family | Legacy collection | Trigger | Planes | Network | Disclosure | Recipients | Credentials | Retention | Export | Scoring | Authorisation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `command.cli.completion` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | metadata only | none | explicit action |
| `command.cli.doctor` | `runtime_diagnostics` | network | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | fixed diagnostic probe | dns resolver<br>target public service<br>registry service | none | local output deliberate | metadata only | none | explicit network approval |
| `command.cli.commands` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | metadata only | none | explicit action |
| `command.cli.manual` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | metadata only | none | explicit action |
| `command.cli.manifest` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.map-observations` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.oam-export` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.lookup` | `lookup` | network | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake<br>public ip address | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | bounded risk and acquisition input | explicit action |
| `command.cli.bulk` | `lookup` | network | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | bounded risk and acquisition input | explicit action |
| `command.cli.ct-search` | `certificate_transparency` | network | explicit cli command | local cli network | bounded passive | certificate search term | certificate transparency service | none | local output deliberate | local output | none | explicit action |
| `command.cli.ct-intake` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.discover` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.discover-scan` | `lookup` | network | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | bounded risk and acquisition input | explicit action |
| `command.cli.posture` | `domain_posture` | network | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>dns question<br>mta sts policy request | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | none | explicit action |
| `command.cli.http` | `website_probe` | network | explicit cli command | local cli network | bounded passive | normalised target<br>dns question<br>homepage request | dns resolver<br>target public service | none | local output deliberate | local output | none | explicit action |
| `command.cli.tls` | `tls_intelligence` | network | explicit cli command | local cli network | bounded passive | normalised target<br>dns question<br>tls handshake | dns resolver<br>target public service | none | local output deliberate | local output | none | explicit action |
| `command.cli.dnssec-validate` | `dnssec_validation` | network | explicit cli command | local cli authorised active | bounded authorised active | normalised target<br>dns question | selected public resolver | required public trust file | local output deliberate | local output | none | owned or authorised acknowledgement |
| `command.cli.mail-transport` | `mail_transport_review` | network | explicit cli command | local cli authorised active | bounded authorised active | normalised target<br>dns question<br>mail transport commands<br>tls handshake | selected public resolver<br>selected mail endpoint | required public trust file | local output deliberate | local output | none | owned or authorised acknowledgement |
| `command.cli.registry-support` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.registry-doctor` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.registry-cohort` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.registry-scaffold` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.risk-calibrate` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.lookalike-calibrate` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.verify-artifact` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | optional secret passphrase file | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.interchange-report` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | optional secret passphrase file | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.inspect-archive` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | optional secret passphrase file | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.sign-artifact` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | required secret private key file | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.verify-signature` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | optional public key file | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.source-report` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.compare` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.page-compare` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.mail-review` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.review-evidence` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.brief` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.case-pack` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.domain-control` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.monitor-once` | `lookup` | network | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>public ip address<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | none | explicit action |
| `command.cli.assurance` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.change-packet` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.sharing-review` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |
| `command.cli.workflow-plan` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.workflow-run` | `workflow_execution` | network | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>public ip address<br>homepage request<br>tls handshake<br>mta sts policy request | registry service<br>dns resolver<br>target public service | none | local output deliberate | local output | none | explicit network approval |
| `command.cli.diff` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.reconcile` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.timeline` | `offline_review` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | local output | none | explicit action |
| `command.cli.export` | `portable_evidence` | offline | explicit cli command | local cli offline | none | none | none | none | local output deliberate | deliberate bounded | none | explicit action |

### Conditional CLI variants

Variant rows override the aggregate operation boundary; no-request variants never inherit a collection disclosure or scoring claim.

| Operation | Variant | Trigger | Planes | Network | Disclosure | Recipients | Request budget | Response budget | Concurrency | Credentials | Retention | Export | Scoring | Authorisation | Cancellation | Partial results | Outcomes | Document states |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `command.cli.doctor` | `default_local` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | not applicable | all or nothing | complete | None |
| `command.cli.doctor` | `network_opt_in` | explicit cli command | local cli network | bounded passive | fixed diagnostic probe | dns resolver<br>target public service<br>registry service | collector specific | bounded runtime report | command bounded | none | local output deliberate | metadata only | none | explicit network approval | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.lookup` | `plan_fast` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.lookup` | `plan_deep` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.lookup` | `collect_fast` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>dns question | registry service<br>dns resolver | registry light | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.lookup` | `collect_deep` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake<br>public ip address | registry service<br>dns resolver<br>target public service | registry deep | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.bulk` | `plan_fast` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.bulk` | `plan_deep` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.bulk` | `collect_fast` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>dns question | registry service<br>dns resolver | registry light | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.bulk` | `collect_deep` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | registry deep | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.discover-scan` | `plan_fast` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.discover-scan` | `plan_deep` | explicit cli command | local cli offline | none | none | none | none | bounded runtime report | none | none | local output deliberate | metadata only | none | explicit action | bounded atomic | all or nothing | complete | None |
| `command.cli.discover-scan` | `collect_fast` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>dns question | registry service<br>dns resolver | registry light | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.discover-scan` | `collect_deep` | explicit cli command | local cli network | bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>homepage request<br>tls handshake | registry service<br>dns resolver<br>target public service | registry deep | collector specific | command bounded | none | local output deliberate | local output | bounded risk and acquisition input | explicit action | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.workflow-run` | `unapproved_run` | explicit cli command | local cli offline | none | none | none | none | bounded local input | command bounded | none | local output deliberate | local output | none | explicit action | step stops admission | explicit step | complete<br>partial<br>blocked | complete<br>awaiting network approval<br>awaiting analyst selection<br>step failed |
| `command.cli.workflow-run` | `approved_run` | explicit cli command | local cli offline<br>local cli network | conditional bounded passive | normalised target<br>registry query<br>whois query<br>dns question<br>public ip address<br>homepage request<br>tls handshake<br>mta sts policy request | registry service<br>dns resolver<br>target public service | workflow step specific | collector specific | command bounded | none | local output deliberate | local output | none | explicit network approval | step stops admission | explicit step | complete<br>partial<br>blocked | complete<br>awaiting analyst selection<br>step failed |

## Hosted policy and budget bindings

Runtime configuration and admission remain with their existing enforcement owners. This table records the exact stable identities that the manifest validates against them.

| Capability | Feature policy | Hard dependencies | Operation budget variants |
| --- | --- | --- | --- |
| `lookup` | `lookup` | None | `lookup_fast` → `registry_light`<br>`lookup_deep` → `registry_deep`<br>`bulk_fast` → `registry_light`<br>`bulk_deep` → `registry_deep` |
| `rdap` | `rdap` | None | `rdap` → `registry_light` |
| `rdap_nameserver_search` | `rdap_nameserver_search` | `rdap` | `rdap_nameserver_search` → `registry_light` |
| `whois` | `whois` | None | `whois` → `registry_deep` |
| `availability` | `availability` | None | `availability_fast` → `registry_light`<br>`availability_deep` → `registry_deep` |
| `dns_intelligence` | `dns_intelligence` | None | Parent operation budget |
| `website_probe` | `website_probe` | None | Parent operation budget |
| `tls_intelligence` | `tls_intelligence` | None | Parent operation budget |
| `certificate_transparency` | `certificate_transparency` | None | `certificate_transparency` → `certificate_search` |
| `domain_posture` | `domain_posture` | `dns_intelligence` | `domain_posture` → `posture_audit` |

### Worker-cycle bounds

| Capability | Maximum lookups | Maximum processed deliveries | Soft cycle budget | Minimum lookup window |
| --- | ---: | ---: | ---: | ---: |
| `scheduled_monitoring` | 2 | 8 | 24000 ms | 16000 ms |

### Distributed-control bounds

| Capability | Request timeout | Response | Provider-unavailable retry hint | Request attempts | Automatic retries | Default lease | Lease range | Maximum counter |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `distributed_budgets` | 4000 ms | 16384 bytes | 5 seconds | 1 | 0 | 300000 ms | 30000–900000 ms | 1000000000 |

### Rendered-capture bounds

| Capability | Requests | Hosts | URL length | Deadline | Per response | Aggregate transfer | Manifest | DOM digest | Screenshot | DOM elements | DOM projection | Visible-text input |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `rendered_web_capture` | 100 | 30 | 2048 characters | 30000 ms | 4194304 bytes | 25165824 bytes | 1048576 bytes | 1048576 bytes | 10485760 bytes | 20000 | 262144 characters | 262144 bytes |

## Request and failure contracts

| Capability | Request budget | Response budget | Concurrency | Cancellation | Partial results | Normalised outcomes | Document states |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lookup` | variant specific | collector specific | registry deep | variant specific | variant specific | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `rdap` | registry light | collector specific | registry light | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `rdap_nameserver_search` | registry light | collector specific | registry light | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `whois` | registry deep | collector specific | registry deep | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `availability` | variant specific | collector specific | registry light | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `domain_evidence` | collector specific | collector specific | registry deep | bounded atomic | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `dns_intelligence` | collector specific | collector specific | registry deep | bounded atomic | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `website_probe` | collector specific | collector specific | registry deep | bounded atomic | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `tls_intelligence` | collector specific | collector specific | registry deep | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `certificate_transparency` | certificate search | collector specific | certificate search | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `security_txt` | collector specific | collector specific | registry deep | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `external_intelligence` | collector specific | collector specific | registry deep | client stops waiting | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `urlscan_search` | collector specific | collector specific | registry deep | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `urlhaus_host` | collector specific | collector specific | registry deep | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `threatfox_domain_ioc` | collector specific | collector specific | registry deep | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `registrar_rdap` | collector specific | collector specific | registry deep | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `network_context` | collector specific | collector specific | registry deep | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `reverse_dns` | collector specific | collector specific | registry deep | bounded atomic | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `domain_posture` | posture audit | collector specific | posture audit | client stops waiting | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `dnssec_validation` | authorised dnssec | collector specific | command bounded | client stops waiting | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `mail_transport_review` | authorised mail transport | collector specific | command bounded | client stops waiting | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `rendered_web_capture` | authorised rendered capture | bounded rendered capture | single capture | cooperative | explicit document | complete<br>partial<br>blocked<br>unavailable<br>budget exhausted | None |
| `rendered_capture_comparison` | none | bounded local input | none | not applicable | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable | None |
| `idn_confusables` | none | none | none | not applicable | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>stale | None |
| `analyst_cases` | none | bounded local input | none | not applicable | explicit document | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>stale | None |
| `watchlists` | none | bounded local input | none | not applicable | explicit per source | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>stale | None |
| `offline_review` | none | bounded local input | none | variant specific | variant specific | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>stale | None |
| `portable_evidence` | none | bounded portable document | none | variant specific | variant specific | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>stale | None |
| `runtime_diagnostics` | collector specific | bounded runtime report | command bounded | variant specific | variant specific | complete<br>partial<br>blocked<br>unsupported<br>unavailable<br>budget exhausted | None |
| `workflow_execution` | variant specific | bounded local input | command bounded | step stops admission | explicit step | complete<br>partial<br>blocked | complete<br>awaiting network approval<br>awaiting analyst selection<br>step failed |
| `scheduled_monitoring` | worker cycle | bounded compact state | worker bounded | queue stops admission | explicit per source | complete<br>partial<br>blocked<br>unavailable<br>budget exhausted | None |
| `distributed_budgets` | control provider specific | bounded runtime report | none | not applicable | fail closed | complete<br>budget exhausted<br>unavailable | None |

### CLI request and failure contracts

| Operation | Request budget | Response budget | Concurrency | Cancellation | Partial results | Normalised outcomes | Document states |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `command.cli.completion` | none | bounded runtime report | none | not applicable | all or nothing | complete | None |
| `command.cli.doctor` | variant specific | bounded runtime report | command bounded | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.commands` | none | bounded runtime report | none | not applicable | all or nothing | complete | None |
| `command.cli.manual` | none | bounded runtime report | none | not applicable | all or nothing | complete | None |
| `command.cli.manifest` | none | bounded portable document | none | bounded atomic | all or nothing | complete | None |
| `command.cli.map-observations` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.oam-export` | none | bounded portable document | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.lookup` | variant specific | collector specific | command bounded | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.bulk` | variant specific | collector specific | command bounded | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.ct-search` | certificate search | collector specific | command bounded | client stops waiting | explicit document | complete<br>partial | None |
| `command.cli.ct-intake` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.discover` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.discover-scan` | variant specific | collector specific | command bounded | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.posture` | posture audit | collector specific | command bounded | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.http` | collector specific | collector specific | command bounded | client stops waiting | explicit document | complete<br>partial | None |
| `command.cli.tls` | collector specific | collector specific | command bounded | client stops waiting | explicit document | complete<br>partial | None |
| `command.cli.dnssec-validate` | authorised dnssec | collector specific | command bounded | client stops waiting | explicit document | complete<br>partial | None |
| `command.cli.mail-transport` | authorised mail transport | collector specific | command bounded | client stops waiting | explicit per source | complete<br>partial | None |
| `command.cli.registry-support` | none | bounded local input | none | bounded atomic | all or nothing | complete | None |
| `command.cli.registry-doctor` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.registry-cohort` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.registry-scaffold` | none | bounded local input | none | not applicable | all or nothing | complete | None |
| `command.cli.risk-calibrate` | none | bounded local input | none | bounded atomic | all or nothing | complete | None |
| `command.cli.lookalike-calibrate` | none | bounded local input | none | bounded atomic | all or nothing | complete | None |
| `command.cli.verify-artifact` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial | None |
| `command.cli.interchange-report` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>unsupported<br>unavailable | None |
| `command.cli.inspect-archive` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>unavailable | None |
| `command.cli.sign-artifact` | none | bounded portable document | none | bounded atomic | all or nothing | complete | None |
| `command.cli.verify-signature` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>unavailable | None |
| `command.cli.source-report` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.compare` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.page-compare` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.mail-review` | none | bounded local input | none | bounded atomic | explicit per item | complete<br>partial | None |
| `command.cli.review-evidence` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>blocked | None |
| `command.cli.brief` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.case-pack` | none | bounded portable document | none | bounded atomic | all or nothing | complete | None |
| `command.cli.domain-control` | none | bounded portable document | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.monitor-once` | collector specific | collector specific | command bounded | queue stops admission | explicit per item | complete<br>partial | None |
| `command.cli.assurance` | none | bounded portable document | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.change-packet` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>blocked | None |
| `command.cli.sharing-review` | none | bounded portable document | none | bounded atomic | explicit document | complete<br>partial<br>blocked | None |
| `command.cli.workflow-plan` | none | bounded local input | none | not applicable | all or nothing | complete | None |
| `command.cli.workflow-run` | variant specific | collector specific | command bounded | step stops admission | explicit step | complete<br>partial<br>blocked | complete<br>awaiting network approval<br>awaiting analyst selection<br>step failed |
| `command.cli.diff` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.reconcile` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.timeline` | none | bounded local input | none | bounded atomic | explicit per source | complete<br>partial | None |
| `command.cli.export` | none | bounded portable document | none | bounded atomic | all or nothing | complete | None |

## Privacy limitations

### Unified Lookup and bounded multi-target collection

- Targets are disclosed only to the source families eligible for the selected mode.
- Fast, Compact, Deep and monitoring retain distinct request, evidence and storage boundaries.
- A source failure or omission remains explicit and never establishes absence or safety.

### RDAP registration and allocation evidence

- Published registration and allocation data remains attributed to its RDAP service.
- Missing or redacted fields do not establish absence, ownership or operational control.

### Registry-scoped RDAP nameserver search

- The query is limited to one selected registry and is not a global reverse-nameserver inventory.

### Referral-aware WHOIS publication evidence

- Registry and referral publications remain separately attributed and can disagree.
- Raw WHOIS payloads and expanded contact data are excluded from compact retention.

### Authority-aware registration availability

- Only authoritative registration evidence can establish an availability decision.
- DNS, page, mail and heuristic evidence cannot decide registration existence.

### Bounded domain evidence collection

- Each source retains its own state, observation time, completeness and limitations.
- Fast and Compact never inherit the richer Deep request or storage contract.

### DNS intelligence

- Resolver answers are point-in-time publications and do not prove provider ownership or control.

### Bounded homepage and static page evidence

- Static captured evidence is not a browser execution, vulnerability test or proof of page purpose.
- Complete query-bearing URLs, cookies, credentials, scripts and raw page content are not retained.

### Bounded TLS connection and certificate evidence

- PKIX, hostname, validity and connection states remain independent and point-in-time.
- A successful handshake is not a safety, ownership or intent verdict.

### Certificate Transparency search

- Search results are lower-bound public log observations and do not prove current deployment or control.

### Optional security.txt collection

- Publication is a source-attributed contact route, not proof that it is monitored or appropriate.

### Selected optional intelligence providers

- Optional providers remain off unless configured and selected for one Deep Lookup.
- A provider report or miss remains attributed and is not proof of maliciousness, safety or absence.

### Archived public scan verdict search

- Archived scan history is searched without submitting a new scan.

### Archived malware-host search

- One exact host search is performed without submitting a URL, file or report.

### Retained malware-indicator search

- One exact retained-indicator search is performed without submitting an indicator or sample.

### Eligible registrar RDAP follow-up

- At most one eligible registry-advertised HTTPS service is followed and it never overwrites registry evidence.

### Observed endpoint network context

- One observed public endpoint does not establish an origin host, hosting control or ownership.

### Public-address reverse DNS

- PTR names are publisher-controlled context and do not prove ownership or service identity.

### Owned-domain posture review

- Posture findings describe bounded public registry, DNS and MTA-STS publication evidence and never change configuration.

### Explicit DNSSEC validation

- The selected resolver receives the bounded DNS questions for this explicitly authorised run.
- DNSSEC assurance remains separate from routing, DANE, PKIX and ownership claims.

### Explicit mail transport review

- The action never sends mail, authenticates, tests relay, enumerates recipients or retries automatically.
- DNSSEC, TLSA, DANE, PKIX, STARTTLS and SMTP states remain independently attributed.

### Explicit local rendered web capture

- Each admitted resource request discloses its exact URL, including path and query, its GET or HEAD method, and ordinary allowlisted request headers to that public resource endpoint; DNS questions are disclosed to the configured resolver.
- Structured outputs exclude request paths, queries, headers and bodies, but the control-sanitised page title and screenshot retain page-controlled content that may reproduce a path or query.
- Rendered capture executes page JavaScript and remains separate from hosted Lookup and the distributable CLI.

### Offline rendered capture comparison

- The comparator reads only two selected bounded local capture sets and makes no network request.
- It reports independent verified components and never emits a combined similarity, intent or maliciousness score.

### Browser-local IDN and confusable analysis

- Local string similarity and script analysis do not establish impersonation, intent or maliciousness.

### Browser-local analyst cases and Review Item lifecycle

- Cases and the bounded analyst Review Item lifecycle overlay remain in the current browser profile unless deliberately exported.
- Review decisions retain stable subject identity, the reviewed material fingerprint, rationale, timestamps, expiry and bounded associations; current titles, evidence summaries and source values remain derived.
- Analyst assertions, response actions and Review Item lifecycle decisions never rewrite their source evidence or start collection, reporting, monitoring or enforcement.
- Missing, partial, stale, truncated or unavailable evidence cannot resolve a Review Item; changed material evidence and expired decisions return it to review.

### Browser-local watchlists and monitoring views

- Browser-local monitoring state is not refreshed automatically unless a separately configured worker is used.

### Bounded local CLI review and derivation

- Offline commands read only selected bounded local inputs and make no network request.
- Generated output remains under the operator's local retention and deletion control.

### Portable evidence, verification and reviewed hand-off

- Integrity, structure, signature and content assurance remain separate checks.
- Browser exports require an explicit browser action; CLI exports, verification and review require an explicit CLI command.
- Sharing a generated artefact is a deliberate action outside the collection runtime.

### CLI runtime diagnostics

- Network diagnostics run only with the explicit network option and use fixed diagnostic targets.

### Approved local CLI workflow execution

- Only installed fixed-recipe steps can run, and each network invocation requires explicit approval.
- Analyst-selection placeholders pause without interpretation or collection.

### Optional scheduled monitoring worker

- The worker retains only the documented compact encrypted projection and is not general evidence custody.
- Disabling collection does not delete retained ciphertext; deletion remains deliberate.

### Optional distributed operation budgets

- Budget records contain operation classes and bounded counters, not targets or evidence contents.
- Unavailable distributed controls make configured network-heavy operations fail closed.

## CLI privacy limitations

| Operation | Fixed limitations |
| --- | --- |
| `command.cli.completion` | The command emits fixed installed metadata and makes no network request or local evidence read. |
| `command.cli.doctor` | Network diagnostics are opt-in and use only fixed public diagnostic destinations. |
| `command.cli.commands` | The command emits fixed installed metadata and makes no network request or local evidence read. |
| `command.cli.manual` | The command emits fixed installed metadata and makes no network request or local evidence read. |
| `command.cli.manifest` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.map-observations` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.oam-export` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.lookup` | Only the source families eligible for the selected command and mode receive the bounded target representation.<br>The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract. |
| `command.cli.bulk` | Only the source families eligible for the selected command and mode receive the bounded target representation.<br>The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract. |
| `command.cli.ct-search` | The bounded search term is sent to the fixed Certificate Transparency search service. |
| `command.cli.ct-intake` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.discover` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.discover-scan` | Only the source families eligible for the selected command and mode receive the bounded target representation.<br>The plan variant is request-free; collection retains the selected command and mode's evidence and persistence contract. |
| `command.cli.posture` | The posture review performs bounded RDAP, DNS and MTA-STS publication checks without changing configuration. |
| `command.cli.http` | The target public service receives one bounded SSRF-guarded homepage workflow. |
| `command.cli.tls` | The selected public endpoint receives one bounded certificate connection. |
| `command.cli.dnssec-validate` | The selected resolver receives the bounded questions only after the owned-or-authorised acknowledgement.<br>The local trust anchor is read from the selected file and is never transmitted. |
| `command.cli.mail-transport` | The command requires both owned-or-authorised and active-probe acknowledgements.<br>It never sends mail, authenticates, tests relay, enumerates recipients or retries automatically. |
| `command.cli.registry-support` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.registry-doctor` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.registry-cohort` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.registry-scaffold` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.risk-calibrate` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.lookalike-calibrate` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.verify-artifact` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.interchange-report` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.inspect-archive` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.sign-artifact` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.verify-signature` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.source-report` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.compare` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.page-compare` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.mail-review` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.review-evidence` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.brief` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.case-pack` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.domain-control` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.monitor-once` | The one-shot monitor reads selected local control state and performs only the bounded scheduled review collection.<br>Its checkpoint and review evidence do not calculate Risk or Opportunity scores. |
| `command.cli.assurance` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.change-packet` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.sharing-review` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.workflow-plan` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.workflow-run` | Only fixed installed recipe steps can run, and every network invocation requires explicit approval. |
| `command.cli.diff` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.reconcile` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.timeline` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |
| `command.cli.export` | The command reads only selected bounded local input and makes no network request.<br>Output remains under the operator's local retention and deletion control. |

## Invariants

- Availability is dynamic state, not an execution plane.
- A capability family link does not override an operation's execution plane, trigger, credential or request contract.
- Fast, Compact, Deep, monitoring, offline review and authorised active actions remain distinct.
- Partial, blocked, unsupported, unavailable, stale and budget-exhausted document outcomes remain explicit; cancellation is reported separately.
- The manifest contains only fixed metadata; it cannot contain a target, credential, runtime secret or collected evidence value.
