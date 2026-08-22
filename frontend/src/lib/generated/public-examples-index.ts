// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLES_INDEX = {
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
      "large": false
    },
    {
      "id": "offline-route-review",
      "title": "Offline route-origin review",
      "format": "terminal",
      "command": "whoisleuth review-evidence synthetic-route.json",
      "summary": "An offline comparison against an empty analyst-supplied reserved-address authorisation set.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": false
    },
    {
      "id": "workflow-plan",
      "title": "Reviewed evidence-handoff workflow",
      "format": "terminal",
      "command": "whoisleuth workflow-plan evidence-handoff \"Example Review\"",
      "summary": "A fixed plan that verifies, packages, and lints reviewed material without submitting it.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": false
    },
    {
      "id": "case-handoff",
      "title": "Reviewed public Case handoff",
      "format": "JSON",
      "command": "whoisleuth case-pack synthetic-cases.json --audience public --reviewed --json",
      "summary": "A canonical public Case-pack v2 built from one reserved-domain Case schema 13 record.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": true
    }
  ],
  "limitations": [
    "Synthetic reserved-domain example. It is not a live finding and no request was made.",
    "Copying or downloading an example changes no workspace data and does not execute the displayed command."
  ]
} as const;
