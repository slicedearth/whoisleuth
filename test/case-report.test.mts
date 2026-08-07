import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as caseReport from '../frontend/src/lib/analysis/case-report.ts';
import { recordValue, requiredValue } from './value-assertions.mts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO = '2026-05-01T00:00:00.000Z';
const LATER = '2026-06-01T00:00:00.000Z';
const LATEST = '2026-07-01T00:00:00.000Z';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-abc',
    fingerprint: 'abc123',
    firstCapturedAt: ISO,
    capturedAt: ISO,
    source: 'lookup',
    scanDepth: 'deep',
    availability: 'registered',
    confidence: null,
    riskModelVersion: 1,
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

function caseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    domain: 'test.invalid',
    status: 'new',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    sightings: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema identity
// ---------------------------------------------------------------------------

describe('schema identity', () => {
  test('exports correct schema and version', () => {
    assert.equal(caseReport.CASE_REPORT_SCHEMA, 'whoisleuth.case-report');
    assert.equal(caseReport.CASE_REPORT_SCHEMA_VERSION, 6);
  });
});

// ---------------------------------------------------------------------------
// JSON report structure
// ---------------------------------------------------------------------------

describe('buildCaseReport JSON', () => {
  test('no-evidence case produces valid report', () => {
    const rec = caseRecord({ evidenceHistory: [] });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.schema, 'whoisleuth.case-report');
    assert.equal(json.schemaVersion, 6);
    assert.equal(json.generatedAt, ISO);
    assert.equal(json.application.name, 'WHOISleuth');
    assert.equal(json.case.id, 'case-1');
    assert.equal(json.case.domain, 'test.invalid');
    assert.equal(json.case.notesIncluded, false);
    assert.deepEqual(json.case.interoperabilityTags, []);
    assert.equal(json.currentAssessment, null);
    assert.deepStrictEqual(json.evidenceTimeline, []);
    assert.ok(typeof json.limitations === 'string');
    assert.ok(json.limitations.length > 0);
    // Notes not present when excluded.
    assert.equal('notes' in json.case, false);
  });

  test('derives conservative interoperability tags from reviewed analyst state', () => {
    const rec = caseRecord({ disposition: 'false_positive', reviewReasonCode: 'shared_infrastructure' });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });
    assert.deepEqual(json.case.interoperabilityTags, [
      'false-positive:confirmed="true"',
      'false-positive:risk="high"',
    ]);
  });

  test('separates structured assertions and explicit manual trail entries', () => {
    const rec = caseRecord({
      assertions: [
        { id: 'assertion-1', kind: 'verified_fact', statement: 'MX was observed.', rationale: null, evidencePinIds: [], state: 'open', createdAt: ISO, updatedAt: ISO },
        { id: 'assertion-2', kind: 'hypothesis', statement: 'Mail activation may be recent.', rationale: 'No earlier complete observation is retained.', evidencePinIds: [], state: 'open', createdAt: ISO, updatedAt: ISO },
        { id: 'assertion-3', kind: 'unknown', statement: 'The responsible operator is unknown.', rationale: null, evidencePinIds: [], state: 'open', createdAt: ISO, updatedAt: ISO },
        { id: 'assertion-4', kind: 'contradiction', statement: 'Registry and registrar dates differ.', rationale: null, evidencePinIds: [], state: 'open', createdAt: ISO, updatedAt: ISO },
        { id: 'assertion-5', kind: 'next_step', statement: 'Verify the provider contact manually.', rationale: null, evidencePinIds: [], state: 'open', createdAt: ISO, updatedAt: ISO },
      ],
      manualTrail: [{ id: 'trail-1', kind: 'pivot', summary: 'Reviewed certificate evidence.', target: 'certificate fingerprint', createdAt: ISO }],
      sightings: [{
        id: 'sighting-1',
        state: 'reported_by_provider',
        sourceClass: 'provider',
        category: 'website',
        source: 'Reviewed provider report',
        observedAt: ISO,
        completeness: 'partial',
        evidencePinId: null,
        limitations: ['Provider coverage is not complete.'],
        createdAt: ISO,
      }],
    });
    const { json, markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });
    assert.equal(json.analystResponse.assertions.length, 5);
    assert.equal(json.analystResponse.manualTrail.length, 1);
    assert.equal(json.analystResponse.sightings.length, 1);
    assert.match(markdown, /### Source-qualified sightings/u);
    assert.match(markdown, /reported by provider/u);
    assert.match(markdown, /### Verified facts/u);
    assert.match(markdown, /### Hypotheses/u);
    assert.match(markdown, /### Unknowns/u);
    assert.match(markdown, /### Contradictory evidence/u);
    assert.match(markdown, /### Recommended next manual steps/u);
    assert.match(markdown, /Browser navigation is not tracked|certificate fingerprint/u);
  });

  test('single-snapshot baseline', () => {
    const rec = caseRecord({
      evidenceHistory: [snapshot({ id: 'ev-1', fingerprint: 'fp1' })],
    });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.evidenceTimeline.length, 1);
    const entry = requiredValue(json.evidenceTimeline[0]);
    assert.equal(entry.isBaseline, true);
    assert.equal(entry.changes, null);
    assert.equal(entry.hasIncomparableChange, false);
    assert.equal(entry.snapshot.id, 'ev-1');
    // Current assessment matches the snapshot.
    assert.equal(requiredValue(json.currentAssessment).id, 'ev-1');
  });

  test('multiple snapshots, chronological order', () => {
    const older = snapshot({ id: 'ev-old', fingerprint: 'old', capturedAt: ISO, riskScore: 20 });
    const newer = snapshot({ id: 'ev-new', fingerprint: 'new', capturedAt: LATER, riskScore: 85 });
    const rec = caseRecord({ evidenceHistory: [older, newer] });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.evidenceTimeline.length, 2);
    // Chronological: older first.
    assert.equal(requiredValue(json.evidenceTimeline[0]).snapshot.id, 'ev-old');
    assert.equal(requiredValue(json.evidenceTimeline[0]).isBaseline, true);
    assert.equal(requiredValue(json.evidenceTimeline[1]).snapshot.id, 'ev-new');
    assert.equal(requiredValue(json.evidenceTimeline[1]).isBaseline, false);
    // Changes detected via compareCaseEvidence.
    assert.ok(Array.isArray(requiredValue(json.evidenceTimeline[1]).changes));
    assert.ok(requiredValue(requiredValue(json.evidenceTimeline[1]).changes).length > 0);
    // Current assessment is the latest.
    assert.equal(requiredValue(json.currentAssessment).id, 'ev-new');
    assert.equal(requiredValue(json.currentAssessment).riskScore, 85);
    assert.equal(requiredValue(json.currentAssessment).riskModelVersion, 1);
  });

  test('repeated observation timestamps', () => {
    const rec = caseRecord({
      evidenceHistory: [
        snapshot({
          id: 'ev-repeat',
          fingerprint: 'fp-repeat',
          firstCapturedAt: ISO,
          capturedAt: LATEST,
        }),
      ],
    });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    const entry = requiredValue(json.evidenceTimeline[0]);
    assert.equal(entry.hasRepeatedObservation, true);
    assert.equal(entry.snapshot.firstCapturedAt, ISO);
    assert.equal(entry.snapshot.capturedAt, LATEST);
  });

  test('incomparable change when fingerprints differ but no changes', () => {
    // Deep baseline vs fast follow-up with same values but different depths.
    const deep = snapshot({
      id: 'ev-deep', fingerprint: 'deep-fp', scanDepth: 'deep',
      capturedAt: ISO, activityStatus: 'active', hasMx: true,
    });
    const fast = snapshot({
      id: 'ev-fast', fingerprint: 'fast-fp', scanDepth: 'fast',
      capturedAt: LATER, activityStatus: null, hasMx: null,
    });
    const rec = caseRecord({ evidenceHistory: [deep, fast] });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.evidenceTimeline.length, 2);
    const fastEntry = requiredValue(json.evidenceTimeline[1]);
    assert.equal(fastEntry.hasIncomparableChange, true);
    assert.deepEqual(fastEntry.incomparableReasons, ['scan-depth']);
    assert.equal(fastEntry.changes, null);
  });

  test('reports a risk-model mismatch without exporting a false score change', () => {
    const legacy = snapshot({ id: 'legacy', fingerprint: 'legacy', capturedAt: ISO, riskModelVersion: null, riskScore: 95 });
    const current = snapshot({ id: 'current', fingerprint: 'current', capturedAt: LATER, riskModelVersion: 1, riskScore: 42, registrar: 'Changed Registrar' });
    const { json, markdown } = caseReport.buildCaseReport(caseRecord({ evidenceHistory: [legacy, current] }), { generatedAt: LATER });
    const entry = requiredValue(json.evidenceTimeline[1]);
    assert.deepEqual(entry.incomparableReasons, ['risk-model']);
    assert.equal(requiredValue(entry.changes).some((change) => change.field === 'riskScore'), false);
    assert.equal(requiredValue(entry.changes).some((change) => change.field === 'registrar'), true);
    assert.match(markdown, /different or unversioned models/);
    assert.match(markdown, /Risk model: v1/);
  });

  test('normalized arrays and score factors', () => {
    const rec = caseRecord({
      evidenceHistory: [
        snapshot({
          id: 'ev-arr',
          fingerprint: 'arr',
          nameservers: ['ns1.example.com', 'ns2.example.com'],
          riskFactors: [{ label: 'Newly registered', points: 15, importedSecret: 'exclude me' }],
          mutationTypes: ['omission', 'hyphenation'],
        }),
      ],
    });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    const snap = requiredValue(json.evidenceTimeline[0]).snapshot;
    assert.deepStrictEqual(snap.nameservers, ['ns1.example.com', 'ns2.example.com']);
    assert.deepStrictEqual(snap.riskFactors, [{ label: 'Newly registered', points: 15 }]);
    assert.deepStrictEqual(snap.mutationTypes, ['omission', 'hyphenation']);
  });

  test('notes excluded by default', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Sensitive note content.' }],
    });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.case.notesIncluded, false);
    assert.equal('notes' in json.case, false);
  });

  test('notes included when requested', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Sensitive note content.' }],
    });
    const { json } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    assert.equal(json.case.notesIncluded, true);
    assert.ok(Array.isArray(json.case.notes));
    assert.equal(json.case.notes.length, 1);
    assert.equal(requiredValue(json.case.notes[0]).body, 'Sensitive note content.');
  });

  test('notes require a strict boolean opt-in', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Sensitive note content.' }],
    });
    const invalidOptions = {
      includeNotes: 'true',
      generatedAt: ISO,
    } as unknown as Parameters<typeof caseReport.buildCaseReport>[1];
    const { json, markdown } = caseReport.buildCaseReport(rec, invalidOptions);

    assert.equal(json.case.notesIncluded, false);
    assert.equal('notes' in json.case, false);
    assert.equal(markdown.includes('Sensitive note content.'), false);
  });

  test('does not mutate source case', () => {
    const originalHistory = [snapshot({ id: 'ev-1', fingerprint: 'fp1' })];
    const originalNotes = [{ createdAt: ISO, body: 'note' }];
    const rec = caseRecord({ evidenceHistory: originalHistory, notes: originalNotes });

    const { json } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    // Source case unchanged.
    assert.strictEqual(rec.evidenceHistory, originalHistory);
    assert.strictEqual(rec.notes, originalNotes);
    // Report has copies.
    assert.notStrictEqual(requiredValue(json.evidenceTimeline[0]).snapshot, originalHistory[0]);
    assert.notStrictEqual(json.case.notes, originalNotes);
  });

  test('unknown imported keys are excluded', () => {
    const rec = caseRecord({
      evidenceHistory: [
        {
          ...snapshot({ id: 'ev-ext', fingerprint: 'ext' }),
          _customField: 'should not appear',
          anotherUnknown: 42,
        },
      ],
    });
    // Add unknown key at case level too (simulates future-schema import).
    const recWithExtra = { ...rec, _futureProp: 'secret' };

    const { json } = caseReport.buildCaseReport(recWithExtra, { generatedAt: ISO });

    const snap = requiredValue(json.evidenceTimeline[0]).snapshot;
    assert.equal('_customField' in snap, false);
    assert.equal('anotherUnknown' in snap, false);
    assert.equal(recordValue(json.case)._futureProp, undefined);
  });

  test('exports the compact HTTP summary without rich response material', () => {
    const rec = caseRecord({ evidenceHistory: [snapshot({
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://example.test',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 1,
      httpCrossOriginRedirect: true,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html',
      httpSecurityHeaders: ['content-security-policy', 'hsts'],
      redirects: [{ from: 'https://example.test', to: 'https://example.test/private' }],
      rawHeaders: { server: 'secret' },
    })] });
    const { json, markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });
    const exported = requiredValue(json.currentAssessment);
    assert.equal(exported.httpFinalOrigin, 'https://example.test');
    assert.equal(exported.httpResponseStatus, 200);
    assert.deepEqual(exported.httpSecurityHeaders, ['content-security-policy', 'hsts']);
    assert.equal('redirects' in exported, false);
    assert.equal('rawHeaders' in exported, false);
    assert.match(markdown, /Final website origin.*https\\:\/\/example\.test/);
    assert.match(markdown, /Observed security headers: Content Security Policy, HSTS/);
    assert.equal(markdown.includes('/private'), false);
    assert.equal(markdown.includes('secret'), false);
  });

  test('deterministic output with injected timestamp', () => {
    const rec = caseRecord({ evidenceHistory: [] });
    const a = caseReport.buildCaseReport(rec, { generatedAt: '2026-01-01T00:00:00.000Z' });
    const b = caseReport.buildCaseReport(rec, { generatedAt: '2026-01-01T00:00:00.000Z' });

    // Same inputs, same outputs.
    assert.deepStrictEqual(a.json, b.json);
    assert.equal(a.markdown, b.markdown);
  });

  test('null or missing evidenceHistory handled safely', () => {
    const rec = caseRecord({ evidenceHistory: null });
    const { json } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(json.currentAssessment, null);
    assert.deepStrictEqual(json.evidenceTimeline, []);
  });

  test('undefined evidenceHistory handled safely', () => {
    const rec = caseRecord();
    const { evidenceHistory: _omitted, ...withoutEvidenceHistory } = rec;
    const malformedRecord = withoutEvidenceHistory as unknown as Parameters<typeof caseReport.buildCaseReport>[0];
    const { json } = caseReport.buildCaseReport(malformedRecord, { generatedAt: ISO });

    assert.equal(json.currentAssessment, null);
    assert.deepStrictEqual(json.evidenceTimeline, []);
  });
});

// ---------------------------------------------------------------------------
// Markdown report structure
// ---------------------------------------------------------------------------

describe('buildCaseReport Markdown', () => {
  test('contains domain as heading', () => {
    const rec = caseRecord({ domain: 'my-domain.invalid' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes('# Case Report: my-domain.invalid'));
  });

  test('contains generated timestamp', () => {
    const rec = caseRecord();
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes(ISO));
  });

  test('includes limitations section', () => {
    const rec = caseRecord();
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes('## Limitations & Provenance'));
    assert.ok(markdown.includes('normalised browser-local observations'));
  });

  test('notes excluded by default in markdown', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Sensitive content.' }],
    });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(markdown.includes('## Analyst Notes'), false);
    assert.equal(markdown.includes('Sensitive content.'), false);
  });

  test('notes included in markdown when requested', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Investigation detail.' }],
    });
    const { markdown } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    assert.ok(markdown.includes('## Analyst Notes'));
    assert.ok(markdown.includes('Investigation detail.'));
    assert.ok(markdown.includes('Warning:'));
  });
});

// ---------------------------------------------------------------------------
// Markdown escaping
// ---------------------------------------------------------------------------

describe('Markdown escaping', () => {
  test('escapes heading syntax in domain', () => {
    const rec = caseRecord({ domain: '# fake-heading' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    // Should not produce a second level-1 heading.
    const headingCount = (markdown.match(/^# /gm) || []).length;
    assert.equal(headingCount, 1);
    // Should contain the escaped version.
    assert.ok(markdown.includes('\\# fake-heading'));
  });

  test('escapes link syntax in tags', () => {
    const rec = caseRecord({ tags: ['[phishing](https://hostile.example)'] });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal(markdown.includes('(https://hostile.example)'), false);
    assert.ok(markdown.includes('\\[phishing\\]'));
  });

  test('escapes image syntax', () => {
    const rec = caseRecord({ domain: '![img](x)' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes('\\!\\[img\\]'));
    assert.equal(markdown.includes('![img]'), false);
  });

  test('escapes inline HTML in notes', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: '<script>alert(1)</script>' }],
    });
    const { markdown } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    assert.equal(markdown.includes('<script>'), false);
    assert.ok(markdown.includes('\\<script\\>'));
  });

  test('escapes code fence characters in notes', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: '```\nmalicious\n```' }],
    });
    const { markdown } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    // Backticks are escaped.
    assert.ok(markdown.includes('\\`\\`\\`'));
  });

  test('escapes backticks in domain', () => {
    const rec = caseRecord({ domain: '`code`' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes('\\`code\\`'));
  });

  test('multiline notes use blockquote escaping', () => {
    const rec = caseRecord({
      notes: [{ createdAt: ISO, body: 'Line one\nLine two # heading' }],
    });
    const { markdown } = caseReport.buildCaseReport(rec, { includeNotes: true, generatedAt: ISO });

    // Each line should be prefixed with > and escaped.
    assert.ok(markdown.includes('> Line one'));
    assert.ok(markdown.includes('> Line two \\# heading'));
  });

  test('escapes pipe characters to prevent table injection', () => {
    const rec = caseRecord({ domain: 'a|b' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.ok(markdown.includes('a\\|b'));
  });

  test('breaks bare URL autolinks in stored values', () => {
    const rec = caseRecord({ tags: ['https://evil.example', 'www.evil.example'] });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.doesNotMatch(markdown, /https:\/\/evil\.example/);
    assert.doesNotMatch(markdown, /www\.evil\.example/);
    assert.match(markdown, /https\\:\/\/evil\.example/);
    assert.match(markdown, /www\\\.evil\.example/);
  });

  test('flattens line breaks in inline stored values', () => {
    const rec = caseRecord({ domain: 'safe.invalid\n# injected heading' });
    const { markdown } = caseReport.buildCaseReport(rec, { generatedAt: ISO });

    assert.equal((markdown.match(/^# /gm) || []).length, 1);
    assert.equal(markdown.includes('\n# injected heading'), false);
  });
});

// ---------------------------------------------------------------------------
// Filename generation
// ---------------------------------------------------------------------------

describe('caseReportFilename', () => {
  test('produces safe filename with domain and timestamp', () => {
    const name = caseReport.caseReportFilename('example.com', 'json', '2026-01-01T00-00-00-000Z');

    assert.equal(
      name,
      'whoisleuth-case-example.com-2026-01-01T00-00-00-000Z.json',
    );
  });

  test('produces .md extension', () => {
    const name = caseReport.caseReportFilename('example.com', 'md', '2026-01-01T00-00-00-000Z');
    assert.ok(name.endsWith('.md'));
  });

  test('sanitizes special characters in domain', () => {
    const name = caseReport.caseReportFilename('evil/../etc', 'json', '2026-01-01T00-00-00-000Z');

    assert.equal(name.includes('/'), false);
    assert.equal(name.includes('..'), false);
    assert.ok(name.includes('evil'));
  });

  test('handles missing domain', () => {
    const name = caseReport.caseReportFilename('', 'json', '2026-01-01T00-00-00-000Z');

    assert.ok(name.includes('case'));
    assert.equal(name.includes('/'), false);
  });

  test('handles null domain', () => {
    const name = caseReport.caseReportFilename(null, 'json', '2026-01-01T00-00-00-000Z');

    assert.ok(name.includes('case'));
    assert.equal(name.includes('/'), false);
  });

  test('truncates long domain', () => {
    const longDomain = 'a'.repeat(200) + '.com';
    const name = caseReport.caseReportFilename(longDomain, 'json', '2026-01-01T00-00-00-000Z');

    // Domain portion should be at most 80 chars.
    const domainPart = requiredValue(name.replace('whoisleuth-case-', '').split('-2026')[0]);
    assert.ok(domainPart.length <= 80);
  });

  test('produces bounded length', () => {
    const name = caseReport.caseReportFilename('example.com', 'json', '2026-01-01T00-00-00-000Z');

    // Should be well under common filesystem limits.
    assert.ok(name.length < 255);
  });

  test('sanitizes an untrusted timestamp segment', () => {
    const name = caseReport.caseReportFilename('example.com', 'json', '../../outside\nbad');

    assert.equal(/[\\/\u0000-\u001f\u007f]/.test(name), false);
    assert.equal(name.includes('..'), false);
    assert.ok(name.length < 255);
  });
});
