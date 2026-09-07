import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearInvestigationGuide,
  approveInvestigationGuideCollection,
  INVESTIGATION_GUIDE_EVENT,
  INVESTIGATION_GUIDE_KEY,
  pauseInvestigationGuide,
  recordInvestigationGuideVisit,
  startInvestigationGuide,
  updateInvestigationGuideOutcome,
} from '../frontend/src/lib/investigation-guide.ts';

test('guide mutation failures preserve stored progress and do not announce success', () => {
  const descriptors = new Map(['window', 'sessionStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = new EventTarget();
  const stored = new Map<string, string>();
  let failure: 'none' | 'read' | 'write' | 'clear' = 'none';
  let announcements = 0;
  events.addEventListener(INVESTIGATION_GUIDE_EVENT, () => { announcements += 1; });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => { if (failure === 'read') throw new Error('Unavailable'); return stored.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (failure === 'write') throw new Error('Unavailable'); stored.set(key, value); },
    removeItem: (key: string) => { if (failure === 'clear') throw new Error('Unavailable'); stored.delete(key); },
  } });
  try {
    startInvestigationGuide('guide.example', 'infrastructure_pivot');
    approveInvestigationGuideCollection('lookup');
    recordInvestigationGuideVisit('/lookup');
    const original = stored.get(INVESTIGATION_GUIDE_KEY);
    assert.ok(original);
    assert.equal(announcements, 3);
    failure = 'write';
    assert.throws(() => updateInvestigationGuideOutcome('lookup', 'partial', 'Retain this explanation'), /Could not retain/);
    assert.equal(stored.get(INVESTIGATION_GUIDE_KEY), original);
    failure = 'read';
    assert.throws(pauseInvestigationGuide, /Could not read/);
    failure = 'clear';
    assert.throws(clearInvestigationGuide, /Could not clear/);
    assert.equal(stored.get(INVESTIGATION_GUIDE_KEY), original);
    assert.equal(announcements, 3);
    failure = 'none';
    const updated = updateInvestigationGuideOutcome('lookup', 'partial', 'Retain this explanation');
    assert.equal(updated?.stages.find((stage) => stage.id === 'lookup')?.reviewNote, 'Retain this explanation');
    assert.equal(announcements, 4);
    clearInvestigationGuide();
    assert.equal(stored.has(INVESTIGATION_GUIDE_KEY), false);
    assert.equal(announcements, 5);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
