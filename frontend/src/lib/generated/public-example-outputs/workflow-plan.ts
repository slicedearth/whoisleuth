// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "workflow-plan",
  "direction": "output",
  "title": "Reviewed evidence-handoff workflow",
  "format": "terminal",
  "command": "whoisleuth workflow-plan evidence-handoff \"Example Review\"",
  "summary": "A fixed plan that verifies, packages, and lints reviewed material without submitting it.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nInvestigation plan: Reviewed evidence handoff\nSubject  example review\nMode     plan_only\n\n1. Verify the selected artefact\n   verify-artifact \u003cevidence.json> --json --strict-exit\n   offline; approval: analyst selection\n   Verification checks structure and integrity, not the truth or currency of observations.\n2. Build a reviewed public Case-pack\n   case-pack \u003ccases.json> --audience public --reviewed --json\n   offline; approval: analyst selection\n   Review minimisation and audience projection before retaining the separate package.\n3. Review deliberate-sharing metadata\n   sharing-review \u003cpackage.json> --marking clear --recipient-scope public --purpose reviewed evidence handoff --human-reviewed --personal-data-reviewed --redactions-confirmed --json\n   offline; approval: analyst selection\n   A clear lint result does not send, upload, publish, or authorise the artefact.\n\nLimitation: The recipe prepares local material only; sharing remains a separate deliberate action.\nLimitation: This document is a fixed plan. It does not execute commands, expand placeholders, make requests, read files, change cases, or submit reports.\nLimitation: Network steps require deliberate execution and disclose the selected target to the sources described by that command.\nLimitation: Analyst-selection steps require reviewed local artefacts; placeholders are never interpreted as file paths by this planner.\n",
  "large": false,
  "downloadName": "synthetic-evidence-handoff-plan.txt",
  "mediaType": "text/plain"
} as const;
