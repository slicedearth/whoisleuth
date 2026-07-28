# External findings import

The Cases view can import a deliberately small JSON document containing findings
collected outside WHOISleuth. The import is local-only and inert: WHOISleuth
validates and previews the complete document before it can add evidence pins to
browser-local cases.

An imported finding is not treated as a WHOISleuth observation. Its source,
observation time, completeness, and limitations remain attached to a separately
labelled evidence pin. WHOISleuth does not independently verify the finding,
change the case's analyst status or disposition, fetch a reference, execute
content, contact a provider, or submit a report.

## Version 1 schema

```json
{
  "schema": "whoisleuth.external-findings",
  "schemaVersion": 1,
  "source": {
    "name": "Local analyst export",
    "reference": "offline review",
    "collectedAt": "2026-07-28T01:00:00.000Z"
  },
  "findings": [
    {
      "domain": "review-target.invalid",
      "category": "page",
      "summary": "A credential form was reported in a retained external observation.",
      "observedAt": "2026-07-28T00:45:00.000Z",
      "completeness": "partial",
      "limitations": [
        "Rendered behavior was not retained."
      ],
      "reference": "finding-17"
    }
  ]
}
```

The root object accepts only `schema`, `schemaVersion`, `source`, and
`findings`. The source accepts only:

- `name`: required text, at most 80 characters;
- `reference`: optional text, at most 500 characters;
- `collectedAt`: optional date and time.

Each finding accepts only:

- `domain`: a required canonicalisable domain;
- `category`: `certificate`, `dns`, `http`, `malware`, `other`, `page`,
  `registration`, or `reputation`;
- `summary`: required text, at most 900 characters;
- `observedAt`: a required date and time;
- `completeness`: `complete`, `inconclusive`, `partial`, or `unknown`;
- `limitations`: up to eight text entries of at most 240 characters each;
- `reference`: optional text, at most 500 characters.

Additional properties, unsupported categories or completeness states, invalid
domains or dates, control characters, empty findings, and future schema
versions reject the whole document.

## Bounds and merge behavior

- Maximum file size: 384 KiB.
- Maximum findings: 100.
- Maximum distinct domains: 25.
- Maximum findings per domain: 20.
- A preview shows at most the first eight validated findings.

Applying a validated preview creates a missing case or adds evidence pins to an
existing one in a single browser-storage update. Existing status, disposition,
notes, assertions, decisions, actions, and evidence remain intact. Reimporting
the same normalized finding from the same named source skips the duplicate.
Normal case-storage limits still apply, including bounded evidence history and
quota-aware pruning.

Imported summaries, references, and limitations become browser-local case data.
They are therefore included in deliberate case or workspace exports. Avoid
including raw provider payloads, expanded registration contacts, credentials,
tokens, or unnecessary URL paths and query strings.
