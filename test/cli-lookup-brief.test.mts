import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCliLookupBrief, formatCliLookupBrief } from '../cli/lookup-brief.mts';
import { MAX_TERMINAL_VALUE_LENGTH } from '../cli/formatters/terminal.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { parseRdap } from '../lib/rdap.mts';

const NOW = '2026-08-05T02:00:00.000Z';

function lookup() {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW, mode: 'deep', query: 'example.test', type: 'domain', registrableDomain: 'example.test',
    diagnostics: { rdap: { status: 'success', observedAt: NOW }, whois: { status: 'partial', observedAt: NOW } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, lifecycle: { createdDateIso: '2024-01-02T00:00:00.000Z' } } },
    whois: { parsed: {} },
    availability: { state: 'registered', activityStatus: 'active', pageTitle: 'Example service', dns: { status: 'success' }, http: { status: 'success' }, tls: { status: 'unavailable' } },
  };
}

function sourceBranch(output: string, label: string): string {
  const lines = output.split('\n');
  const start = lines.findIndex(line => line.trimStart().startsWith(`${label} [`));
  assert.ok(start >= 0, `The ${label} source must be present`);
  const indentation = lines[start]!.length - lines[start]!.trimStart().length;
  let end = start + 1;
  while (end < lines.length && lines[end]!.trim()
    && lines[end]!.length - lines[end]!.trimStart().length > indentation) end += 1;
  return lines.slice(start, end).join('\n');
}

describe('CLI Lookup brief', () => {
  test('separates facts from incomplete sources without copying raw evidence', () => {
    const brief = buildCliLookupBrief(JSON.stringify({ ...lookup(), rawWhois: 'private raw value' }), NOW);
    assert.equal(brief.target, 'example.test');
    assert.equal(brief.version, 3);
    const registrar = brief.facts.find((item) => item.label === 'Registrar' && item.value === 'Example Registrar');
    assert.equal(registrar?.source.label, 'Registry RDAP');
    assert.equal(registrar?.source.observedAt, NOW);
    assert.ok(brief.unknowns.includes('whois: partial'));
    assert.ok(brief.unknowns.includes('tls: unavailable'));
    assert.ok(brief.actionPlan.every((item) => item.expectedOutcome.length > 20));
    assert.match(brief.actionPlan.find((item) => item.id === 'source-state-review')?.expectedOutcome ?? '', /transient|persistent/u);
    assert.doesNotMatch(JSON.stringify(brief), /private raw value/u);
    assert.match(formatCliLookupBrief(brief), /Source-attributed facts/u);
    assert.doesNotMatch(formatCliLookupBrief(brief), /Verified facts/u);
    assert.match(formatCliLookupBrief(brief), /Recommended manual actions/u);
  });

  test('groups selected facts under their source without turning an empty branch into absence', () => {
    const brief = buildCliLookupBrief(JSON.stringify(lookup()), NOW);
    const before = JSON.stringify(brief);
    const output = formatCliLookupBrief(brief);
    const registry = sourceBranch(output, 'Registry RDAP');
    assert.match(registry, /\[success; observed 2026-08-05T02:00:00\.000Z\]/);
    assert.match(registry, /Registrar: Example Registrar/);
    assert.match(registry, /Created: 2024-01-02T00:00:00\.000Z/);
    assert.doesNotMatch(registry, /Page title|Website activity/);
    const http = sourceBranch(output, 'HTTP and static page identity');
    assert.match(http, /\[success; source time not recorded\]/);
    assert.match(http, /Page title: Example service/);
    assert.match(http, /Website activity: active/);
    assert.doesNotMatch(http, /Registrar:|Created:/);
    const dns = sourceBranch(output, 'DNS');
    assert.match(dns, /\[success; source time not recorded\]/);
    assert.match(dns, /No fact selected for this brief/);
    const whois = sourceBranch(output, 'WHOIS');
    assert.match(whois, /\[partial; observed 2026-08-05T02:00:00\.000Z\]/);
    assert.match(whois, /No fact selected for this brief/);
    assert.match(sourceBranch(output, 'TLS'), /\[unavailable; source time not recorded\]/);
    assert.doesNotMatch(dns + whois, /source (?:empty|absent)|no (?:records|evidence)/i);
    assert.equal(JSON.stringify(brief), before);
  });

  test('retains conflicting publication values with separate source states and times', () => {
    const source = lookup();
    source.diagnostics.rdap = { status: 'success', observedAt: NOW };
    source.diagnostics.whois = { status: 'complete', observedAt: '2026-08-05T01:59:00.000Z' };
    source.rdap.parsed.registrar = { name: 'Registry Registrar' };
    Object.assign(source.whois.parsed, { registrar: 'WHOIS Registrar' });
    const brief = buildCliLookupBrief(JSON.stringify(source), NOW);
    assert.deepEqual(brief.contradictions[0], {
      field: 'Registrar',
      detail: 'Registry RDAP and WHOIS publish different values for Registrar.',
      observations: [
        { source: brief.sourceHealth[0], state: 'value', value: 'Registry Registrar' },
        { source: brief.sourceHealth[2], state: 'value', value: 'WHOIS Registrar' },
      ],
    });
    const rendered = formatCliLookupBrief(brief);
    assert.match(rendered, new RegExp(`Registry Registrar.*observed ${NOW.replaceAll('.', '\\.')}`, 'u'));
    assert.match(rendered, /WHOIS Registrar.*observed 2026-08-05T01:59:00.000Z/u);
    assert.match(rendered, /Registry Registrar \(value state: value; source state: success;/);
    assert.match(rendered, /WHOIS Registrar \(value state: value; source state: complete;/);
  });

  test('reads registration and expiry dates from the canonical RDAP parser lifecycle', () => {
    const source = lookup();
    const parsed = parseRdap('domain', {
      ldhName: 'EXAMPLE.TEST',
      events: [
        { eventAction: 'registration', eventDate: '2024-01-02T00:00:00Z' },
        { eventAction: 'expiration', eventDate: '2028-03-04T00:00:00Z' },
      ],
    });
    assert.ok(parsed);
    Object.assign(source.rdap, {
      parsed: { ...parsed, registrar: { name: 'Example Registrar' } },
    });
    const brief = buildCliLookupBrief(JSON.stringify(source), NOW);
    assert.equal(brief.facts.find((item) => item.id === 'created')?.value, '2024-01-02T00:00:00.000Z');
    assert.equal(brief.facts.find((item) => item.id === 'expires')?.value, '2028-03-04T00:00:00.000Z');

    Object.assign(source.rdap, {
      parsed: { registrar: { name: 'Example Registrar' }, lifecycle: {} },
    });
    const missing = buildCliLookupBrief(JSON.stringify(source), NOW);
    assert.equal(missing.facts.some((item) => item.id === 'created' || item.id === 'expires'), false);
  });

  test('sanitises retained page identity before building and presenting a brief', () => {
    const source = lookup();
    source.availability.pageTitle = 'Account\u009b\u202e centre\u00ad';
    const brief = buildCliLookupBrief(JSON.stringify(source), NOW);
    const pageTitle = brief.facts.find((item) => item.label === 'Page title');
    assert.equal(pageTitle?.value, 'Account centre');
    assert.doesNotMatch(formatCliLookupBrief(brief), /[\u0080-\u009f]|\p{Default_Ignorable_Code_Point}/u);
  });

  test('keeps the existing selected-value bound without losing source grouping', () => {
    const source = lookup();
    source.availability.pageTitle = `${'Long title '.repeat(100)}hidden-tail`;
    const brief = buildCliLookupBrief(JSON.stringify(source), NOW);
    const value = brief.facts.find(item => item.id === 'page-title')!.value;
    assert.equal(value.length, 300);
    const rendered = formatCliLookupBrief(brief);
    const title = sourceBranch(rendered, 'HTTP and static page identity')
      .split('\n').find(line => line.trimStart().startsWith('Page title:'))!
      .trimStart().slice('Page title: '.length);
    assert.equal(title.length, MAX_TERMINAL_VALUE_LENGTH);
    assert.ok(title.endsWith('…'));
    assert.ok(value.startsWith(title.slice(0, -1)));
    assert.doesNotMatch(rendered, /hidden-tail/);
    assert.equal(rendered.split('Page title:').length - 1, 1);
  });

  test('surfaces local certificate warning data as a review lead rather than a verdict', () => {
    const source = lookup();
    Object.assign(source, {
      sslbl: {
        sslblVersion: 1,
        source: 'sslbl',
        status: 'success',
        verdict: 'listed',
        complete: true,
        observedAt: NOW,
        fingerprintSha1: 'ab'.repeat(20),
        snapshot: { sourceUpdatedAt: '2026-08-04T00:00:00.000Z' },
      },
    });
    const brief = buildCliLookupBrief(JSON.stringify(source), NOW);
    const warningFact = brief.facts.find((item) => item.id === 'certificate-warning-data');
    assert.equal(warningFact?.value, 'Listed certificate review lead');
    assert.equal(warningFact?.source.label, 'Local SSLBL certificate snapshot');
    assert.equal(warningFact?.source.observedAt, NOW);
    assert.match(brief.actionPlan.find((item) => item.id === 'certificate-warning-review')?.expectedOutcome ?? '', /without treating it alone as a maliciousness verdict/u);
    assert.match(formatCliLookupBrief(brief), /Certificate warning data: Listed certificate review lead/u);
  });

  test('routes the offline command without collecting', async () => {
    const raw = JSON.stringify(lookup());
    const expected = buildCliLookupBrief(raw, NOW);
    let requests = 0;
    const denied = () => { requests += 1; throw new Error('Offline brief attempted collection.'); };
    for (const mode of [[], ['--json'], ['--quiet']]) {
      let stdout = '', stderr = '';
      const code = await runCli(['brief', '--no-color', ...mode], {
        stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } }, now: () => NOW,
        readArtifactInput: async () => raw,
        runUnifiedLookup: denied, safeFetch: denied, resolvePublicAddresses: denied,
        whoisQuery: denied, fetchHomepage: denied, collectTlsIntelligence: denied,
      });
      assert.equal(code, EXIT_CODES.SUCCESS, stderr);
      assert.equal(stderr, '');
      assert.equal(requests, 0);
      if (mode.includes('--json')) assert.deepEqual(JSON.parse(stdout), expected);
      else if (mode.includes('--quiet')) assert.equal(stdout, '');
      else {
        assert.match(sourceBranch(stdout, 'Registry RDAP'), /Registrar: Example Registrar/);
        assert.match(sourceBranch(stdout, 'TLS'), /unavailable/);
      }
    }
  });
});
