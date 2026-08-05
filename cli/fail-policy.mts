import type { UnknownRecord } from './saved-lookup.mts';
import { lookupStrictExitFindings } from './strict-exit.mts';
import { CliUsageError } from './errors.mts';

export const CLI_FAIL_POLICIES = ['source-failure', 'inconclusive', 'danger', 'material-drift'] as const;
export type CliFailPolicy = typeof CLI_FAIL_POLICIES[number];

type FailPolicyFinding = Readonly<{ policy: CliFailPolicy; reason: string }>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function parseCliFailPolicies(value: unknown): CliFailPolicy[] {
  if (typeof value !== 'string' || !value || value.length > 100) throw new CliUsageError('--fail-on requires a comma-separated policy list.');
  const policies = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (!policies.length || policies.some((item) => !(CLI_FAIL_POLICIES as readonly string[]).includes(item))) {
    throw new CliUsageError(`--fail-on supports: ${CLI_FAIL_POLICIES.join(', ')}.`);
  }
  return policies as CliFailPolicy[];
}

function availabilityStates(document: UnknownRecord): string[] {
  const direct = String(record(document.availability).state || '').toLowerCase();
  const results = Array.isArray(document.results) ? document.results : [];
  const resultStates = results.flatMap((value) => {
    const item = record(value);
    const state = item.availabilityState ?? record(item.availability).state;
    return typeof state === 'string' ? [state.toLowerCase()] : [];
  });
  return [direct, ...resultStates].filter(Boolean);
}

export function evaluateCliFailPolicies(document: unknown, policies: readonly CliFailPolicy[]): FailPolicyFinding[] {
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
      const risk = Number(record(root.risk).score ?? root.riskScore);
      const severity = String(root.severity || record(root.review).severity || '').toLowerCase();
      if ((Number.isFinite(risk) && risk >= 70) || severity === 'danger' || severity === 'critical') {
        findings.push({ policy, reason: Number.isFinite(risk) ? `risk score ${risk} met the 70 review threshold` : `explicit ${severity} severity was present` });
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
