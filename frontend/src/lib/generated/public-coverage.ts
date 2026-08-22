// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_COVERAGE = {
  "distinctions": [
    {
      "id": "implemented",
      "label": "Implemented capability",
      "description": "A checked-in capability family with an owned execution and evidence contract."
    },
    {
      "id": "reviewed",
      "label": "Fixture- or contract-reviewed support",
      "description": "Deterministic fixtures or a versioned contract exercise the declared shape and failure states; this is not a live availability measurement."
    },
    {
      "id": "optional",
      "label": "Optional or configuration-dependent",
      "description": "The implementation exists, but deployment configuration, an explicit variant, local input, a credential, or separate authorisation may be required."
    },
    {
      "id": "runtime",
      "label": "Runtime availability",
      "description": "Availability is evaluated only when a deliberate operation runs. This public catalogue does not probe a source or deployment."
    },
    {
      "id": "unsupported",
      "label": "Unsupported or intentionally excluded",
      "description": "The declared boundary excludes behaviours such as arbitrary execution, automatic enforcement, implicit active collection and unbounded custody."
    },
    {
      "id": "partial",
      "label": "Bounded omissions and partial results",
      "description": "Limits, truncation, source failure and unsupported states remain visible; omitted data is never reported as absent."
    }
  ],
  "summary": {
    "capabilityFamilies": 32,
    "cliOperations": 47,
    "registrySnapshot": {
      "schema": "whoisleuth\u002eregistry-standards-coverage",
      "version": 1,
      "verifiedAt": "2026-08-03",
      "counts": {
        "activeTlds": 1438,
        "countryCode": 309,
        "nonCountryCode": 1129,
        "generic": 1111,
        "genericRestricted": 3,
        "sponsored": 14,
        "infrastructure": 1,
        "rdapBootstrapServiceGroups": 590,
        "genericAndRestrictedRdapCovered": 1114,
        "sponsoredRdapCovered": 12,
        "infrastructureRdapCovered": 0
      },
      "exceptionCount": 3,
      "interpretation": "This official-source snapshot describes published service coverage at the verification date. It does not test current reachability or decide registration, availability, ownership, safety, or maliciousness."
    }
  },
  "capabilities": [
    {
      "id": "lookup",
      "title": "Unified Lookup and bounded multi-target collection",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "fast",
        "compact",
        "deep",
        "monitor"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "variant_specific",
      "limitations": [
        "Targets are disclosed only to the source families eligible for the selected mode.",
        "Fast, Compact, Deep and monitoring retain distinct request, evidence and storage boundaries.",
        "A source failure or omission remains explicit and never establishes absence or safety."
      ]
    },
    {
      "id": "rdap",
      "title": "RDAP registration and allocation evidence",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "fast",
        "compact",
        "deep",
        "monitor"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Published registration and allocation data remains attributed to its RDAP service.",
        "Missing or redacted fields do not establish absence, ownership or operational control."
      ]
    },
    {
      "id": "rdap_nameserver_search",
      "title": "Registry-scoped RDAP nameserver search",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "The query is limited to one selected registry and is not a global reverse-nameserver inventory."
      ]
    },
    {
      "id": "whois",
      "title": "Referral-aware WHOIS publication evidence",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep",
        "monitor"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Registry and referral publications remain separately attributed and can disagree.",
        "Raw WHOIS payloads and expanded contact data are excluded from compact retention."
      ]
    },
    {
      "id": "availability",
      "title": "Authority-aware registration availability",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "fast",
        "compact",
        "deep",
        "monitor"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Only authoritative registration evidence can establish an availability decision.",
        "DNS, page, mail and heuristic evidence cannot decide registration existence."
      ]
    },
    {
      "id": "domain_evidence",
      "title": "Bounded domain evidence collection",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "fast",
        "compact",
        "deep",
        "monitor"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Each source retains its own state, observation time, completeness and limitations.",
        "Fast and Compact never inherit the richer Deep request or storage contract."
      ]
    },
    {
      "id": "dns_intelligence",
      "title": "DNS intelligence",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep",
        "monitor"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Resolver answers are point-in-time publications and do not prove provider ownership or control."
      ]
    },
    {
      "id": "website_probe",
      "title": "Bounded homepage and static page evidence",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Static captured evidence is not a browser execution, vulnerability test or proof of page purpose.",
        "Complete query-bearing URLs, cookies, credentials, scripts and raw page content are not retained."
      ]
    },
    {
      "id": "tls_intelligence",
      "title": "Bounded TLS connection and certificate evidence",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "PKIX, hostname, validity and connection states remain independent and point-in-time.",
        "A successful handshake is not a safety, ownership or intent verdict."
      ]
    },
    {
      "id": "certificate_transparency",
      "title": "Certificate Transparency search",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Search results are lower-bound public log observations and do not prove current deployment or control."
      ]
    },
    {
      "id": "security_txt",
      "title": "Optional security.txt collection",
      "job": "respond",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Publication is a source-attributed contact route, not proof that it is monitored or appropriate."
      ]
    },
    {
      "id": "external_intelligence",
      "title": "Selected optional intelligence providers",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Optional providers remain off unless configured and selected for one Deep Lookup.",
        "A provider report or miss remains attributed and is not proof of maliciousness, safety or absence."
      ]
    },
    {
      "id": "urlscan_search",
      "title": "Archived public scan verdict search",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Archived scan history is searched without submitting a new scan."
      ]
    },
    {
      "id": "urlhaus_host",
      "title": "Archived malware-host search",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "One exact host search is performed without submitting a URL, file or report."
      ]
    },
    {
      "id": "threatfox_domain_ioc",
      "title": "Retained malware-indicator search",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "One exact retained-indicator search is performed without submitting an indicator or sample."
      ]
    },
    {
      "id": "registrar_rdap",
      "title": "Eligible registrar RDAP follow-up",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "At most one eligible registry-advertised HTTPS service is followed and it never overwrites registry evidence."
      ]
    },
    {
      "id": "network_context",
      "title": "Observed endpoint network context",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "One observed public endpoint does not establish an origin host, hosting control or ownership."
      ]
    },
    {
      "id": "reverse_dns",
      "title": "Public-address reverse DNS",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "PTR names are publisher-controlled context and do not prove ownership or service identity."
      ]
    },
    {
      "id": "domain_posture",
      "title": "Owned-domain posture review",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [
        "deep"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Posture findings describe bounded public registry, DNS and MTA-STS publication evidence and never change configuration."
      ]
    },
    {
      "id": "dnssec_validation",
      "title": "Explicit DNSSEC validation",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "local_cli_authorised_active"
      ],
      "scanModes": [
        "active"
      ],
      "networkMode": "bounded_authorised_active",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "The selected resolver receives the bounded DNS questions for this explicitly authorised run.",
        "DNSSEC assurance remains separate from routing, DANE, PKIX and ownership claims."
      ]
    },
    {
      "id": "mail_transport_review",
      "title": "Explicit mail transport review",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "local_cli_authorised_active"
      ],
      "scanModes": [
        "active"
      ],
      "networkMode": "bounded_authorised_active",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "The action never sends mail, authenticates, tests relay, enumerates recipients or retries automatically.",
        "DNSSEC, TLSA, DANE, PKIX, STARTTLS and SMTP states remain independently attributed."
      ]
    },
    {
      "id": "rendered_web_capture",
      "title": "Explicit local rendered web capture",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "local_tool_authorised_active"
      ],
      "scanModes": [
        "active"
      ],
      "networkMode": "bounded_authorised_active",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Each admitted resource request discloses its exact URL, including path and query, its GET or HEAD method, and ordinary allowlisted request headers to that public resource endpoint; DNS questions are disclosed to the configured resolver.",
        "Structured outputs exclude request paths, queries, headers and bodies, but the control-sanitised page title and screenshot retain page-controlled content that may reproduce a path or query.",
        "Rendered capture executes page JavaScript and remains separate from hosted Lookup and the distributable CLI."
      ]
    },
    {
      "id": "rendered_capture_comparison",
      "title": "Offline rendered capture comparison",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "local_tool_offline"
      ],
      "scanModes": [
        "offline"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "The comparator reads only two selected bounded local capture sets and makes no network request.",
        "It reports independent verified components and never emits a combined similarity, intent or maliciousness score."
      ]
    },
    {
      "id": "idn_confusables",
      "title": "Browser-local IDN and confusable analysis",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "browser_local"
      ],
      "scanModes": [
        "fast",
        "deep",
        "offline"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "stale"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Local string similarity and script analysis do not establish impersonation, intent or maliciousness."
      ]
    },
    {
      "id": "analyst_cases",
      "title": "Browser-local analyst cases and Review Item lifecycle",
      "job": "respond",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "browser_local"
      ],
      "scanModes": [
        "offline"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "stale"
      ],
      "partialResultContract": "explicit_document",
      "limitations": [
        "Cases and the bounded analyst Review Item lifecycle overlay remain in the current browser profile unless deliberately exported.",
        "Review decisions retain stable subject identity, the reviewed material fingerprint, rationale, timestamps, expiry and bounded associations; current titles, evidence summaries and source values remain derived.",
        "Analyst assertions, response actions and Review Item lifecycle decisions never rewrite their source evidence or start collection, reporting, monitoring or enforcement.",
        "Missing, partial, stale, truncated or unavailable evidence cannot resolve a Review Item; changed material evidence and expired decisions return it to review."
      ]
    },
    {
      "id": "watchlists",
      "title": "Browser-local watchlists and monitoring views",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "browser_local"
      ],
      "scanModes": [
        "fast",
        "deep",
        "offline",
        "monitor"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "stale"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "Browser-local monitoring state is not refreshed automatically unless a separately configured worker is used."
      ]
    },
    {
      "id": "offline_review",
      "title": "Bounded local CLI review and derivation",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "local_cli_offline"
      ],
      "scanModes": [
        "offline"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "stale"
      ],
      "partialResultContract": "variant_specific",
      "limitations": [
        "Offline commands read only selected bounded local inputs and make no network request.",
        "Generated output remains under the operator's local retention and deletion control."
      ]
    },
    {
      "id": "portable_evidence",
      "title": "Portable evidence, verification and reviewed hand-off",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "browser_local",
        "local_cli_offline"
      ],
      "scanModes": [
        "offline"
      ],
      "networkMode": "none",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "stale"
      ],
      "partialResultContract": "variant_specific",
      "limitations": [
        "Integrity, structure, signature and content assurance remain separate checks.",
        "Browser exports require an explicit browser action; CLI exports, verification and review require an explicit CLI command.",
        "Sharing a generated artefact is a deliberate action outside the collection runtime."
      ]
    },
    {
      "id": "runtime_diagnostics",
      "title": "CLI runtime diagnostics",
      "job": "platform",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "local_cli_offline",
        "local_cli_network"
      ],
      "scanModes": [
        "offline"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unsupported",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "variant_specific",
      "limitations": [
        "Network diagnostics run only with the explicit network option and use fixed diagnostic targets."
      ]
    },
    {
      "id": "workflow_execution",
      "title": "Approved local CLI workflow execution",
      "job": "investigate",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": false,
      "executionPlanes": [
        "local_cli_offline",
        "local_cli_network"
      ],
      "scanModes": [
        "offline",
        "fast",
        "deep"
      ],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked"
      ],
      "partialResultContract": "explicit_step",
      "limitations": [
        "Only installed fixed-recipe steps can run, and each network invocation requires explicit approval.",
        "Analyst-selection placeholders pause without interpretation or collection."
      ]
    },
    {
      "id": "scheduled_monitoring",
      "title": "Optional scheduled monitoring worker",
      "job": "assure",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "optional_worker"
      ],
      "scanModes": [
        "fast",
        "compact",
        "monitor"
      ],
      "networkMode": "bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "partial",
        "blocked",
        "unavailable",
        "budget_exhausted"
      ],
      "partialResultContract": "explicit_per_source",
      "limitations": [
        "The worker retains only the documented compact encrypted projection and is not general evidence custody.",
        "Disabling collection does not delete retained ciphertext; deletion remains deliberate."
      ]
    },
    {
      "id": "distributed_budgets",
      "title": "Optional distributed operation budgets",
      "job": "platform",
      "implemented": true,
      "reviewBasis": "Versioned capability contract and deterministic repository verification",
      "optionalOrConfigurationDependent": true,
      "executionPlanes": [
        "hosted_bounded_passive"
      ],
      "scanModes": [],
      "networkMode": "conditional_bounded_passive",
      "runtimeAvailability": "not_evaluated_by_public_catalogue",
      "outcomes": [
        "complete",
        "budget_exhausted",
        "unavailable"
      ],
      "partialResultContract": "fail_closed",
      "limitations": [
        "Budget records contain operation classes and bounded counters, not targets or evidence contents.",
        "Unavailable distributed controls make configured network-heavy operations fail closed."
      ]
    }
  ],
  "intentionallyExcluded": [
    "Internet-wide or live-uptime coverage claims",
    "Arbitrary command, path, query-language, agent-protocol, submission, enforcement, or monitoring execution",
    "Inference of safety, ownership, control, attribution, intent, maliciousness, legal status, or universal completeness",
    "Automatic promotion of missing, stale, unsupported, unavailable, partial, blocked, or conflicting evidence into absence"
  ]
} as const;
