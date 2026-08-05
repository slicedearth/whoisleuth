import type { UnknownRecord } from './saved-lookup.mts';

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function xml(value: unknown): string {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

type JunitCase = Readonly<{ name: string; failure?: string }>;

function junitCases(document: UnknownRecord): JunitCase[] {
  const schema = String(document.schema || '');
  if (schema === 'whoisleuth.cli.lookup') {
    const diagnostics = record(document.diagnostics);
    const cases = Object.entries(diagnostics).slice(0, 64).map(([source, value]) => {
      const state = String(record(value).status ?? record(value).state ?? 'unavailable').toLowerCase();
      return ['error', 'failed', 'partial', 'rate_limited', 'timeout', 'unavailable'].includes(state)
        ? { name: `source ${source}`, failure: `Source state: ${state}` }
        : { name: `source ${source}` };
    });
    return cases.length ? cases : [{ name: 'lookup diagnostics', failure: 'No source diagnostics were available.' }];
  }
  if (schema === 'whoisleuth.cli.bulk') {
    const summary = record(document.summary);
    const failed = Number(summary.failed ?? 0);
    const results = Array.isArray(document.results) ? document.results.map(record) : [];
    const inconclusive = results.filter((item) => ['unknown', 'inconclusive', 'partial', 'unavailable'].includes(String(record(item.availability).state || '').toLowerCase())).length;
    return [
      failed ? { name: 'collection failures', failure: `${failed} target collection(s) failed.` } : { name: 'collection failures' },
      inconclusive ? { name: 'authority conclusions', failure: `${inconclusive} target state(s) remained inconclusive.` } : { name: 'authority conclusions' },
    ];
  }
  if (schema === 'whoisleuth.cli.domain-control-monitor') {
    const collection = record(document.collection);
    const summary = record(record(document.flightRecorder).summary);
    const failed = Number(collection.failed ?? 0);
    const drift = Number(summary.unexpectedChanges ?? 0);
    return [
      failed ? { name: 'domain control collection', failure: `${failed} owned-domain collection(s) failed.` } : { name: 'domain control collection' },
      drift ? { name: 'unexpected domain control changes', failure: `${drift} complete observation change(s) require review.` } : { name: 'unexpected domain control changes' },
    ];
  }
  return [{ name: 'WHOISleuth result', failure: 'Unsupported document for JUnit conversion.' }];
}

export function formatCliJunit(document: unknown): string {
  const cases = junitCases(record(document));
  const failures = cases.filter((item) => item.failure).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="WHOISleuth" tests="${cases.length}" failures="${failures}">\n${cases.map((item) => `  <testcase classname="whoisleuth" name="${xml(item.name)}">${item.failure ? `<failure message="${xml(item.failure)}" />` : ''}</testcase>`).join('\n')}\n</testsuite>\n`;
}

export function buildPostureSarif(document: unknown) {
  const root = record(document);
  const checks = Array.isArray(root.checks) ? root.checks.map(record).slice(0, 64) : [];
  const actionable = checks.filter((item) => ['warning', 'danger'].includes(String(item.status).toLowerCase()));
  const rules = actionable.map((item) => ({
    id: `WHOISLEUTH-${String(item.id || 'posture').replace(/[^a-z0-9_-]/giu, '-').slice(0, 64)}`,
    shortDescription: { text: String(item.label || 'Domain posture finding').slice(0, 200) },
    help: { text: String(item.remediation || item.detail || 'Review this owned-domain posture finding.').slice(0, 1000) },
  }));
  return Object.freeze({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [Object.freeze({
      tool: { driver: { name: 'WHOISleuth', informationUri: 'https://www.whoisleuth.com/request-policy', rules } },
      results: actionable.map((item) => ({
        ruleId: `WHOISLEUTH-${String(item.id || 'posture').replace(/[^a-z0-9_-]/giu, '-').slice(0, 64)}`,
        level: String(item.status).toLowerCase() === 'danger' ? 'error' : 'warning',
        message: { text: `${String(item.summary || item.label || 'Posture finding').slice(0, 500)}${item.remediation ? ` Next: ${String(item.remediation).slice(0, 500)}` : ''}` },
      })),
      properties: {
        ownedDomainConfirmed: true,
        generatedAt: typeof root.generatedAt === 'string' ? root.generatedAt : null,
        evidenceBoundary: 'Passive owned-domain DNS posture; raw records and contact data omitted from SARIF.',
      },
    })],
  });
}
