import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plannedLookupSources } from '../lib/lookup-progress.mts';
import { plannedLookupProgressSources } from '../lib/lookup-source-progress.mts';
import { classifyQuery } from '../lib/classify.mts';
import { buildCliLookupPlan } from '../cli/lookup-plan.mts';
import { buildLookupCollectionPreflight } from '../frontend/src/lib/analysis/collection-preflight.ts';
import { buildLookupRequestUrl, eligibleLookupOptionalSources, lookupTargetType } from '../frontend/src/lib/analysis/lookup-page-actions.ts';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import type { Capability } from '../frontend/src/lib/capabilities.ts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { prepareLookupCollectionTarget } from '../packages/evidence/lookup-target.mts';

const features: Capability[] = CAPABILITY_MANIFEST.capabilities.flatMap(item => item.legacyCapability ? [{
  id: item.id, status: 'supported' as const, execution: item.legacyCapability.execution,
  scanModes: [...item.legacyCapability.scanModes], reason: null,
}] : []);
const selected = { includeExternalIntelligence: true, externalIntelligenceSupported: true,
  includeMalwareHostIntelligence: true, malwareHostIntelligenceSupported: true,
  includeMalwareIocIntelligence: true, malwareIocIntelligenceSupported: true,
  includeSecurityTxt: true, websiteObservationSupported: true, securityTxtEligible: true };

test('offline recipes and published CLI plans retain target-specific source identities and shapes', () => {
  const cases = [
    ['portal.example.test', ['rdap', 'domain_evidence'], ['rdap', 'whois', 'domain_evidence', 'registrar_rdap', 'network_context']],
    ['192.0.2.8', ['rdap'], ['rdap', 'whois', 'reverse_dns']],
    ['2001:db8::8', ['rdap'], ['rdap', 'whois', 'reverse_dns']],
    ['AS64496', ['rdap'], ['rdap', 'whois']],
  ] as const;
  for (const [target, fast, deep] of cases) {
    const classified = classifyQuery(target);
    for (const [mode, expected] of [['fast', fast], ['deep', deep]] as const) {
      assert.deepEqual(plannedLookupSources(classified.type, mode), expected);
      const plan = buildCliLookupPlan(target, classified, mode === 'deep');
      assert.deepEqual(plan.planning.sources.map(row => row.source), expected);
      assert.equal(plan.planning.networkRequestsMade, false);
      assert.deepEqual(Object.keys(plan).sort(), ['limitations', 'mode', 'planning', 'schema', 'target', 'version']);
      assert.ok(plan.planning.sources.every(row => Object.keys(row).sort().join(',') === 'conditional,disclosure,purpose,source'));
    }
    assert.deepEqual(plannedLookupProgressSources(classified), deep);
  }
});

test('browser eligibility uses the same admitted target scope without deciding address safety', () => {
  for (const [target, expected] of [['https://portal.example.test/private?q=example#local', 'domain'],
    ['192.0.2.8', 'ipv4'], ['https://[2001:db8::8]/', 'ipv6'], ['AS64496', 'asn'], ['64496', 'asn']] as const) {
    assert.equal(lookupTargetType([target]), expected);
    assert.equal(lookupTargetType([target]), classifyQuery(prepareLookupCollectionTarget(target)).type);
  }
  for (const entries of [[], [''], ['one.example.test', 'two.example.test'], ['AS4294967296'],
    ['localhost'], ['invalid.example.test\\path'], ['https://synthetic:private@portal.example.test/'], ['https://0xc0000208/']]) {
    assert.equal(lookupTargetType(entries), 'unknown');
  }
  assert.equal(lookupTargetType(['127.0.0.1']), 'ipv4', 'Public-address admission remains collector-owned.');
});

test('browser source families omit domain enrichments for IP and ASN targets in each mode', () => {
  for (const type of ['ipv4', 'ipv6', 'asn'] as const) {
    const fast = buildLookupCollectionPreflight({ mode: 'fast', targetCount: 1, targetType: type, capabilities: features });
    assert.deepEqual(fast.sources.map(row => row.id), ['rdap']);
    const deep = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, targetType: type, capabilities: features, ...selected });
    assert.deepEqual(deep.sources.map(row => row.id), type === 'asn' ? ['rdap', 'whois'] : ['rdap', 'whois', 'reverse_dns']);
    assert.ok(deep.sources.every(row => row.state === 'included' || row.state === 'conditional'));
  }
  for (const [targetType, targetCount] of [['unknown', 1], ['domain', 0], ['domain', 2]] as const) {
    assert.deepEqual(buildLookupCollectionPreflight({ mode: 'deep', targetCount, targetType }).sources, []);
  }
});

test('draft selections cannot become requests or included preflight sources for an ineligible target', () => {
  for (const target of ['192.0.2.8', '2001:db8::8', 'AS64496']) {
    const eligible = eligibleLookupOptionalSources(selected, lookupTargetType([target]));
    assert.ok(Object.values(eligible).every(value => value === false));
    const params = new URL(buildLookupRequestUrl(target, { mode: 'deep', ...selected }), 'https://app.invalid').searchParams;
    assert.deepEqual([...params.keys()], ['q']);
  }
  const domain = buildLookupRequestUrl('portal.example.test', { mode: 'deep', ...selected });
  assert.deepEqual([...new URL(domain, 'https://app.invalid').searchParams.keys()], ['q', 'intelligence', 'malware', 'ioc', 'security_txt']);
  assert.ok(Object.values(selected).every(value => value === true), 'Eligibility must not mutate retained checkbox drafts.');
});

test('each optional provider has its own selection and authoritative configuration state', () => {
  const capabilities = features.map(item => item.id === 'urlhaus_host' ? { ...item, status: 'disabled' as const }
    : item.id === 'threatfox_domain_ioc' ? { ...item, status: 'unavailable' as const } : item);
  const plan = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, targetType: 'domain', capabilities,
    includeExternalIntelligence: true, includeMalwareHostIntelligence: true, includeMalwareIocIntelligence: true });
  assert.equal(plan.sources.find(row => row.id === 'external_intelligence')?.state, 'included');
  assert.equal(plan.sources.find(row => row.id === 'malware_host_intelligence')?.state, 'disabled');
  assert.equal(plan.sources.find(row => row.id === 'malware_ioc_intelligence')?.state, 'unavailable');
  assert.ok(plan.sources.length <= 12);
});

test('disabled prerequisite families and unavailable capability reports never look included', () => {
  const plan = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, capabilities: features, disabledSourceIds: ['availability', 'rdap'] });
  for (const id of ['rdap', 'dns_intelligence', 'website_probe', 'tls_intelligence', 'registrar_rdap', 'network_context']) {
    assert.equal(plan.sources.find(row => row.id === id)?.state, 'disabled', id);
  }
  assert.equal(plan.sources.find(row => row.id === 'security_txt')?.state, 'optional', 'security.txt has its own website prerequisite, not availability.');
  for (const capabilities of [null, []]) {
    const unknown = buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, capabilities });
    assert.ok(unknown.sources.every(row => row.state === 'unavailable'));
  }
  const wrongMode = features.map(item => item.id === 'whois' ? { ...item, scanModes: [] } : item);
  assert.equal(buildLookupCollectionPreflight({ mode: 'deep', targetCount: 1, capabilities: wrongMode }).sources.find(row => row.id === 'whois')?.state, 'unavailable');
});

test('canonical optional source planning agrees with the existing execution progress recipe', () => {
  const target = classifyQuery('portal.example.test');
  const options = { securityTxt: true, externalIntelligence: true, malwareHostIntelligence: true, malwareIocIntelligence: true };
  assert.deepEqual(plannedLookupSources(target.type, 'deep', options), ['rdap', 'whois', 'domain_evidence',
    'registrar_rdap', 'network_context', 'security_txt', 'external_intelligence', 'malware_host_intelligence', 'malware_ioc_intelligence']);
  for (const type of ['ipv4', 'ipv6', 'asn'] as const) {
    assert.deepEqual(plannedLookupSources(type, 'deep', options), plannedLookupSources(type, 'deep'));
    assert.deepEqual(plannedLookupSources(type, 'fast', options), ['rdap']);
  }
});

test('injected execution keeps planned IP families and separate unsupported, skipped and quota outcomes', async () => {
  for (const dnsDisabled of [false, true]) {
    const target = classifyQuery('192.0.2.8');
    const settled: Array<{ source: string; state: string }> = [];
    let rdapCalls = 0, whoisCalls = 0, dnsCalls = 0;
    await runUnifiedLookup(target, {
      featurePolicy: networkFeaturePolicy(dnsDisabled ? { WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1' } : {}),
      fetchRdapRecord: async () => { rdapCalls++; return null; },
      buildWhoisChain: async () => { whoisCalls++; return []; },
      collectReverseDnsIntelligence: async () => { dnsCalls++; return { version: 1, status: 'rate_limited', query: '192.0.2.8', addresses: [] } as never; },
      onSourceSettled: row => settled.push({ source: row.source, state: row.state }),
    });
    assert.equal(rdapCalls, 1); assert.equal(whoisCalls, 1); assert.equal(dnsCalls, dnsDisabled ? 0 : 1);
    assert.deepEqual(settled.map(row => row.source).sort(), ['rdap', 'reverse_dns', 'whois']);
    assert.equal(settled.find(row => row.source === 'reverse_dns')?.state, dnsDisabled ? 'skipped' : 'rate_limited');
    assert.deepEqual(plannedLookupProgressSources(target), ['rdap', 'whois', 'reverse_dns']);
  }
});
