// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLES_INDEX = {
  "generatedAt": "2026-08-23T00:00:00.000Z",
  "examples": [
    {
      "id": "lookup-preflight",
      "direction": "output",
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
      "direction": "output",
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
      "direction": "output",
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
      "direction": "output",
      "title": "Importable public Case handoff",
      "format": "JSON",
      "command": "whoisleuth case-pack synthetic-cases.json --audience public --reviewed --json",
      "summary": "A complete public Case-pack v2 built from one reserved-domain Case schema 19 record, with a verifiable digest.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": true
    },
    {
      "id": "case-pin-input",
      "direction": "input",
      "title": "Case evidence-pin input",
      "format": "JSON",
      "command": "whoisleuth case pin synthetic-cases.json --input synthetic-pin.json --output reviewed-cases.json",
      "summary": "An observation with its own source, time and partial coverage.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": false
    },
    {
      "id": "case-assess-input",
      "direction": "input",
      "title": "Case assessment input",
      "format": "JSON",
      "command": "whoisleuth case assess synthetic-cases.json --input synthetic-assess.json --output reviewed-cases.json",
      "summary": "A reviewed disposition linked to a new source-qualified pin. Replace every fictional claim before using it.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": false
    },
    {
      "id": "case-recheck-input",
      "direction": "input",
      "title": "Case incomplete-recheck input",
      "format": "JSON",
      "command": "whoisleuth case recheck synthetic-cases.json --input synthetic-recheck.json --output reviewed-cases.json",
      "summary": "An unavailable observation, not a removal or takedown conclusion.",
      "synthetic": true,
      "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
      "large": false
    }
  ],
  "limitations": [
    "Synthetic reserved-domain example. It is not a live finding and no request was made.",
    "Copying or downloading an example changes no workspace data and does not execute the displayed command."
  ]
} as const;
