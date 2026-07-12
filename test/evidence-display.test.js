const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let display;
before(async () => {
  display = await import('../frontend/src/lib/analysis/evidence-display.js');
});

const ISO = '2026-05-01T00:00:00.000Z';
const LATER = '2026-06-01T00:00:00.000Z';
const LATEST = '2026-07-01T00:00:00.000Z';

function deepSnapshot(overrides = {}) {
  return {
    id: 'ev-abc',
    fingerprint: 'abc123',
    firstCapturedAt: ISO,
    capturedAt: ISO,
    source: 'lookup',
    scanDepth: 'deep',
    availability: 'registered',
    confidence: null,
    riskScore: 40,
    opportunityScore: null,
    riskFactors: [],
    opportunityFactors: [],
    registrar: 'Example Registrar',
    createdDate: null,
    expiryDate: null,
    nameservers: [],
    hasMx: null,
    hasSpf: null,
    hasDmarc: null,
    activityStatus: null,
    websiteProbeDetail: null,
    pageTitle: null,
    faviconMatch: null,
    faviconNearMatch: null,
    reusesOfficialAssets: null,
    hasPasswordField: null,
    phishingLanguageMatch: null,
    mutationTypes: [],
    ...overrides,
  };
}

function fastSnapshot(overrides = {}) {
  return deepSnapshot({ scanDepth: 'fast', ...overrides });
}

describe('scanDepthLabel', () => {
  test('returns human labels for known depths', () => {
    assert.equal(display.scanDepthLabel('fast'), 'Fast scan');
    assert.equal(display.scanDepthLabel('deep'), 'Deep scan');
    assert.equal(display.scanDepthLabel('unknown'), 'Unknown depth');
  });

  test('falls back for unknown values', () => {
    assert.equal(display.scanDepthLabel('turbo'), 'Unknown depth');
    assert.equal(display.scanDepthLabel(''), 'Unknown depth');
  });
});

describe('fieldLabel', () => {
  test('returns labels for known fields', () => {
    assert.equal(display.fieldLabel('availability'), 'Availability');
    assert.equal(display.fieldLabel('riskScore'), 'Risk score');
    assert.equal(display.fieldLabel('hasMx'), 'MX');
    assert.equal(display.fieldLabel('mutationTypes'), 'Mutation types');
  });

  test('returns the raw field name for unknown fields', () => {
    assert.equal(display.fieldLabel('customField'), 'customField');
  });
});

describe('formatSnapshotValue', () => {
  test('returns "Not observed" for null and undefined', () => {
    assert.equal(display.formatSnapshotValue('availability', null), 'Not observed');
    assert.equal(display.formatSnapshotValue('riskScore', undefined), 'Not observed');
  });

  test('returns "Detected" for true and "Not detected" for false', () => {
    assert.equal(display.formatSnapshotValue('hasMx', true), 'Detected');
    assert.equal(display.formatSnapshotValue('hasMx', false), 'Not detected');
  });

  test('returns string for numbers', () => {
    assert.equal(display.formatSnapshotValue('riskScore', 85), '85');
    assert.equal(display.formatSnapshotValue('riskScore', 0), '0');
  });

  test('returns comma-joined string for string arrays', () => {
    assert.equal(display.formatSnapshotValue('nameservers', ['ns1.example', 'ns2.example']), 'ns1.example, ns2.example');
  });

  test('returns "None" for empty arrays', () => {
    assert.equal(display.formatSnapshotValue('nameservers', []), 'None');
  });

  test('formats factor arrays with label and signed points', () => {
    const factors = [
      { label: 'Active site', points: 20 },
      { label: 'Recent registration', points: -10 },
      { label: 'No MX', points: 0 },
    ];
    assert.equal(
      display.formatSnapshotValue('riskFactors', factors),
      'Active site (+20), Recent registration (-10), No MX (0)',
    );
  });

  test('returns string for plain strings', () => {
    assert.equal(display.formatSnapshotValue('registrar', 'GoDaddy'), 'GoDaddy');
  });
});

describe('snapshotFieldGroups', () => {
  test('groups fields into sections and excludes empty groups', () => {
    const snap = deepSnapshot({
      availability: 'registered',
      riskScore: 40,
      registrar: 'Example Registrar',
      nameservers: ['ns1.example'],
      hasMx: true,
      activityStatus: 'active',
      faviconMatch: true,
      mutationTypes: ['omission'],
    });
    const groups = display.snapshotFieldGroups(snap);
    const names = groups.map((g) => g.name);
    assert.ok(names.includes('Registration'));
    assert.ok(names.includes('Scoring'));
    assert.ok(names.includes('Mail and web'));
    assert.ok(names.includes('Impersonation'));
  });

  test('excludes groups with no present values', () => {
    const snap = deepSnapshot({ availability: 'registered', registrar: null, riskScore: null });
    const groups = display.snapshotFieldGroups(snap);
    // Only Registration should have a value (availability).
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, 'Registration');
  });

  test('includes boolean false as a present value', () => {
    const snap = deepSnapshot({ availability: 'registered', hasMx: false });
    const groups = display.snapshotFieldGroups(snap);
    const mailGroup = groups.find((g) => g.name === 'Mail and web');
    assert.ok(mailGroup);
    const mxRow = mailGroup.rows.find((r) => r.field === 'hasMx');
    assert.ok(mxRow);
    assert.equal(mxRow.value, false);
  });

  test('excludes null, undefined, and empty strings', () => {
    const snap = deepSnapshot({
      availability: 'registered',
      registrar: null,
      pageTitle: '',
      nameservers: [],
    });
    const groups = display.snapshotFieldGroups(snap);
    const regGroup = groups.find((g) => g.name === 'Registration');
    assert.ok(regGroup);
    const fields = regGroup.rows.map((r) => r.field);
    assert.ok(fields.includes('availability'));
    assert.ok(!fields.includes('registrar'));
    assert.ok(!fields.includes('nameservers'));
  });
});

describe('formatChangeEntry', () => {
  test('classifies a newly present value as "added"', () => {
    const change = { field: 'hasMx', label: 'MX', before: null, after: true, tone: 'warn' };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.kind, 'added');
    assert.equal(formatted.beforeText, 'Not observed');
    assert.equal(formatted.afterText, 'Detected');
  });

  test('classifies a removed value as "removed"', () => {
    const change = { field: 'activityStatus', label: 'Website activity', before: 'active', after: null, tone: 'neutral' };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.kind, 'removed');
    assert.equal(formatted.beforeText, 'active');
    assert.equal(formatted.afterText, 'Not observed');
  });

  test('classifies a changed value as "changed"', () => {
    const change = { field: 'riskScore', label: 'Risk score', before: 40, after: 85, tone: 'danger' };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.kind, 'changed');
    assert.equal(formatted.beforeText, '40');
    assert.equal(formatted.afterText, '85');
  });

  test('classifies nameserver changes as "set-change"', () => {
    const change = { field: 'nameservers', label: 'Nameservers', before: ['a.ns'], after: ['b.ns'], tone: 'warn' };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.kind, 'set-change');
  });

  test('classifies factor changes as "factor-change"', () => {
    const change = {
      field: 'riskFactors',
      label: 'Risk factors',
      before: [{ label: 'A', points: 40 }],
      after: [{ label: 'B', points: 30 }],
      tone: 'neutral',
    };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.kind, 'factor-change');
    assert.equal(formatted.beforeText, 'A (+40)');
    assert.equal(formatted.afterText, 'B (+30)');
  });

  test('formats boolean changes correctly', () => {
    const change = { field: 'faviconMatch', label: 'Official favicon match', before: false, after: true, tone: 'danger' };
    const formatted = display.formatChangeEntry(change);
    assert.equal(formatted.beforeText, 'Not detected');
    assert.equal(formatted.afterText, 'Detected');
  });
});

describe('deriveTimeline', () => {
  test('returns empty array for empty or non-array input', () => {
    assert.deepEqual(display.deriveTimeline([]), []);
    assert.deepEqual(display.deriveTimeline(null), []);
    assert.deepEqual(display.deriveTimeline(undefined), []);
  });

  test('returns a single baseline entry for one snapshot', () => {
    const snap = deepSnapshot();
    const timeline = display.deriveTimeline([snap]);
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].isBaseline, true);
    assert.equal(timeline[0].changes, null);
    assert.equal(timeline[0].displayIndex, 1);
  });

  test('returns newest-first order', () => {
    const older = deepSnapshot({ capturedAt: ISO, firstCapturedAt: ISO, fingerprint: 'older' });
    const newer = deepSnapshot({ capturedAt: LATER, firstCapturedAt: LATER, riskScore: 85, fingerprint: 'newer' });
    const timeline = display.deriveTimeline([older, newer]);
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].snapshot.fingerprint, 'newer');
    assert.equal(timeline[0].displayIndex, 1);
    assert.equal(timeline[1].snapshot.fingerprint, 'older');
    assert.equal(timeline[1].displayIndex, 2);
  });

  test('marks baseline correctly (first chronological, not first display)', () => {
    const older = deepSnapshot({ capturedAt: ISO, fingerprint: 'older' });
    const newer = deepSnapshot({ capturedAt: LATER, riskScore: 85, fingerprint: 'newer' });
    const timeline = display.deriveTimeline([older, newer]);
    // Newest-first: newer is index 1, older is index 2.
    assert.equal(timeline[0].isBaseline, false); // newer
    assert.equal(timeline[1].isBaseline, true);  // older (first chronological)
  });

  test('detects repeated observation when firstCapturedAt differs from capturedAt', () => {
    const snap = deepSnapshot({ firstCapturedAt: ISO, capturedAt: LATER });
    const timeline = display.deriveTimeline([snap]);
    assert.equal(timeline[0].hasRepeatedObservation, true);
  });

  test('does not flag repeated observation when timestamps match', () => {
    const snap = deepSnapshot({ firstCapturedAt: ISO, capturedAt: ISO });
    const timeline = display.deriveTimeline([snap]);
    assert.equal(timeline[0].hasRepeatedObservation, false);
  });

  test('reports changes from compareCaseEvidence for subsequent snapshots', () => {
    const older = deepSnapshot({ capturedAt: ISO, riskScore: 40, fingerprint: 'older' });
    const newer = deepSnapshot({ capturedAt: LATER, riskScore: 85, fingerprint: 'newer' });
    const timeline = display.deriveTimeline([older, newer]);
    // newer is first in display order, and it's not the baseline.
    assert.equal(timeline[0].isBaseline, false);
    assert.ok(timeline[0].changes);
    assert.ok(timeline[0].changes.length > 0);
    const riskChange = timeline[0].changes.find((c) => c.field === 'riskScore');
    assert.ok(riskChange);
    assert.equal(riskChange.before, 40);
    assert.equal(riskChange.after, 85);
  });

  test('detects incomparable change when only deep-only evidence differs across depths', () => {
    // A deep snapshot with deep-only signals followed by a fast snapshot
    // where only the deep-only fields differ (nulled out in fast). The
    // fingerprints should differ (scanDepth is part of material identity),
    // but compareCaseEvidence produces no changes because the deep-only
    // fields aren't safely comparable. `hasIncomparableChange` must be true.
    const deep = deepSnapshot({
      capturedAt: ISO,
      fingerprint: 'deep-only',
      availability: 'registered',
      riskScore: 40,
      activityStatus: 'active',
      hasMx: true,
      faviconMatch: true,
    });
    // Fast snapshot: distinct fingerprint (different scanDepth + nulled deep signals).
    // Material identity includes scanDepth, so fingerprint differs even though
    // the only substantive difference is in deep-only fields.
    const fast = fastSnapshot({
      capturedAt: LATER,
      fingerprint: 'fast-incomp',
      availability: 'registered',   // same as deep
      riskScore: 40,                // same as deep
      // deep-only fields are null in a fast capture (unevaluated).
    });
    const timeline = display.deriveTimeline([deep, fast]);

    // Fast entry is newest-first (index 0), not baseline.
    assert.equal(timeline[0].isBaseline, false);
    // Deep-only signal differences across depths produce no field-level changes.
    assert.equal(timeline[0].changes, null);
    // But snapshots are materially distinct -> incomparable.
    assert.equal(timeline[0].hasIncomparableChange, true);
    // No false favicon "removal" — changes list is null.
    assert.equal(timeline[0].changes, null);
    // No risk change reported across different depths.
    assert.equal(timeline[0].changes, null);
  });

  test('does not flag incomparable when fingerprints match (identical material)', () => {
    const snap1 = deepSnapshot({ capturedAt: ISO, fingerprint: 'same' });
    const snap2 = deepSnapshot({ capturedAt: LATER, fingerprint: 'same' });
    const timeline = display.deriveTimeline([snap1, snap2]);
    assert.equal(timeline[0].hasIncomparableChange, false);
    assert.equal(timeline[0].changes, null);
  });
});

describe('filterChangedOnly', () => {
  test('always retains the baseline snapshot', () => {
    const older = deepSnapshot({ capturedAt: ISO, fingerprint: 'older' });
    const newer = deepSnapshot({ capturedAt: LATER, riskScore: 85, fingerprint: 'newer' });
    const timeline = display.deriveTimeline([older, newer]);
    const filtered = display.filterChangedOnly(timeline);
    const baseline = filtered.find((e) => e.isBaseline);
    assert.ok(baseline);
  });

  test('retains entries with changes', () => {
    const older = deepSnapshot({ capturedAt: ISO, riskScore: 40, fingerprint: 'older' });
    const newer = deepSnapshot({ capturedAt: LATER, riskScore: 85, fingerprint: 'newer' });
    const timeline = display.deriveTimeline([older, newer]);
    const filtered = display.filterChangedOnly(timeline);
    // Both should be retained: baseline + entry with changes.
    assert.equal(filtered.length, 2);
  });

  test('filters out entries with no changes and no incomparable flag', () => {
    const snap1 = deepSnapshot({ capturedAt: ISO, fingerprint: 'same' });
    const snap2 = deepSnapshot({ capturedAt: LATER, fingerprint: 'same' });
    const snap3 = deepSnapshot({ capturedAt: LATEST, riskScore: 90, fingerprint: 'diff' });
    const timeline = display.deriveTimeline([snap1, snap2, snap3]);
    const filtered = display.filterChangedOnly(timeline);
    // snap3 (newest, has changes) + snap1 (baseline) = 2.
    // snap2 (identical to snap1, no changes) is filtered out.
    assert.equal(filtered.length, 2);
  });
});

describe('currentEvidenceSummary', () => {
  test('returns null for empty or missing history', () => {
    assert.equal(display.currentEvidenceSummary([]), null);
    assert.equal(display.currentEvidenceSummary(null), null);
    assert.equal(display.currentEvidenceSummary(undefined), null);
  });

  test('returns the latest snapshot summary fields', () => {
    const older = deepSnapshot({ capturedAt: ISO, availability: 'available', riskScore: 20, registrar: 'OldReg', activityStatus: null });
    const newer = deepSnapshot({ capturedAt: LATER, availability: 'registered', riskScore: 85, registrar: 'NewReg', activityStatus: 'active' });
    const summary = display.currentEvidenceSummary([older, newer]);
    assert.equal(summary.availability, 'registered');
    assert.equal(summary.riskScore, 85);
    assert.equal(summary.registrar, 'NewReg');
    assert.equal(summary.activityStatus, 'active');
    assert.equal(summary.capturedAt, LATER);
  });
});