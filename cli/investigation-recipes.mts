import { CLI_DOMAIN_CONTROL_MONITOR_SCHEMA } from '../packages/contracts/domain-control-monitor.mts';
import { DOMAIN_CONTROL_REVIEW_SCHEMA } from '../packages/contracts/domain-control-review.mts';
import { EXTERNAL_FINDINGS_SCHEMA } from '../packages/interchange/external-findings-import.mts';
import { CLI_LOOKUP_BRIEF_SCHEMA } from './lookup-brief.mts';
import type { WorkflowArtifactBinding } from '../packages/contracts/investigation-run.mts';
import type { CliCommand } from '../packages/contracts/cli-command-semantics.mts';

export type RecipeStep = Readonly<{
  id: string;
  label: string;
  command: CliCommand;
  arguments: readonly string[];
  mode: 'offline' | 'network';
  approval: 'none' | 'network_disclosure' | 'analyst_selection';
  produces: string;
  completion: string;
}>;

export type RecipeDefinition = Readonly<{
  label: string;
  subjectRequirement: 'domain' | 'brand_or_domain' | 'review_label';
  objective: string;
  limitations: readonly string[];
  standardInputs?: readonly WorkflowArtifactBinding[];
  steps(subject: string): readonly RecipeStep[];
}>;

export const INVESTIGATION_RECIPE_DEFINITIONS = Object.freeze({
  'domain-triage': Object.freeze({
    label: 'New domain triage',
    standardInputs: Object.freeze([
      { stepId: 'export', input: 1, sourceStepId: 'collect' },
      { stepId: 'verify', input: 1, sourceStepId: 'export' },
    ]),
    subjectRequirement: 'domain',
    objective:
      'Collect and preserve separately attributed registration, DNS, HTTP, TLS, page, and network-context evidence.',
    limitations: Object.freeze([
      'Collection remains analyst-triggered and source limitations remain explicit.',
      'Disposition, reviewed response actions, monitoring, and closure continue in the saved Case workspace; this CLI recipe does not submit reports.',
    ]),
    steps: (domain: string) =>
      Object.freeze([
        step(
          'collect',
          'Collect a Deep lookup',
          'lookup',
          [domain, '--deep', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.lookup',
          'Review source health and limitations before using missing fields.',
        ),
        step(
          'export',
          'Create a portable evidence report',
          'export',
          ['<saved-lookup.json>'],
          'offline',
          'analyst_selection',
          'whoisleuth.lookup-evidence',
          'Reuse the collected Lookup by default, or select a different reviewed Lookup file.',
        ),
        step(
          'verify',
          'Verify the exported artefact',
          'verify-artifact',
          ['<evidence.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.offline-artifact-verification',
          'Keep verification distinct from a claim that the observations are correct or current.',
        ),
      ]),
  }),
  'lookalike-review': Object.freeze({
    label: 'Lookalike candidate review',
    subjectRequirement: 'brand_or_domain',
    objective:
      'Generate a bounded candidate queue, collect only the selected scope, and retain a reviewed candidate lookup.',
    limitations: Object.freeze([
      'Candidate generation does not establish registration, control, intent, or maliciousness.',
      'Official-reference collection and page comparison require analyst-selected saved evidence; use page-compare after retaining the reference and candidate observations.',
    ]),
    steps: (subject: string) =>
      Object.freeze([
        step(
          'generate',
          'Generate candidates offline',
          'discover',
          [subject, '--preset', 'all', '--json'],
          'offline',
          'none',
          'whoisleuth.cli.discover',
          'Review mutation families and suppressions before collection.',
        ),
        step(
          'scan',
          'Collect a bounded candidate queue',
          'discover-scan',
          [subject, '--fast', '--scan-limit', '50', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.discovery-scan',
          'Fast collection is a triage boundary; partial or inconclusive authority evidence remains explicit.',
        ),
        step(
          'inspect',
          'Deep-review one selected candidate',
          'lookup',
          ['<selected-domain>', '--deep', '--json'],
          'network',
          'analyst_selection',
          'whoisleuth.cli.lookup',
          'Select a candidate deliberately; generation does not prove registration, control, intent, or maliciousness.',
        ),
      ]),
  }),
  'owned-domain-review': Object.freeze({
    label: 'Owned domain posture review',
    subjectRequirement: 'domain',
    objective:
      'Review current passive posture and compare supplied observations with an analyst-authored control manifest.',
    limitations: Object.freeze([
      'Use only for a domain the analyst owns or is authorised to review.',
    ]),
    steps: (domain: string) =>
      Object.freeze([
        step(
          'posture',
          'Collect bounded DNS posture',
          'posture',
          [domain, '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.posture',
          'Review mail profile and delegation evidence before interpreting missing records.',
        ),
        step(
          'lookup',
          'Collect supporting Deep evidence',
          'lookup',
          [domain, '--deep', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.lookup',
          'Retain separately attributed registration, DNS, TLS, and page observations.',
        ),
        step(
          'manifest',
          'Review the domain control manifest',
          'domain-control',
          ['<review-input.json>', '--json'],
          'offline',
          'analyst_selection',
          DOMAIN_CONTROL_REVIEW_SCHEMA,
          'Only complete supplied observations may produce drift.',
        ),
      ]),
  }),
  'historical-comparison': Object.freeze({
    label: 'Historical observation comparison',
    standardInputs: Object.freeze([
      { stepId: 'diff', input: 2, sourceStepId: 'current' },
      { stepId: 'timeline', input: 3, sourceStepId: 'current' },
    ]),
    subjectRequirement: 'domain',
    objective:
      'Collect a current observation and compare it with analyst-selected saved observations without merging source states.',
    limitations: Object.freeze([
      'A later observation does not retroactively refresh retained evidence.',
    ]),
    steps: (domain: string) =>
      Object.freeze([
        step(
          'current',
          'Collect the current lookup',
          'lookup',
          [domain, '--deep', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.lookup',
          'A current request does not refresh or validate older provider-reported history.',
        ),
        step(
          'diff',
          'Compare two selected observations',
          'diff',
          ['<previous.json>', '<current.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.lookup-diff',
          'Equal, different, conflicting, and unavailable evidence remain separate.',
        ),
        step(
          'timeline',
          'Build a bounded local timeline',
          'timeline',
          ['<oldest.json>', '<newer.json>', '<current.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.lookup-timeline',
          'Choose two to twenty same-domain files in chronological scope.',
        ),
      ]),
  }),
  'campaign-review': Object.freeze({
    label: 'Campaign candidate review',
    subjectRequirement: 'brand_or_domain',
    objective:
      'Prepare a bounded candidate set, collect a deliberately selected queue, and review retained evidence without asserting campaign attribution.',
    limitations: Object.freeze([
      'Grouping candidates is analyst triage and does not prove common ownership, control, infrastructure, or intent.',
    ]),
    steps: (subject: string) =>
      Object.freeze([
        step(
          'prepare',
          'Prepare candidates offline',
          'discover',
          [subject, '--preset', 'all', '--json'],
          'offline',
          'none',
          'whoisleuth.cli.discover',
          'Review mutation families and bounded omissions before selecting a collection scope.',
        ),
        step(
          'collect',
          'Collect the selected candidate queue',
          'discover-scan',
          [subject, '--fast', '--scan-limit', '50', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.discovery-scan',
          'Treat partial and inconclusive authority results as explicit outcomes.',
        ),
        step(
          'review',
          'Prepare a selected candidate brief',
          'brief',
          ['<saved-lookup.json>', '--json'],
          'offline',
          'analyst_selection',
          CLI_LOOKUP_BRIEF_SCHEMA,
          'Select a saved candidate Lookup; keep any campaign grouping analyst-authored.',
        ),
      ]),
  }),
  'certificate-anomaly': Object.freeze({
    label: 'Certificate anomaly review',
    subjectRequirement: 'domain',
    objective:
      'Review bounded certificate observations alongside current source-qualified domain evidence without treating issuance as proof of control or intent.',
    limitations: Object.freeze([
      'Certificate observations are separately attributed and do not establish current service control.',
    ]),
    steps: (domain: string) =>
      Object.freeze([
        step(
          'search',
          'Collect bounded certificate observations',
          'ct-search',
          [domain, '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.ct-search',
          'Review source availability, truncation, and observation timing.',
        ),
        step(
          'intake',
          'Normalise the selected observations',
          'ct-intake',
          ['<certificate-events.json>', '--json'],
          'offline',
          'analyst_selection',
          EXTERNAL_FINDINGS_SCHEMA,
          'Select a certificate-event batch; a certificate-search report is not interchangeable with that input.',
        ),
        step(
          'corroborate',
          'Collect supporting domain evidence',
          'lookup',
          [domain, '--deep', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.lookup',
          'Compare evidence families without collapsing certificate and registration identities.',
        ),
      ]),
  }),
  'registry-disagreement': Object.freeze({
    label: 'Registry disagreement review',
    standardInputs: Object.freeze([
      { stepId: 'compare', input: 1, sourceStepId: 'collect' },
      { stepId: 'report', input: 1, sourceStepId: 'collect' },
    ]),
    subjectRequirement: 'domain',
    objective:
      'Collect separately attributed registration evidence and review conflicting publications without selecting an arbitrary source as truth.',
    limitations: Object.freeze([
      'Only authority-aware registration evidence may decide availability; disagreement remains explicit.',
    ]),
    steps: (domain: string) =>
      Object.freeze([
        step(
          'collect',
          'Collect source-qualified registration evidence',
          'lookup',
          [domain, '--deep', '--json'],
          'network',
          'network_disclosure',
          'whoisleuth.cli.lookup',
          'Retain RDAP, registrar RDAP, WHOIS, and authority states separately.',
        ),
        step(
          'compare',
          'Compare registry publications offline',
          'compare',
          ['<saved-lookup.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.compare',
          'Do not convert conflicting or unavailable publications into equivalence.',
        ),
        step(
          'report',
          'Prepare a target-free source report',
          'source-report',
          ['<saved-lookup.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.source-reliability-report',
          'The report describes source behaviour, not ownership, safety, or legal status.',
        ),
      ]),
  }),
  'evidence-handoff': Object.freeze({
    label: 'Reviewed evidence handoff',
    standardInputs: Object.freeze([{ stepId: 'lint', input: 1, sourceStepId: 'package' }]),
    subjectRequirement: 'review_label',
    objective:
      'Verify, minimise, and package analyst-selected evidence for a deliberate handoff without transmitting or submitting it.',
    limitations: Object.freeze([
      'The recipe prepares local material only; sharing remains a separate deliberate action.',
    ]),
    steps: () =>
      Object.freeze([
        step(
          'verify',
          'Verify the selected artefact',
          'verify-artifact',
          ['<evidence.json>', '--json', '--strict-exit'],
          'offline',
          'analyst_selection',
          'whoisleuth.offline-artifact-verification',
          'Verification checks structure and integrity, not the truth or currency of observations.',
        ),
        step(
          'package',
          'Build a reviewed public Case-pack',
          'case-pack',
          ['<cases.json>', '--audience', 'public', '--reviewed', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.case-pack',
          'Review minimisation and audience projection before retaining the separate package.',
        ),
        step(
          'lint',
          'Review deliberate-sharing metadata',
          'sharing-review',
          [
            '<package.json>',
            '--marking',
            'clear',
            '--recipient-scope',
            'public',
            '--purpose',
            'reviewed evidence handoff',
            '--human-reviewed',
            '--personal-data-reviewed',
            '--redactions-confirmed',
            '--json',
          ],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.sharing-review',
          'A clear lint result does not send, upload, publish, or authorise the artefact.',
        ),
      ]),
  }),
  'planned-domain-change': Object.freeze({
    label: 'Planned domain change',
    subjectRequirement: 'domain',
    objective:
      'Review an analyst-authored desired state and prepare bounded change material without changing DNS, registry, mail, or hosted configuration.',
    limitations: Object.freeze([
      'Planning and packaging never apply, submit, schedule, or enforce a change.',
    ]),
    steps: () =>
      Object.freeze([
        step(
          'control',
          'Review the desired-state manifest',
          'domain-control',
          ['<review-input.json>', '--json'],
          'offline',
          'analyst_selection',
          DOMAIN_CONTROL_REVIEW_SCHEMA,
          'Only supplied complete observations may produce drift.',
        ),
        step(
          'assure',
          'Review change and recovery assumptions',
          'assurance',
          ['<assurance-input.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.domain-assurance',
          'Record uncertainty, rollback dependencies, and unavailable evidence explicitly.',
        ),
        step(
          'package',
          'Build a reviewed change packet',
          'change-packet',
          ['<change-packet-input.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.domain-change-packet',
          'The packet is local reviewed material and performs no submission or enforcement.',
        ),
      ]),
  }),
  'post-change-verification': Object.freeze({
    label: 'Post-change verification',
    subjectRequirement: 'domain',
    objective:
      'Perform one explicit later observation and compare it with analyst-selected retained evidence after an authorised change.',
    limitations: Object.freeze([
      'This is a one-time recheck, not monitoring setup or proof that every resolver or service has converged.',
    ]),
    steps: () =>
      Object.freeze([
        step(
          'recheck',
          'Run one bounded retained-manifest review',
          'monitor-once',
          ['<manifest.json>', '--limit', '1', '--json'],
          'network',
          'network_disclosure',
          CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
          'One later observation may remain partial, unavailable, stale, or conflicting.',
        ),
        step(
          'compare',
          'Compare selected before and after evidence',
          'diff',
          ['<before.json>', '<after.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.cli.lookup-diff',
          'Materiality is derived from compatible retained evidence and does not infer intent.',
        ),
        step(
          'record',
          'Record reviewed completion material',
          'change-packet',
          ['<post-change-input.json>', '--json'],
          'offline',
          'analyst_selection',
          'whoisleuth.domain-change-packet',
          'Recording reviewed material does not submit it or start automatic monitoring.',
        ),
      ]),
  }),
} satisfies Readonly<Record<string, RecipeDefinition>>);

export type InvestigationPlanRecipe = keyof typeof INVESTIGATION_RECIPE_DEFINITIONS;
export type RunnableInvestigationPlanRecipe = InvestigationPlanRecipe;
export const INVESTIGATION_PLAN_RECIPES = Object.freeze(
  Object.keys(INVESTIGATION_RECIPE_DEFINITIONS),
) as readonly InvestigationPlanRecipe[];
export const RUNNABLE_INVESTIGATION_PLAN_RECIPES = INVESTIGATION_PLAN_RECIPES;

function step(
  id: string,
  label: string,
  command: CliCommand,
  args: readonly string[],
  mode: RecipeStep['mode'],
  approval: RecipeStep['approval'],
  produces: string,
  completion: string,
): RecipeStep {
  return Object.freeze({
    id,
    label,
    command,
    arguments: Object.freeze([...args]),
    mode,
    approval,
    produces,
    completion,
  });
}
