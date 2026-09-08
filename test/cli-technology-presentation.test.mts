import assert from 'node:assert/strict';
import test from 'node:test';
import { appendTechnologyLines } from '../cli/formatters/terminal-technology.mts';

const generatedAt = '2026-08-31T00:00:00.000Z';
function render(overrides: Partial<Parameters<typeof appendTechnologyLines>[1]> = {}): string {
  const lines: string[] = [];
  appendTechnologyLines(lines, {
    technology: { source: 'derived', status: 'partial', findings: [] },
    libraries: {}, nameservers: ['ns1.example.test'], generatedAt, detail: 'verbose',
    ...overrides,
  });
  return lines.join('\n');
}

test('technology and library observations retain independent ages at output generation', () => {
  const text = render({
    technology: { source: 'derived', status: 'success', observedAt: '2026-08-20T10:00:00+10:00', findings: [] },
    libraries: { profileVersion: 2, source: 'derived', status: 'partial', observedAt: '2026-08-30T00:00:00Z', findings: [] },
  });
  assert.match(text, /Tech observed\s+2026-08-20T00:00:00\.000Z · 11 days old at output generation/u);
  assert.match(text, /Lib observed\s+2026-08-30T00:00:00\.000Z · 1 day old at output generation/u);
  for (const value of [undefined, null, '2026-02-30T00:00:00Z', '2026-08-20']) {
    const unknown = render({
      technology: { source: 'derived', status: 'success', observedAt: value },
      libraries: { profileVersion: 2, source: 'derived', status: 'success' },
    });
    assert.match(unknown, /Tech observed\s+Observed time unavailable/u);
    assert.match(unknown, /Lib observed\s+Observed time unavailable/u);
    assert.doesNotMatch(unknown, /days? old|less than a day/iu);
  }
  assert.match(render({ technology: { source: 'derived', observedAt: '2026-09-01T00:00:00Z' } }),
    /2026-09-01T00:00:00\.000Z · age unavailable/u);
  assert.match(render({ technology: { source: 'derived', observedAt: generatedAt } }), /less than a day old at output generation/u);
});

test('verbose technology output contains every admitted clue and keeps roles separate', () => {
  const findings = Array.from({ length: 24 }, (_, index) => ({
    id: `indicator-${index}`, name: `Indicator ${index}`, confidence: 'medium',
    roles: [index % 2 ? 'application_platform' : 'observed_edge'],
    evidence: Array.from({ length: 4 }, (_, signal) => ({
      source: 'passive response header', role: index % 2 ? 'application_platform' : 'observed_edge',
      description: `Header criterion ${index}-${signal} matched the captured response.`,
      rawValue: 'private-header-value-must-not-render',
    })),
  }));
  const verbose = render({ technology: { source: 'derived', status: 'partial', findings } });
  assert.equal(verbose.split('\n').filter((line) => line.startsWith('Indicator ')).length, 24);
  assert.equal(verbose.split('\n').filter((line) => line.startsWith('  Signal ')).length, 96);
  for (let index = 0; index < 24; index += 1) {
    for (let signal = 0; signal < 4; signal += 1) assert.ok(verbose.includes(`Header criterion ${index}-${signal} matched the captured response.`));
  }
  assert.match(verbose, /Source\s+passive response header · Observed edge/u);
  assert.match(verbose, /Source\s+passive response header · App platform/u);
  assert.match(verbose, /Origin host\s+Not established from retained evidence/u);
  assert.doesNotMatch(verbose, /private-header|malicious|confirmed hosting/u);
  const standard = render({ technology: { source: 'derived', status: 'partial', findings }, detail: 'standard' });
  assert.match(standard, /\+18 more/u);
  assert.doesNotMatch(standard, /Header criterion/u);
  assert.doesNotMatch(render({ detail: 'summary' }), /Tech observed|Nameservers|Signal/u);
});

test('technology display remains bounded and sanitised for malformed direct formatter input', () => {
  const text = render({ technology: {
    source: 'derived', status: 'partial',
    findings: Array.from({ length: 25 }, (_, index) => ({
      name: `Clue ${index}\u001b\n\u202e`, confidence: 'medium', roles: ['observed_edge'],
      evidence: [
        { description: 'private-incomplete-record' },
        ...Array.from({ length: 4 }, (_, signal) => ({ source: 'header\u001b', role: 'observed_edge', description: `Signal ${signal}\n\u202e` })),
      ],
    })),
  } });
  assert.equal(text.split('\n').filter((line) => line.startsWith('Indicator ')).length, 24);
  assert.match(text, /Additional findings exceed the admitted profile limit/u);
  assert.match(text, /Additional signals exceed the admitted profile limit/u);
  assert.match(text, /Incomplete retained signal record/u);
  assert.doesNotMatch(text, /Clue 24|private-incomplete|\u001b|\u202e/u);
});

test('verbose libraries expose retained detection and advisory identifiers without hidden source fields', () => {
  const text = render({ libraries: {
    profileVersion: 2, status: 'partial', observedAt: '2026-08-30T00:00:00Z',
    catalog: { name: 'Fixture catalogue', version: 'fixture-1' },
    findings: [{
      name: 'Fixture library', apparentVersion: '1.2.3', detectionMethods: ['script filename'],
      advisoryCount: 2, highestSeverity: 'high',
      advisoryIdentifiers: ['CVE-2026-12345', 'GHSA-2345-6789-cfgh'],
      knownExploitedIdentifiers: ['CVE-2026-12345'],
      rawScript: 'private-inline-content-must-not-render',
    }],
    limitations: ['Passive matches do not establish exploitability.'],
  } });
  assert.match(text, /Library\s+Fixture library · 1\.2\.3/u);
  assert.match(text, /Detected by\s+script filename/u);
  assert.match(text, /Identifier\s+GHSA-2345-6789-cfgh/u);
  assert.match(text, /Known exploited\s+CVE-2026-12345/u);
  assert.match(text, /Limit\s+Passive matches do not establish exploitability\./u);
  assert.doesNotMatch(text, /private-inline/u);
});
