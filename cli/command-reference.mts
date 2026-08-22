import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../lib/evidence-export.mts';
import {
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_REPORT_SCHEMA,
} from '../packages/contracts/risk-calibration.mts';
import {
  CASE_SCHEMA_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';

const COMMAND_ORDER = Object.freeze([
  'completion',
  'doctor',
  'commands',
  'manual',
  'manifest',
  'map-observations',
  'oam-export',
  'lookup',
  'bulk',
  'ct-search',
  'ct-intake',
  'discover',
  'discover-scan',
  'posture',
  'http',
  'tls',
  'dnssec-validate',
  'mail-transport',
  'registry-support',
  'registry-doctor',
  'registry-cohort',
  'registry-scaffold',
  'risk-calibrate',
  'lookalike-calibrate',
  'verify-artifact',
  'interchange-report',
  'inspect-archive',
  'sign-artifact',
  'verify-signature',
  'source-report',
  'compare',
  'page-compare',
  'mail-review',
  'review-evidence',
  'brief',
  'case-pack',
  'domain-control',
  'monitor-once',
  'assurance',
  'change-packet',
  'sharing-review',
  'workflow-plan',
  'workflow-run',
  'diff',
  'reconcile',
  'timeline',
  'export',
] as const);

type CliCommand = typeof COMMAND_ORDER[number];
type CompletionShell = 'bash' | 'zsh' | 'fish' | 'powershell';
type CommandDetail = Readonly<{
  description: string;
  example: string;
  boundary: string;
}>;
type CommandCollection = Readonly<{
  mode: 'offline' | 'network';
  scope: string;
}>;
type CliNetworkEffect = 'offline' | 'always_network' | 'conditional_network';
type CliInvocationNetworkEffect = 'offline' | 'network';
type CliHelpGroup = 'investigate' | 'respond' | 'assure' | 'utilities';
type CliDisclosureClass = 'none' | 'bounded_passive' | 'conditional_bounded_passive' | 'bounded_authorised_active';
type CliOptionValueKind = 'enum' | 'file' | 'flag' | 'integer' | 'policy_list' | 'text';
type CliOptionOccurrence = 'idempotent' | 'once';
type CliOptionScope = 'command' | 'common';
type CliPositionalValueKind = 'enum' | 'file' | 'text';
type CliPositionalInputSource = 'argv' | 'argv_or_stdin';
type CliMetaActionId = 'help' | 'version';
type CliMetaAction = Readonly<{
  id: CliMetaActionId;
  aliases: readonly string[];
  scope: 'root_only' | 'root_or_command';
  precedence: 'before_command_grammar';
  bypassesOrdinaryRequirements: true;
  acceptsAdditionalArguments: false;
}>;
type CliOptionIntegerRange = Readonly<{
  minimum: number;
  maximum: number;
  whenOptionPresent: string | null;
}>;
type CliOptionSpec = Readonly<{
  option: string;
  scope: CliOptionScope;
  arity: 0 | 1;
  valueKind: CliOptionValueKind;
  values: readonly string[];
  integerRanges: readonly CliOptionIntegerRange[];
  occurrence: CliOptionOccurrence;
  metaAction: CliMetaActionId | null;
}>;
type CliPositionalSpec = Readonly<{
  name: string;
  valueKind: CliPositionalValueKind;
  minimum: number;
  maximum: number;
  values: readonly string[];
  inputSource: CliPositionalInputSource;
  requiredWhenOptions: readonly string[];
}>;
type CliGrammarConstraint =
  | Readonly<{ kind: 'mutually_exclusive'; options: readonly string[] }>
  | Readonly<{ kind: 'excludes_all'; option: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_all'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_any'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'value_excludes'; option: string; value: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'required'; options: readonly string[] }>;
type CliHandlerOwner =
  | 'bulk'
  | 'discovery'
  | 'discovery_scan'
  | 'evidence'
  | 'inline'
  | 'lookup'
  | 'network';
type CliCommandDefinition = Readonly<{
  command: CliCommand;
  order: number;
  reference: Readonly<CommandDetail & { usage: string }>;
  collection: CommandCollection;
  completion: Readonly<{
    description: string;
    commonOptions: readonly string[];
    options: readonly string[];
  }>;
  grammar: Readonly<{
    parserKey: CliCommand;
    bootstrapProfile: 'allowed' | 'command_owned';
    options: readonly CliOptionSpec[];
    positionals: readonly CliPositionalSpec[];
    constraints: readonly CliGrammarConstraint[];
    metaActions: readonly CliMetaActionId[];
  }>;
  execution: Readonly<{
    handlerOwner: CliHandlerOwner;
    networkEffect: CliNetworkEffect;
  }>;
  help: Readonly<{
    group: CliHelpGroup;
    summary: string;
  }>;
  documentation: Readonly<{
    common: boolean;
    disclosureClass: CliDisclosureClass;
    explicitAuthorisationRequired: boolean;
    planSupport: boolean;
    failurePolicySupport: boolean;
    supportedSchemaIdentifiers: readonly string[];
    inputLimits: readonly string[];
    outputLimits: readonly string[];
    outputFormats: readonly string[];
    primaryEvidenceArtefacts: readonly string[];
  }>;
}>;

const INVESTIGATION_PLAN_RECIPES = Object.freeze([
  'domain-triage',
  'lookalike-review',
  'owned-domain-review',
  'historical-comparison',
  'campaign-review',
  'certificate-anomaly',
  'registry-disagreement',
  'evidence-handoff',
  'planned-domain-change',
  'post-change-verification',
] as const);

const RUNNABLE_INVESTIGATION_PLAN_RECIPES = Object.freeze([
  'domain-triage',
  'lookalike-review',
  'owned-domain-review',
  'historical-comparison',
] as const);

const CLI_META_ACTIONS: readonly CliMetaAction[] = Object.freeze([
  Object.freeze({
    id: 'help',
    aliases: Object.freeze(['--help', '-h']),
    scope: 'root_or_command',
    precedence: 'before_command_grammar',
    bypassesOrdinaryRequirements: true,
    acceptsAdditionalArguments: false,
  }),
  Object.freeze({
    id: 'version',
    aliases: Object.freeze(['--version', '-V']),
    scope: 'root_only',
    precedence: 'before_command_grammar',
    bypassesOrdinaryRequirements: true,
    acceptsAdditionalArguments: false,
  }),
]);
const CLI_META_ACTION_BY_ID = Object.freeze(Object.fromEntries(
  CLI_META_ACTIONS.map((action) => [action.id, action]),
)) as Readonly<Record<CliMetaActionId, CliMetaAction>>;

// Human-facing command reference kept separate from command execution so
// additions do not expand the already broad runtime controller.

const HELP_INTRO = `WHOISleuth CLI
Domain investigation from your terminal.

Quick start:
  whoisleuth
  whoisleuth example.test
  whoisleuth lookup example.test --deep
  cat domains.txt | whoisleuth bulk --jsonl
`;

const HELP_FOOTER = `
Run "whoisleuth <command> --help" for focused usage and an example.
With no arguments, an eligible interactive terminal opens a bounded launcher;
redirected or unsupported terminals continue to print this help. No request
starts until a Lookup plan is shown and the analyst confirms collection.
Use --json or --jsonl where supported for machine-readable stdout.
Use --output <file> for atomic private file output and --force to replace it.
Use --palette auto, light, or dark after the command to select a fixed terminal
colour palette; --no-color, NO_COLOR, and redirected output still suppress ANSI.
Use --config <file> and --profile <name> for explicit versioned safe defaults.
Registry scaffold is the exception: its --profile selects a fixture capability
profile and --config is rejected, so bootstrap defaults cannot alter fixtures.
An ICANN-recognised public domain, reserved documentation domain, IP, or ASN
may replace "lookup"; URL-like or ambiguous input requires the explicit
command. Both forms use the same Lookup options.
Diagnostics are written to stderr. Fast lookup is the default; deep collection
must be requested explicitly and can disclose a target to additional sources.

Copyright 2026 slicedearth. Licensed under AGPL-3.0-only.
Source and licence: ${WHOISLEUTH_SOURCE_REPOSITORY_URL}
`;
const COMMAND_USAGE_SEED: Readonly<Record<CliCommand, string>> = Object.freeze({
  completion: 'whoisleuth completion <bash|zsh|fish|powershell>',
  doctor: 'whoisleuth doctor [--network] [--json] [--quiet] [--no-color]',
  commands: 'whoisleuth commands [--common] [--group <group>] [--mode <offline|network>] [--json] [--quiet] [--no-color]',
  manual: 'whoisleuth manual',
  manifest: 'whoisleuth manifest <artefact.json> [...] --workflow <label> [--configuration-digest <sha256:digest>] [--json] [--quiet] [--no-color]',
  'map-observations': 'whoisleuth map-observations [mapping.json] [--json] [--quiet] [--no-color]',
  'oam-export': 'whoisleuth oam-export [external-findings.json] [--json] [--quiet] [--no-color]',
  lookup: 'whoisleuth lookup [domain|IP|ASN] [--json|--junit|--markdown|--html] [--no-attribution] [--fast|--deep] [--observer <label>] [--vantage <label>] [--plan] [--summary|--verbose|--browse [--save-lookup <file>]] [--palette <auto|light|dark>] [--strict-exit] [--fail-on <policies>] [--events] [--quiet] [--no-color]',
  bulk: 'whoisleuth bulk [file] [--json|--jsonl|--junit|--csv|--domains|--queries] [--registered-only|--inconclusive-only|--errors-only] [--fast|--deep] [--concurrency <1-8>] [--checkpoint <file> [--resume]] [--events] [--plan] [--fail-on <policies>] [--quiet] [--no-color]',
  'ct-search': 'whoisleuth ct-search [keyword] [--json] [--quiet] [--no-color]',
  'ct-intake': 'whoisleuth ct-intake [events.json] [--json] [--quiet] [--no-color]',
  discover: 'whoisleuth discover [brand|domain] [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--snapshot <file>] [--json|--jsonl|--domains] [--quiet] [--no-color]',
  'discover-scan': 'whoisleuth discover-scan [brand|domain] [--tlds <list>] [--preset <name>|--families <ids>] [--keyboard <layout>] [--dictionary <file>] [--fast|--deep] [--scan-limit <n>] [--chunk-size <n>] [--concurrency <n>] [--resolver <IPs>] [--allowlist <file>] [--checkpoint <file> [--resume]] [--observation-snapshot <file>] [--registered-only|--inconclusive-only|--acquisition-only|--suppressed-only] [--events] [--json|--jsonl|--csv|--domains] [--plan] [--fail-on <policies>] [--quiet] [--no-color]',
  posture: 'whoisleuth posture [domain] [--selectors <list>] [--retired-selectors <list>] [--mail-profile <profile>] [--json|--sarif --owned-domain] [--quiet] [--no-color]',
  http: 'whoisleuth http [domain] [--json] [--quiet] [--no-color]',
  tls: 'whoisleuth tls [hostname] [--json] [--quiet] [--no-color]',
  'dnssec-validate': 'whoisleuth dnssec-validate <domain> --resolver <public-IP> --trust-anchor <anchor.json> --owned-or-authorized [--json] [--quiet] [--no-color]',
  'mail-transport': 'whoisleuth mail-transport [input.json] --resolver <public-IP> --trust-anchor <anchor.json> --owned-or-authorized --active-probe [--json] [--quiet] [--no-color]',
  'registry-support': 'whoisleuth registry-support [domain|suffix] [--json] [--quiet] [--no-color]',
  'registry-doctor': 'whoisleuth registry-doctor [lookup.json] [--json] [--quiet] [--no-color]',
  'registry-cohort': 'whoisleuth registry-cohort [lookups-or-reports.json|jsonl] [--json] [--quiet] [--no-color]',
  'registry-scaffold': 'whoisleuth registry-scaffold --profile <id> --suffix <suffix> --scenario <registered|not_found|inconclusive>',
  'risk-calibrate': 'whoisleuth risk-calibrate [dataset.json] [--json|--summary-json] [--quiet] [--no-color]',
  'lookalike-calibrate': 'whoisleuth lookalike-calibrate [dataset.json] [--json] [--quiet] [--no-color]',
  'verify-artifact': 'whoisleuth verify-artifact [artifact.json] [--passphrase-file <file>] [--manifest <manifest.json> --manifest-entry <artifact-N>] [--json] [--strict-exit] [--quiet] [--no-color]',
  'interchange-report': 'whoisleuth interchange-report [artifact.json] [--passphrase-file <file>] [--json] [--quiet] [--no-color]',
  'inspect-archive': 'whoisleuth inspect-archive [archive.json] [--passphrase-file <file>] [--search <value>] [--require-match] [--reveal] [--expect-content-digest <sha256:digest>] [--json] [--quiet] [--no-color]',
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
  'sharing-review': 'whoisleuth sharing-review [artifact.json] --marking <level> --recipient-scope <scope> --purpose <text> [--human-reviewed] [--personal-data-reviewed] [--redactions-confirmed] [--json] [--quiet] [--no-color]',
  'workflow-plan': 'whoisleuth workflow-plan <recipe> <domain|brand> | --list | --explain <recipe> [--json] [--quiet] [--no-color]',
  'workflow-run': 'whoisleuth workflow-run <recipe> <domain|brand> [--approve-network] [--resume <state.json>] [--json] [--quiet] [--no-color]',
  diff: 'whoisleuth diff <left.json> <right.json> [--left-session <id> --right-session <id>] [--json] [--quiet] [--no-color]',
  reconcile: 'whoisleuth reconcile <observation.json> <observation.json> [...] [--json] [--quiet] [--no-color]',
  timeline: 'whoisleuth timeline <observation.json> <observation.json> [...] [--json] [--quiet] [--no-color]',
  export: 'whoisleuth export [lookup.json] [--markdown|--html|--compact] [--no-attribution]',
});

const COMMAND_DETAILS_SEED: Readonly<Record<CliCommand, CommandDetail>> = Object.freeze({
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
    example: 'whoisleuth lookup example.test --deep --browse',
    boundary: 'Fast is the default. An ICANN-recognised public domain, reserved documentation domain, IP, or ASN may occupy command position as shorthand; it delegates to this same parser and URL-like input requires the explicit lookup command. Deep mode adds bounded WHOIS, DNS, HTTP, TLS, technology, posture, and network context where applicable. A full Deep homepage observation can derive fixed publication and delivery/cache summaries from the same response without retaining raw metadata values or making another request. --browse opens before collection, shows aggregate Fast progress or independently settled planned Deep sources, and then navigates allowlisted retained fields in the completed document. Press ? for help and / to search rendered panel text only. Closing during collection cancels without a partial document. --save-lookup writes the exact completed private JSON only after a normal browser close; it can contain normalised evidence omitted from panels and refuses an existing path.',
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
    boundary: 'Requests use the shared public-address and redirect guards. Fixed content-coding and cache-policy metadata describes only the selected response, excludes raw header values, and does not prove caching, transfer savings, performance, privacy, or safety. This is not a rendered browser or vulnerability scan.',
  },
  tls: {
    description: 'Inspect one hostname certificate through a bounded TLS connection.',
    example: 'whoisleuth tls example.test --json',
    boundary: 'One observed connection is point-in-time evidence and does not establish every address, edge, or historical certificate.',
  },
  'dnssec-validate': {
    description: 'Cryptographically validate one authorised DNSSEC chain from a supplied trust anchor through one selected public resolver.',
    example: 'whoisleuth dnssec-validate example.test --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --json',
    boundary: 'This isolated action is never invoked by Lookup, Bulk, monitoring, or recipes. It caps DNS queries, aliases, delegations, bytes, and duration; transport and validation failures remain separate, and secure is not a general safety verdict.',
  },
  'mail-transport': {
    description: 'Review selected authorised MX endpoints, DNSSEC-qualified TLSA evidence, SMTP capabilities, and optional STARTTLS certificates.',
    example: 'whoisleuth mail-transport selected-mx.json --resolver "$PUBLIC_RESOLVER_IP" --trust-anchor anchor.json --owned-or-authorized --active-probe --json',
    boundary: 'This isolated action probes at most three selected MX hosts sequentially, reports selection, public revalidation, connection, and address authentication separately, sends only EHLO and optional STARTTLS, never retries, and performs no authentication, relay, recipient, mailbox, catch-all, or message test. If a DANE-TA TLSA usage 2 association is published, active collection retains only the leaf certificate and leaves that comparison partial without certificate-path construction and trust-anchor path validation. SMTP relay PKIX-TA usage 0 and PKIX-EE usage 1 records remain unsupported and cannot complete SMTP DANE assurance; a separate usage 3 match remains eligible.',
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
    description: 'Build privacy-safe suffix and capability-profile timelines from saved observations or retained cohort reports.',
    example: 'whoisleuth registry-cohort saved-lookups.jsonl --json',
    boundary: 'This command is offline and omits domains, queries, and raw evidence. Input families cannot be mixed, and retained samples are never assumed independent.',
  },
  'registry-scaffold': {
    description: 'Create a bounded synthetic WHOIS fixture scaffold for one existing capability profile.',
    example: 'whoisleuth registry-scaffold --profile example-profile --suffix test --scenario registered',
    boundary: 'The output is a sanitised template only. Its command-owned --profile selects fixture capability, --config is rejected, and contributors must not paste live responses or personal registration data into fixtures.',
  },
  'risk-calibrate': {
    description: 'Replay reviewed labels against the current explainable Risk model.',
    example: 'whoisleuth risk-calibrate calibration.json --summary-json',
    boundary: 'Calibration is offline and diagnostic. The summary form omits record identifiers, domains, and evidence; neither form trains, tunes, or changes the scoring model automatically.',
  },
  'lookalike-calibrate': {
    description: 'Summarise reviewed candidate dispositions by mutation family without retaining domains.',
    example: 'whoisleuth lookalike-calibrate reviewed-candidates.json --json',
    boundary: 'Calibration is offline and diagnostic. It omits candidate identifiers, domains, notes, and evidence and never tunes generation or filtering automatically.',
  },
  'verify-artifact': {
    description: 'Validate a supported archive, claim passport, packet, manifest, saved Lookup, or supported Lookup-evidence export without printing evidence contents.',
    example: 'whoisleuth verify-artifact report.json --manifest manifest.json --manifest-entry artifact-2 --json --strict-exit',
    boundary: 'Verification is offline and redacted. Encrypted archives require an explicitly supplied passphrase file; --strict-exit returns 4 when only an envelope or legacy projection integrity was verified.',
  },
  'interchange-report': {
    description: 'Report what one recognised portable artefact preserves, excludes, and supports across browser and CLI workflows.',
    example: 'whoisleuth interchange-report workspace.json --json',
    boundary: 'The report is offline and metadata-only. It does not echo targets, contacts, notes, passphrases, evidence values, or an unrecognised schema string.',
  },
  'inspect-archive': {
    description: `Summarise or search one current version-${WORKSPACE_ARCHIVE_VERSION} workspace archive, with exact public version-${PUBLIC_WORKSPACE_ARCHIVE_VERSION} support and redacted output by default.`,
    example: 'whoisleuth inspect-archive workspace.json --search example.test --json',
    boundary: 'Exact matches require --reveal. Retired and future archive versions are rejected without changing data. The archive is read locally and is never uploaded.',
  },
  'sign-artifact': {
    description: 'Sign one reviewed response packet or supported manifest with a local private key.',
    example: 'whoisleuth sign-artifact packet.json --private-key-file analyst-private.pem',
    boundary: 'The command never creates, stores, or transmits keys. Key custody and signer identity remain the operator\'s responsibility.',
  },
  'verify-signature': {
    description: 'Verify the cryptographic signature of one signed evidence package and report embedded-artefact assurance separately.',
    example: 'whoisleuth verify-signature packet.signed.json --json',
    boundary: 'A valid signature proves package consistency for the embedded key. It does not upgrade failed or unsupported embedded-artefact assurance or establish the holder\'s real-world identity or authority.',
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
    description: `Build a reviewed, audience-specific Case-pack v2 from an exact Case-schema-${CASE_SCHEMA_VERSION} export.`,
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
    description: 'Compare two compatible retained Lookup, Bulk-session, or domain-portfolio artefacts.',
    example: 'whoisleuth diff first.json second.json --json',
    boundary: 'Comparison is offline. Multi-session Bulk exports require explicit session IDs, and missing, unavailable, equal, and different evidence remain separate states.',
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
    boundary: `Saved Lookup versions 1 and 2 are capped at 8 MiB and scanned for duplicate keys, the prototype-sensitive __proto__ key, and bounded nesting, key, value, and per-container counts before parsing. Current schema-${LOOKUP_EVIDENCE_SCHEMA_VERSION} exports preserve evidence-source attribution and limitations; exact public schema ${PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remains readable with its strict source/publication binding, while other historical and unreleased shapes are unsupported. Markdown and HTML include a presentation-only generator footer unless --no-attribution is selected; JSON retains bounded generator provenance. Compact output intentionally omits raw registry payloads.`,
  },
});

const COMMAND_COLLECTION_SEED: Readonly<Record<CliCommand, CommandCollection>> = Object.freeze({
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
  posture: { mode: 'network', scope: 'Accepts one domain and performs bounded RDAP, DNS, and conditional MTA-STS HTTPS requests.' },
  http: { mode: 'network', scope: 'Accepts one domain and follows only the bounded SSRF-guarded homepage redirect workflow.' },
  tls: { mode: 'network', scope: 'Accepts one public hostname and opens one bounded certificate connection.' },
  'dnssec-validate': { mode: 'network', scope: 'Accepts one authorised domain, one public resolver IP, and one local trust-anchor file; DNS-over-TCP validation is capped at 32 queries and 15 seconds.' },
  'mail-transport': { mode: 'network', scope: 'Accepts at most three selected authorised MX hosts, uses one public resolver, and performs sequential bounded SMTP connections with no retries.' },
  'registry-support': { mode: 'offline', scope: 'Reads the embedded registry capability catalogue for one domain or suffix.' },
  'registry-doctor': { mode: 'offline', scope: 'Reads one saved Lookup and the embedded registry capability catalogue.' },
  'registry-cohort': { mode: 'offline', scope: 'Reads at most 500 saved Lookups or retained cohort reports from one unmixed family and emits bounded target-free timelines.' },
  'registry-scaffold': { mode: 'offline', scope: 'Reads the embedded registry capability catalogue and prints one synthetic fixture template.' },
  'risk-calibrate': { mode: 'offline', scope: 'Reads one bounded reviewed-label dataset and changes no model or evidence.' },
  'lookalike-calibrate': { mode: 'offline', scope: 'Reads at most 5,000 reviewed candidate labels from one dataset capped at 2 MiB.' },
  'verify-artifact': { mode: 'offline', scope: 'Reads one selected bounded artefact and, when explicitly supplied, one manifest whose selected entry is compared by exact bytes and canonical identity.' },
  'interchange-report': { mode: 'offline', scope: 'Reads one selected bounded portable artefact and emits fixed compatibility metadata only.' },
  'inspect-archive': { mode: 'offline', scope: `Reads one selected bounded workspace archive v${WORKSPACE_ARCHIVE_VERSION}, retains exact v${PUBLIC_WORKSPACE_ARCHIVE_VERSION} compatibility, and redacts output by default.` },
  'sign-artifact': { mode: 'offline', scope: 'Reads one selected artefact and one local private key without transmitting either.' },
  'verify-signature': { mode: 'offline', scope: 'Reads one selected signed package and optional local public key.' },
  'source-report': { mode: 'offline', scope: 'Reads bounded saved evidence and emits target-free source reliability data.' },
  compare: { mode: 'offline', scope: 'Reads one saved Lookup and compares its separately attributed registry publications.' },
  'page-compare': { mode: 'offline', scope: 'Reads two saved Lookup documents and executes no page code.' },
  'mail-review': { mode: 'offline', scope: 'Reads one saved Bulk result and sends no DNS or SMTP traffic.' },
  'review-evidence': { mode: 'offline', scope: 'Reads one bounded versioned evidence or request-planning document and performs no collection.' },
  brief: { mode: 'offline', scope: 'Reads one bounded saved Lookup and emits a compact source-attributed decision brief.' },
  'case-pack': { mode: 'offline', scope: `Reads one bounded Case-schema-${CASE_SCHEMA_VERSION} browser export and writes a separate audience-specific Case-pack v2.` },
  'domain-control': { mode: 'offline', scope: 'Reads one bounded desired-state or review document and performs no collection or configuration change.' },
  'monitor-once': { mode: 'network', scope: 'Runs deep collection for at most 20 manifest domains with concurrency capped at 3.' },
  assurance: { mode: 'offline', scope: 'Reads one versioned plan capped at 2 MiB and makes no request or configuration change.' },
  'change-packet': { mode: 'offline', scope: 'Reads one versioned packet input capped at 6 MiB and makes no request or configuration change.' },
  'sharing-review': { mode: 'offline', scope: 'Reads one artefact capped at 15 MiB, emits only bounded schema/version metadata and no content values, and performs no transmission.' },
  'workflow-plan': { mode: 'offline', scope: 'Builds a fixed typed recipe and executes none of its network or file steps.' },
  'workflow-run': { mode: 'network', scope: 'Runs only concrete fixed-recipe steps; network collection requires --approve-network and analyst-selection steps always pause.' },
  diff: { mode: 'offline', scope: 'Reads two compatible retained artefacts capped at 8 MiB each and retains no source paths.' },
  reconcile: { mode: 'offline', scope: 'Reads 2 to 5 saved observations for one domain, capped at 32 MiB in total.' },
  timeline: { mode: 'offline', scope: 'Reads 2 to 20 saved observations for one domain, capped at 32 MiB in total.' },
  export: { mode: 'offline', scope: 'Reads one saved Lookup and writes one bounded report.' },
});

const COMMON_OPTIONS = Object.freeze(['--help', '--output', '--force', '--config', '--profile', '--palette']);
const REGISTRY_SCAFFOLD_COMMON_OPTIONS = Object.freeze(
  COMMON_OPTIONS.filter((option) => option !== '--config' && option !== '--profile'),
);

function commonOptionsSeedForCommand(command: CliCommand): readonly string[] {
  return command === 'registry-scaffold' ? REGISTRY_SCAFFOLD_COMMON_OPTIONS : COMMON_OPTIONS;
}
const OPTIONS_BY_COMMAND_SEED: Readonly<Record<CliCommand, readonly string[]>> = Object.freeze({
  manifest: ['--workflow', '--configuration-digest', '--json', '--quiet', '--no-color'],
  'map-observations': ['--json', '--quiet', '--no-color'],
  'oam-export': ['--json', '--quiet', '--no-color'],
  lookup: ['--json', '--junit', '--markdown', '--html', '--no-attribution', '--fast', '--deep', '--observer', '--vantage', '--plan', '--summary', '--verbose', '--browse', '--save-lookup', '--strict-exit', '--fail-on', '--events', '--quiet', '--no-color'],
  bulk: ['--json', '--jsonl', '--junit', '--csv', '--domains', '--queries', '--registered-only', '--inconclusive-only', '--errors-only', '--fast', '--deep', '--concurrency', '--checkpoint', '--resume', '--events', '--plan', '--fail-on', '--quiet', '--no-color'],
  'ct-search': ['--json', '--quiet', '--no-color'],
  'ct-intake': ['--json', '--quiet', '--no-color'],
  discover: ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--snapshot', '--json', '--jsonl', '--domains', '--quiet', '--no-color'],
  'discover-scan': ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--fast', '--deep', '--scan-limit', '--chunk-size', '--concurrency', '--resolver', '--allowlist', '--checkpoint', '--resume', '--observation-snapshot', '--registered-only', '--inconclusive-only', '--acquisition-only', '--suppressed-only', '--events', '--plan', '--fail-on', '--json', '--jsonl', '--csv', '--domains', '--quiet', '--no-color'],
  posture: ['--selectors', '--retired-selectors', '--mail-profile', '--json', '--sarif', '--owned-domain', '--quiet', '--no-color'],
  http: ['--json', '--quiet', '--no-color'],
  tls: ['--json', '--quiet', '--no-color'],
  'dnssec-validate': ['--resolver', '--trust-anchor', '--owned-or-authorized', '--json', '--quiet', '--no-color'],
  'mail-transport': ['--resolver', '--trust-anchor', '--owned-or-authorized', '--active-probe', '--json', '--quiet', '--no-color'],
  'registry-support': ['--json', '--quiet', '--no-color'],
  'registry-doctor': ['--json', '--quiet', '--no-color'],
  'registry-cohort': ['--json', '--quiet', '--no-color'],
  'registry-scaffold': ['--profile', '--suffix', '--scenario'],
  'risk-calibrate': ['--json', '--summary-json', '--quiet', '--no-color'],
  'lookalike-calibrate': ['--json', '--quiet', '--no-color'],
  'verify-artifact': ['--passphrase-file', '--manifest', '--manifest-entry', '--json', '--strict-exit', '--quiet', '--no-color'],
  'interchange-report': ['--passphrase-file', '--json', '--quiet', '--no-color'],
  'inspect-archive': ['--passphrase-file', '--search', '--require-match', '--reveal', '--expect-content-digest', '--json', '--quiet', '--no-color'],
  'sign-artifact': ['--private-key-file'],
  'verify-signature': ['--public-key-file', '--json', '--quiet', '--no-color'],
  'source-report': ['--json', '--quiet', '--no-color'],
  compare: ['--json', '--quiet', '--no-color'],
  'page-compare': ['--json', '--quiet', '--no-color'],
  'mail-review': ['--json', '--quiet', '--no-color'],
  'review-evidence': ['--mmdb', '--json', '--strict-exit', '--quiet', '--no-color'],
  brief: ['--json', '--quiet', '--no-color'],
  'case-pack': ['--audience', '--reviewed', '--json', '--quiet', '--no-color'],
  'domain-control': ['--json', '--quiet', '--no-color'],
  'monitor-once': ['--previous', '--limit', '--concurrency', '--fail-on', '--json', '--junit', '--quiet', '--no-color'],
  assurance: ['--json', '--quiet', '--no-color'],
  'change-packet': ['--json', '--quiet', '--no-color'],
  'sharing-review': ['--marking', '--recipient-scope', '--purpose', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed', '--json', '--quiet', '--no-color'],
  'workflow-plan': ['--list', '--explain', '--json', '--quiet', '--no-color'],
  'workflow-run': ['--approve-network', '--resume', '--json', '--quiet', '--no-color'],
  diff: ['--left-session', '--right-session', '--json', '--quiet', '--no-color'],
  reconcile: ['--json', '--quiet', '--no-color'],
  timeline: ['--json', '--quiet', '--no-color'],
  export: ['--markdown', '--html', '--compact', '--no-attribution'],
  completion: [],
  commands: ['--common', '--group', '--mode', '--json', '--quiet', '--no-color'],
  doctor: ['--network', '--json', '--quiet', '--no-color'],
  manual: [],
});

const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '--group': Object.freeze(['investigate', 'respond', 'assure', 'utilities']),
  '--mode': Object.freeze(['offline', 'network']),
  '--explain': INVESTIGATION_PLAN_RECIPES,
  '--preset': Object.freeze(['common', 'impersonation', 'all']),
  '--keyboard': Object.freeze(['qwerty', 'azerty', 'qwertz', 'all']),
  '--mail-profile': Object.freeze(['standard', 'defensive-no-mail', 'parked']),
  '--marking': Object.freeze(['clear', 'green', 'amber', 'amber-strict', 'red']),
  '--recipient-scope': Object.freeze(['public', 'community', 'organization', 'named-recipients']),
  '--audience': Object.freeze(['internal', 'trusted', 'public']),
  '--fail-on': Object.freeze(['source-failure', 'inconclusive', 'danger', 'material-drift']),
  '--manifest-entry': Object.freeze(Array.from({ length: 16 }, (_, index) => `artifact-${index + 1}`)),
  '--palette': Object.freeze(['auto', 'light', 'dark']),
  '--scenario': Object.freeze(['registered', 'not_found', 'inconclusive']),
});
const STANDARD_CONCURRENCY_VALUES = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8']);
const LIMITED_CONCURRENCY_VALUES = Object.freeze(['1', '2', '3']);

const FILE_OPTIONS = Object.freeze([
  '--checkpoint',
  '--config',
  '--allowlist',
  '--dictionary',
  '--manifest',
  '--mmdb',
  '--output',
  '--passphrase-file',
  '--private-key-file',
  '--public-key-file',
  '--snapshot',
  '--observation-snapshot',
  '--previous',
  '--save-lookup',
  '--trust-anchor',
]);

const FILE_OPTIONS_BY_COMMAND: Partial<Record<CliCommand, readonly string[]>> = Object.freeze({
  'workflow-run': Object.freeze(['--resume']),
});

function positional(
  name: string,
  valueKind: CliPositionalValueKind,
  minimum: number,
  maximum: number,
  values: readonly string[] = [],
  inputSource: CliPositionalInputSource = 'argv',
  requiredWhenOptions: readonly string[] = [],
): CliPositionalSpec {
  return Object.freeze({
    name,
    valueKind,
    minimum,
    maximum,
    values: Object.freeze([...values]),
    inputSource,
    requiredWhenOptions: Object.freeze([...requiredWhenOptions]),
  });
}

const NO_POSITIONALS: readonly CliPositionalSpec[] = Object.freeze([]);
const OPTIONAL_FILE_POSITIONAL = Object.freeze([positional('source', 'file', 0, 1, [], 'argv_or_stdin')]);
const OPTIONAL_TEXT_POSITIONAL = Object.freeze([positional('subject', 'text', 0, 1, [], 'argv_or_stdin')]);
const POSITIONALS_BY_COMMAND_SEED: Readonly<Record<CliCommand, readonly CliPositionalSpec[]>> = Object.freeze({
  completion: Object.freeze([positional('shell', 'enum', 1, 1, ['bash', 'zsh', 'fish', 'powershell'])]),
  doctor: NO_POSITIONALS,
  commands: NO_POSITIONALS,
  manual: NO_POSITIONALS,
  manifest: Object.freeze([positional('artefacts', 'file', 1, 16)]),
  'map-observations': OPTIONAL_FILE_POSITIONAL,
  'oam-export': OPTIONAL_FILE_POSITIONAL,
  lookup: Object.freeze([positional('target', 'text', 0, 1, [], 'argv_or_stdin', ['--browse'])]),
  bulk: OPTIONAL_FILE_POSITIONAL,
  'ct-search': Object.freeze([positional('keyword', 'text', 0, 1, [], 'argv_or_stdin')]),
  'ct-intake': OPTIONAL_FILE_POSITIONAL,
  discover: OPTIONAL_TEXT_POSITIONAL,
  'discover-scan': OPTIONAL_TEXT_POSITIONAL,
  posture: Object.freeze([positional('domain', 'text', 0, 1, [], 'argv_or_stdin')]),
  http: Object.freeze([positional('domain', 'text', 0, 1, [], 'argv_or_stdin')]),
  tls: Object.freeze([positional('hostname', 'text', 0, 1, [], 'argv_or_stdin')]),
  'dnssec-validate': Object.freeze([positional('domain', 'text', 1, 1)]),
  'mail-transport': OPTIONAL_FILE_POSITIONAL,
  'registry-support': Object.freeze([positional('domain-or-suffix', 'text', 0, 1, [], 'argv_or_stdin')]),
  'registry-doctor': OPTIONAL_FILE_POSITIONAL,
  'registry-cohort': OPTIONAL_FILE_POSITIONAL,
  'registry-scaffold': NO_POSITIONALS,
  'risk-calibrate': OPTIONAL_FILE_POSITIONAL,
  'lookalike-calibrate': OPTIONAL_FILE_POSITIONAL,
  'verify-artifact': OPTIONAL_FILE_POSITIONAL,
  'interchange-report': OPTIONAL_FILE_POSITIONAL,
  'inspect-archive': OPTIONAL_FILE_POSITIONAL,
  'sign-artifact': OPTIONAL_FILE_POSITIONAL,
  'verify-signature': OPTIONAL_FILE_POSITIONAL,
  'source-report': OPTIONAL_FILE_POSITIONAL,
  compare: OPTIONAL_FILE_POSITIONAL,
  'page-compare': Object.freeze([positional('sources', 'file', 2, 2)]),
  'mail-review': OPTIONAL_FILE_POSITIONAL,
  'review-evidence': OPTIONAL_FILE_POSITIONAL,
  brief: OPTIONAL_FILE_POSITIONAL,
  'case-pack': OPTIONAL_FILE_POSITIONAL,
  'domain-control': OPTIONAL_FILE_POSITIONAL,
  'monitor-once': OPTIONAL_FILE_POSITIONAL,
  assurance: OPTIONAL_FILE_POSITIONAL,
  'change-packet': OPTIONAL_FILE_POSITIONAL,
  'sharing-review': OPTIONAL_FILE_POSITIONAL,
  'workflow-plan': Object.freeze([
    positional('recipe', 'enum', 0, 1, INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 0, 1),
  ]),
  'workflow-run': Object.freeze([
    positional('recipe', 'enum', 1, 1, RUNNABLE_INVESTIGATION_PLAN_RECIPES),
    positional('subject', 'text', 1, 1),
  ]),
  diff: Object.freeze([positional('sources', 'file', 2, 2)]),
  reconcile: Object.freeze([positional('sources', 'file', 2, 5)]),
  timeline: Object.freeze([positional('sources', 'file', 2, 20)]),
  export: OPTIONAL_FILE_POSITIONAL,
});

const TEXT_OPTIONS = Object.freeze([
  '--families',
  '--workflow',
  '--configuration-digest',
  '--resolver',
  '--expect-content-digest',
  '--profile',
  '--suffix',
  '--left-session',
  '--right-session',
  '--purpose',
  '--observer',
  '--retired-selectors',
  '--search',
  '--selectors',
  '--tlds',
  '--vantage',
]);

const IDEMPOTENT_OPTIONS = Object.freeze([
  '--human-reviewed',
  '--no-color',
  '--personal-data-reviewed',
  '--quiet',
  '--redactions-confirmed',
]);

const INTEGER_RANGE_SEED: Readonly<Partial<Record<CliCommand, Readonly<Record<string, readonly CliOptionIntegerRange[]>>>>> = Object.freeze({
  bulk: Object.freeze({
    '--concurrency': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 8, whenOptionPresent: null }),
      Object.freeze({ minimum: 1, maximum: 3, whenOptionPresent: '--deep' }),
    ]),
  }),
  'discover-scan': Object.freeze({
    '--scan-limit': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 500, whenOptionPresent: null }),
      Object.freeze({ minimum: 1, maximum: 50, whenOptionPresent: '--deep' }),
    ]),
    '--chunk-size': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 100, whenOptionPresent: null }),
    ]),
    '--concurrency': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 8, whenOptionPresent: null }),
      Object.freeze({ minimum: 1, maximum: 3, whenOptionPresent: '--deep' }),
    ]),
  }),
  'monitor-once': Object.freeze({
    '--limit': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 20, whenOptionPresent: null }),
    ]),
    '--concurrency': Object.freeze([
      Object.freeze({ minimum: 1, maximum: 3, whenOptionPresent: null }),
    ]),
  }),
});

function constraint(
  value: CliGrammarConstraint,
): CliGrammarConstraint {
  if (value.kind === 'mutually_exclusive') {
    return Object.freeze({ ...value, options: Object.freeze([...value.options]) });
  }
  if (value.kind === 'required') {
    return Object.freeze({ ...value, options: Object.freeze([...value.options]) });
  }
  if (value.kind === 'excludes_all' || value.kind === 'value_excludes') {
    return Object.freeze({ ...value, excludedOptions: Object.freeze([...value.excludedOptions]) });
  }
  return Object.freeze({ ...value, requiredOptions: Object.freeze([...value.requiredOptions]) });
}

const EMPTY_CONSTRAINTS: readonly CliGrammarConstraint[] = Object.freeze([]);
const FILE_OUTPUT_CONSTRAINTS = Object.freeze([
  constraint({ kind: 'requires_all', option: '--force', requiredOptions: ['--output'] }),
] satisfies readonly CliGrammarConstraint[]);
const QUIET_OUTPUT_CONSTRAINT = constraint({
  kind: 'mutually_exclusive',
  options: ['--quiet', '--output'],
});
const MACHINE_OUTPUT_OPTIONS = Object.freeze([
  '--json', '--jsonl', '--junit', '--csv', '--domains', '--queries', '--markdown',
  '--html', '--sarif', '--summary-json',
]);
const GRAMMAR_CONSTRAINTS_SEED: Readonly<Partial<Record<CliCommand, readonly CliGrammarConstraint[]>>> = Object.freeze({
  commands: Object.freeze([]),
  manifest: Object.freeze([
    constraint({ kind: 'required', options: ['--workflow'] }),
  ]),
  lookup: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--summary', '--verbose'] }),
    constraint({ kind: 'requires_all', option: '--save-lookup', requiredOptions: ['--browse'] }),
    constraint({ kind: 'excludes_all', option: '--summary', excludedOptions: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--verbose', excludedOptions: ['--json', '--junit', '--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--browse', excludedOptions: ['--json', '--junit', '--markdown', '--html', '--summary', '--verbose', '--events', '--plan', '--quiet'] }),
    constraint({ kind: 'requires_any', option: '--no-attribution', requiredOptions: ['--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--junit', '--markdown', '--html', '--summary', '--verbose', '--strict-exit', '--events', '--quiet', '--fail-on'] }),
  ]),
  bulk: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--junit', '--csv', '--domains', '--queries'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--registered-only', '--inconclusive-only', '--errors-only'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'requires_all', option: '--resume', requiredOptions: ['--checkpoint'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--jsonl', '--junit', '--csv', '--domains', '--queries', '--events', '--checkpoint', '--resume', '--quiet', '--fail-on'] }),
  ]),
  discover: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--domains'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--preset', '--families'] }),
    constraint({ kind: 'value_excludes', option: '--preset', value: 'common', excludedOptions: ['--dictionary'] }),
  ]),
  'discover-scan': Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--jsonl', '--csv', '--domains'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--preset', '--families'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--fast', '--deep'] }),
    constraint({ kind: 'mutually_exclusive', options: ['--registered-only', '--inconclusive-only', '--acquisition-only', '--suppressed-only'] }),
    constraint({ kind: 'requires_all', option: '--resume', requiredOptions: ['--checkpoint'] }),
    constraint({ kind: 'value_excludes', option: '--preset', value: 'common', excludedOptions: ['--dictionary'] }),
    constraint({ kind: 'excludes_all', option: '--plan', excludedOptions: ['--jsonl', '--csv', '--domains', '--events', '--checkpoint', '--resume', '--observation-snapshot', '--quiet', '--fail-on'] }),
  ]),
  posture: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--sarif'] }),
    constraint({ kind: 'requires_all', option: '--sarif', requiredOptions: ['--owned-domain'] }),
  ]),
  'dnssec-validate': Object.freeze([
    constraint({ kind: 'required', options: ['--resolver', '--trust-anchor', '--owned-or-authorized'] }),
  ]),
  'mail-transport': Object.freeze([
    constraint({ kind: 'required', options: ['--resolver', '--trust-anchor', '--owned-or-authorized', '--active-probe'] }),
  ]),
  'registry-scaffold': Object.freeze([
    constraint({ kind: 'required', options: ['--profile', '--suffix', '--scenario'] }),
  ]),
  'risk-calibrate': Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--summary-json'] }),
  ]),
  'verify-artifact': Object.freeze([
    constraint({ kind: 'requires_all', option: '--manifest', requiredOptions: ['--manifest-entry'] }),
    constraint({ kind: 'requires_all', option: '--manifest-entry', requiredOptions: ['--manifest'] }),
  ]),
  'inspect-archive': Object.freeze([
    constraint({ kind: 'requires_all', option: '--reveal', requiredOptions: ['--search'] }),
    constraint({ kind: 'requires_all', option: '--require-match', requiredOptions: ['--search'] }),
  ]),
  'sign-artifact': Object.freeze([
    constraint({ kind: 'required', options: ['--private-key-file'] }),
  ]),
  'case-pack': Object.freeze([
    constraint({ kind: 'required', options: ['--audience', '--reviewed'] }),
  ]),
  'monitor-once': Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--json', '--junit'] }),
  ]),
  'sharing-review': Object.freeze([
    constraint({ kind: 'required', options: ['--marking', '--recipient-scope', '--purpose'] }),
  ]),
  'workflow-plan': Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--list', '--explain'] }),
  ]),
  export: Object.freeze([
    constraint({ kind: 'mutually_exclusive', options: ['--markdown', '--html'] }),
    constraint({ kind: 'excludes_all', option: '--compact', excludedOptions: ['--markdown', '--html'] }),
    constraint({ kind: 'requires_any', option: '--no-attribution', requiredOptions: ['--markdown', '--html'] }),
  ]),
});

function optionValueKind(command: CliCommand, option: string): CliOptionValueKind {
  if (Object.hasOwn(VALUE_OPTIONS, option)) return option === '--fail-on' ? 'policy_list' : 'enum';
  if (INTEGER_RANGE_SEED[command]?.[option]) return 'integer';
  if (FILE_OPTIONS.includes(option) || FILE_OPTIONS_BY_COMMAND[command]?.includes(option)) return 'file';
  if (TEXT_OPTIONS.includes(option)) return 'text';
  return 'flag';
}

function optionSpec(command: CliCommand, option: string, scope: CliOptionScope): CliOptionSpec {
  const valueKind = optionValueKind(command, option);
  return Object.freeze({
    option,
    scope,
    arity: valueKind === 'flag' ? 0 : 1,
    valueKind,
    values: Object.freeze([...(VALUE_OPTIONS[option] ?? [])]),
    integerRanges: Object.freeze([...(INTEGER_RANGE_SEED[command]?.[option] ?? [])]),
    occurrence: IDEMPOTENT_OPTIONS.includes(option) ? 'idempotent' : 'once',
    metaAction: option === '--help' ? 'help' : null,
  });
}

function grammarConstraints(command: CliCommand): readonly CliGrammarConstraint[] {
  const commandOptions = OPTIONS_BY_COMMAND_SEED[command];
  const machineOutputOptions = commandOptions.filter((option) => MACHINE_OUTPUT_OPTIONS.includes(option));
  return Object.freeze([
    ...FILE_OUTPUT_CONSTRAINTS,
    ...(commandOptions.includes('--quiet') ? [QUIET_OUTPUT_CONSTRAINT] : []),
    ...(commandOptions.includes('--quiet') && machineOutputOptions.length > 0
      ? [constraint({ kind: 'excludes_all', option: '--quiet', excludedOptions: machineOutputOptions })]
      : []),
    ...(commandOptions.includes('--events')
      ? [constraint({ kind: 'mutually_exclusive', options: ['--events', '--output'] })]
      : []),
    ...(commandOptions.includes('--browse')
      ? [constraint({ kind: 'mutually_exclusive', options: ['--browse', '--output'] })]
      : []),
    ...(GRAMMAR_CONSTRAINTS_SEED[command] ?? EMPTY_CONSTRAINTS),
  ]);
}

const COMMAND_DESCRIPTIONS_SEED: Readonly<Record<CliCommand, string>> = Object.freeze({
  manifest: 'Build an evidence manifest offline',
  'map-observations': 'Apply a declarative observation map offline',
  'oam-export': 'Project external findings to Open Asset Model',
  lookup: 'Collect one domain, IP, or ASN',
  bulk: 'Run bounded multi-target collection',
  'ct-search': 'Search certificate observations',
  'ct-intake': 'Normalise certificate observations offline',
  discover: 'Generate lookalike candidates offline',
  'discover-scan': 'Collect a supervised candidate review queue',
  posture: 'Review DNS and mail posture',
  http: 'Inspect one homepage request',
  tls: 'Inspect one TLS connection',
  'dnssec-validate': 'Validate an authorised DNSSEC chain',
  'mail-transport': 'Review selected authorised SMTP transports',
  'registry-support': 'Explain local registry coverage',
  'registry-doctor': 'Diagnose saved registry collection',
  'registry-cohort': 'Build target-free registry quality timelines',
  'registry-scaffold': 'Create a sanitised registry fixture scaffold',
  'risk-calibrate': 'Replay reviewed Risk labels offline',
  'lookalike-calibrate': 'Summarise reviewed lookalike yield offline',
  'verify-artifact': 'Validate saved evidence offline',
  'interchange-report': 'Report portable artefact fidelity offline',
  'inspect-archive': 'Inspect an archive locally',
  'sign-artifact': 'Sign a reviewed artefact locally',
  'verify-signature': 'Verify a signed evidence package',
  'source-report': 'Build a target-free source report',
  compare: 'Compare registry publications in one lookup',
  'page-compare': 'Compare saved static page evidence',
  'mail-review': 'Review saved passive mail evidence',
  'review-evidence': 'Review supplied evidence offline',
  brief: 'Build a decision brief from a saved lookup',
  'case-pack': 'Build a reviewed case package',
  'domain-control': 'Build or review a domain control manifest',
  'monitor-once': 'Run one bounded domain control review',
  assurance: 'Review domain change, recovery, or retirement plans',
  'change-packet': 'Build a reviewed change packet offline',
  'sharing-review': 'Lint an artefact before deliberate sharing',
  'workflow-plan': 'Plan a fixed investigation recipe',
  'workflow-run': 'Execute approved fixed-recipe steps',
  diff: 'Compare two compatible retained artefacts',
  reconcile: 'Reconcile independently labelled observations',
  timeline: 'Build same-domain history from saved lookups',
  export: 'Convert a lookup to an evidence report',
  completion: 'Print shell completion',
  commands: 'List installed command contracts',
  doctor: 'Check the local CLI runtime',
  manual: 'Print the generated manual page',
});

const HELP_COMMANDS_BY_GROUP = Object.freeze({
  investigate: Object.freeze([
    'lookup', 'bulk', 'ct-search', 'ct-intake', 'discover', 'discover-scan',
    'posture', 'http', 'tls', 'registry-support', 'registry-doctor',
    'registry-cohort', 'source-report', 'compare', 'page-compare', 'mail-review',
    'review-evidence', 'brief',
  ] satisfies readonly CliCommand[]),
  respond: Object.freeze([
    'map-observations', 'oam-export', 'case-pack', 'change-packet',
    'sharing-review', 'export',
  ] satisfies readonly CliCommand[]),
  assure: Object.freeze([
    'dnssec-validate', 'mail-transport', 'domain-control', 'monitor-once',
    'assurance', 'workflow-plan', 'workflow-run', 'diff', 'reconcile', 'timeline',
    'inspect-archive', 'verify-artifact', 'interchange-report', 'manifest',
    'sign-artifact', 'verify-signature', 'risk-calibrate', 'lookalike-calibrate',
  ] satisfies readonly CliCommand[]),
  utilities: Object.freeze([
    'registry-scaffold', 'doctor', 'commands', 'completion', 'manual',
  ] satisfies readonly CliCommand[]),
} satisfies Readonly<Record<CliHelpGroup, readonly CliCommand[]>>);

const HELP_GROUP_BY_COMMAND = Object.freeze(Object.fromEntries(
  Object.entries(HELP_COMMANDS_BY_GROUP).flatMap(([group, commands]) => (
    commands.map((command) => [command, group])
  )),
)) as Readonly<Record<CliCommand, CliHelpGroup>>;

const HANDLER_OWNER_BY_COMMAND: Readonly<Record<CliCommand, CliHandlerOwner>> = Object.freeze({
  completion: 'inline',
  doctor: 'inline',
  commands: 'inline',
  manual: 'inline',
  manifest: 'inline',
  'map-observations': 'inline',
  'oam-export': 'inline',
  lookup: 'lookup',
  bulk: 'bulk',
  'ct-search': 'network',
  'ct-intake': 'inline',
  discover: 'discovery',
  'discover-scan': 'discovery_scan',
  posture: 'network',
  http: 'network',
  tls: 'network',
  'dnssec-validate': 'network',
  'mail-transport': 'network',
  'registry-support': 'inline',
  'registry-doctor': 'inline',
  'registry-cohort': 'inline',
  'registry-scaffold': 'inline',
  'risk-calibrate': 'inline',
  'lookalike-calibrate': 'inline',
  'verify-artifact': 'inline',
  'interchange-report': 'inline',
  'inspect-archive': 'evidence',
  'sign-artifact': 'evidence',
  'verify-signature': 'evidence',
  'source-report': 'inline',
  compare: 'inline',
  'page-compare': 'inline',
  'mail-review': 'inline',
  'review-evidence': 'inline',
  brief: 'inline',
  'case-pack': 'inline',
  'domain-control': 'inline',
  'monitor-once': 'inline',
  assurance: 'inline',
  'change-packet': 'inline',
  'sharing-review': 'inline',
  'workflow-plan': 'inline',
  'workflow-run': 'inline',
  diff: 'inline',
  reconcile: 'inline',
  timeline: 'inline',
  export: 'inline',
});

const NETWORK_EFFECT_BY_COMMAND: Readonly<Record<CliCommand, CliNetworkEffect>> = Object.freeze({
  completion: 'offline',
  doctor: 'conditional_network',
  commands: 'offline',
  manual: 'offline',
  manifest: 'offline',
  'map-observations': 'offline',
  'oam-export': 'offline',
  lookup: 'conditional_network',
  bulk: 'conditional_network',
  'ct-search': 'always_network',
  'ct-intake': 'offline',
  discover: 'offline',
  'discover-scan': 'conditional_network',
  posture: 'always_network',
  http: 'always_network',
  tls: 'always_network',
  'dnssec-validate': 'always_network',
  'mail-transport': 'always_network',
  'registry-support': 'offline',
  'registry-doctor': 'offline',
  'registry-cohort': 'offline',
  'registry-scaffold': 'offline',
  'risk-calibrate': 'offline',
  'lookalike-calibrate': 'offline',
  'verify-artifact': 'offline',
  'interchange-report': 'offline',
  'inspect-archive': 'offline',
  'sign-artifact': 'offline',
  'verify-signature': 'offline',
  'source-report': 'offline',
  compare: 'offline',
  'page-compare': 'offline',
  'mail-review': 'offline',
  'review-evidence': 'offline',
  brief: 'offline',
  'case-pack': 'offline',
  'domain-control': 'offline',
  'monitor-once': 'always_network',
  assurance: 'offline',
  'change-packet': 'offline',
  'sharing-review': 'offline',
  'workflow-plan': 'offline',
  'workflow-run': 'conditional_network',
  diff: 'offline',
  reconcile: 'offline',
  timeline: 'offline',
  export: 'offline',
});

const COMMON_COMMANDS = Object.freeze([
  'doctor', 'commands', 'lookup', 'bulk', 'discover', 'discover-scan', 'verify-artifact',
  'review-evidence', 'case-pack', 'workflow-plan', 'diff', 'export',
] as const satisfies readonly CliCommand[]);

const SCHEMA_IDENTIFIERS_BY_COMMAND: Readonly<Partial<Record<CliCommand, readonly string[]>>> = Object.freeze({
  commands: Object.freeze(['whoisleuth.cli.command-catalogue']),
  doctor: Object.freeze(['whoisleuth.cli.doctor']),
  manifest: Object.freeze(['whoisleuth.investigation-manifest']),
  'map-observations': Object.freeze(['whoisleuth.external-observation-mapping']),
  'oam-export': Object.freeze(['whoisleuth.open-asset-model-bridge']),
  lookup: Object.freeze(['whoisleuth.cli.lookup', 'whoisleuth.cli.lookup-plan']),
  bulk: Object.freeze(['whoisleuth.cli.bulk', 'whoisleuth.cli.bulk.item', 'whoisleuth.cli.bulk-checkpoint']),
  'ct-search': Object.freeze(['whoisleuth.cli.ct-search']),
  'ct-intake': Object.freeze(['whoisleuth.ct-event-batch', 'whoisleuth.external-findings']),
  discover: Object.freeze(['whoisleuth.cli.discover', 'whoisleuth.cli.discover.item', 'whoisleuth.cli.discovery-snapshot']),
  'discover-scan': Object.freeze(['whoisleuth.cli.discovery-scan', 'whoisleuth.cli.discovery-scan.item', 'whoisleuth.cli.discovery-observation-snapshot']),
  posture: Object.freeze(['whoisleuth.cli.posture']),
  http: Object.freeze(['whoisleuth.cli.http']),
  tls: Object.freeze(['whoisleuth.cli.tls']),
  'dnssec-validate': Object.freeze(['whoisleuth.dnssec-chain-validation', 'whoisleuth.dnssec-trust-anchor']),
  'mail-transport': Object.freeze(['whoisleuth.mail-transport.input', 'whoisleuth.cli.mail-transport-review']),
  'registry-support': Object.freeze(['whoisleuth.cli.registry-support', 'whoisleuth.registry-standards-coverage']),
  'registry-doctor': Object.freeze(['whoisleuth.cli.registry-doctor']),
  'registry-cohort': Object.freeze(['whoisleuth.cli.registry-cohort']),
  'risk-calibrate': Object.freeze([RISK_CALIBRATION_DATASET_SCHEMA, RISK_CALIBRATION_REPORT_SCHEMA]),
  'lookalike-calibrate': Object.freeze(['whoisleuth.lookalike-calibration-input', 'whoisleuth.lookalike-calibration']),
  'verify-artifact': Object.freeze(['whoisleuth.offline-artifact-verification']),
  'interchange-report': Object.freeze(['whoisleuth.interchange-fidelity-report']),
  'inspect-archive': Object.freeze(['whoisleuth.workspace-archive-inspection']),
  'sign-artifact': Object.freeze(['whoisleuth.signed-evidence-package']),
  'verify-signature': Object.freeze(['whoisleuth.evidence-signature-verification']),
  'source-report': Object.freeze(['whoisleuth.source-reliability-report']),
  compare: Object.freeze(['whoisleuth.cli.compare']),
  'page-compare': Object.freeze(['whoisleuth.cli.page-compare']),
  'mail-review': Object.freeze(['whoisleuth.cli.mail-review']),
  'review-evidence': Object.freeze([
    'whoisleuth.cli.offline-evidence-review',
    'whoisleuth.rdap-search-input',
    'whoisleuth.dnssec-evidence-input',
    'whoisleuth.tlsa-evidence-input',
    'whoisleuth.rpki-route-input',
    'whoisleuth.local-geoip-query',
    'whoisleuth.encrypted-dns-plan-input',
  ]),
  brief: Object.freeze(['whoisleuth.cli.lookup-brief']),
  'case-pack': Object.freeze(['whoisleuth.cli.case-pack', 'whoisleuth.case-report']),
  'domain-control': Object.freeze(['whoisleuth.cli.domain-control-review-input', 'whoisleuth.cli.domain-control-review']),
  'monitor-once': Object.freeze(['whoisleuth.cli.domain-control-monitor', 'whoisleuth.domain-control-flight-recorder.input']),
  assurance: Object.freeze(['whoisleuth.domain-assurance.input', 'whoisleuth.domain-assurance']),
  'change-packet': Object.freeze(['whoisleuth.domain-change-packet.input', 'whoisleuth.domain-change-packet']),
  'sharing-review': Object.freeze(['whoisleuth.cli.sharing-review']),
  'workflow-plan': Object.freeze(['whoisleuth.cli.investigation-plan', 'whoisleuth.cli.workflow-recipe-catalogue']),
  'workflow-run': Object.freeze(['whoisleuth.cli.investigation-run']),
  diff: Object.freeze(['whoisleuth.cli.lookup-diff']),
  reconcile: Object.freeze(['whoisleuth.cli.lookup-reconciliation']),
  timeline: Object.freeze(['whoisleuth.cli.lookup-timeline']),
  export: Object.freeze(['whoisleuth.lookup-evidence']),
});

const PRIMARY_ARTEFACTS_BY_COMMAND: Readonly<Partial<Record<CliCommand, readonly string[]>>> = Object.freeze({
  lookup: Object.freeze(['Source-qualified Lookup', 'Lookup request plan']),
  bulk: Object.freeze(['Bulk result', 'Bulk checkpoint']),
  discover: Object.freeze(['Candidate set', 'Discovery snapshot']),
  'discover-scan': Object.freeze(['Reviewed candidate queue', 'Observation snapshot']),
  'verify-artifact': Object.freeze(['Offline verification report']),
  'case-pack': Object.freeze(['Reviewed Case-pack v2']),
  'workflow-plan': Object.freeze(['Plan-only workflow document']),
  'workflow-run': Object.freeze(['Resumable workflow state']),
  diff: Object.freeze(['Retained-evidence comparison']),
  timeline: Object.freeze(['Bounded retained-observation timeline']),
  export: Object.freeze(['Portable evidence report']),
});

function documentationMetadata(
  command: CliCommand,
  commandOptions: readonly string[],
  positionals: readonly CliPositionalSpec[],
): CliCommandDefinition['documentation'] {
  const effect = NETWORK_EFFECT_BY_COMMAND[command];
  const explicitAuthorisationRequired = commandOptions.some((option) => (
    option === '--owned-or-authorized' || option === '--active-probe' || option === '--approve-network'
  ));
  const outputOptionFormats = [
    ['--json', 'JSON'], ['--jsonl', 'JSON Lines'], ['--junit', 'JUnit XML'],
    ['--csv', 'CSV'], ['--domains', 'domain list'], ['--queries', 'query list'],
    ['--markdown', 'Markdown'], ['--html', 'HTML'], ['--sarif', 'SARIF'],
    ['--summary-json', 'summary JSON'],
  ] as const;
  const outputFormats = new Set<string>(['terminal']);
  for (const [option, label] of outputOptionFormats) {
    if (commandOptions.includes(option)) outputFormats.add(label);
  }
  if (command === 'export') outputFormats.add('JSON');
  const positionalLimits = positionals.map((item) => (
    `${item.name}: ${item.minimum}-${item.maximum} ${item.valueKind} value${item.maximum === 1 ? '' : 's'}`
  ));
  return Object.freeze({
    common: COMMON_COMMANDS.includes(command as typeof COMMON_COMMANDS[number]),
    disclosureClass: effect === 'offline'
      ? 'none'
      : explicitAuthorisationRequired
        ? 'bounded_authorised_active'
        : effect === 'conditional_network'
          ? 'conditional_bounded_passive'
          : 'bounded_passive',
    explicitAuthorisationRequired,
    planSupport: commandOptions.includes('--plan') || command === 'workflow-plan',
    failurePolicySupport: commandOptions.includes('--fail-on') || commandOptions.includes('--strict-exit'),
    supportedSchemaIdentifiers: Object.freeze([...(SCHEMA_IDENTIFIERS_BY_COMMAND[command] ?? [])]),
    inputLimits: Object.freeze([COMMAND_COLLECTION_SEED[command].scope, ...positionalLimits]),
    outputLimits: Object.freeze([
      'Output is bounded by the command-owned formatter and document contract.',
      ...(commonOptionsSeedForCommand(command).includes('--output')
        ? ['Selected file output is atomic and replacement requires --force.']
        : []),
    ]),
    outputFormats: Object.freeze([...outputFormats]),
    primaryEvidenceArtefacts: Object.freeze([...(PRIMARY_ARTEFACTS_BY_COMMAND[command] ?? [])]),
  });
}

const CLI_COMMAND_REGISTRY: readonly CliCommandDefinition[] = Object.freeze(
  COMMAND_ORDER.map((command, order) => {
    const commonOptions = Object.freeze([...commonOptionsSeedForCommand(command)]);
    const commandOptions = Object.freeze([...OPTIONS_BY_COMMAND_SEED[command]]);
    const grammarOptions = Object.freeze([
      ...commonOptions.map((option) => optionSpec(command, option, 'common')),
      ...commandOptions.map((option) => optionSpec(command, option, 'command')),
    ]);
    return Object.freeze({
      command,
      order,
      reference: Object.freeze({
        usage: COMMAND_USAGE_SEED[command],
        ...COMMAND_DETAILS_SEED[command],
      }),
      collection: Object.freeze({ ...COMMAND_COLLECTION_SEED[command] }),
      completion: Object.freeze({
        description: COMMAND_DESCRIPTIONS_SEED[command],
        commonOptions,
        options: commandOptions,
      }),
      grammar: Object.freeze({
        parserKey: command,
        bootstrapProfile: command === 'registry-scaffold' ? 'command_owned' : 'allowed',
        options: grammarOptions,
        positionals: POSITIONALS_BY_COMMAND_SEED[command],
        constraints: grammarConstraints(command),
        metaActions: Object.freeze(['help'] as const),
      }),
      execution: Object.freeze({
        handlerOwner: HANDLER_OWNER_BY_COMMAND[command],
        networkEffect: NETWORK_EFFECT_BY_COMMAND[command],
      }),
      help: Object.freeze({
        group: HELP_GROUP_BY_COMMAND[command],
        summary: COMMAND_DESCRIPTIONS_SEED[command],
      }),
      documentation: documentationMetadata(command, commandOptions, POSITIONALS_BY_COMMAND_SEED[command]),
    });
  }),
);

const CLI_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMAND_REGISTRY.map((definition) => definition.command),
);
const FILE_POSITIONAL_COMMANDS: readonly CliCommand[] = Object.freeze(
  CLI_COMMAND_REGISTRY
    .filter((definition) => definition.grammar.positionals.some((item) => item.valueKind === 'file'))
    .map((definition) => definition.command),
);
const CLI_COMMAND_BY_NAME = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition]),
)) as Readonly<Record<CliCommand, CliCommandDefinition>>;

function isCliCommand(value: unknown): value is CliCommand {
  return typeof value === 'string' && Object.hasOwn(CLI_COMMAND_BY_NAME, value);
}

function commandDefinition(command: CliCommand): CliCommandDefinition {
  return CLI_COMMAND_BY_NAME[command];
}

function metaActionDefinition(id: CliMetaActionId): CliMetaAction {
  return CLI_META_ACTION_BY_ID[id];
}

function cliMetaActionForInvocation(argv: readonly string[]): CliMetaAction | null {
  for (const action of CLI_META_ACTIONS) {
    const matches = action.scope === 'root_only'
      ? action.aliases.includes(argv[0] ?? '')
      : argv.some((argument) => action.aliases.includes(argument));
    if (matches) return action;
  }
  return null;
}

const COMMAND_USAGE = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.reference.usage]),
)) as Readonly<Record<CliCommand, string>>;
const COMMAND_DETAILS = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, Object.freeze({
    description: definition.reference.description,
    example: definition.reference.example,
    boundary: definition.reference.boundary,
  })]),
)) as Readonly<Record<CliCommand, CommandDetail>>;
const COMMAND_COLLECTION = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.collection]),
)) as Readonly<Record<CliCommand, CommandCollection>>;
const COMMAND_DESCRIPTIONS = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, definition.completion.description]),
)) as Readonly<Record<CliCommand, string>>;
const OPTIONS_BY_COMMAND = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.map((definition) => [definition.command, Object.freeze(
    definition.grammar.options
      .filter((option) => option.scope === 'command')
      .map((option) => option.option),
  )]),
)) as Readonly<Record<CliCommand, readonly string[]>>;

function commonOptionsForCommand(command: CliCommand): readonly string[] {
  return Object.freeze(commandDefinition(command).grammar.options
    .filter((option) => option.scope === 'common')
    .map((option) => option.option));
}

function commandOptionSpec(command: CliCommand, option: string): CliOptionSpec | null {
  return commandDefinition(command).grammar.options.find((candidate) => candidate.option === option) ?? null;
}

function commandPositionalSpecs(command: CliCommand): readonly CliPositionalSpec[] {
  return commandDefinition(command).grammar.positionals;
}

const HELP_GROUP_LABELS: Readonly<Record<CliHelpGroup, string>> = Object.freeze({
  investigate: 'Investigate',
  respond: 'Respond',
  assure: 'Assure',
  utilities: 'Utilities',
});

function renderRootHelpCommands(): string {
  return (Object.keys(HELP_COMMANDS_BY_GROUP) as CliHelpGroup[]).map((group) => {
    const lines = HELP_COMMANDS_BY_GROUP[group].map((command) => {
      const definition = commandDefinition(command);
      return `  ${command.padEnd(20, ' ')} ${definition.help.summary}.`;
    });
    return `${HELP_GROUP_LABELS[group]}:\n${lines.join('\n')}`;
  }).join('\n\n');
}

const HELP = `${HELP_INTRO}\n${renderRootHelpCommands()}\n${HELP_FOOTER}`;

function commandOwnsOption(command: CliCommand, option: string): boolean {
  return commandDefinition(command).grammar.options.some((candidate) => candidate.option === option);
}

function invocationHasFlag(command: CliCommand, args: readonly string[], flag: string): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === flag) return true;
    const specification = argument ? commandOptionSpec(command, argument) : null;
    if (specification?.arity === 1) index += 1;
  }
  return false;
}

function cliInvocationNetworkEffect(
  command: CliCommand,
  args: readonly string[],
): CliInvocationNetworkEffect {
  const effect = commandDefinition(command).execution.networkEffect;
  if (effect === 'offline') return 'offline';
  if (effect === 'always_network') return 'network';
  if (command === 'doctor') return invocationHasFlag(command, args, '--network') ? 'network' : 'offline';
  if (command === 'lookup' || command === 'bulk' || command === 'discover-scan') {
    return invocationHasFlag(command, args, '--plan') ? 'offline' : 'network';
  }
  if (command === 'workflow-run') {
    return invocationHasFlag(command, args, '--approve-network') ? 'network' : 'offline';
  }
  throw new Error(`Conditional network effect is not implemented for ${command}.`);
}

function commandHelp(command: CliCommand): string {
  const detail = COMMAND_DETAILS[command];
  const collection = COMMAND_COLLECTION[command];
  return `WHOISleuth ${command}\n${detail.description}\n\nUsage:\n  ${COMMAND_USAGE[command]}\n\nExample:\n  ${detail.example}\n\nCollection:\n  ${collection.mode === 'offline' ? 'Offline' : 'Network'}: ${collection.scope}\n\nBoundary:\n  ${detail.boundary}\n\nRun "whoisleuth --help" to see the grouped command list.\n`;
}

export {
  CLI_COMMAND_REGISTRY,
  CLI_COMMANDS,
  CLI_META_ACTIONS,
  COMMAND_COLLECTION,
  COMMAND_DESCRIPTIONS,
  COMMAND_DETAILS,
  COMMAND_USAGE,
  COMMON_OPTIONS,
  FILE_OPTIONS,
  FILE_OPTIONS_BY_COMMAND,
  FILE_POSITIONAL_COMMANDS,
  HELP,
  HELP_COMMANDS_BY_GROUP,
  INVESTIGATION_PLAN_RECIPES,
  RUNNABLE_INVESTIGATION_PLAN_RECIPES,
  LIMITED_CONCURRENCY_VALUES,
  OPTIONS_BY_COMMAND,
  STANDARD_CONCURRENCY_VALUES,
  TEXT_OPTIONS,
  VALUE_OPTIONS,
  cliMetaActionForInvocation,
  cliInvocationNetworkEffect,
  commandOptionSpec,
  commandOwnsOption,
  commandPositionalSpecs,
  commonOptionsForCommand,
  commandDefinition,
  commandHelp,
  isCliCommand,
  metaActionDefinition,
};
export type {
  CliCommand,
  CliCommandDefinition,
  CliDisclosureClass,
  CliHandlerOwner,
  CliHelpGroup,
  CliInvocationNetworkEffect,
  CliMetaAction,
  CliMetaActionId,
  CliNetworkEffect,
  CliGrammarConstraint,
  CliOptionIntegerRange,
  CliOptionOccurrence,
  CliOptionScope,
  CliOptionSpec,
  CliOptionValueKind,
  CliPositionalSpec,
  CliPositionalInputSource,
  CliPositionalValueKind,
  CommandCollection,
  CommandDetail,
  CompletionShell,
};
