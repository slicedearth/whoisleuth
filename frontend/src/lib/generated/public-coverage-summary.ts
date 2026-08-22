// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_COVERAGE_SUMMARY = {
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
  "intentionallyExcluded": [
    "Internet-wide or live-uptime coverage claims",
    "Arbitrary command, path, query-language, agent-protocol, submission, enforcement, or monitoring execution",
    "Inference of safety, ownership, control, attribution, intent, maliciousness, legal status, or universal completeness",
    "Automatic promotion of missing, stale, unsupported, unavailable, partial, blocked, or conflicting evidence into absence"
  ]
} as const;
