// Runtime-neutral public product metadata. Rendering this contract performs no
// navigation, collection, storage access, environment discovery, or request.

const METHODOLOGY_TOPICS = Object.freeze([
  Object.freeze({
    id: 'authority',
    title: 'Authority-aware registration decisions',
    summary: 'Only applicable authoritative registry evidence decides registration state. Registrar, WHOIS, DNS, HTTP, mail, page and analyst signals remain supporting context.',
    states: Object.freeze(['complete', 'partial', 'unavailable', 'unsupported', 'conflicting', 'stale']),
  }),
  Object.freeze({
    id: 'families',
    title: 'Separately attributed evidence families',
    summary: 'Registration, DNS, routing, certificate, TLS, transport, HTTP, page, imported, browser-local and analyst-authored records retain their own source identities and limitations.',
    states: Object.freeze(['observed', 'derived', 'imported', 'analyst-authored']),
  }),
  Object.freeze({
    id: 'evidence-state',
    title: 'Absence is never manufactured',
    summary: 'Missing, malformed, skipped, blocked, unsupported, rate-limited, unavailable, partial, stale and inconclusive evidence stays explicit instead of becoming a favourable or negative finding.',
    states: Object.freeze(['complete', 'partial', 'unavailable', 'unsupported', 'conflicting', 'stale']),
  }),
  Object.freeze({
    id: 'triage',
    title: 'Explainable secondary triage',
    summary: 'Risk and Opportunity organise analyst attention through versioned factors and limitations. Neither score is an ownership, legitimacy, safety, intent or maliciousness verdict.',
    states: Object.freeze(['explainable', 'versioned', 'bounded', 'secondary']),
  }),
  Object.freeze({
    id: 'review-items',
    title: 'Review Items and explicit decisions',
    summary: 'Stable subject identities and material fingerprints preserve lifecycle history while reopening evidence that actually changed. Decisions are analyst actions, never inferred from an empty field.',
    states: Object.freeze(['due', 'acknowledged', 'snoozed', 'dismissed', 'reopened']),
  }),
  Object.freeze({
    id: 'modes',
    title: 'Distinct request and review modes',
    summary: 'Fast, Deep, Compact, Bulk, offline review and monitoring retain separate request, storage, scoring, cancellation and partial-result contracts.',
    states: Object.freeze(['fast', 'deep', 'compact', 'bulk', 'offline', 'monitor']),
  }),
  Object.freeze({
    id: 'jobs',
    title: 'Three analyst jobs',
    summary: 'Investigate covers evidence collection and review. Respond covers reviewed action preparation. Assure covers retained change, integrity and controls.',
    states: Object.freeze(['investigate', 'respond', 'assure']),
  }),
  Object.freeze({
    id: 'non-inference',
    title: 'Deliberate non-inferences',
    summary: 'Observed similarity, shared infrastructure, a certificate, a score, a registry publication or missing evidence does not by itself establish safety, ownership, control, attribution, intent, legal status or maliciousness.',
    states: Object.freeze(['no safety verdict', 'no ownership claim', 'no attribution claim', 'no intent claim']),
  }),
] as const);

const COVERAGE_DISTINCTIONS = Object.freeze([
  Object.freeze({ id: 'implemented', label: 'Implemented capability', description: 'A checked-in capability family with an owned execution and evidence contract.' }),
  Object.freeze({ id: 'reviewed', label: 'Fixture- or contract-reviewed support', description: 'Deterministic fixtures or a versioned contract exercise the declared shape and failure states; this is not a live availability measurement.' }),
  Object.freeze({ id: 'optional', label: 'Optional or configuration-dependent', description: 'The implementation exists, but deployment configuration, an explicit variant, local input, a credential, or separate authorisation may be required.' }),
  Object.freeze({ id: 'runtime', label: 'Runtime availability', description: 'Availability is evaluated only when a deliberate operation runs. This public catalogue does not probe a source or deployment.' }),
  Object.freeze({ id: 'unsupported', label: 'Unsupported or intentionally excluded', description: 'The declared boundary excludes behaviours such as arbitrary execution, automatic enforcement, implicit active collection and unbounded custody.' }),
  Object.freeze({ id: 'partial', label: 'Bounded omissions and partial results', description: 'Limits, truncation, source failure and unsupported states remain visible; omitted data is never reported as absent.' }),
] as const);

const CLI_PUBLIC_GUIDANCE = Object.freeze({
  runOnce: Object.freeze([
    'npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth --help',
    'npm exec --yes --ignore-scripts --package=@slicedearth/whoisleuth-cli -- whoisleuth example.test --plan --json',
  ]),
  install: Object.freeze([
    'npm install --global --ignore-scripts @slicedearth/whoisleuth-cli',
    'whoisleuth doctor',
  ]),
  update: Object.freeze([
    'npm install --global --ignore-scripts @slicedearth/whoisleuth-cli@latest',
    'whoisleuth --version',
    'whoisleuth doctor',
  ]),
  verification: Object.freeze([
    'Confirm Node.js 24 or later and compare whoisleuth --version with the reviewed release you intended to install.',
    'Review the scoped package identity, source location, licence, notices and registry-provided integrity or provenance metadata before relying on an installation.',
    'A matching package digest detects changed bytes; it does not establish who operated the terminal or whether observed evidence is true or current.',
    'Release-specific final evidence is published only with the reviewed release; this page does not claim a future release has completed that assurance.',
  ]),
  commonWorkflows: Object.freeze([
    Object.freeze({ label: 'Plan before collection', command: 'whoisleuth lookup example.test --deep --plan --json' }),
    Object.freeze({ label: 'Review supplied evidence offline', command: 'whoisleuth review-evidence evidence.json --json' }),
    Object.freeze({ label: 'Compare retained observations', command: 'whoisleuth diff earlier.json later.json --json' }),
    Object.freeze({ label: 'Discover fixed workflow recipes', command: 'whoisleuth workflow-plan --list --json' }),
    Object.freeze({ label: 'Explain one recipe', command: 'whoisleuth workflow-plan --explain evidence-handoff' }),
    Object.freeze({ label: 'Prepare a reviewed public handoff', command: 'whoisleuth case-pack cases.json --audience public --reviewed --json' }),
  ]),
  exitCodes: Object.freeze([
    Object.freeze({ code: 0, meaning: 'Command completed; individual evidence sources may still be partial or inconclusive.' }),
    Object.freeze({ code: 2, meaning: 'Command, option, input, or standard-input shape was invalid.' }),
    Object.freeze({ code: 3, meaning: 'The requested collection, lookup, or comparison could not run.' }),
    Object.freeze({ code: 4, meaning: 'A bounded operation completed partially or met an explicit failure policy.' }),
    Object.freeze({ code: 70, meaning: 'Unexpected CLI bootstrap failure.' }),
    Object.freeze({ code: 130, meaning: 'The analyst cancelled; no partial final result was emitted.' }),
    Object.freeze({ code: 143, meaning: 'The process received SIGTERM; no partial final result was emitted.' }),
  ]),
  configuration: Object.freeze([
    'Version-1 local profiles can set only safe presentation, Fast-mode, bounded concurrency, observer and vantage defaults.',
    'Profiles cannot add a target, enable Deep collection, choose an output path, approve network work, or set a failure policy.',
    'Explicit command options override defaults from the same option group.',
  ]),
  handoffs: Object.freeze([
    'Browser exports and CLI artefacts remain separate versioned documents; compatibility and privacy projections are checked before import or packaging.',
    'A browser handoff prepares or imports reviewed local material. It does not upload, submit, publish, enforce, or start monitoring.',
  ]),
  boundaries: Object.freeze([
    'Offline commands may read only deliberately selected bounded files or standard input and make no request.',
    'Network commands run from the local machine and disclose the selected target only to the source classes declared by that command.',
    'Authorised active commands require their dedicated acknowledgement and never enter Lookup, Bulk, monitoring, or an automatic recipe.',
    'Redirected and machine-readable output contains no ANSI; file output is bounded, private, atomic and refuses replacement without --force.',
  ]),
});

export {
  CLI_PUBLIC_GUIDANCE,
  COVERAGE_DISTINCTIONS,
  METHODOLOGY_TOPICS,
};
