export const INVESTIGATION_HANDOFF_READINESS_VERSION = 1;

export type InvestigationHandoffCheckState = 'pass' | 'caution' | 'block';

export type InvestigationHandoffCheck = Readonly<{
  id: 'analyst_decision' | 'case_retained' | 'disposition' | 'evidence_support' | 'open_questions';
  label: string;
  state: InvestigationHandoffCheckState;
  detail: string;
}>;

export type InvestigationHandoffReadiness = Readonly<{
  version: 1;
  status: 'not_retained' | 'needs_decision' | 'review_cautions' | 'ready';
  label: string;
  counts: Readonly<{
    observations: number;
    relationships: number;
    evidencePins: number;
    decisions: number;
    openHypotheses: number;
    openUnknowns: number;
    openContradictions: number;
    openNextSteps: number;
    activeActions: number;
  }>;
  checks: readonly InvestigationHandoffCheck[];
  limitations: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function records(value: unknown, maximum: number): UnknownRecord[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function boundedCount(value: unknown, maximum = 100_000): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : 0;
}

function openAssertions(assertions: UnknownRecord[], kind: string): number {
  return assertions.filter((item) => item.kind === kind && item.state === 'open').length;
}

/**
 * Summarises whether retained local case work is ready for a deliberate
 * analyst handoff. It counts typed records only and never turns case state into
 * a finding about the investigated domain.
 */
export function buildInvestigationHandoffReadiness(input: Readonly<{
  caseRecord?: unknown;
  evidenceProjection?: unknown;
}>): InvestigationHandoffReadiness {
  const caseRecord = record(input.caseRecord);
  const evidence = record(input.evidenceProjection);
  const retained = typeof caseRecord.id === 'string' && typeof caseRecord.domain === 'string';
  const pins = records(caseRecord.evidencePins, 40);
  const decisions = records(caseRecord.decisions, 30);
  const assertions = records(caseRecord.assertions, 50);
  const actions = records(caseRecord.actions, 50);
  const disposition = typeof caseRecord.disposition === 'string' ? caseRecord.disposition : '';
  const openHypotheses = openAssertions(assertions, 'hypothesis');
  const openUnknowns = openAssertions(assertions, 'unknown');
  const openContradictions = openAssertions(assertions, 'contradiction');
  const openNextSteps = openAssertions(assertions, 'next_step');
  const activeActions = actions.filter((item) => !['resolved', 'closed'].includes(String(item.state))).length;
  const supportedDecisions = decisions.filter((item) => (
    Array.isArray(item.evidencePinIds) && item.evidencePinIds.some((id) => pins.some((pin) => pin.id === id))
  )).length;
  const observations = boundedCount(evidence.observations);
  const relationships = boundedCount(evidence.relationships);

  const checks: InvestigationHandoffCheck[] = [
    {
      id: 'case_retained',
      label: 'Case retained',
      state: retained ? 'pass' : 'block',
      detail: retained
        ? 'A browser-local case is available for the current investigation target.'
        : 'Open a case only if this investigation needs a durable local decision or follow-up record.',
    },
    {
      id: 'disposition',
      label: 'Disposition reviewed',
      state: retained && disposition && disposition !== 'unreviewed' ? 'pass' : retained ? 'caution' : 'block',
      detail: retained && disposition && disposition !== 'unreviewed'
        ? `The case disposition is ${disposition.replaceAll('_', ' ')}.`
        : 'The case still has an unreviewed disposition.',
    },
    {
      id: 'analyst_decision',
      label: 'Analyst decision recorded',
      state: decisions.length ? 'pass' : retained ? 'caution' : 'block',
      detail: decisions.length
        ? `${decisions.length} typed analyst decision${decisions.length === 1 ? '' : 's'} retained.`
        : 'No typed analyst decision is retained yet.',
    },
    {
      id: 'evidence_support',
      label: 'Decision support',
      state: decisions.length && supportedDecisions === decisions.length
        ? 'pass'
        : pins.length || observations || relationships
          ? 'caution'
          : retained ? 'caution' : 'block',
      detail: decisions.length && supportedDecisions === decisions.length
        ? 'Every retained decision references at least one current evidence pin.'
        : pins.length || observations || relationships
          ? 'Evidence is retained, but one or more decisions do not reference a current evidence pin.'
          : 'No typed evidence pin or projected observation is retained for this handoff.',
    },
    {
      id: 'open_questions',
      label: 'Open questions reviewed',
      state: openUnknowns || openContradictions ? 'caution' : 'pass',
      detail: openUnknowns || openContradictions
        ? `${openUnknowns} open unknown${openUnknowns === 1 ? '' : 's'} and ${openContradictions} open contradiction${openContradictions === 1 ? '' : 's'} remain explicit.`
        : 'No typed open unknown or contradiction is retained.',
    },
  ];

  const blocks = checks.filter((item) => item.state === 'block').length;
  const cautions = checks.filter((item) => item.state === 'caution').length;
  const status = !retained
    ? 'not_retained'
    : !decisions.length || !disposition || disposition === 'unreviewed'
      ? 'needs_decision'
      : cautions
        ? 'review_cautions'
        : 'ready';
  return {
    version: INVESTIGATION_HANDOFF_READINESS_VERSION,
    status,
    label: status === 'ready'
      ? 'Decision handoff is structured'
      : status === 'review_cautions'
        ? `${cautions} handoff caution${cautions === 1 ? '' : 's'} remain`
        : status === 'needs_decision'
          ? 'Case needs a reviewed disposition or decision'
          : 'No case retained for handoff',
    counts: {
      observations,
      relationships,
      evidencePins: pins.length,
      decisions: decisions.length,
      openHypotheses,
      openUnknowns,
      openContradictions,
      openNextSteps,
      activeActions,
    },
    checks,
    limitations: [
      'This readiness view describes browser-local workflow structure only; it is not a finding about the target.',
      'A passing check does not validate the accuracy, sufficiency, or legal basis of an analyst decision.',
      `${blocks} blocking workflow gap${blocks === 1 ? '' : 's'} and ${cautions} caution${cautions === 1 ? '' : 's'} were counted from bounded current records.`,
    ],
  };
}
