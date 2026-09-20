import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_PROFILE_KEY, activeProfileId, setActiveProfile } from '../frontend/src/lib/brand-profiles.ts';
import { clearInvestigationGuide, loadInvestigationGuide, startInvestigationGuide } from '../frontend/src/lib/investigation-guide.ts';
import { hasStoredInvestigationGuide, INVESTIGATION_GUIDE_KEY } from '../frontend/src/lib/investigation-guide-storage.ts';
import { consumeCandidateHandoff, saveCandidateHandoff } from '../frontend/src/lib/candidate-handoff.ts';
import { HANDOFF_KEY } from '../packages/investigation/candidate-handoff.mts';
import { BROWSER_WORKSPACE_SELECTION_KEY } from '../frontend/src/lib/browser-workspace-context.ts';

test('the real guide, candidate and Brand adapters use the captured named scope without touching default or peer keys', () => {
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  const firstKey = (key: string) => `whoisleuth:workspace:${first}:${key}`;
  const secondKey = (key: string) => `whoisleuth:workspace:${second}:${key}`;
  const values = new Map([[BROWSER_WORKSPACE_SELECTION_KEY, first], [INVESTIGATION_GUIDE_KEY, 'default guide'], [HANDOFF_KEY, 'default handoff'], [secondKey(ACTIVE_PROFILE_KEY), 'peer-profile']]);
  const descriptors = new Map(['window', 'sessionStorage', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => { throw new Error('Named preferences cannot read default storage.'); },
    setItem: () => { throw new Error('Named preferences cannot write default storage.'); },
    removeItem: () => { throw new Error('Named preferences cannot remove default storage.'); },
  } });
  try {
    assert.equal(hasStoredInvestigationGuide(), false);
    startInvestigationGuide('scoped.example', 'infrastructure_pivot');
    assert.equal(hasStoredInvestigationGuide(), true);
    assert.ok(loadInvestigationGuide());
    assert.ok(values.get(firstKey(INVESTIGATION_GUIDE_KEY)));
    values.set(BROWSER_WORKSPACE_SELECTION_KEY, second);
    setActiveProfile('first-profile');
    assert.equal(activeProfileId(), 'first-profile');
    assert.equal(values.get(firstKey(ACTIVE_PROFILE_KEY)), 'first-profile');
    assert.equal(values.get(secondKey(ACTIVE_PROFILE_KEY)), 'peer-profile');
    const saved = saveCandidateHandoff('manual', [{ domain: 'candidate.example', source: 'Analyst supplied', mutationTypes: [] }]);
    assert.equal(saved.saved, true);
    if (!saved.saved) throw new Error('The bounded handoff was not saved.');
    assert.ok(values.get(firstKey(HANDOFF_KEY)));
    assert.equal(consumeCandidateHandoff(saved.token, 'manual')?.candidates[0]?.domain, 'candidate.example');
    assert.equal(consumeCandidateHandoff(saved.token, 'manual'), null);
    clearInvestigationGuide();
    assert.equal(hasStoredInvestigationGuide(), false);
    assert.equal(values.get(INVESTIGATION_GUIDE_KEY), 'default guide');
    assert.equal(values.get(HANDOFF_KEY), 'default handoff');
    assert.equal(values.has(secondKey(INVESTIGATION_GUIDE_KEY)), false);
    assert.equal(values.has(secondKey(HANDOFF_KEY)), false);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
