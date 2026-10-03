// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "case-recheck-input",
  "title": "Case incomplete-recheck input",
  "format": "JSON",
  "direction": "input",
  "command": "whoisleuth case recheck synthetic-cases.json --input synthetic-recheck.json --output reviewed-cases.json",
  "summary": "An unavailable observation, not a removal or takedown conclusion.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "{\n  \"state\": \"unavailable\",\n  \"observedAt\": \"2026-08-23T00:00:00.000Z\",\n  \"completeness\": \"partial\",\n  \"source\": \"Fictional later capture\",\n  \"comparisonSummary\": \"The later capture did not complete.\",\n  \"limitations\": [\n    \"No later page content is available.\"\n  ]\n}",
  "large": false,
  "downloadName": "synthetic-recheck.json",
  "mediaType": "application/json"
} as const;
