// Runtime-neutral public product metadata. Rendering this contract performs no
// navigation, collection, storage access, environment discovery, or request.

const METHODOLOGY_TOPICS = Object.freeze([
  Object.freeze({
    id: 'authority',
    title: 'Authority-aware registration decisions',
    summary: 'Authoritative registration publications take precedence. If they are inconclusive, positive authoritative DNS delegation can support registered status at medium confidence. Missing DNS never proves availability; HTTP, mail, page and analyst signals remain supporting context.',
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
  operationModes: Object.freeze([
    Object.freeze({
      id: 'hosted-console', title: 'Hosted console', availability: 'Website', packageManifest: null,
      task: 'Investigate in the browser and keep cases, brands and watchlists together.',
      prerequisites: 'A supported browser and access to the console. Nothing to install locally.',
      requests: 'Collection goes through the website service and runs from its host. Optional sources depend on that deployment; each action discloses what it sends.',
      storage: 'Saved work stays in the current browser profile. Unencrypted workspaces are plaintext; encrypted named workspaces are optional. Separately configured scheduled monitoring has its own limited hosted storage.',
      offline: 'Selected-file analysis and retained-evidence review run locally after the page loads. The hosted website is not an offline installation.',
      href: '/resources', linkLabel: 'Console task guide',
    }),
    Object.freeze({
      id: 'local-console', title: 'Local application', availability: 'Local archive only', packageManifest: 'packages/local-application/package.json',
      task: 'Use the console with a filesystem workspace on your own computer.',
      prerequisites: 'A verified, locally assembled archive. Open its private launch link; no hosted login is used.',
      requests: 'Explicit collection runs from your computer. Start with --offline to disable collection; starting the application does not investigate a target.',
      storage: 'Records, drafts and originals live in the selected SQLite folder in plaintext. Encrypted portable backups are separate. Appearance preferences remain browser-local.',
      offline: 'The installed application serves its own pages over loopback. With --offline, review saved work and selected files without collection. Loopback cookies are host-scoped, not isolated by port; use a dedicated browser profile alongside other local servers.',
      href: '#local-application', linkLabel: 'Local application setup',
    }),
    Object.freeze({
      id: 'main-cli', title: 'Command-line tool', availability: 'Public npm package', packageManifest: 'packages/cli/package.template.json',
      task: 'Collect, inspect and verify evidence from a terminal or an explicit workflow.',
      prerequisites: 'Install the public package or run its help once; check the installed version and command help.',
      requests: 'Networked commands run from your computer, not the hosted service. Plans and commands labelled offline do not collect evidence; doctor is offline unless --network is selected.',
      storage: 'Commands use deliberately selected local inputs and output files, not the browser workspace. Ordinary files are plaintext; encrypted-package commands are separate.',
      offline: 'After installation, offline commands need only their declared local inputs. Package installation or updating can require a registry download.',
      href: '#start', linkLabel: 'CLI installation commands',
    }),
    Object.freeze({
      id: 'rendered-capture', title: 'Capture companion', availability: 'Separate local archive only', packageManifest: 'packages/web-capture/package.json',
      task: 'Render one explicitly authorised page or compare two existing captures offline.',
      prerequisites: 'Its own verified local archive. Rendering also needs the separately installed matching browser and supported sandbox; help and comparison do not.',
      requests: 'An authorised capture executes page JavaScript and contacts admitted resource operators from your computer. The browser and pinned collector enforce the companion’s request boundaries. It is not part of the main CLI or hosted console.',
      storage: 'Screenshots and minimised manifests are local output files, unencrypted. Screenshots can contain sensitive visible content; review them before sharing.',
      offline: 'Comparison of supplied captures makes no request. Capturing a page and explicitly downloading the browser require network access.',
      href: '#capture-companion', linkLabel: 'Capture companion setup',
    }),
  ]),
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
  localArchive: Object.freeze({
    install: 'npm install --offline --ignore-scripts --omit=optional ./reviewed-local-archive.tgz',
    initialize: 'npx --no-install whoisleuth-local --workspace ./review-workspace --init --offline',
    reopen: 'npx --no-install whoisleuth-local --workspace ./review-workspace --offline',
    verification: Object.freeze([
      'Use the selected candidate report to check packageName, packageVersion, applicationVersion and archiveSha256. The local package and enclosed application have separate versions.',
      'Compare the complete archive SHA-256 with archiveSha256 before installing. A matching digest establishes corresponding bytes, not publisher identity or evidence accuracy.',
      'Archive assembly downloads existing pinned dependencies. Installation from the bundled reviewed archive stays offline with scripts disabled; this channel is not a public npm release.',
    ]),
    upgrade: Object.freeze([
      'Stop every instance using the workspace, then keep an unchanged private whole-folder recovery copy. SQLite and that copy are plaintext.',
      'Verify the new archive against its own report and install it separately. Reopen a separate rehearsal copy offline without --init; keep the recovery copy untouched.',
      'Check saved records, recovery drafts and original-file integrity, not just startup. Keep the earlier installation and untouched copy until verification is complete.',
      'An unsupported workspace version must remain unchanged. Use a compatible application or supported portable backup; never edit a schema marker to force opening.',
    ]),
  }),
  commonWorkflows: Object.freeze([
    Object.freeze({ label: 'Plan before collection', command: 'whoisleuth lookup example.test --deep --plan --json' }),
    Object.freeze({ label: 'Review supplied evidence offline', command: 'whoisleuth review-evidence evidence.json --json' }),
    Object.freeze({ label: 'Compare retained observations', command: 'whoisleuth diff earlier.json later.json --json' }),
    Object.freeze({ label: 'Discover fixed workflow recipes', command: 'whoisleuth workflow-plan --list --json' }),
    Object.freeze({ label: 'Create an offline case file', command: 'whoisleuth case open --domain example.test --output cases.json' }),
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
  interchangeRecipes: Object.freeze([
    Object.freeze({
      id: 'workspace-verification',
      label: 'Check a browser workspace before restoring it',
      commands: Object.freeze([
        'whoisleuth verify-artifact workspace.json --json',
        'whoisleuth interchange-report workspace.json --json',
      ]),
      result: 'Review structure, section integrity, supported versions and the proposed browser import before applying any records.',
    }),
    Object.freeze({
      id: 'lookup-replay',
      label: 'Continue a CLI Lookup in the browser',
      commands: Object.freeze([
        'whoisleuth lookup example.test --deep --browse --save-lookup lookup.json',
        'whoisleuth verify-artifact lookup.json --json',
        'whoisleuth export lookup.json --output evidence.json',
        'whoisleuth verify-artifact evidence.json --json',
      ]),
      result: 'Keep lookup.json as the private CLI original. Replay evidence.json from Lookup in the console, inspect its source states and then choose whether to retain it in a case.',
    }),
    Object.freeze({
      id: 'case-handoff',
      label: 'Prepare a reviewed case handoff',
      commands: Object.freeze([
        'whoisleuth case-pack cases.json --audience public --reviewed --json --output case-pack.json',
        'whoisleuth sharing-review case-pack.json --marking clear --recipient-scope public --purpose "Reviewed evidence handoff" --human-reviewed --personal-data-reviewed --redactions-confirmed --json',
      ]),
      result: 'Verify the output digest and review the audience projection before deliberately sharing the separate file.',
    }),
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
