// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_CLI_INDEX = {
  "commandCount": 47,
  "groups": [
    "investigate",
    "respond",
    "assure",
    "utilities"
  ],
  "modes": [
    "offline",
    "network"
  ],
  "commands": [
    {
      "id": "completion",
      "summary": "Print shell completion",
      "group": "utilities",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "doctor",
      "summary": "Check the local CLI runtime",
      "group": "utilities",
      "common": true,
      "mode": "network"
    },
    {
      "id": "commands",
      "summary": "List installed command contracts",
      "group": "utilities",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "manual",
      "summary": "Print the generated manual page",
      "group": "utilities",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "manifest",
      "summary": "Build an evidence manifest offline",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "map-observations",
      "summary": "Apply a declarative observation map offline",
      "group": "respond",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "oam-export",
      "summary": "Project external findings to Open Asset Model",
      "group": "respond",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "lookup",
      "summary": "Collect one domain, IP, or ASN",
      "group": "investigate",
      "common": true,
      "mode": "network"
    },
    {
      "id": "bulk",
      "summary": "Run bounded multi-target collection",
      "group": "investigate",
      "common": true,
      "mode": "network"
    },
    {
      "id": "ct-search",
      "summary": "Search certificate observations",
      "group": "investigate",
      "common": false,
      "mode": "network"
    },
    {
      "id": "ct-intake",
      "summary": "Normalise certificate observations offline",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "discover",
      "summary": "Generate lookalike candidates offline",
      "group": "investigate",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "discover-scan",
      "summary": "Collect a supervised candidate review queue",
      "group": "investigate",
      "common": true,
      "mode": "network"
    },
    {
      "id": "posture",
      "summary": "Review DNS and mail posture",
      "group": "investigate",
      "common": false,
      "mode": "network"
    },
    {
      "id": "http",
      "summary": "Inspect one homepage request",
      "group": "investigate",
      "common": false,
      "mode": "network"
    },
    {
      "id": "tls",
      "summary": "Inspect one TLS connection",
      "group": "investigate",
      "common": false,
      "mode": "network"
    },
    {
      "id": "dnssec-validate",
      "summary": "Validate an authorised DNSSEC chain",
      "group": "assure",
      "common": false,
      "mode": "network"
    },
    {
      "id": "mail-transport",
      "summary": "Review selected authorised SMTP transports",
      "group": "assure",
      "common": false,
      "mode": "network"
    },
    {
      "id": "registry-support",
      "summary": "Explain local registry coverage",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "registry-doctor",
      "summary": "Diagnose saved registry collection",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "registry-cohort",
      "summary": "Build target-free registry quality timelines",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "registry-scaffold",
      "summary": "Create a sanitised registry fixture scaffold",
      "group": "utilities",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "risk-calibrate",
      "summary": "Replay reviewed Risk labels offline",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "lookalike-calibrate",
      "summary": "Summarise reviewed lookalike yield offline",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "verify-artifact",
      "summary": "Validate saved evidence offline",
      "group": "assure",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "interchange-report",
      "summary": "Report portable artefact fidelity offline",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "inspect-archive",
      "summary": "Inspect an archive locally",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "sign-artifact",
      "summary": "Sign a reviewed artefact locally",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "verify-signature",
      "summary": "Verify a signed evidence package",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "source-report",
      "summary": "Build a target-free source report",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "compare",
      "summary": "Compare registry publications in one lookup",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "page-compare",
      "summary": "Compare saved static page evidence",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "mail-review",
      "summary": "Review saved passive mail evidence",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "review-evidence",
      "summary": "Review supplied evidence offline",
      "group": "investigate",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "brief",
      "summary": "Build a decision brief from a saved lookup",
      "group": "investigate",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "case-pack",
      "summary": "Build a reviewed case package",
      "group": "respond",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "domain-control",
      "summary": "Build or review a domain control manifest",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "monitor-once",
      "summary": "Run one bounded domain control review",
      "group": "assure",
      "common": false,
      "mode": "network"
    },
    {
      "id": "assurance",
      "summary": "Review domain change, recovery, or retirement plans",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "change-packet",
      "summary": "Build a reviewed change packet offline",
      "group": "respond",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "sharing-review",
      "summary": "Lint an artefact before deliberate sharing",
      "group": "respond",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "workflow-plan",
      "summary": "Plan a fixed investigation recipe",
      "group": "assure",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "workflow-run",
      "summary": "Execute approved fixed-recipe steps",
      "group": "assure",
      "common": false,
      "mode": "network"
    },
    {
      "id": "diff",
      "summary": "Compare two compatible retained artefacts",
      "group": "assure",
      "common": true,
      "mode": "offline"
    },
    {
      "id": "reconcile",
      "summary": "Reconcile independently labelled observations",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "timeline",
      "summary": "Build same-domain history from saved lookups",
      "group": "assure",
      "common": false,
      "mode": "offline"
    },
    {
      "id": "export",
      "summary": "Convert a lookup to an evidence report",
      "group": "respond",
      "common": true,
      "mode": "offline"
    }
  ],
  "workflows": [
    {
      "id": "domain-triage",
      "label": "New domain triage",
      "objective": "Collect and preserve separately attributed registration, DNS, HTTP, TLS, page, and network-context evidence.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": true
    },
    {
      "id": "lookalike-review",
      "label": "Lookalike candidate review",
      "objective": "Generate a bounded candidate queue, collect only the selected scope, and retain a reviewed candidate lookup.",
      "subjectRequirement": "brand_or_domain",
      "runnableByWorkflowRun": true
    },
    {
      "id": "owned-domain-review",
      "label": "Owned domain posture review",
      "objective": "Review current passive posture and compare supplied observations with an analyst-authored control manifest.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": true
    },
    {
      "id": "historical-comparison",
      "label": "Historical observation comparison",
      "objective": "Collect a current observation and compare it with analyst-selected saved observations without merging source states.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": true
    },
    {
      "id": "campaign-review",
      "label": "Campaign candidate review",
      "objective": "Prepare a bounded candidate set, collect a deliberately selected queue, and review retained evidence without asserting campaign attribution.",
      "subjectRequirement": "brand_or_domain",
      "runnableByWorkflowRun": false
    },
    {
      "id": "certificate-anomaly",
      "label": "Certificate anomaly review",
      "objective": "Review bounded certificate observations alongside current source-qualified domain evidence without treating issuance as proof of control or intent.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": false
    },
    {
      "id": "registry-disagreement",
      "label": "Registry disagreement review",
      "objective": "Collect separately attributed registration evidence and review conflicting publications without selecting an arbitrary source as truth.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": false
    },
    {
      "id": "evidence-handoff",
      "label": "Reviewed evidence handoff",
      "objective": "Verify, minimise, and package analyst-selected evidence for a deliberate handoff without transmitting or submitting it.",
      "subjectRequirement": "review_label",
      "runnableByWorkflowRun": false
    },
    {
      "id": "planned-domain-change",
      "label": "Planned domain change",
      "objective": "Review an analyst-authored desired state and prepare bounded change material without changing DNS, registry, mail, or hosted configuration.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": false
    },
    {
      "id": "post-change-verification",
      "label": "Post-change verification",
      "objective": "Perform one explicit later observation and compare it with analyst-selected retained evidence after an authorised change.",
      "subjectRequirement": "domain",
      "runnableByWorkflowRun": false
    }
  ]
} as const;
