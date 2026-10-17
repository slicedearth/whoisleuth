import type { UnknownRecord } from './saved-lookup.mts';
import { lookupStrictExitFindings } from './strict-exit.mts';
import { CliUsageError } from './errors.mts';
import { RISK_REVIEW_THRESHOLD } from '../packages/analysis/risk-scoring.mts';
import type { BrandProfileSignalProfile } from '../packages/analysis/brand-profile-signals.mts';
import { explainCliLookupRisk } from './risk-policy.mts';
import type { CliProgressEvents } from './progress-events.mts';

export const CLI_FAIL_POLICIES = ['source-failure', 'inconclusive', 'danger', 'material-drift'] as const;
export type CliFailPolicy = typeof CLI_FAIL_POLICIES[number];
export const CLI_FAIL_POLICIES_BY_COMMAND = Object.freeze({
  lookup: Object.freeze(['source-failure', 'inconclusive', 'danger']),
  bulk: Object.freeze(['source-failure', 'inconclusive', 'danger']),
  'discover-scan': Object.freeze(['source-failure', 'inconclusive', 'danger']),
  'monitor-once': Object.freeze(['source-failure', 'inconclusive', 'material-drift']),
} as const satisfies Readonly<Record<string, readonly CliFailPolicy[]>>);
export type CliFailPolicyCommand = keyof typeof CLI_FAIL_POLICIES_BY_COMMAND;

type FailPolicyFinding = Readonly<{ policy: CliFailPolicy; reason: string }>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function parseCliFailPolicies(value: unknown, command: CliFailPolicyCommand): CliFailPolicy[] {
  if (typeof value !== 'string' || !value || value.length > 100) throw new CliUsageError('--fail-on requires a comma-separated policy list.');
  const policies = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const supported = CLI_FAIL_POLICIES_BY_COMMAND[command];
  if (!policies.length || policies.some((item) => !(supported as readonly string[]).includes(item))) {
    throw new CliUsageError(`--fail-on for ${command} supports: ${supported.join(', ')}.`);
  }
  return policies as CliFailPolicy[];
}

function availabilityStates(document: UnknownRecord): string[] {
  const direct = String(record(document.availability).state || '').toLowerCase();
  const review = String(record(document.review).state || '').toLowerCase();
  const results = Array.isArray(document.results) ? document.results : [];
  const resultStates = results.flatMap((value) => {
    const item = record(value);
    const state = item.availabilityState ?? record(item.availability).state;
    return typeof state === 'string' ? [state.toLowerCase()] : [];
  });
  return [direct, review, ...resultStates].filter(Boolean);
}

export function evaluateCliFailPolicies(
  document: unknown,
  policies: readonly CliFailPolicy[],
  profile: BrandProfileSignalProfile | null = null,
): FailPolicyFinding[] {
  const root = record(document);
  const findings: FailPolicyFinding[] = [];
  for (const policy of policies) {
    if (policy === 'source-failure') {
      const resultDocuments = Array.isArray(root.results) ? root.results.map(record).filter((item) => Object.keys(record(item.diagnostics)).length) : [];
      const sourceFindings = Object.keys(record(root.diagnostics)).length
        ? lookupStrictExitFindings(root)
        : resultDocuments.flatMap((item) => lookupStrictExitFindings(item));
      const collection = record(root.collection);
      const summary = record(root.summary);
      const failed = Number(collection.failed ?? summary.failed ?? 0);
      if (sourceFindings.length || failed > 0) findings.push({ policy, reason: `${sourceFindings.length + failed} failed or incomplete collection state(s)` });
    } else if (policy === 'inconclusive') {
      const count = availabilityStates(root).filter((state) => ['unknown', 'inconclusive', 'partial', 'unavailable'].includes(state)).length;
      if (count) findings.push({ policy, reason: `${count} authority or availability state(s) remained inconclusive` });
    } else if (policy === 'danger') {
      const documents = [root, ...(Array.isArray(root.results) ? root.results.map(record) : [])];
      const risks = documents.flatMap(item => {
        const risk = explainCliLookupRisk(item, profile, item.mode ?? root.mode);
        return risk ? [risk] : [];
      });
      const highestRisk = risks.reduce<(typeof risks)[number] | null>((highest, risk) => (
        !highest || risk.score > highest.score ? risk : highest
      ), null);
      if (highestRisk && highestRisk.score >= RISK_REVIEW_THRESHOLD) {
        findings.push({
          policy,
          reason: `risk score ${highestRisk.score} met the ${RISK_REVIEW_THRESHOLD} review threshold; model v${highestRisk.modelVersion}; evidence ${highestRisk.evidenceQuality.state} (heuristic, not a verdict)`,
        });
      }
    } else {
      const summary = record(record(root.flightRecorder).summary);
      const unexpected = Number(summary.unexpectedChanges ?? 0);
      if (unexpected > 0) findings.push({ policy, reason: `${unexpected} unexpected complete observation change(s)` });
    }
  }
  return findings;
}

export function formatFailPolicyNotice(findings: readonly FailPolicyFinding[]): string {
  return `Failure policy matched: ${findings.map((item) => `${item.policy} (${item.reason})`).join('; ')}.\n`;
}

export function reportCliFailPolicies(
  findings: readonly FailPolicyFinding[],
  writeStderr: (value: string) => void,
  progress: CliProgressEvents,
): void {
  if (!findings.length) return;
  if (!progress.enabled) writeStderr(formatFailPolicyNotice(findings));
  else for (const finding of findings) {
    progress.emit({ event: 'warning', state: 'failure_policy_matched', source: finding.policy, reason: finding.reason });
  }
}
