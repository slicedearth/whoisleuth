// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_METHODOLOGY = {
  "topics": [
    {
      "id": "authority",
      "title": "Authority-aware registration decisions",
      "summary": "Only applicable authoritative registry evidence decides registration state. Registrar, WHOIS, DNS, HTTP, mail, page and analyst signals remain supporting context.",
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
  ]
} as const;
