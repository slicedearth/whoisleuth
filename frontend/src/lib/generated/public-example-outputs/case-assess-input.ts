// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "case-assess-input",
  "title": "Case assessment input",
  "format": "JSON",
  "direction": "input",
  "command": "whoisleuth case assess synthetic-cases.json --input synthetic-assess.json --output reviewed-cases.json",
  "summary": "A reviewed disposition linked to a new source-qualified pin. Replace every fictional claim before using it.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "{\n  \"disposition\": \"suspicious\",\n  \"reviewReasonCode\": \"other_reviewed\",\n  \"summary\": \"Review the apparent credential request\",\n  \"rationale\": \"The supplied observation needs independent corroboration.\",\n  \"evidence\": [\n    {\n      \"pin\": {\n        \"label\": \"Selected page observation\",\n        \"value\": \"A form was retained in the supplied fictional capture.\",\n        \"source\": \"Analyst supplied fictional capture\",\n        \"observedAt\": \"2026-08-23T00:00:00.000Z\",\n        \"completeness\": \"partial\",\n        \"sourceState\": \"partial\",\n        \"observationHostname\": \"example.test\",\n        \"limitations\": [\n          \"One supplied page only.\"\n        ]\n      },\n      \"stance\": \"supports\"\n    }\n  ]\n}",
  "large": false,
  "downloadName": "synthetic-assess.json",
  "mediaType": "application/json"
} as const;
