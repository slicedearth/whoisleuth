import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LookupRequestController } from '../frontend/src/lib/controllers/lookup-request-controller.ts';
import { publishLookupResult } from '../frontend/src/lib/controllers/lookup-publication.ts';
import { lookupWebSurfaces } from '../frontend/src/lib/components/lookup-web-surfaces.ts';
import { hasLookupWebEvidence, lookupPageComparisonState, lookupWebEvidenceSources } from '../frontend/src/lib/analysis/lookup-route-projections.ts';
import { normalizeBrandProfileStore } from '../packages/workspace/brand-profile-model.mts';
import { lookupSectionSurfaces } from '../frontend/src/lib/components/lookup-section-surfaces.ts';
import { createLookupViewModel } from '../lib/lookup-response-contract.mts';
import { normalizeSnapshot } from '../packages/cases/case-evidence-model.mts';
import { compareLookupRecheck } from '../frontend/src/lib/analysis/lookup-recheck-comparison.ts';

test('rechecks distinguish missing, non-later, wrong-host and comparable observations', () => {
  const before = normalizeSnapshot(
    {
      availability: 'registered',
      inputHostname: 'login.example.test',
      scanDepth: 'deep',
      registrar: 'Earlier registrar',
      webCollectionQuality: {
        version: 1,
        page: 'complete',
        favicon: 'complete',
        combined: 'complete',
      },
    },
    { fallback: '2026-09-20T00:00:00.000Z', caseDomain: 'example.test' },
  );
  assert.ok(before);
  const after = { ...before, capturedAt: '2026-09-21T00:00:00.000Z' };
  const changedSnapshot = (fields: Record<string, unknown>) => {
    const snapshot = normalizeSnapshot({ ...after, ...fields }, { caseDomain: 'example.test' });
    assert.ok(snapshot);
    return snapshot;
  };
  assert.equal(compareLookupRecheck(null, after).available, false);
  assert.equal(compareLookupRecheck(before, null).available, false);
  assert.match(compareLookupRecheck(before, before).detail, /No later/);
  assert.equal(
    compareLookupRecheck(before, changedSnapshot({ inputHostname: 'other.example.test' }))
      .available,
    false,
  );
  const same = compareLookupRecheck(before, after);
  assert.equal(same.available, true);
  assert.deepEqual(same.changes, []);
  assert.match(same.detail, /does not prove/);
  const changed = compareLookupRecheck(before, changedSnapshot({ registrar: 'Later registrar' }));
  assert.equal(changed.available, true);
  assert.ok(changed.changes.length > 0);
});

test('one operation token spans transport, reconciliation, retention and reveal', async () => {
  for (const stop of ['none', 'before', 'reconcile', 'retain', 'ready'] as const) {
    const controller = new LookupRequestController();
    const operation = controller.begin();
    const seen: string[] = [];
    const step = (name: string) => {
      seen.push(name);
      if (stop === name) controller.invalidate();
    };
    if (stop === 'before') controller.invalidate();
    const published = await publishLookupResult(operation, {
      publish: () => step('publish'),
      reconcile: async () => step('reconcile'),
      retain: async () => step('retain'),
      ready: async () => step('ready'),
      reveal: () => step('reveal'),
    });
    const order = ['publish', 'reconcile', 'retain', 'ready', 'reveal'];
    assert.deepEqual(
      seen,
      stop === 'none' ? order : stop === 'before' ? [] : order.slice(0, order.indexOf(stop) + 1),
    );
    assert.equal(published, stop === 'none');
    controller.dispose();
  }
});

test('held reconciliation cannot retain or reveal after a new operation or input change', async () => {
  for (const invalidate of ['begin', 'dispose', 'context'] as const) {
    const controller = new LookupRequestController();
    let currentContext = true,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = controller.begin(() => currentContext);
    const pending = publishLookupResult(operation, {
      publish() {},
      reconcile: () => held,
      retain: async () => {
        assert.fail('Stale write');
      },
      ready: async () => {
        assert.fail('Stale readiness');
      },
      reveal: () => {
        assert.fail('Stale reveal');
      },
    });
    if (invalidate === 'context') currentContext = false;
    else controller[invalidate]();
    release();
    assert.equal(await pending, false);
    controller.dispose();
  }
});

test('publication failures propagate without treating committed retention as an unperformed write', async () => {
  const controller = new LookupRequestController();
  const operation = controller.begin();
  let writes = 0;
  await assert.rejects(
    publishLookupResult(operation, {
      publish() {},
      reconcile: async () => {},
      retain: async () => {
        writes++;
      },
      ready: async () => {
        throw new Error('Refresh failed');
      },
      reveal: () => assert.fail('No reveal'),
    }),
    /Refresh failed/,
  );
  assert.equal(writes, 1);
  assert.equal(operation.current(), true);
  controller.dispose();
});

test('web surface eligibility is source-specific and rendering shares its loader with preloading', () => {
  const view = createLookupViewModel(null);
  const context = { serviceDependency: true, pageComparison: false, brandMimicry: false };
  const empty = lookupWebSurfaces(view, context);
  assert.ok(Object.values(empty).every((surface) => !surface.visible));
  const source = lookupWebSurfaces(
    {
      ...view,
      dnsEvidence: { source: 'dns' },
      tlsEvidence: { source: 'tls' },
      reverseDns: { source: 'reverse_dns' },
      pageRoleProfile: { source: 'derived' },
    },
    context,
  );
  assert.equal(source.dns.visible, true);
  assert.equal(source.serviceDependency.visible, true);
  assert.equal(source.dns.load, source.reverseDns.load);
  assert.equal(source.tls.visible, true);
  assert.equal(source.certificatePolicy.visible, true);
  assert.equal(source.behaviour.visible, false);
  const unavailable = lookupWebSurfaces({ ...view, dnsEvidence: { source: 'future' } }, context);
  assert.equal(unavailable.dns.visible, false);
  assert.equal(unavailable.serviceDependency.visible, false);
});

test('each web source alone keeps its family available without inventing a complete combined surface', () => {
  const view = createLookupViewModel(null);
  const context = { serviceDependency: false, pageComparison: false, brandMimicry: false };
  const examples = {
    network: ['observedNetworkContext', { contextVersion: 1 }, 'network'],
    reverseDns: ['reverseDns', { source: 'reverse_dns' }, 'reverseDns'],
    dns: ['dnsEvidence', { source: 'dns' }, 'dns'],
    http: ['httpEvidence', { source: 'http' }, 'http'],
    tls: ['tlsEvidence', { source: 'tls' }, 'tls'],
    sslbl: ['sslbl', { sslblVersion: 1 }, 'sslbl'],
    page: ['pageIdentity', { source: 'html' }, 'page'],
    credentials: ['credentialSurfaceProfile', { source: 'html' }, 'credentials'],
    structuredIdentity: ['structuredDataIdentity', { source: 'html' }, 'structuredIdentity'],
    technology: ['technologyProfile', { source: 'derived' }, 'technology'],
    pageRole: ['pageRoleProfile', { source: 'derived' }, null],
    clientBehaviour: ['clientBehaviorProfile', { source: 'derived' }, null],
    posture: ['securityPosture', { source: 'derived' }, 'posture'],
    disclosure: ['securityTxt', { securityTxtVersion: 1 }, 'disclosure'],
  } as const satisfies Record<keyof ReturnType<typeof lookupWebEvidenceSources>, readonly [
    keyof typeof view, Readonly<Record<string, unknown>>, keyof ReturnType<typeof lookupWebSurfaces> | null,
  ]>;
  assert.equal(hasLookupWebEvidence(view, 'hidden'), false);
  for (const [source, [field, input, surface]] of Object.entries(examples)) {
    for (const status of ['success', 'partial', 'unsupported']) {
      const only = { ...view, [field]: { ...input, status } };
      assert.deepEqual(Object.entries(lookupWebEvidenceSources(only)).filter(([, present]) => present).map(([key]) => key), [source]);
      assert.equal(hasLookupWebEvidence(only, 'hidden'), true, `${source}: ${status}`);
      const surfaces = lookupWebSurfaces(only, context);
      if (surface) assert.equal(surfaces[surface].visible, true, source);
      else assert.equal(surfaces.behaviour.visible, false, 'A combined behaviour view still requires both inputs.');
    }
    const unknown = { ...view, [field]: { source: 'future', contextVersion: 99, sslblVersion: 99, securityTxtVersion: 99 } };
    assert.equal(hasLookupWebEvidence(unknown, 'hidden'), false, source);
  }
});

test('saved baseline comparison has one state for the family, card and unavailable explanation', () => {
  const archive = JSON.parse(readFileSync(new URL('./fixtures/workspace-html-baseline-v8-public.json', import.meta.url), 'utf8'));
  const profile = normalizeBrandProfileStore(archive.sections.brandProfiles).profiles[0];
  assert.ok(profile?.pageBaseline);
  const empty = createLookupViewModel(null);
  const domain = { type: 'domain' } as const;
  const examples = [
    { result: null, profile, comparison: null, state: 'hidden', visible: false },
    { result: domain, profile: null, comparison: null, state: 'hidden', visible: false },
    { result: domain, profile: { pageBaseline: null }, comparison: null, state: 'hidden', visible: false },
    { result: { type: 'ipv4' } as const, profile, comparison: null, state: 'hidden', visible: false },
    { result: domain, profile, comparison: null, state: 'unavailable', visible: true },
    { result: domain, profile, comparison: {}, state: 'available', visible: true },
  ] as const;
  for (const example of examples) {
    const state = lookupPageComparisonState(example.result, example.profile, example.comparison);
    assert.equal(state, example.state);
    assert.equal(hasLookupWebEvidence(empty, state), example.visible);
    assert.equal(lookupWebSurfaces(empty, {
      serviceDependency: false, brandMimicry: false, pageComparison: state !== 'hidden',
    }).comparison.visible, example.visible);
  }
});

test('registration disclosure and optional sections require their own evidence context', () => {
  const view = createLookupViewModel(null);
  const web = lookupWebSurfaces(view, {
    serviceDependency: false,
    pageComparison: false,
    brandMimicry: false,
  });
  const empty = lookupSectionSurfaces(view, { domainResult: false, caseSection: false, web });
  assert.equal(empty.registry.access.visible, false);
  assert.equal(empty.registry.disclosure.visible, false);
  assert.equal(empty['case-response'].workspace.visible, false);
  assert.equal(empty['advanced-evidence'].intelligence.visible, false);
  assert.equal(empty['web-evidence'], web);
  const evidence = {
    ...view,
    registryAccess: { suffix: 'test' },
    rdapParsed: { redactions: [{}] },
    threatIntelligenceProviders: [{}],
  };
  const domain = lookupSectionSurfaces(evidence, { domainResult: true, caseSection: true, web });
  assert.equal(domain.registry.access.visible, true);
  assert.equal(domain.registry.disclosure.visible, true);
  assert.equal(domain['case-response'].workspace.visible, true);
  assert.equal(domain['advanced-evidence'].intelligence.visible, true);
  assert.equal(
    lookupSectionSurfaces(evidence, { domainResult: false, caseSection: false, web }).registry
      .disclosure.visible,
    false,
  );
});
