// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "case-pin-input",
  "title": "Case evidence-pin input",
  "format": "JSON",
  "direction": "input",
  "command": "whoisleuth case pin synthetic-cases.json --input synthetic-pin.json --output reviewed-cases.json",
  "summary": "An observation with its own source, time and partial coverage.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "{\n  \"label\": \"Selected page observation\",\n  \"value\": \"A form was retained in the supplied fictional capture.\",\n  \"source\": \"Analyst supplied fictional capture\",\n  \"observedAt\": \"2026-08-23T00:00:00.000Z\",\n  \"completeness\": \"partial\",\n  \"sourceState\": \"partial\",\n  \"observationHostname\": \"example.test\",\n  \"limitations\": [\n    \"One supplied page only.\"\n  ]\n}",
  "large": false,
  "downloadName": "synthetic-pin.json",
  "mediaType": "application/json"
} as const;
