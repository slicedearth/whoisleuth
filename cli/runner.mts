import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';

import { abortable } from '../lib/abort.mts';
import { REGISTRY_CAPABILITIES_VERSION, registryCapabilityFor } from '../lib/registry-capabilities.mts';
import { explainRiskScore, explainRiskScoreV6, RISK_MODEL_VERSION, RISK_REVIEW_THRESHOLD } from '../lib/risk-scoring.mts';
import { CLI_COMMANDS, parseCliArguments } from './arguments.mts';
import type { CliArguments, CliCommand } from './arguments.mts';
import { buildCliCommandCatalogue, formatCliCommandCatalogue } from './command-catalogue.mts';
import { buildShellCompletion } from './completion.mts';
import { buildDoctorReport, formatDoctorReport } from './doctor.mts';
import type { BoundedTextStream } from './bulk.mts';
import {
  MAX_COMPARE_INPUT_BYTES,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
} from './compare.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import {
  evidenceCommandFailureLabel,
  isEvidenceCommand,
  runEvidenceCommand,
} from './evidence-command-runner.mts';
import { buildCliEvidenceExport, formatCliEvidenceExport } from './export-evidence.mts';
import EXIT_CODES from './exit-codes.mts';
import { formatLookupEvidenceHtml } from './formatters/html.mts';
import {
  buildCliCompareDocument,
  formatJsonDocument,
} from './formatters/json.mts';
import { formatLookupEvidenceMarkdown } from './formatters/markdown.mts';
import {
  formatTerminalCompare,
  formatTerminalRegistrySupport,
  formatTerminalRiskCalibration,
} from './formatters/terminal.mts';
import { buildCliLookupDiff, formatCliLookupDiff } from './lookup-diff.mts';
import {
  MAX_LOOKUP_RECONCILIATION_INPUT_BYTES,
  buildCliLookupReconciliation,
  formatCliLookupReconciliation,
} from './lookup-reconcile.mts';
import {
  MAX_SHARING_REVIEW_BYTES,
  buildSharingReview,
  formatSharingReview,
} from './sharing-review.mts';
import {
  MAX_LOOKUP_TIMELINE_INPUT_BYTES,
  buildCliLookupTimeline,
  formatCliLookupTimeline,
} from './lookup-timeline.mts';
import { buildCliPageComparison, formatCliPageComparison } from './page-compare.mts';
import {
  MAX_MAIL_REVIEW_INPUT_BYTES,
  buildCliMailReview,
  formatCliMailReview,
} from './mail-review.mts';
import {
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
  formatOfflineEvidenceReview,
} from './offline-evidence-review.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildDomainControlManifest,
  formatDomainControlResult,
  reviewDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  buildDomainControlFlightRecorder,
  formatDomainControlFlightRecorder,
} from '../lib/domain-control-flight-recorder.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildCliDomainControlReview,
  formatCliDomainControlReview,
} from './domain-control-observations.mts';
import { buildCliLookupBrief, formatCliLookupBrief } from './lookup-brief.mts';
import { buildCliCasePack, formatCliCasePack } from './case-pack.mts';
import { formatDomainControlMonitor, runDomainControlMonitor } from './domain-control-monitor.mts';
import {
  MAX_ASSURANCE_INPUT_BYTES,
  buildDomainAssurance,
  formatDomainAssurance,
} from '../lib/domain-assurance.mts';
import {
  MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES,
  buildDomainChangePacket,
  formatDomainChangePacket,
} from '../lib/domain-change-packet.mts';
import { buildCliManual } from './manual.mts';
import { buildInvestigationPlan, formatInvestigationPlan } from './investigation-plan.mts';
import { formatInvestigationRun, runInvestigationRecipe } from './investigation-run.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import { formatCliJunit } from './ci-report.mts';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';
import { createBufferedOutput, writePrivateFile } from './output-file.mts';
import { createTerminalProgress, type TerminalProgress } from './progress.mts';
import type { CliProgressEvents } from './progress-events.mts';
import { buildRegistrySupportDocument } from './registry-support.mts';
import { buildRegistryDoctorReport, formatRegistryDoctorReport } from './registry-doctor.mts';
import {
  MAX_REGISTRY_COHORT_INPUT_BYTES,
  buildRegistryCohortReport,
  formatRegistryCohortReport,
} from './registry-cohort.mts';
import { buildRegistryFixtureScaffold } from './registry-fixture-scaffold.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
  formatOfflineArtifactVerification,
  verifyOfflineArtifact,
} from './artifact-verify.mts';
import {
  MAX_SOURCE_RELIABILITY_INPUT_BYTES,
  buildSourceReliabilityReport,
  formatSourceReliabilityReport,
} from './source-reliability.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  buildRiskCalibrationReport,
  parseRiskCalibrationDataset,
  readRiskCalibrationInputBounded,
} from './risk-calibration.mts';
import {
  MAX_LOOKALIKE_CALIBRATION_BYTES,
  buildLookalikeCalibration,
  formatLookalikeCalibration,
} from './lookalike-calibration.mts';
import { MAX_SAVED_LOOKUP_INPUT_BYTES, readSavedLookupInputBounded } from './saved-lookup.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  type TerminalEnvironment,
} from './terminal-presentation.mts';
import type { CliCommandContext, CliDependencies, WritableLike } from './runner-types.mts';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const MAX_STDIN_BYTES = 4096;
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
  discover           Generate offline lookalike candidates.
  discover-scan      Collect a bounded candidate review queue.
  registry-support   Explain local registry coverage without a request.
  registry-doctor    Diagnose a saved registry collection against local policy.
  registry-cohort    Aggregate target-free registry quality cohorts.
  registry-scaffold  Create a sanitised synthetic fixture scaffold.

Review saved evidence:
  source-report      Summarise source reliability without retaining targets.
  compare            Compare saved registry publications.
  page-compare       Compare saved static page and TLS evidence.
  mail-review        Review saved passive mail exposure evidence.
  review-evidence    Review supplied DNS, routing, GeoIP, or RDAP evidence offline.
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

Integrity and calibration:
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
  lookup: 'whoisleuth lookup <domain|IP|ASN> [--json|--junit|--markdown|--html] [--fast|--deep] [--observer <label>] [--vantage <label>] [--plan] [--summary|--verbose] [--strict-exit] [--fail-on <policies>] [--events] [--quiet] [--no-color]',
  bulk: 'whoisleuth bulk [file] [--json|--jsonl|--junit|--csv|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency <1-8>] [--checkpoint <file> [--resume]] [--events] [--plan] [--fail-on <policies>]',
  'ct-search': 'whoisleuth ct-search <keyword> [--json] [--quiet] [--no-color]',
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
  'verify-artifact': 'whoisleuth verify-artifact [artifact.json] [--passphrase-file <file>] [--json] [--quiet] [--no-color]',
  'inspect-archive': 'whoisleuth inspect-archive [archive.json] [--passphrase-file <file>] [--search <value>] [--require-match] [--reveal] [--json]',
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
  export: 'whoisleuth export [lookup.json] [--markdown|--html|--compact]',
});

const COMMAND_DETAILS: Readonly<Record<CliCommand, Readonly<{ description: string; example: string; boundary: string }>>> = Object.freeze({
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
    example: 'whoisleuth verify-artifact workspace.json --json',
    boundary: 'Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file.',
  },
  'inspect-archive': {
    description: 'Summarise or search one workspace archive with redacted output by default.',
    example: 'whoisleuth inspect-archive workspace.json --search example.test --json',
    boundary: 'Exact matches require --reveal. The archive is read locally and is never uploaded.',
  },
  'sign-artifact': {
    description: 'Sign one reviewed response packet or supported manifest with a local private key.',
    example: 'whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem',
    boundary: 'The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator\'s responsibility.',
  },
  'verify-signature': {
    description: 'Verify the integrity and signature of one signed evidence package.',
    example: 'whoisleuth verify-signature packet.signed.json --json',
    boundary: 'A valid signature proves package consistency for the embedded key, not the real-world identity or authority of its holder.',
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
    description: 'Review one versioned DNS, domain-change, routing, GeoIP, or RDAP planning document offline.',
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
    boundary: 'Exports preserve source attribution and limitations. Compact output intentionally omits raw registry payloads.',
  },
});

const COMMAND_COLLECTION: Readonly<Record<CliCommand, Readonly<{
  mode: 'offline' | 'network';
  scope: string;
}>>> = Object.freeze({
  completion: { mode: 'offline', scope: 'Prints one static script and changes no shell configuration.' },
  doctor: { mode: 'network', scope: 'Network access is opt-in with --network and is limited to fixed public DNS, HTTPS, and WHOIS diagnostics.' },
  commands: { mode: 'offline', scope: 'Reads the embedded command catalogue and performs no collection.' },
  manual: { mode: 'offline', scope: 'Builds documentation from the embedded command catalogue.' },
  lookup: { mode: 'network', scope: 'Accepts one target. Fast is the default; deep collection must be selected explicitly.' },
  bulk: { mode: 'network', scope: 'Accepts at most 500 fast or 50 deep targets, with concurrency capped at 8 fast or 3 deep.' },
  'ct-search': { mode: 'network', scope: 'Accepts one bounded search keyword and queries the fixed certificate-transparency source.' },
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

async function readStdinBounded(
  stream: BoundedTextStream | null | undefined,
  limit = MAX_STDIN_BYTES,
): Promise<string> {
  if (!stream || stream.isTTY) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) throw new CliUsageError(`Standard input is limited to ${limit} bytes.`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) throw new CliUsageError('Single-value commands accept one stdin line. Use the bulk command for multiple inputs.');
  return lines[0] || '';
}

function write(stream: WritableLike | null | undefined, value: string): void {
  if (stream && typeof stream.write === 'function') stream.write(value);
}

function formatForTerminal(
  value: string,
  stream: WritableLike,
  color: boolean,
  environment: TerminalEnvironment,
): string {
  return presentTerminalOutput(value, terminalPresentation(stream, color, environment));
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function usageEventReason(error: unknown): string {
  const message = boundedCliErrorMessage(error, 'Invalid command input').toLowerCase();
  if (message.includes('could not read')) return 'input_unavailable';
  if (message.includes('cannot be combined') || message.includes('mutually exclusive')) return 'conflicting_options';
  if (message.includes('requires') || message.includes('did not contain')) return 'missing_input';
  return 'invalid_input';
}

async function runParsedCli(args: CliArguments, dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const environment = dependencies.environment || process.env;
  let progress: TerminalProgress | null = null;
  const eventProgress: { current: CliProgressEvents | null } = { current: null };
  let failureLabel = 'Lookup';
  try {
    const terminal = (value: string, color = true) => formatForTerminal(value, stdout, color, environment);
    const beginProgress = (message: string): TerminalProgress => {
      const terminalOutput = 'output' in args
        && args.output === 'terminal'
        && 'quiet' in args
        && 'color' in args;
      const eventOutput = 'events' in args && args.events;
      const enabled = terminalOutput && !args.quiet && !eventOutput;
      progress = createTerminalProgress(stderr, {
        enabled,
        color: terminalOutput ? args.color : false,
        environment,
        ...(dependencies.nowMs ? { now: dependencies.nowMs } : {}),
      });
      progress.start(message);
      return progress;
    };
    const endProgress = () => {
      progress?.stop();
      progress = null;
    };
    const withProgress = async <T,>(message: string, operation: () => T | Promise<T>): Promise<T> => {
      beginProgress(message);
      try {
        return await abortable(operation, dependencies.signal);
      } finally {
        endProgress();
      }
    };
    const readSingleInput = async (): Promise<string> => (
      dependencies.readStdin
        ? await dependencies.readStdin()
        : await readStdinBounded(dependencies.stdin || process.stdin)
    );
    const commandContext: CliCommandContext = Object.freeze({
      stdout,
      stderr,
      terminal,
      writeStdout: (value: string) => write(stdout, value),
      writeStderr: (value: string) => write(stderr, value),
      readSingleInput,
      now: () => dependencies.now ? dependencies.now() : new Date().toISOString(),
      beginProgress,
      endProgress,
      withProgress,
      setEventProgress: (next: CliProgressEvents) => {
        eventProgress.current = next;
      },
    });
    if (args.action === 'help') {
      write(stdout, terminal(args.command ? commandHelp(args.command) : HELP));
      return EXIT_CODES.SUCCESS;
    }
    if (args.action === 'version') { write(stdout, `${VERSION}\n`); return EXIT_CODES.SUCCESS; }

    if (args.action === 'completion') {
      write(stdout, buildShellCompletion(args.shell));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'commands') {
      const catalogue = buildCliCommandCatalogue({
        commands: CLI_COMMANDS,
        collections: COMMAND_COLLECTION,
        details: COMMAND_DETAILS,
        usage: COMMAND_USAGE,
        packageVersion: VERSION,
      });
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(catalogue)
        : terminal(formatCliCommandCatalogue(catalogue), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'manual') {
      write(stdout, buildCliManual({
        commands: CLI_COMMANDS,
        collections: COMMAND_COLLECTION,
        details: COMMAND_DETAILS,
        usage: COMMAND_USAGE,
        version: VERSION,
      }));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'doctor') {
      failureLabel = 'CLI diagnostics';
      const buildReport = () => buildDoctorReport({
        version: VERSION,
        generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        network: args.network,
        presentation: terminalPresentation(stdout, args.color, environment),
        ...(dependencies.resolvePublicAddresses ? { resolveAddresses: dependencies.resolvePublicAddresses } : {}),
        ...(dependencies.safeFetch ? { fetchHttps: dependencies.safeFetch } : {}),
        ...(dependencies.whoisQuery ? { queryWhois: dependencies.whoisQuery } : {}),
      });
      const report = args.network
        ? await withProgress('Checking public DNS, HTTPS, and WHOIS connectivity', buildReport)
        : await buildReport();
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatDoctorReport(report), args.color));
      }
      return report.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-support') {
      failureLabel = 'Registry support';
      const readInput = dependencies.readStdin || (() => readStdinBounded(dependencies.stdin || process.stdin));
      const requestedInput = args.target || await readInput();
      if (!requestedInput) throw new CliUsageError('registry-support requires one domain or suffix as an argument or on stdin.');
      const lookupCapability = dependencies.registryCapabilityFor || registryCapabilityFor;
      const capability = lookupCapability(requestedInput);
      if (!capability) throw new CliUsageError('registry-support requires a valid domain or suffix.');
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const catalogueVersion = dependencies.registryCapabilitiesVersion || REGISTRY_CAPABILITIES_VERSION;
      const document = buildRegistrySupportDocument(requestedInput, capability, catalogueVersion, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalRegistrySupport(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-doctor') {
      failureLabel = 'Registry compatibility diagnostic';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
              label: 'Registry doctor input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read registry doctor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('registry-doctor requires one saved Lookup JSON file or a document on stdin.');
      const report = buildRegistryDoctorReport(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatRegistryDoctorReport(report), args.color));
      return report.summary.investigate ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-cohort') {
      failureLabel = 'Registry quality cohort';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_REGISTRY_COHORT_INPUT_BYTES,
              label: 'Registry cohort input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read registry cohort input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const report = buildRegistryCohortReport(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatRegistryCohortReport(report), args.color));
      return report.cohorts.some((cohort) => cohort.state === 'review')
        ? EXIT_CODES.PARTIAL_FAILURE
        : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'registry-scaffold') {
      failureLabel = 'Registry fixture scaffold';
      try {
        write(stdout, buildRegistryFixtureScaffold(args.profile, args.suffix, args.scenario));
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Registry fixture scaffold failed'));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'risk-calibrate') {
      failureLabel = 'Risk calibration';
      let input: string;
      try {
        input = dependencies.readRiskCalibrationInput
          ? await dependencies.readRiskCalibrationInput(args.source)
          : await readRiskCalibrationInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_RISK_CALIBRATION_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Risk calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('risk-calibrate requires one dataset JSON file or a dataset on stdin.');
      const dataset = parseRiskCalibrationDataset(input);
      const report = buildRiskCalibrationReport(dataset, dependencies.explainRiskScore || explainRiskScore, {
        generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
        modelVersion: dependencies.riskModelVersion || RISK_MODEL_VERSION,
        reviewThreshold: dependencies.riskReviewThreshold || RISK_REVIEW_THRESHOLD,
        ...(!dependencies.explainRiskScore ? {
          previousModelVersion: 6,
          explainPreviousRiskScore: explainRiskScoreV6,
        } : {}),
      });
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(report) : terminal(formatTerminalRiskCalibration(report), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'lookalike-calibrate') {
      failureLabel = 'Lookalike review-yield calibration';
      let input: string;
      try {
        input = dependencies.readRiskCalibrationInput
          ? await dependencies.readRiskCalibrationInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_LOOKALIKE_CALIBRATION_BYTES,
              label: 'Lookalike calibration input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read lookalike calibration input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('lookalike-calibrate requires one dataset JSON file or a document on stdin.');
      let report;
      try {
        report = buildLookalikeCalibration(input, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Lookalike calibration input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(report)
        : terminal(formatLookalikeCalibration(report), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'verify-artifact') {
      failureLabel = 'Artefact verification';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_OFFLINE_ARTIFACT_BYTES,
              label: 'Artefact input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read artifact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('verify-artifact requires one JSON file or an artefact on stdin.');

      let passphrase: string | null = null;
      if (args.passphraseSource) {
        let passphraseText: string;
        try {
          passphraseText = dependencies.readPassphraseFile
            ? await dependencies.readPassphraseFile(args.passphraseSource)
            : await readSavedLookupInputBounded(
              createReadStream(args.passphraseSource, { highWaterMark: MAX_OFFLINE_PASSPHRASE_FILE_BYTES }),
              {
                limit: MAX_OFFLINE_PASSPHRASE_FILE_BYTES,
                label: 'Passphrase file',
              },
            );
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read passphrase file: ${boundedCliErrorMessage(error, 'File could not be read')}`);
        }
        passphrase = passphraseText.replace(/\r?\n$/u, '');
        if (!passphrase || /[\r\n\u0000]/u.test(passphrase)) {
          throw new CliUsageError('Passphrase file must contain exactly one non-empty UTF-8 line.');
        }
      }

      const report = await verifyOfflineArtifact(input, { passphrase });
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatOfflineArtifactVerification(report), args.color));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (isEvidenceCommand(args)) {
      failureLabel = evidenceCommandFailureLabel(args.action);
      const evidenceStdout = args.action !== 'sign-artifact' && args.output === 'terminal'
        ? { write: (value: string) => write(stdout, terminal(value, args.color)) }
        : stdout;
      return await runEvidenceCommand(args, {
        stdout: evidenceStdout,
        stdin: dependencies.stdin || process.stdin,
        readArtifactInput: dependencies.readArtifactInput,
        readPassphraseFile: dependencies.readPassphraseFile,
        readPrivateKeyFile: dependencies.readPrivateKeyFile,
        readPublicKeyFile: dependencies.readPublicKeyFile,
        now: dependencies.now,
      });
    }

    if (args.action === 'source-report') {
      failureLabel = 'Source reliability report';
      let input: string;
      try {
        input = dependencies.readSourceReliabilityInput
          ? await dependencies.readSourceReliabilityInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SOURCE_RELIABILITY_INPUT_BYTES,
              label: 'Source reliability input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read source reliability input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('source-report requires one JSON file or lookup documents on stdin.');
      const report = buildSourceReliabilityReport(
        input,
        dependencies.now ? dependencies.now() : new Date().toISOString(),
      );
      if (!args.quiet) {
        write(stdout, args.output === 'json'
          ? formatJsonDocument(report)
          : terminal(formatSourceReliabilityReport(report), args.color));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'compare') {
      failureLabel = 'Registry comparison';
      let input: string;
      try {
        input = dependencies.readCompareInput
          ? await dependencies.readCompareInput(args.source)
          : await readCompareInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, MAX_COMPARE_INPUT_BYTES);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read comparison input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('compare requires one lookup JSON file or a lookup document on stdin.');
      const parsed = parseCliLookupDocument(input);
      const loadComparison = dependencies.loadRegistryComparison || (() => import('../lib/registry-comparison.mts'));
      const comparisonModule = await loadComparison();
      const result = compareLookupDocument(
        parsed,
        comparisonModule.compareRegistrySources,
        comparisonModule.compareRdapPublications,
      );
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliCompareDocument(result, now);
      if (!args.quiet) write(stdout, args.output === 'json' ? formatJsonDocument(document) : terminal(formatTerminalCompare(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'page-compare') {
      failureLabel = 'Static page comparison';
      const readDiffInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Page comparison input',
        })
      ));
      let leftInput: string;
      let rightInput: string;
      try {
        [leftInput, rightInput] = await Promise.all([
          readDiffInput(args.leftSource),
          readDiffInput(args.rightSource),
        ]);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read page comparison input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliPageComparison(leftInput, rightInput, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliPageComparison(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'mail-review') {
      failureLabel = 'Passive mail review';
      let input: string;
      try {
        input = dependencies.readMailReviewInput
          ? await dependencies.readMailReviewInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_MAIL_REVIEW_INPUT_BYTES,
              label: 'Mail review input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read mail review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliMailReview(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliMailReview(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'review-evidence') {
      failureLabel = 'Offline evidence review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
              label: 'Offline evidence input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read offline evidence input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('review-evidence requires one JSON file or a document on stdin.');
      const document = args.mmdbSource
        ? await buildOfflineEvidenceReviewWithLocalResources(input, commandContext.now(), { mmdbPath: args.mmdbSource })
        : buildOfflineEvidenceReview(input, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatOfflineEvidenceReview(document), args.color));
      if (args.strictExit) {
        const result = document.result && typeof document.result === 'object' && !Array.isArray(document.result)
          ? document.result as Record<string, unknown>
          : {};
        const gate = result.gate && typeof result.gate === 'object' && !Array.isArray(result.gate)
          ? result.gate as Record<string, unknown>
          : null;
        const zoneMismatch = document.kind === 'zone_intent' && (
          result.complete !== true
          || (result.counts && typeof result.counts === 'object' && !Array.isArray(result.counts)
            && ['different', 'missing', 'unexpected', 'incomplete'].some((key) => Number((result.counts as Record<string, unknown>)[key]) > 0))
        );
        if (gate?.pass === false || zoneMismatch) return EXIT_CODES.PARTIAL_FAILURE;
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'brief' || args.action === 'case-pack') {
      const isBrief = args.action === 'brief';
      failureLabel = isBrief ? 'Lookup brief' : 'Case pack';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: isBrief ? MAX_SAVED_LOOKUP_INPUT_BYTES : 4 * 1024 * 1024,
              label: isBrief ? 'Lookup brief input' : 'Case-pack input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read ${isBrief ? 'Lookup brief' : 'case-pack'} input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError(`${args.action} requires one JSON file or a document on stdin.`);
      if (args.action === 'brief') {
        const document = buildCliLookupBrief(input, commandContext.now());
        if (!args.quiet) write(stdout, args.output === 'json'
          ? formatJsonDocument(document)
          : terminal(formatCliLookupBrief(document), args.color));
      } else {
        const document = buildCliCasePack(input, { audience: args.audience, reviewed: args.reviewed }, commandContext.now());
        if (!args.quiet) write(stdout, args.output === 'json'
          ? formatJsonDocument(document)
          : terminal(formatCliCasePack(document), args.color));
      }
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'domain-control') {
      failureLabel = 'Domain control review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
              label: 'Domain control input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain control input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('domain-control requires one JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Domain control input is not valid JSON.');
      }
      const schema = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).schema
        : null;
      const document = schema === DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA
        ? buildDomainControlManifest(parsed, commandContext.now())
        : schema === DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
          ? reviewDomainControlManifest(parsed, commandContext.now())
          : schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
            ? buildCliDomainControlReview(input, commandContext.now())
            : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
              ? buildDomainControlFlightRecorder(parsed, commandContext.now())
              : null;
      if (!document) {
        throw new CliUsageError(`Domain control input must use a supported manifest, review, saved-Lookup review, or flight-recorder schema.`);
      }
      const terminalDocument = schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
        ? formatCliDomainControlReview(document as ReturnType<typeof buildCliDomainControlReview>)
        : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
          ? formatDomainControlFlightRecorder(document as ReturnType<typeof buildDomainControlFlightRecorder>)
          : formatDomainControlResult(document as ReturnType<typeof buildDomainControlManifest> | ReturnType<typeof reviewDomainControlManifest>);
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(terminalDocument, args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'monitor-once') {
      failureLabel = 'One-shot domain control review';
      let manifestInput: string;
      let previousInput: string | null = null;
      try {
        manifestInput = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
              label: 'Domain-control manifest input',
            });
        if (args.previousSource) {
          previousInput = dependencies.readDiffInput
            ? await dependencies.readDiffInput(args.previousSource)
            : await readSavedLookupInputBounded(createReadStream(args.previousSource, { highWaterMark: 64 * 1024 }), {
              limit: MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
              label: 'Prior monitor snapshot',
            });
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read monitor input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!manifestInput.trim()) throw new CliUsageError('monitor-once requires one domain-control manifest file or a document on stdin.');
      const executeLookup = dependencies.runUnifiedLookup || (await import('../lib/lookup.mts')).runUnifiedLookup;
      const progress = commandContext.beginProgress('Collecting bounded domain-control evidence');
      let document;
      try {
        document = await runDomainControlMonitor(manifestInput, previousInput, {
          executeLookup,
          now: commandContext.now,
          limit: args.limit,
          concurrency: args.concurrency,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          onSettled: (completed, total) => progress.update(`Collected ${completed} of ${total} owned domains`),
        });
      } finally {
        commandContext.endProgress();
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : args.output === 'junit'
          ? formatCliJunit(document)
          : terminal(formatDomainControlMonitor(document), args.color));
      const policyFindings = evaluateCliFailPolicies(document, args.failOn || []);
      if (policyFindings.length) write(stderr, formatFailPolicyNotice(policyFindings));
      return document.collection.failed || policyFindings.length ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'assurance') {
      failureLabel = 'Domain assurance review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_ASSURANCE_INPUT_BYTES,
              label: 'Domain assurance input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain assurance input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('assurance requires one versioned JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Domain assurance input is not valid JSON.');
      }
      let document;
      try {
        document = buildDomainAssurance(parsed, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Domain assurance input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatDomainAssurance(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'change-packet') {
      failureLabel = 'Domain change packet';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES,
              label: 'Domain change packet input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read domain change packet input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('change-packet requires one versioned JSON file or a document on stdin.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new CliUsageError('Domain change packet input is not valid JSON.');
      }
      let document;
      try {
        document = await buildDomainChangePacket(parsed, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Domain change packet input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatDomainChangePacket(document), args.color));
      return document.gate.pass ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE;
    }

    if (args.action === 'sharing-review') {
      failureLabel = 'Evidence sharing review';
      let input: string;
      try {
        input = dependencies.readArtifactInput
          ? await dependencies.readArtifactInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SHARING_REVIEW_BYTES,
              label: 'Sharing review input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read sharing review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('sharing-review requires one artefact JSON file or a document on stdin.');
      let document;
      try {
        document = await buildSharingReview(input, {
          marking: args.marking,
          recipientScope: args.recipientScope,
          purpose: args.purpose,
          humanReviewed: args.humanReviewed,
          personalDataReviewed: args.personalDataReviewed,
          redactionsConfirmed: args.redactionsConfirmed,
        }, commandContext.now());
      } catch (error) {
        throw new CliUsageError(boundedCliErrorMessage(error, 'Sharing review input is invalid'));
      }
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatSharingReview(document), args.color));
      return document.summary.status === 'blocked' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'workflow-plan') {
      failureLabel = 'Investigation plan';
      const document = buildInvestigationPlan(args.recipe, args.subject, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatInvestigationPlan(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'workflow-run') {
      failureLabel = 'Investigation workflow';
      let resumeInput: string | null = null;
      if (args.resumeSource) {
        try {
          resumeInput = dependencies.readDiffInput
            ? await dependencies.readDiffInput(args.resumeSource)
            : await readSavedLookupInputBounded(createReadStream(args.resumeSource, { highWaterMark: 64 * 1024 }), {
              limit: 24 * 1024 * 1024,
              label: 'Investigation resume state',
            });
        } catch (error) {
          if (error instanceof CliUsageError) throw error;
          throw new CliUsageError(`Could not read investigation resume state: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
        }
      }
      const document = await runInvestigationRecipe(args.recipe, args.subject, {
        approveNetwork: args.approveNetwork,
        resumeInput,
        generatedAt: commandContext.now(),
        execute: async (command, stepArguments) => {
          const stepStdout = createBufferedOutput();
          const stepStderr = createBufferedOutput();
          const exitCode = await runCli([command, ...stepArguments], {
            ...dependencies,
            stdout: stepStdout.stream,
            stderr: stepStderr.stream,
          });
          return { exitCode, stdout: stepStdout.value() };
        },
      });
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatInvestigationRun(document), args.color));
      return document.state === 'step_failed' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
    }

    if (args.action === 'diff') {
      failureLabel = 'Lookup evidence diff';
      const readDiffInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Lookup diff input',
        })
      ));
      let leftInput: string;
      let rightInput: string;
      try {
        [leftInput, rightInput] = await Promise.all([
          readDiffInput(args.leftSource),
          readDiffInput(args.rightSource),
        ]);
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup diff input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupDiff(
        leftInput,
        rightInput,
        dependencies.now ? dependencies.now() : new Date().toISOString(),
      );
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupDiff(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'reconcile') {
      failureLabel = 'Lookup observation reconciliation';
      const readReconciliationInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Lookup reconciliation input',
        })
      ));
      const inputs: string[] = [];
      let totalBytes = 0;
      try {
        for (const source of args.sources) {
          const input = await readReconciliationInput(source);
          totalBytes += Buffer.byteLength(input, 'utf8');
          if (totalBytes > MAX_LOOKUP_RECONCILIATION_INPUT_BYTES) {
            throw new CliUsageError(`Lookup reconciliation input is limited to ${MAX_LOOKUP_RECONCILIATION_INPUT_BYTES} bytes in total.`);
          }
          inputs.push(input);
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup reconciliation input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupReconciliation(inputs, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupReconciliation(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'timeline') {
      failureLabel = 'Lookup observation timeline';
      const readTimelineInput = dependencies.readDiffInput || (async (source: string) => (
        readSavedLookupInputBounded(createReadStream(source, { highWaterMark: 64 * 1024 }), {
          limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
          label: 'Lookup timeline input',
        })
      ));
      const inputs: string[] = [];
      let totalBytes = 0;
      try {
        for (const source of args.sources) {
          const input = await readTimelineInput(source);
          totalBytes += Buffer.byteLength(input, 'utf8');
          if (totalBytes > MAX_LOOKUP_TIMELINE_INPUT_BYTES) {
            throw new CliUsageError(`Lookup timeline input is limited to ${MAX_LOOKUP_TIMELINE_INPUT_BYTES} bytes in total.`);
          }
          inputs.push(input);
        }
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read Lookup timeline input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      const document = buildCliLookupTimeline(inputs, commandContext.now());
      if (!args.quiet) write(stdout, args.output === 'json'
        ? formatJsonDocument(document)
        : terminal(formatCliLookupTimeline(document), args.color));
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'export') {
      failureLabel = 'Evidence export';
      let input: string;
      try {
        input = dependencies.readExportInput
          ? await dependencies.readExportInput(args.source)
          : await readSavedLookupInputBounded(args.source
            ? createReadStream(args.source, { highWaterMark: 64 * 1024 })
            : dependencies.stdin || process.stdin, {
              limit: MAX_SAVED_LOOKUP_INPUT_BYTES,
              label: 'Evidence export input',
            });
      } catch (error) {
        if (error instanceof CliUsageError) throw error;
        throw new CliUsageError(`Could not read evidence export input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
      }
      if (!input.trim()) throw new CliUsageError('export requires one lookup JSON file or a lookup document on stdin.');
      const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
      const evidenceModule = await loadEvidence();
      const now = dependencies.now ? dependencies.now() : new Date().toISOString();
      const document = buildCliEvidenceExport(input, evidenceModule, now);
      const output = args.format === 'markdown'
        ? formatLookupEvidenceMarkdown(document)
        : args.format === 'html'
          ? formatLookupEvidenceHtml(document)
          : formatCliEvidenceExport(document, args.compact);
      write(stdout, output);
      return EXIT_CODES.SUCCESS;
    }

    if (args.action === 'bulk') {
      failureLabel = 'Bulk lookup';
      const { runBulkCommand } = await import('./bulk-command-runner.mts');
      return await runBulkCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover') {
      failureLabel = 'Candidate generation';
      const { runDiscoveryCommand } = await import('./discovery-command-runner.mts');
      return await runDiscoveryCommand(args, dependencies, commandContext);
    }

    if (args.action === 'discover-scan') {
      failureLabel = 'Candidate scan';
      const { runDiscoveryScanCommand } = await import('./discovery-scan-command-runner.mts');
      return await runDiscoveryScanCommand(args, dependencies, commandContext);
    }

    if (args.action === 'ct-search'
      || args.action === 'posture'
      || args.action === 'http'
      || args.action === 'tls') {
      failureLabel = args.action === 'ct-search'
        ? 'Certificate Transparency search'
        : args.action === 'posture'
          ? 'Domain posture audit'
          : args.action === 'http'
            ? 'HTTP probe'
            : 'TLS intelligence';
      const { runNetworkCommand } = await import('./network-command-runner.mts');
      return await runNetworkCommand(args, dependencies, commandContext);
    }

    const { runLookupCommand } = await import('./lookup-command-runner.mts');
    return await runLookupCommand(args, dependencies, commandContext);
  } catch (error) {
    (progress as TerminalProgress | null)?.stop();
    progress = null;
    if (isCancellation(error, dependencies.signal)) {
      eventProgress.current?.emit({ event: 'cancelled', exitCode: EXIT_CODES.CANCELLED });
      if (!eventProgress.current?.enabled) write(stderr, 'Cancelled by analyst.\n');
      return EXIT_CODES.CANCELLED;
    }
    if (error instanceof CliUsageError) {
      eventProgress.current?.emit({
        event: 'failed',
        state: 'usage',
        reason: usageEventReason(error),
        exitCode: EXIT_CODES.USAGE,
      });
      if (!eventProgress.current?.enabled) write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    eventProgress.current?.emit({ event: 'failed', state: 'operational', exitCode: EXIT_CODES.LOOKUP_FAILED });
    if (!eventProgress.current?.enabled) write(stderr, `${failureLabel} failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

async function runCli(argv: unknown, dependencies: CliDependencies = {}): Promise<number> {
  const stderr = dependencies.stderr || process.stderr;
  let args: CliArguments;
  try {
    args = parseCliArguments(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Invalid command')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `CLI startup failed: ${boundedCliErrorMessage(error, 'Unexpected command failure')}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
  if (!args.destination) return runParsedCli(args, dependencies);
  const buffered = createBufferedOutput();
  const code = await runParsedCli(args, { ...dependencies, stdout: buffered.stream });
  if (code !== EXIT_CODES.SUCCESS && code !== EXIT_CODES.PARTIAL_FAILURE) return code;
  try {
    await writePrivateFile(args.destination, buffered.value(), { force: args.force === true });
    return code;
  } catch (error) {
    if (error instanceof CliUsageError) {
      write(stderr, `Usage error: ${boundedCliErrorMessage(error, 'Output file could not be written')}\n`);
      return EXIT_CODES.USAGE;
    }
    write(stderr, `Output failed: ${boundedCliErrorMessage(error, 'Output file could not be written')}\n`);
    return EXIT_CODES.LOOKUP_FAILED;
  }
}

export { HELP, MAX_STDIN_BYTES, VERSION, readStdinBounded, runCli };
export type { CliDependencies, WritableLike };
