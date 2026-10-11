// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "case-assess-input",
  "title": "Case assessment input",
  "format": "JSON",
  "direction": "input",
  "command": "whoisleuth case assess synthetic-cases.json --input synthetic-assess.json --output reviewed-cases.json",
  "summary": "A reviewed disposition linked to separate supporting and contrary source accounts. Replace every fictional claim before using it.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "{\n  \"disposition\": \"suspicious\",\n  \"reviewReasonCode\": \"other_reviewed\",\n  \"summary\": \"Review the apparent credential request\",\n  \"rationale\": \"Keep both accounts; the separate review has no recorded path or viewport.\",\n  \"evidence\": [\n    {\n      \"pin\": {\n        \"label\": \"Selected page observation\",\n        \"value\": \"A form asking for a password appears in the supplied fictional capture.\",\n        \"source\": \"Analyst supplied fictional capture\",\n        \"observedAt\": \"2026-08-22T00:00:00.000Z\",\n        \"completeness\": \"partial\",\n        \"sourceState\": \"partial\",\n        \"observationHostname\": \"example.test\",\n        \"limitations\": [\n          \"One supplied page only. No credentials were submitted.\"\n        ]\n      },\n      \"stance\": \"supports\"\n    },\n    {\n      \"pin\": {\n        \"label\": \"Separate page review\",\n        \"value\": \"A separate supplied review reports that no password form was seen.\",\n        \"source\": \"Fictional separate reviewer account\",\n        \"observedAt\": \"2026-08-22T00:00:00.000Z\",\n        \"completeness\": \"partial\",\n        \"sourceState\": \"partial\",\n        \"observationHostname\": \"example.test\",\n        \"limitations\": [\n          \"The reviewed path and viewport were not recorded. This cannot resolve the supplied capture.\"\n        ]\n      },\n      \"stance\": \"contradicts\"\n    }\n  ]\n}",
  "large": false,
  "downloadName": "synthetic-assess.json",
  "mediaType": "application/json"
} as const;
