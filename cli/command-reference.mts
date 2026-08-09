import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';
import type { CliCommand } from './arguments.mts';
import type { CommandCollection, CommandDetail } from './manual.mts';

// Human-facing command reference kept separate from command execution so
// additions do not expand the already broad runtime controller.

const HELP = `WHOISleuth CLI
Source-aware domain investigation from your terminal.

Quick start:
  whoisleuth lookup example.test
  whoisleuth lookup example.test --deep
  cat domains.txt | whoisleuth bulk --jsonl

Investigate:
  lookup             Collect one domain, IP, or ASN.
  bulk               Triage newline-delimited targets with bounded concurrency.
  http               Inspect one homepage request and redirect chain.
  tls                Inspect one hostname's current certificate connection.
  posture            Review DNS mail and domain-control posture.

Discover:
  ct-search          Search certificate-transparency observations.
  ct-intake          Normalise a local certificate event batch for case import.
  discover           Generate offline lookalike candidates.
  discover-scan      Collect a bounded candidate review queue.
  registry-support   Explain local registry coverage without a request.
  registry-doctor    Diagnose a saved registry collection against local policy.
  registry-cohort    Aggregate target-free registry quality cohorts.
  registry-scaffold  Create a sanitised synthetic fixture scaffold.

Review saved evidence:
  map-observations    Apply a declarative profile to local observations.
  oam-export          Project external findings into an open asset graph.
  source-report      Summarise source reliability without retaining targets.
  compare            Compare saved registry publications.
  page-compare       Compare saved static page and TLS evidence.
  mail-review        Review saved passive mail exposure evidence.
  review-evidence    Review supplied DNS, routing, GeoIP, RDAP, or trust-store evidence offline.
  brief              Turn one saved Lookup into a bounded decision brief.
  case-pack          Build a reviewed browser-importable case package.
  domain-control     Build or review an integrity-protected desired-state manifest.
  monitor-once       Run one bounded domain-control review and checkpoint.
  assurance          Review change, recovery, concentration, or retirement plans.
  change-packet      Assemble a digest-protected domain change review packet.
  sharing-review     Lint a reviewed artifact before deliberate sharing.
  workflow-plan      Plan a fixed investigation recipe without executing it.
  workflow-run       Execute resumable approved steps from a fixed recipe.
  diff               Compare two saved domain observations.
  reconcile          Reconcile independently labelled observations.
  timeline           Compare a sequence of observations for one domain.
  export             Convert a saved lookup into an evidence report.
  inspect-archive    Inspect a workspace archive, redacted by default.
  verify-artifact    Validate saved evidence or an integrity envelope offline.
  interchange-report Report preserved and excluded field groups offline.

Integrity and calibration:
  manifest           Record ordered artefact and configuration digests.
  sign-artifact      Sign one reviewed packet or manifest locally.
  verify-signature   Verify one signed evidence package locally.
  risk-calibrate     Replay reviewed labels without changing the model.
  lookalike-calibrate Summarise reviewed mutation-family yield without tuning generation.

Terminal:
  doctor             Check the local runtime; network tests require --network.
  commands           List command contracts for people or local tooling.
  completion         Print completion for bash, zsh, fish, or PowerShell.
  manual             Print the generated manual page.

Run "whoisleuth <command> --help" for focused usage and an example.
Use --json or --jsonl where supported for machine-readable stdout.
Use --output <file> for atomic private file output and --force to replace it.
Use --config <file> and --profile <name> for explicit versioned safe defaults.
Diagnostics are written to stderr. Fast lookup is the default; deep collection
must be requested explicitly and can disclose a target to additional sources.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
Source and licence: ${WHOISLEUTH_SOURCE_REPOSITORY_URL}
`;
const COMMAND_USAGE: Readonly<Record<CliCommand, string>> = Object.freeze({
  completion: 'whoisleuth completion <bash|zsh|fish|powershell>',
  doctor: 'whoisleuth doctor [--network] [--json] [--quiet] [--no-color]',
  commands: 'whoisleuth commands [--json] [--quiet] [--no-color]',
  manual: 'whoisleuth manual',
  manifest: 'whoisleuth manifest <artefact.json> [...] --workflow <label> [--configuration-digest <sha256:digest>] [--json] [--quiet] [--no-color]',
  'map-observations': 'whoisleuth map-observations [mapping.json] [--json] [--quiet] [--no-color]',
  'oam-export': 'whoisleuth oam-export [external-findings.json] [--json] [--quiet] [--no-color]',
  lookup: 'whoisleuth lookup <domain|IP|ASN> [--json|--junit|--markdown|--html] [--no-attribution] [--fast|--deep] [--observer <label>] [--vantage <label>] [--plan] [--summary|--verbose] [--strict-exit] [--fail-on <policies>] [--events] [--quiet] [--no-color]',
  bulk: 'whoisleuth bulk [file] [--json|--jsonl|--junit|--csv|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency <1-8>] [--checkpoint <file> [--resume]] [--events] [--plan] [--fail-on <policies>]',
  'ct-search': 'whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]',
  'ct-intake': 'whoisleuth ct-intake [events.json] [--json] [--quiet] [--no-color]',
  discover: 'whoisleuth discover <brand|domain> [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--snapshot <file>] [--json|--jsonl|--domains]',
  'discover-scan': 'whoisleuth discover-scan <brand|domain> [--fast|--deep] [--scan-limit <n>] [--chunk-size <n>] [--concurrency <n>] [--resolver <IPs>] [--allowlist <file>] [--checkpoint <file> [--resume]] [--observation-snapshot <file>] [--json|--jsonl|--csv|--domains] [--plan] [--fail-on <policies>]',
  posture: 'whoisleuth posture <domain> [--selectors <list>] [--retired-selectors <list>] [--mail-profile <profile>] [--json|--sarif --owned-domain] [--quiet] [--no-color]',
  http: 'whoisleuth http <domain> [--json] [--quiet] [--no-color]',
  tls: 'whoisleuth tls <hostname> [--json] [--quiet] [--no-color]',
  'registry-support': 'whoisleuth registry-support <domain|suffix> [--json] [--quiet] [--no-color]',
  'registry-doctor': 'whoisleuth registry-doctor [lookup.json] [--json] [--quiet] [--no-color]',
  'registry-cohort': 'whoisleuth registry-cohort [lookups.json|lookups.jsonl] [--json] [--quiet] [--no-color]',
  'registry-scaffold': 'whoisleuth registry-scaffold --profile <id> --suffix <suffix> --scenario <registered|not_found|inconclusive>',
  'risk-calibrate': 'whoisleuth risk-calibrate [dataset.json] [--json] [--quiet] [--no-color]',
  'lookalike-calibrate': 'whoisleuth lookalike-calibrate [dataset.json] [--json] [--quiet] [--no-color]',
  'verify-artifact': 'whoisleuth verify-artifact [artifact.json] [--passphrase-file <file>] [--json] [--strict-exit] [--quiet] [--no-color]',
  'interchange-report': 'whoisleuth interchange-report [artifact.json] [--passphrase-file <file>] [--json] [--quiet] [--no-color]',
  'inspect-archive': 'whoisleuth inspect-archive [archive.json] [--passphrase-file <file>] [--search <value>] [--require-match] [--reveal] [--expect-content-digest <sha256:digest>] [--json]',
  'sign-artifact': 'whoisleuth sign-artifact [artifact.json] --private-key-file <file>',
  'verify-signature': 'whoisleuth verify-signature [package.json] [--public-key-file <file>] [--json] [--quiet] [--no-color]',
  'source-report': 'whoisleuth source-report [lookup.json] [--json] [--quiet] [--no-color]',
  compare: 'whoisleuth compare [lookup.json] [--json] [--quiet] [--no-color]',
  'page-compare': 'whoisleuth page-compare <left.json> <right.json> [--json] [--quiet] [--no-color]',
  'mail-review': 'whoisleuth mail-review [bulk.json|bulk.jsonl] [--json] [--quiet] [--no-color]',
  'review-evidence': 'whoisleuth review-evidence [evidence.json] [--mmdb <database-file>] [--json] [--strict-exit] [--quiet] [--no-color]',
  brief: 'whoisleuth brief [lookup.json] [--json] [--quiet] [--no-color]',
  'case-pack': 'whoisleuth case-pack [cases.json] --audience <internal|trusted|public> --reviewed [--json] [--quiet] [--no-color]',
  'domain-control': 'whoisleuth domain-control [manifest-input.json|review-input.json] [--json] [--quiet] [--no-color]',
  'monitor-once': 'whoisleuth monitor-once [manifest.json] [--previous <snapshot.json>] [--limit <1-20>] [--concurrency <1-3>] [--fail-on <policies>] [--json|--junit] [--quiet] [--no-color]',
  assurance: 'whoisleuth assurance [assurance-input.json] [--json] [--quiet] [--no-color]',
  'change-packet': 'whoisleuth change-packet [change-packet-input.json] [--json] [--quiet] [--no-color]',
  'sharing-review': 'whoisleuth sharing-review [artifact.json] --marking <level> --recipient-scope <scope> --purpose <text> [--human-reviewed] [--personal-data-reviewed] [--redactions-confirmed] [--json]',
  'workflow-plan': 'whoisleuth workflow-plan <recipe> <domain|brand> [--json] [--quiet] [--no-color]',
  'workflow-run': 'whoisleuth workflow-run <recipe> <domain|brand> [--approve-network] [--resume <state.json>] [--json] [--quiet] [--no-color]',
  diff: 'whoisleuth diff <left.json> <right.json> [--json] [--quiet] [--no-color]',
  reconcile: 'whoisleuth reconcile <observation.json> <observation.json> [...] [--json] [--quiet] [--no-color]',
  timeline: 'whoisleuth timeline <observation.json> <observation.json> [...] [--json] [--quiet] [--no-color]',
  export: 'whoisleuth export [lookup.json] [--markdown|--html|--compact] [--no-attribution]',
});

const COMMAND_DETAILS: Readonly<Record<CliCommand, CommandDetail>> = Object.freeze({
  completion: {
    description: 'Print a static shell-completion script for the installed CLI.',
    example: 'whoisleuth completion zsh > ~/.zfunc/_whoisleuth',
    boundary: 'Generation is offline and writes only the script to stdout. The command never modifies shell configuration.',
  },
  doctor: {
    description: 'Check the supported runtime and local terminal capabilities.',
    example: 'whoisleuth doctor --json',
    boundary: 'The default check is offline. Public DNS and port 43 checks run only when --network is explicitly supplied.',
  },
  commands: {
    description: 'List the installed command contracts in terminal or versioned JSON form.',
    example: 'whoisleuth commands --json',
    boundary: 'Catalogue generation is offline. It reports declared command modes and limits without executing collection or inspecting local evidence.',
  },
  manual: {
    description: 'Print a generated roff manual page for local installation.',
    example: 'whoisleuth manual | man -l -',
    boundary: 'Generation is offline and derives from the same command catalogue as focused help.',
  },
  manifest: {
    description: 'Record an ordered, path-free manifest for up to 16 local JSON artefacts.',
    example: 'whoisleuth manifest lookup.json comparison.json --workflow "domain review" --json',
    boundary: 'The command records hashes and bounded schema metadata only. It omits source paths and artefact contents and performs no network collection.',
  },
  'map-observations': {
    description: 'Apply one bounded declarative field-mapping profile to local source observations.',
    example: 'whoisleuth map-observations mapping.json --json',
    boundary: 'Profiles select allowlisted dotted fields only. They execute no scripts, make no requests, and emit the browser-compatible external-findings contract.',
  },
  'oam-export': {
    description: 'Project browser-compatible external findings into a bounded Open Asset Model bridge document.',
    example: 'whoisleuth oam-export external-findings.json --json',
    boundary: 'The projection is offline, preserves source completeness without inventing confidence, and covers only bounded FQDN, IP address, certificate, and related edge vocabulary.',
  },
  lookup: {
    description: 'Collect registration evidence for one domain, IP, or ASN.',
    example: 'whoisleuth lookup example.test --deep',
    boundary: 'Fast is the default. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable.',
  },
  bulk: {
    description: 'Triage newline-delimited domains, IPs, or ASNs with bounded concurrency.',
    example: 'cat domains.txt | whoisleuth bulk --jsonl',
    boundary: 'Fast and deep jobs use separate concurrency ceilings. Filters affect output only; collection failures and inconclusive authority states remain explicit in JSON, JSONL, and CSV.',
  },
  'ct-search': {
    description: 'Search certificate-transparency observations for one bounded keyword.',
    example: 'whoisleuth ct-search "example brand" --json',
    boundary: 'Certificate observations do not prove website activity, registration ownership, or malicious intent.',
  },
  'ct-intake': {
    description: 'Normalise source-qualified local certificate events into browser-compatible findings.',
    example: 'whoisleuth ct-intake certificate-events.json --json',
    boundary: 'The command is offline, caps output at 100 findings, and treats every event as a review lead rather than proof of serving or control.',
  },
  discover: {
    description: 'Generate bounded lookalike-domain candidates from local mutation rules.',
    example: 'whoisleuth discover example.test --preset common --jsonl',
    boundary: 'Generation and optional local snapshot comparison are offline. Candidates are leads only and are not resolved, registered, or classified as malicious.',
  },
  'discover-scan': {
    description: 'Generate a bounded candidate set, collect a selected subset, and produce a supervised review queue.',
    example: 'whoisleuth discover-scan example.test --scan-limit 50 --checkpoint scan.json --json',
    boundary: 'This command performs network collection. Fast compact lookup is the default; deep mode is capped at 50 candidates. Allowlisting changes review priority only and shared infrastructure remains a lead, not attribution.',
  },
  posture: {
    description: 'Review bounded DNS mail, delegation, and domain-control posture.',
    example: 'whoisleuth posture example.test --mail-profile standard --json',
    boundary: 'Missing or failed DNS observations remain inconclusive and are not reported as absent controls.',
  },
  http: {
    description: 'Inspect one homepage request, redirects, and bounded response metadata.',
    example: 'whoisleuth http example.test --json',
    boundary: 'Requests use the shared public-address and redirect guards. This is not a rendered browser or vulnerability scan.',
  },
  tls: {
    description: 'Inspect one hostname certificate through a bounded TLS connection.',
    example: 'whoisleuth tls example.test --json',
    boundary: 'One observed connection is point-in-time evidence and does not establish every address, edge, or historical certificate.',
  },
  'registry-support': {
    description: 'Explain the local registry capability profile for one domain or suffix.',
    example: 'whoisleuth registry-support example.test --json',
    boundary: 'This command is offline. Catalogue coverage does not test live reachability or decide registration or availability.',
  },
  'registry-doctor': {
    description: 'Compare a saved Lookup registry result with the reviewed local capability profile.',
    example: 'whoisleuth registry-doctor lookup.json --json',
    boundary: 'The command is offline. It distinguishes expected access constraints from collection results and does not contact a live registry.',
  },
  'registry-cohort': {
    description: 'Aggregate saved registry observations into privacy-safe suffix and capability-profile cohorts.',
    example: 'whoisleuth registry-cohort saved-lookups.jsonl --json',
    boundary: 'This command is offline and omits domains, queries, and raw evidence. Cohorts below the fixed minimum sample remain insufficient.',
  },
  'registry-scaffold': {
    description: 'Create a bounded synthetic WHOIS fixture scaffold for one existing capability profile.',
    example: 'whoisleuth registry-scaffold --profile example-profile --suffix test --scenario registered',
    boundary: 'The output is a sanitised template only. Contributors must not paste live responses or personal registration data into fixtures.',
  },
  'risk-calibrate': {
    description: 'Replay reviewed labels against the current explainable Risk model.',
    example: 'whoisleuth risk-calibrate calibration.json --json',
    boundary: 'Calibration is offline and diagnostic. It never trains, tunes, or changes the scoring model automatically.',
  },
  'lookalike-calibrate': {
    description: 'Summarise reviewed candidate dispositions by mutation family without retaining domains.',
    example: 'whoisleuth lookalike-calibrate reviewed-candidates.json --json',
    boundary: 'Calibration is offline and diagnostic. It omits candidate identifiers, domains, notes, and evidence and never tunes generation or filtering automatically.',
  },
  'verify-artifact': {
    description: 'Validate a supported archive, packet, manifest, or saved Lookup without printing evidence contents.',
    example: 'whoisleuth verify-artifact workspace.json --json --strict-exit',
    boundary: 'Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file; --strict-exit returns 4 when only an envelope or legacy projection integrity was verified.',
  },
  'interchange-report': {
    description: 'Report what one recognised portable artefact preserves, excludes, and supports across browser and CLI workflows.',
    example: 'whoisleuth interchange-report workspace.json --json',
    boundary: 'The report is offline and metadata-only. It does not echo targets, contacts, notes, passphrases, evidence values, or an unrecognised schema string.',
  },
  'inspect-archive': {
    description: 'Summarise or search one workspace archive with redacted output by default.',
    example: 'whoisleuth inspect-archive workspace.json --search example.test --json',
    boundary: 'Exact matches require --reveal. Content identity excludes export time and formatting. The archive is read locally and is never uploaded.',
  },
  'sign-artifact': {
    description: 'Sign one reviewed response packet or supported manifest with a local private key.',
    example: 'whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem',
    boundary: 'The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator\'s responsibility.',
  },
  'verify-signature': {
    description: 'Verify the cryptographic signature of one signed evidence package and report embedded-artifact assurance separately.',
    example: 'whoisleuth verify-signature packet.signed.json --json',
    boundary: 'A valid signature proves package consistency for the embedded key. It does not upgrade failed or unsupported embedded-artifact assurance or establish the holder\'s real-world identity or authority.',
  },
  'source-report': {
    description: 'Create a target-free reliability summary from a saved lookup.',
    example: 'whoisleuth source-report lookup.json --json',
    boundary: 'The report retains source states and timings but excludes targets, queries, endpoints, and raw evidence.',
  },
  compare: {
    description: 'Compare separately attributed registry publications in a saved lookup.',
    example: 'whoisleuth compare lookup.json --json',
    boundary: 'Comparison is offline. Differences are review context and do not by themselves prove which publication is current.',
  },
  'page-compare': {
    description: 'Compare static page identity, favicon, technology, and TLS evidence in two saved deep lookups.',
    example: 'whoisleuth page-compare official.json candidate.json --json',
    boundary: 'Comparison is offline and component-based. It executes no page code and produces no aggregate similarity or maliciousness score.',
  },
  'mail-review': {
    description: 'Review passive MX, null MX, SPF, DMARC, and shared mail-provider evidence from saved Bulk results.',
    example: 'whoisleuth mail-review candidates.json --json',
    boundary: 'Review is offline and sends no SMTP traffic. Missing or partial DNS evidence remains inconclusive.',
  },
  'review-evidence': {
    description: 'Review one versioned DNS, domain-change, routing, GeoIP, RDAP, or trust-store document offline.',
    example: 'whoisleuth review-evidence domain-change.json --json --strict-exit',
    boundary: 'The command reads only the supplied document. It performs no DNS, RDAP, BGP, GeoIP-provider, TLS, HTTP, certificate-authority, or SMTP request.',
  },
  brief: {
    description: 'Turn one saved Lookup into a compact decision brief with facts, unknowns, contradictions, and next actions.',
    example: 'whoisleuth brief lookup.json --json',
    boundary: 'The command is offline, excludes raw upstream payloads, and does not create an analyst assertion or claim that the saved observation is current.',
  },
  'case-pack': {
    description: 'Build a reviewed, audience-specific and browser-importable case package.',
    example: 'whoisleuth case-pack cases.json --audience trusted --reviewed --json',
    boundary: 'The command is offline, creates a new package, never mutates the source archive, and requires an explicit review acknowledgement.',
  },
  'domain-control': {
    description: 'Build an integrity-protected desired-state manifest or compare one with supplied observations.',
    example: 'whoisleuth domain-control domain-control-input.json --json',
    boundary: 'The command is offline and changes no registrar, DNS, mail, or certificate configuration. Only complete supplied observations can produce drift.',
  },
  'monitor-once': {
    description: 'Collect one bounded owned-domain review and compare it with an optional prior checkpoint.',
    example: 'whoisleuth monitor-once manifest.json --previous previous.json --json --output next.json',
    boundary: 'This is an operator-scheduled one-shot collection, not a daemon. It caps targets and concurrency, retains normalised observations, and never changes domain configuration.',
  },
  assurance: {
    description: 'Review a versioned domain change, recovery-dependency, or retirement plan.',
    example: 'whoisleuth assurance domain-assurance.json --json',
    boundary: 'The command is offline and treats every provider label, readiness state, and evidence reference as analyst-authored input. It changes no configuration.',
  },
  'change-packet': {
    description: 'Assemble pre-change, post-change, and planning evidence into one integrity-protected packet.',
    example: 'whoisleuth change-packet change-review.json --json',
    boundary: 'Assembly is offline. Readiness reflects only the supplied bounded evidence and does not authorise or perform a domain change.',
  },
  'sharing-review': {
    description: 'Lint one reviewed artefact against local integrity, marking, recipient, personal-data, and redaction controls.',
    example: 'whoisleuth sharing-review packet.json --marking amber --recipient-scope organization --purpose "Reviewed incident handoff" --human-reviewed --personal-data-reviewed --redactions-confirmed --json',
    boundary: 'The command is offline and emits only bounded schema/version metadata, no content values, and no raw evidence. Its result is a review aid, not legal advice or recipient authorisation.',
  },
  'workflow-plan': {
    description: 'Build a fixed domain-investigation plan from existing bounded CLI commands.',
    example: 'whoisleuth workflow-plan domain-triage example.test --json',
    boundary: 'Planning is offline and plan-only. It does not execute commands, expand placeholders, read files, make requests, or submit evidence.',
  },
  'workflow-run': {
    description: 'Execute approved concrete steps from a fixed investigation recipe and emit a resumable checkpoint.',
    example: 'whoisleuth workflow-run domain-triage example.test --approve-network --json --output run.json',
    boundary: 'Only installed recipe commands can run. Network steps require explicit approval for each invocation, and analyst-selection placeholders always pause without interpretation.',
  },
  diff: {
    description: 'Compare bounded evidence retained in two saved domain lookups.',
    example: 'whoisleuth diff first.json second.json --json',
    boundary: 'Comparison is offline. Missing, unavailable, equal, and different evidence remain separate states.',
  },
  reconcile: {
    description: 'Reconcile bounded values across independently labelled observations of one domain.',
    example: 'whoisleuth reconcile office.json mobile.json external.json --json',
    boundary: 'The command is offline, accepts 2 to 5 saved observations for one domain, and never treats labels as proof of network independence or majority agreement as truth.',
  },
  timeline: {
    description: 'Build an ordered same-domain history from saved Lookup observations.',
    example: 'whoisleuth timeline first.json second.json latest.json --json',
    boundary: 'The command is offline, accepts 2 to 20 bounded inputs for one domain, retains no filenames or raw registry payloads, and does not treat changed collection conditions as a domain change.',
  },
  export: {
    description: 'Convert one saved lookup into a versioned evidence report.',
    example: 'whoisleuth export lookup.json --markdown',
    boundary: 'Exports preserve evidence-source attribution and limitations. Markdown and HTML include a presentation-only generator footer unless --no-attribution is selected; JSON retains bounded generator provenance. Compact output intentionally omits raw registry payloads.',
  },
});

const COMMAND_COLLECTION: Readonly<Record<CliCommand, CommandCollection>> = Object.freeze({
  completion: { mode: 'offline', scope: 'Prints one static script and changes no shell configuration.' },
  doctor: { mode: 'network', scope: 'Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics.' },
  commands: { mode: 'offline', scope: 'Reads the embedded command catalogue and performs no collection.' },
  manual: { mode: 'offline', scope: 'Builds documentation from the embedded command catalogue.' },
  manifest: { mode: 'offline', scope: 'Reads 1 to 16 local JSON artefacts capped at 32 MiB in total and retains no source paths.' },
  'map-observations': { mode: 'offline', scope: 'Reads one mapping document capped at 4 MiB and executes no scripts or requests.' },
  'oam-export': { mode: 'offline', scope: 'Reads one browser-compatible external-findings document and projects bounded graph records locally.' },
  lookup: { mode: 'network', scope: 'Accepts one target. Fast is the default; deep collection must be selected explicitly.' },
  bulk: { mode: 'network', scope: 'Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep.' },
  'ct-search': { mode: 'network', scope: 'Accepts one bounded search keyword and queries the fixed certificate-transparency source.' },
  'ct-intake': { mode: 'offline', scope: 'Reads one source-qualified event batch capped at 4 MiB and makes no request.' },
  discover: { mode: 'offline', scope: 'Generates a bounded candidate set from local rules, dictionaries, and optional saved snapshots.' },
  'discover-scan': { mode: 'network', scope: 'Scans at most 500 fast or 50 deep candidates, with concurrency capped at 8 fast or 3 deep.' },
  posture: { mode: 'network', scope: 'Accepts one domain and performs bounded DNS queries only.' },
  http: { mode: 'network', scope: 'Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow.' },
  tls: { mode: 'network', scope: 'Accepts one public hostname and opens one bounded certificate connection.' },
  'registry-support': { mode: 'offline', scope: 'Reads the embedded registry capability catalogue for one domain or suffix.' },
  'registry-doctor': { mode: 'offline', scope: 'Reads one saved Lookup and the embedded registry capability catalogue.' },
  'registry-cohort': { mode: 'offline', scope: 'Reads at most 500 saved Lookups and emits target-free suffix/profile cohort counts.' },
  'registry-scaffold': { mode: 'offline', scope: 'Reads the embedded registry capability catalogue and prints one synthetic fixture template.' },
  'risk-calibrate': { mode: 'offline', scope: 'Reads one bounded reviewed-label dataset and changes no model or evidence.' },
  'lookalike-calibrate': { mode: 'offline', scope: 'Reads at most 5,000 reviewed candidate labels from one dataset capped at 2 MiB.' },
  'verify-artifact': { mode: 'offline', scope: 'Reads one selected bounded archive, packet, manifest, or saved Lookup document.' },
  'interchange-report': { mode: 'offline', scope: 'Reads one selected bounded portable artefact and emits fixed compatibility metadata only.' },
  'inspect-archive': { mode: 'offline', scope: 'Reads one selected bounded workspace archive with redacted output by default.' },
  'sign-artifact': { mode: 'offline', scope: 'Reads one selected artefact and one local private key without transmitting either.' },
  'verify-signature': { mode: 'offline', scope: 'Reads one selected signed package and optional local public key.' },
  'source-report': { mode: 'offline', scope: 'Reads bounded saved evidence and emits target-free source reliability data.' },
  compare: { mode: 'offline', scope: 'Reads one saved Lookup and compares its separately attributed registry publications.' },
  'page-compare': { mode: 'offline', scope: 'Reads two saved Lookup documents and executes no page code.' },
  'mail-review': { mode: 'offline', scope: 'Reads one saved Bulk result and sends no DNS or SMTP traffic.' },
  'review-evidence': { mode: 'offline', scope: 'Reads one bounded versioned evidence or request-planning document and performs no collection.' },
  brief: { mode: 'offline', scope: 'Reads one bounded saved Lookup and emits a compact source-aware decision brief.' },
  'case-pack': { mode: 'offline', scope: 'Reads one bounded browser case export and writes a separate audience-specific package.' },
  'domain-control': { mode: 'offline', scope: 'Reads one bounded desired-state or review document and performs no collection or configuration change.' },
  'monitor-once': { mode: 'network', scope: 'Runs deep collection for at most 20 manifest domains with concurrency capped at 3.' },
  assurance: { mode: 'offline', scope: 'Reads one versioned plan capped at 2 MiB and makes no request or configuration change.' },
  'change-packet': { mode: 'offline', scope: 'Reads one versioned packet input capped at 6 MiB and makes no request or configuration change.' },
  'sharing-review': { mode: 'offline', scope: 'Reads one artefact capped at 15 MiB, emits only bounded schema/version metadata and no content values, and performs no transmission.' },
  'workflow-plan': { mode: 'offline', scope: 'Builds a fixed typed recipe and executes none of its network or file steps.' },
  'workflow-run': { mode: 'network', scope: 'Runs only concrete fixed-recipe steps; network collection requires --approve-network and analyst-selection steps always pause.' },
  diff: { mode: 'offline', scope: 'Reads two saved Lookup documents for different domains.' },
  reconcile: { mode: 'offline', scope: 'Reads 2 to 5 saved observations for one domain, capped at 32 MiB in total.' },
  timeline: { mode: 'offline', scope: 'Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total.' },
  export: { mode: 'offline', scope: 'Reads one saved Lookup and writes one bounded report.' },
});

function commandHelp(command: CliCommand): string {
  const detail = COMMAND_DETAILS[command];
  const collection = COMMAND_COLLECTION[command];
  return `WHOISleuth ${command}\n${detail.description}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nExample:\n  ${detail.example}\n\nCollection:\n  ${collection.mode === 'offline' ? 'Offline' : 'Network'}: ${collection.scope}\n\nBoundary:\n  ${detail.boundary}\n\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

export { COMMAND_COLLECTION, COMMAND_DETAILS, COMMAND_USAGE, HELP, commandHelp };
