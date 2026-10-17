// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_METHODOLOGY = {
  "topics": [
    {
      "id": "authority",
      "title": "Authority-aware registration decisions",
      "summary": "Authoritative registration publications take precedence. If they are inconclusive, positive authoritative DNS delegation can support registered status at medium confidence. Missing DNS never proves availability; HTTP, mail, page and analyst signals remain supporting context.",
      "states": [
        "complete",
        "partial",
        "unavailable",
        "unsupported",
        "conflicting",
        "stale"
      ]
    },
    {
      "id": "families",
      "title": "Separately attributed evidence families",
      "summary": "Registration, DNS, routing, certificate, TLS, transport, HTTP, page, imported, browser-local and analyst-authored records retain their own source identities and limitations.",
      "states": [
        "observed",
        "derived",
        "imported",
        "analyst-authored"
      ]
    },
    {
      "id": "evidence-state",
      "title": "Absence is never manufactured",
      "summary": "Missing, malformed, skipped, blocked, unsupported, rate-limited, unavailable, partial, stale and inconclusive evidence stays explicit instead of becoming a favourable or negative finding.",
      "states": [
        "complete",
        "partial",
        "unavailable",
        "unsupported",
        "conflicting",
        "stale"
      ]
    },
    {
      "id": "triage",
      "title": "Explainable secondary triage",
      "summary": "Risk and Opportunity organise analyst attention through versioned factors and limitations. Neither score is an ownership, legitimacy, safety, intent or maliciousness verdict.",
      "states": [
        "explainable",
        "versioned",
        "bounded",
        "secondary"
      ]
    },
    {
      "id": "review-items",
      "title": "Review Items and explicit decisions",
      "summary": "Stable subject identities and material fingerprints preserve lifecycle history while reopening evidence that actually changed. Decisions are analyst actions, never inferred from an empty field.",
      "states": [
        "due",
        "acknowledged",
        "snoozed",
        "dismissed",
        "reopened"
      ]
    },
    {
      "id": "modes",
      "title": "Distinct request and review modes",
      "summary": "Fast, Deep, Compact, Bulk, offline review and monitoring retain separate request, storage, scoring, cancellation and partial-result contracts.",
      "states": [
        "fast",
        "deep",
        "compact",
        "bulk",
        "offline",
        "monitor"
      ]
    },
    {
      "id": "jobs",
      "title": "Three analyst jobs",
      "summary": "Investigate covers evidence collection and review. Respond covers reviewed action preparation. Assure covers retained change, integrity and controls.",
      "states": [
        "investigate",
        "respond",
        "assure"
      ]
    },
    {
      "id": "non-inference",
      "title": "Deliberate non-inferences",
      "summary": "Observed similarity, shared infrastructure, a certificate, a score, a registry publication or missing evidence does not by itself establish safety, ownership, control, attribution, intent, legal status or maliciousness.",
      "states": [
        "no safety verdict",
        "no ownership claim",
        "no attribution claim",
        "no intent claim"
      ]
    }
  ],
  "examples": [
    {
      "id": "conflicting-page-accounts",
      "title": "Two page accounts disagree",
      "claim": "A password form appeared in the supplied capture.",
      "conclusion": "The capture supports that limited statement. It does not establish what every visitor saw, who controlled the page or whether credentials were submitted.",
      "sources": [
        {
          "id": "capture",
          "role": "Supporting observation",
          "label": "Selected page observation",
          "value": "A form asking for a password appears in the supplied fictional capture.",
          "source": "Analyst supplied fictional capture",
          "observedAt": "2026-08-22T00:00:00.000Z",
          "completeness": "partial",
          "sourceState": "partial",
          "observationHostname": "example.test",
          "limitations": [
            "One supplied page only. No credentials were submitted."
          ]
        },
        {
          "id": "other-review",
          "role": "Contrary account",
          "label": "Separate page review",
          "value": "A separate supplied review reports that no password form was seen.",
          "source": "Fictional separate reviewer account",
          "observedAt": "2026-08-22T00:00:00.000Z",
          "completeness": "partial",
          "sourceState": "partial",
          "observationHostname": "example.test",
          "limitations": [
            "The reviewed path and viewport were not recorded. This cannot resolve the supplied capture."
          ]
        }
      ],
      "unknowns": [
        "The other review has no recorded path or viewport, so the accounts are not directly comparable.",
        "The current page, operator and any credential submission remain unestablished."
      ],
      "rule": {
        "href": "#method-families",
        "label": "Keep source accounts separate"
      },
      "example": {
        "href": "/examples#example-case-assess-input",
        "label": "Inspect the fictional assessment input"
      }
    },
    {
      "id": "unavailable-page-recheck",
      "title": "A later recheck did not complete",
      "claim": "The password form has been removed.",
      "conclusion": "Not established. An unavailable recheck supplies no later page content. The earlier observation is context, not evidence for or against the current state.",
      "sources": [
        {
          "id": "earlier-capture",
          "role": "Earlier context, not current contrary evidence",
          "label": "Selected page observation",
          "value": "A form asking for a password appears in the supplied fictional capture.",
          "source": "Analyst supplied fictional capture",
          "observedAt": "2026-08-22T00:00:00.000Z",
          "completeness": "partial",
          "sourceState": "partial",
          "observationHostname": "example.test",
          "limitations": [
            "One supplied page only. No credentials were submitted."
          ]
        },
        {
          "id": "recheck",
          "role": "Unavailable later observation",
          "label": "Incomplete page recheck",
          "value": "The later capture did not complete.",
          "source": "Fictional later capture",
          "observedAt": "2026-08-23T00:00:00.000Z",
          "completeness": "partial",
          "sourceState": "unavailable",
          "observationHostname": null,
          "limitations": [
            "No later page content is available."
          ]
        }
      ],
      "unknowns": [
        "No complete later observation supports removal or continued presence.",
        "A comparable review of the same page would be needed; this example starts no collection."
      ],
      "rule": {
        "href": "#method-evidence-state",
        "label": "Keep unavailable evidence distinct from absence"
      },
      "example": {
        "href": "/examples#example-case-recheck-input",
        "label": "Inspect the fictional recheck input"
      }
    }
  ]
} as const;
