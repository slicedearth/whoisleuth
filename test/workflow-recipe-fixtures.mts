import { readFileSync } from 'node:fs';
import { buildCliLookupDocument } from '../cli/formatters/json.mts';
import { buildCliEvidenceExport } from '../cli/export-evidence.mts';
import * as evidence from '../lib/evidence-export.mts';
import { classifyQuery } from '../lib/classify.mts';

export const WORKFLOW_NOW = '2026-08-22T00:00:00.000Z';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export function workflowLookupResult(domain = 'example.test') {
  return {
    rdap: { parsed: { domain, registrar: { name: 'Example Registrar' }, nameservers: [`ns1.${domain}`], statuses: ['clientTransferProhibited'] } },
    whois: { skipped: true, chain: [] },
    availability: { applicable: true, domain, observationHostname: domain, state: 'registered', confidence: 'high', deepScanComplete: true,
      dns: { status: 'success', records: { a: ['192.0.2.1'], ns: [`ns1.${domain}`], mx: [], caa: [] }, delegation: { status: 'success', records: { ds: [] } } },
      tls: { status: 'unsupported' }, http: { status: 'unavailable' }, pageIdentity: { status: 'unavailable' },
    },
    diagnostics: { rdap: { status: 'success', observedAt: WORKFLOW_NOW }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
  };
}

export function workflowRecipeInputs(): Readonly<Record<string, string>> {
  const lookup = (when: string) => buildCliLookupDocument('example.test', classifyQuery('example.test'), workflowLookupResult(), when, 'deep');
  const current = JSON.stringify(lookup(WORKFLOW_NOW));
  const cases = fixture('case-lifecycle/cli-case-pack-v2-case-v16-current.json');
  const assurance = { schema: 'whoisleuth.domain-assurance.input', version: 2, kind: 'planned-change', domain: 'example.test',
    change: { reference: 'CHANGE-EXAMPLE', startsAt: '2026-08-21T00:00:00Z', endsAt: '2026-08-23T00:00:00Z',
      milestones: [{ id: 'dns', label: 'Publish DNS', expectedBy: WORKFLOW_NOW, evidenceSource: 'Retained authority observation', state: 'observed', observedAt: WORKFLOW_NOW, evidenceReference: 'after:dns' }],
      rollbackCriteria: [{ id: 'resolution', condition: 'Resolution unavailable', owner: 'Change reviewer', state: 'not_met' }],
      postChangeChecks: [{ id: 'post-dns', label: 'DNS agrees', expectedState: 'Published address', evidenceSource: 'Retained authority observation', state: 'matched', evidenceReference: 'after:dns' }],
    },
  };
  const change = (address: string) => ({ schema: 'whoisleuth.domain-change.input', version: 1, domain: 'example.test',
    authoritySnapshots: ['Authority A', 'Authority B'].map(label => ({ label, source: 'Fixture authority', state: 'observed', observedAt: WORKFLOW_NOW,
      records: [{ owner: 'example.test', type: 'A', value: address, ttl: 300 }] })),
    resolverSnapshots: [], acmeDependencies: [], certificate: null, hsts: null,
  });
  const packet = { schema: 'whoisleuth.domain-change-packet.input', version: 1, domain: 'example.test', reference: 'CHANGE-EXAMPLE',
    preChange: change('192.0.2.1'), postChange: change('192.0.2.2'), assurance };
  return Object.fromEntries(Object.entries({
    'saved-lookup.json': JSON.parse(current),
    'evidence.json': buildCliEvidenceExport(current, evidence, WORKFLOW_NOW),
    'previous.json': lookup('2026-08-20T00:00:00.000Z'), 'current.json': JSON.parse(current),
    'oldest.json': lookup('2026-08-18T00:00:00.000Z'), 'newer.json': lookup('2026-08-20T00:00:00.000Z'),
    'before.json': lookup('2026-08-20T00:00:00.000Z'), 'after.json': JSON.parse(current),
    'review-input.json': fixture('domain-control-review-input-v2.json'),
    'manifest.json': fixture('domain-control-manifest-v2.json'),
    'cases.json': { version: cases.version, exportedAt: WORKFLOW_NOW, cases: cases.cases },
    'certificate-events.json': { schema: 'whoisleuth.ct-event-batch', version: 1,
      source: { name: 'Synthetic certificate observations', reference: null, collectedAt: WORKFLOW_NOW },
      events: [{ logId: 'fixture-log', observedAt: WORKFLOW_NOW, certificateSha256: 'a'.repeat(64), dnsNames: ['example.test'], issuer: 'Example issuer', notAfter: '2026-10-01T00:00:00Z', completeness: 'complete', limitations: [] }],
    },
    'assurance-input.json': assurance, 'change-packet-input.json': packet, 'post-change-input.json': packet,
  }).map(([name, value]) => [name, JSON.stringify(value)]));
}
