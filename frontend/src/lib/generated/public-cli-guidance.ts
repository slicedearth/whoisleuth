// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_CLI_GUIDANCE = {
  "runOnce": [
    "npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help",
    "npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth example.test --plan --json"
  ],
  "install": [
    "npm install --global --ignore-scripts @slicedearth/whoisleuth-cli",
    "whoisleuth doctor"
  ],
  "update": [
    "npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest",
    "whoisleuth --version",
    "whoisleuth doctor"
  ],
  "verification": [
    "Confirm Node.js 24 or later and compare whoisleuth --version with the reviewed release you intended to install.",
    "Review the scoped package identity, source location, licence, notices and registry-provided integrity or provenance metadata before relying on an installation.",
    "A matching package digest detects changed bytes; it does not establish who operated the terminal or whether observed evidence is true or current.",
    "Release-specific final evidence is published only with the reviewed release; this page does not claim a future release has completed that assurance."
  ],
  "commonWorkflows": [
    {
      "label": "Plan before collection",
      "command": "whoisleuth lookup example.test --deep --plan --json"
    },
    {
      "label": "Review supplied evidence offline",
      "command": "whoisleuth review-evidence evidence.json --json"
    },
    {
      "label": "Compare retained observations",
      "command": "whoisleuth diff earlier.json later.json --json"
    },
    {
      "label": "Discover fixed workflow recipes",
      "command": "whoisleuth workflow-plan --list --json"
    },
    {
      "label": "Explain one recipe",
      "command": "whoisleuth workflow-plan --explain evidence-handoff"
    },
    {
      "label": "Prepare a reviewed public handoff",
      "command": "whoisleuth case-pack cases.json --audience public --reviewed --json"
    }
  ],
  "exitCodes": [
    {
      "code": 0,
      "meaning": "Command completed; individual evidence sources may still be partial or inconclusive."
    },
    {
      "code": 2,
      "meaning": "Command, option, input, or standard-input shape was invalid."
    },
    {
      "code": 3,
      "meaning": "The requested collection, lookup, or comparison could not run."
    },
    {
      "code": 4,
      "meaning": "A bounded operation completed partially or met an explicit failure policy."
    },
    {
      "code": 70,
      "meaning": "Unexpected CLI bootstrap failure."
    },
    {
      "code": 130,
      "meaning": "The analyst cancelled; no partial final result was emitted."
    },
    {
      "code": 143,
      "meaning": "The process received SIGTERM; no partial final result was emitted."
    }
  ],
  "configuration": [
    "Version-1 local profiles can set only safe presentation, Fast-mode, bounded concurrency, observer and vantage defaults.",
    "Profiles cannot add a target, enable Deep collection, choose an output path, approve network work, or set a failure policy.",
    "Explicit command options override defaults from the same option group."
  ],
  "handoffs": [
    "Browser exports and CLI artefacts remain separate versioned documents; compatibility and privacy projections are checked before import or packaging.",
    "A browser handoff prepares or imports reviewed local material. It does not upload, submit, publish, enforce, or start monitoring."
  ],
  "boundaries": [
    "Offline commands may read only deliberately selected bounded files or standard input and make no request.",
    "Network commands run from the local machine and disclose the selected target only to the source classes declared by that command.",
    "Authorised active commands require their dedicated acknowledgement and never enter Lookup, Bulk, monitoring, or an automatic recipe.",
    "Redirected and machine-readable output contains no ANSI; file output is bounded, private, atomic and refuses replacement without --force."
  ]
} as const;
