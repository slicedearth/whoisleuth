import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRdap } from '../lib/rdap.mts';
import { buildRegistryInsights } from '../lib/registry-insights.mts';
import { buildLookupEvidence } from '../lib/evidence-export.mts';
import { buildLookupEvidenceReport } from '../lib/evidence-report.mts';
import { requiredValue } from './value-assertions.mts';

test('readable evidence distinguishes excluded contacts from a publication with no routes', () => {
  for (const contacts of [[], ['abuse@registry.example']]) {
    const parsed = requiredValue(parseRdap('domain', {
      objectClassName: 'domain', ldhName: 'example.test',
      entities: contacts.length ? [{
        roles: ['abuse'],
        vcardArray: ['vcard', contacts.map((contact) => ['email', {}, 'text', contact])],
      }] : [],
    }));
    const insights = buildRegistryInsights({ rdapParsed: parsed, rdapStatus: 'success' });
    assert.equal(insights.abuseRouting.length, contacts.length);
    const document = buildLookupEvidence({
      query: 'example.test', type: 'domain', registrableDomain: 'example.test', inputHostname: 'example.test',
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'unsupported' } },
      rdap: { parsed, upstreamStatus: 200, fetchedAt: '2026-07-01T00:00:00.000Z' },
    }, { generatedAt: '2026-07-02T00:00:00.000Z' });
    const report = buildLookupEvidenceReport(document);
    const count = requiredValue(report.registryInterpretation.find((field) => field.label === 'Published escalation routes'));
    assert.match(count.value, /Excluded.*count unavailable/u);
    assert.notEqual(count.value, '0');
    assert.equal(Object.hasOwn(requiredValue(document.analysis.registryInsights), 'abuseRouting'), false);
    assert.doesNotMatch(JSON.stringify({ document, report }), /abuse@registry\.example/u);
  }
  const retained = buildLookupEvidenceReport({ analysis: { registryInsights: { version: 1, abuseRouting: [] } } });
  assert.equal(retained.registryInterpretation.find((field) => field.label === 'Published escalation routes')?.value, '0');
});
