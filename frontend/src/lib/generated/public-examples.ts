// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLES = {
  "generatedAt": "2026-08-23T00:00:00.000Z",
  "examples": [
    {
      "id": "lookup-preflight",
      "title": "Deep Lookup preflight",
      "format": "terminal",
      "command": "whoisleuth lookup example.test --deep --plan",
      "summary": "A request-free plan naming intended source families and disclosures.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nWHOISleuth lookup preflight\nTarget: example.test\nType: domain\nMode: deep\nNetwork requests made: no\nCollection requires network: yes\n\nPlanned collection:\n  rdap\n    Collect authoritative registration or allocation evidence where supported.\n    Disclosure: The normalised target is sent to the applicable RDAP bootstrap and service endpoints.\n  whois\n    Collect separately attributed registry and referral publications.\n    Disclosure: The normalised target is sent over bounded TCP connections to applicable WHOIS services.\n  domain_evidence\n    Collect bounded DNS, HTTP, TLS, page-identity, technology, and security-posture evidence.\n    Disclosure: DNS resolvers and the target website infrastructure receive the hostname through bounded probes.\n  registrar_rdap (conditional)\n    Collect a separately attributed registrar RDAP publication when registry evidence advertises one.\n    Disclosure: The registrable domain is sent to the advertised registrar RDAP service.\n  network_context (conditional)\n    Add allocation and routing context for public addresses observed during domain collection.\n    Disclosure: Observed public addresses may be sent to applicable RDAP services.\n\nLimitation: This is a local preflight. It does not test source availability, feature configuration, cache state, redirects, referrals, or the exact number of requests a completed lookup may require.\n\nLimitation: Conditional sources may be skipped when prerequisite evidence is absent, unsupported, disabled, or unavailable.\n",
      "large": false,
      "downloadName": "synthetic-lookup-preflight.txt",
      "mediaType": "text/plain"
    },
    {
      "id": "offline-route-review",
      "title": "Offline route-origin review",
      "format": "terminal",
      "command": "whoisleuth review-evidence synthetic-route.json",
      "summary": "An offline comparison against an empty analyst-supplied reserved-address authorisation set.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nOffline evidence review\nKind   rpki\nState  not found\nRejected0\nMatches0\n\nLimitations:\n  - The review is local and uses only the supplied document. It does not refresh, transmit, or independently establish the current completeness of the evidence.\n  - This offline review evaluates an explicitly supplied route prefix and origin ASN against an analyst-supplied VRP snapshot.\n  - It does not collect BGP announcements, establish route ownership, or prove that the snapshot was current or complete.\n",
      "large": false,
      "downloadName": "synthetic-offline-route-review.txt",
      "mediaType": "text/plain"
    },
    {
      "id": "workflow-plan",
      "title": "Reviewed evidence-handoff workflow",
      "format": "terminal",
      "command": "whoisleuth workflow-plan evidence-handoff \"Example Review\"",
      "summary": "A fixed plan that verifies, packages, and lints reviewed material without submitting it.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nInvestigation plan: Reviewed evidence handoff\nSubject  example review\nMode     plan_only\n\n1. Verify the selected artefact\n   verify-artifact \u003cevidence.json> --json\n   offline; approval: analyst selection\n   Verification checks structure and integrity, not the truth or currency of observations.\n2. Build a reviewed public Case-pack\n   case-pack \u003ccases.json> --audience public --reviewed --json\n   offline; approval: analyst selection\n   Review minimisation and audience projection before retaining the separate package.\n3. Review deliberate-sharing metadata\n   sharing-review \u003cpackage.json> --marking clear --recipient-scope public --purpose reviewed evidence handoff --human-reviewed --personal-data-reviewed --redactions-confirmed --json\n   offline; approval: analyst selection\n   A clear lint result does not send, upload, publish, or authorise the artefact.\n\nLimitation: This document is a fixed plan. It does not execute commands, expand placeholders, make requests, read files, change cases, or submit reports.\nLimitation: Network steps require deliberate execution and disclose the selected target to the sources described by that command.\nLimitation: Analyst-selection steps require reviewed local artefacts; placeholders are never interpreted as file paths by this planner.\n",
      "large": false,
      "downloadName": "synthetic-evidence-handoff-plan.txt",
      "mediaType": "text/plain"
    },
    {
      "id": "case-handoff",
      "title": "Reviewed public Case handoff",
      "format": "JSON",
      "command": "whoisleuth case-pack synthetic-cases.json --audience public --reviewed --json",
      "summary": "A canonical public Case-pack v2 built from one reserved-domain Case schema 14 record.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "content": "{\n  \"synthetic\": true,\n  \"notice\": \"Synthetic reserved-domain example. It is not a live finding and no request was made.\",\n  \"preview\": {\n    \"schema\": \"whoisleuth\u002ecli.case-pack\",\n    \"version\": 2,\n    \"audience\": \"public\",\n    \"reviewed\": true,\n    \"caseCount\": 1,\n    \"case\": {\n      \"schemaVersion\": 14,\n      \"domain\": \"example.test\",\n      \"status\": \"new\",\n      \"tags\": [\n        \"synthetic\"\n      ]\n    },\n    \"report\": {\n      \"schema\": \"whoisleuth\u002ecase-report\",\n      \"schemaVersion\": 10\n    },\n    \"redactionManifest\": {\n      \"excluded\": [\n        \"Case notes\",\n        \"Brand Profile references\",\n        \"Actions and recipient values\",\n        \"Analyst assertions\",\n        \"Investigation branches\",\n        \"Manual trail targets\",\n        \"Raw upstream payloads and credentials\",\n        \"Independent observed-effect reviews and closure history\"\n      ],\n      \"sourceCaseCount\": 1,\n      \"brandProfileReferencesOmitted\": 0\n    },\n    \"integrity\": {\n      \"algorithm\": \"SHA-256\",\n      \"canonicalization\": \"sorted-json-v2\",\n      \"digestPresent\": true\n    },\n    \"limitations\": [\n      \"This local package is browser-importable through its top-level case collection and does not upload or submit evidence.\",\n      \"The reviewed flag records a deliberate CLI choice; it does not prove recipient authorisation, factual correctness, or legal sufficiency.\",\n      \"Importing the package does not restore fields excluded by its audience profile.\"\n    ]\n  }\n}",
      "large": true,
      "downloadName": "synthetic-reviewed-case-handoff.json",
      "mediaType": "application/json"
    }
  ],
  "limitations": [
    "Synthetic reserved-domain example. It is not a live finding and no request was made.",
    "Copying or downloading an example changes no workspace data and does not execute the displayed command."
  ]
} as const;
