import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCliArguments } from '../cli/arguments.mts';
import type { LookupSourceSettlement } from '../lib/lookup-source-progress.mts';
import {
  MAX_LOOKUP_BROWSER_SEARCH_BYTES,
  MAX_LOOKUP_BROWSER_SEARCH_SCALARS,
  MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES,
  browseLookupOperation,
  browseLookupDocument,
  boundedSearchText,
  buildLookupBrowserHelpFrame,
  buildLookupBrowserSearchFrame,
  buildLookupBrowserPanels,
  buildLookupCollectionFrame,
  canBrowseLookup,
  findLookupBrowserMatches,
  renderedPanelLineOffset,
  renderLookupBrowser,
  terminalDisplayWidth,
} from '../cli/lookup-browser.mts';
import { formatTerminalLookup } from '../cli/formatters/terminal.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

function lookupDocument() {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: '2026-08-13T00:00:00.000Z',
    query: 'example.test',
    type: 'domain',
    mode: 'deep',
    rdap: { parsed: { domain: 'EXAMPLE.TEST' } },
    availability: {
      applicable: true,
      state: 'registered',
      confidence: 'high',
      activityStatus: 'active',
      dns: {
        source: 'dns',
        status: 'partial',
        complete: false,
        diagnostics: {
          a: { status: 'success' },
          aaaa: { status: 'error' },
          mx: { status: 'success' },
          spf: { status: 'success' },
          dmarc: { status: 'success' },
        },
        records: {
          a: ['192.0.2.10'],
          aaaa: [],
          cname: [],
          ns: ['ns1.example.test'],
          mx: [{ priority: 10, exchange: 'mail.example.test' }],
          spf: ['v=spf1 -all'],
          dmarc: ['v=DMARC1; p=reject'],
          caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }],
          soa: [{ nsname: 'ns1.example.test', serial: 2026081301 }],
          https: [],
        },
        hasMx: true,
        hasNullMx: false,
        mxHosts: ['mail.example.test'],
        hasSpf: true,
        hasDmarc: true,
      },
      http: {
        source: 'http',
        status: 'success',
        transportSecurity: 'https',
        response: { status: 200 },
      },
      tls: {
        source: 'tls',
        status: 'success',
        protocol: 'TLSv1.3',
        cipher: { standardName: 'TLS_AES_256_GCM_SHA384' },
        authorization: { authorized: true },
        hostname: { matches: true },
        validity: { status: 'valid' },
        certificate: {
          subject: { commonNames: ['example.test'] },
          issuer: { commonNames: ['Fixture issuing CA'] },
          validTo: '2027-08-13T00:00:00.000Z',
          fingerprintSha256: 'ab'.repeat(32),
          publicKey: { type: 'rsa', bits: 2048, curve: null },
          subjectAltNames: { dnsNames: ['example.test'], ipAddresses: [], classes: { dns: 1 }, truncated: false },
        },
        limitations: ['One observed endpoint does not establish every edge.'],
        privateCertificateBytes: 'must-not-render',
      },
      pageIdentity: {
        source: 'html', status: 'success', complete: true, truncated: false,
        documentLanguage: 'en', canonical: { url: 'https://example.test/', queryOmitted: false, pathTruncated: false },
        resources: { count: 3, byType: { image: 1, script: 2 }, externalOrigins: [], truncated: false },
        forms: { count: 1, postCount: 1, insecureActionCount: 0, externalActionOrigins: [], truncated: false },
        downloads: { count: 0, explicitCount: 0, riskyCount: 0, riskyFileTypes: [], externalOrigins: [], truncated: false },
        embeddedOrigins: [], contactDomains: [], trackingIdentifiers: [],
      },
    },
    networkContext: {
      contextVersion: 1, source: 'ip_rdap', status: 'success', complete: true, truncated: false,
      endpoint: { address: '192.0.2.10', family: 4, selectedFrom: 'tls_connection' },
      network: { handle: 'NET-EXAMPLE', name: 'Example edge network', cidrs: ['192.0.2.0/24'], country: 'AU', networkType: 'DIRECT ALLOCATION' },
      limitations: ['One endpoint is point-in-time context.'], abuseRouting: [],
    },
    whois: { parsed: { domainName: 'EXAMPLE.TEST' } },
    diagnostics: {
      rdap: { status: 'success', endpoint: 'https://rdap.invalid/domain/example.test' },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
      registryAccess: { suffix: 'test', whoisAccessProfile: 'generic', rdapAccessProfile: 'iana-bootstrap' },
    },
    timing: {
      totalMs: 123,
      sources: [{ source: 'dns', outcome: 'partial', durationMs: 20 }],
    },
  };
}

function capture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

class BrowserInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;
  setRawMode(value: boolean) { this.isRaw = value; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
  isPaused() { return this.paused; }
}

class BrowserOutput extends EventEmitter {
  isTTY = true;
  columns = 92;
  rows = 24;
  value = '';
  write(chunk: string) { this.value += chunk; return true; }
}

describe('lookup terminal evidence browser', () => {
  test('builds bounded DNS, mail, web, TLS, source, and collection panels from one retained result', () => {
    const document = lookupDocument();
    const panels = buildLookupBrowserPanels(document);
    assert.deepEqual(panels.map((panel) => panel.label), [
      'Target',
      'Registration',
      'DNS',
      'Mail',
      'Website and security',
      'TLS and certificate',
      'Network',
      'Source health',
      'Collection',
    ]);
    const terminal = formatTerminalLookup(document, { detail: 'verbose' });
    assert.match(terminal, /DNS:\nEvidence\s+Partial/u);
    assert.match(terminal, /A\s+192\.0\.2\.10/u);
    assert.match(terminal, /Query states\s+AAAA Error/u);
    assert.match(terminal, /Mail:\nEvidence\s+Partial/u);
    assert.match(terminal, /Mail exchange\s+MX observed/u);
    assert.match(terminal, /SPF policy\s+v=spf1 -all/u);
    assert.match(terminal, /TLS and certificate:\nEvidence\s+Success/u);
    assert.match(terminal, /Issuer\s+Fixture issuing CA/u);
    assert.doesNotMatch(terminal, /must-not-render|privateCertificateBytes/u);
  });

  test('discloses record and collection truncation while removing terminal direction controls', () => {
    const document = lookupDocument();
    document.availability.dns.records.a = Array.from({ length: 100 }, (_, index) => `192.0.2.${index}`);
    document.availability.dns.records.dmarc = [`v=DMARC1; p=reject; rua=mailto:${'x'.repeat(320)}\u202e`];
    document.availability.dns.records.spf = [`v=spf1 include:${'y'.repeat(320)}\u2066 -all`];
    Reflect.set(document.availability.dns.records, 'https', [{
      type: 'HTTPS', priority: 1, target: `${'edge'.repeat(62)}.test`,
      parameters: { alpn: ['h2', 'h3', 'hq', 'http/1.1', 'acme', 'fixture'] },
    }]);
    document.availability.tls.certificate.subject.commonNames = [
      `${'z'.repeat(320)}\u202d`, 'two.example.test', 'three.example.test', 'four.example.test',
      'five.example.test', 'six.example.test', 'seven.example.test',
    ];
    document.availability.tls.certificate.issuer.commonNames = [
      'Issuer one', 'Issuer two', 'Issuer three', 'Issuer four', 'Issuer five', 'Issuer six',
    ];
    document.availability.tls.limitations = ['one', 'two', 'three', 'four', 'five'];
    const terminal = formatTerminalLookup(document, { detail: 'verbose' });
    assert.match(terminal, /A\s+.*\+95 more/u);
    assert.match(terminal, /DMARC policy\s+.*…/u);
    assert.match(terminal, /SPF policy\s+.*…/u);
    assert.match(terminal, /Subject\s+.*…/u);
    assert.match(terminal, /Subject\s+.*\+2 more/u);
    assert.match(terminal, /Issuer\s+.*\+1 more/u);
    assert.match(terminal, /HTTPS\s+.*ALPN h2, h3, hq, http\/1\.1 · \+2 more/u);
    assert.match(terminal, /Limitation\s+\+2 more retained limitations/u);
    assert.doesNotMatch(terminal, /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u);
  });

  test('renders a height-bounded, width-bounded view without untrusted controls', () => {
    const document = lookupDocument();
    document.query = `example.test\n${'界'.repeat(400)}`;
    const rendered = renderLookupBrowser(document, { activeIndex: 2, width: 54, height: 12, color: false });
    assert.match(rendered, /WHOISleuth evidence browser/u);
    assert.match(rendered, /View 3\/9/u);
    assert.match(rendered, /DNS:/u);
    assert.match(rendered, /Target\s+example\.test.*…/u);
    assert.match(rendered, /Mode\s+deep/u);
    assert.doesNotMatch(rendered, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u);
    assert.ok(rendered.trimEnd().split('\n').length <= 12);
    assert.ok(rendered.trimEnd().split('\n').every((line) => terminalDisplayWidth(line) <= 54));
  });

  test('keeps enriched website, TLS, and network disclosures reachable in a minimum-size terminal', () => {
    const document = lookupDocument();
    const panels = buildLookupBrowserPanels(document);
    const finalDisclosures = new Map([
      ['Website and security', /tracking\s+identifiers/u],
      ['TLS and certificate', /establish\s+every\s+edge/u],
      ['Network', /point-in-time\s+context/u],
    ]);
    for (const [label, finalDisclosure] of finalDisclosures) {
      const activeIndex = panels.findIndex((panel) => panel.label === label);
      assert.notEqual(activeIndex, -1);
      const rendered = renderLookupBrowser(document, {
        activeIndex,
        scrollOffset: Number.MAX_SAFE_INTEGER,
        width: 40,
        height: 12,
        color: false,
      });
      assert.match(rendered, new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}:`));
      assert.match(rendered, /lines \d+-\d+\/\d+/u);
      assert.match(rendered, finalDisclosure);
      assert.ok(rendered.trimEnd().split('\n').every((line) => terminalDisplayWidth(line) <= 40));
    }
  });

  test('requires both terminal directions and disables browsing under CI or dumb terminals', () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    assert.equal(canBrowseLookup(input, output, { TERM: 'xterm-256color' }), true);
    assert.equal(canBrowseLookup(input, output, { TERM: 'dumb' }), false);
    assert.equal(canBrowseLookup(input, output, { CI: 'true', TERM: 'xterm' }), false);
    input.isTTY = false;
    assert.equal(canBrowseLookup(input, output, { TERM: 'xterm' }), false);
    input.isTTY = true;
    output.columns = 20;
    output.rows = 8;
    assert.equal(canBrowseLookup(input, output, { TERM: 'xterm' }), false);
  });

  test('navigates across fragmented arrows and resize events, then restores terminal state on close', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    const browsing = browseLookupDocument(lookupDocument(), {
      input,
      output,
      environment: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });
    input.emit('data', '\u001b');
    input.emit('data', '[C');
    input.emit('data', '3');
    output.rows = 12;
    output.emit('resize');
    input.emit('data', '\u001b');
    input.emit('data', '[B');
    output.columns = 40;
    output.emit('resize');
    input.emit('data', 'q');
    await browsing;
    assert.match(output.value, /\u001b\[\?1049h/u);
    assert.match(output.value, /Registration:/u);
    assert.match(output.value, /DNS:/u);
    assert.match(output.value, /lines 2-/u);
    assert.match(output.value, /\u001b\[\?1049l/u);
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
    const finalFrame = output.value.split('\u001b[2J\u001b[H').at(-1) || '';
    assert.ok(finalFrame.split('\n').every((line) => terminalDisplayWidth(line) <= 40));
  });

  test('ignores complete unsupported CSI sequences and rejects a too-small resize cleanly', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    const browsing = browseLookupDocument(lookupDocument(), {
      input,
      output,
      environment: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });
    input.emit('data', '\u001b[>0c');
    assert.equal(input.isRaw, true);
    output.columns = 20;
    output.rows = 8;
    output.emit('resize');
    await assert.rejects(browsing, /at least 40 columns by 12 rows/u);
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('rejects abort and cleanup failures without leaving raw mode or listeners behind', async () => {
    const abortedInput = new BrowserInput();
    const abortedOutput = new BrowserOutput();
    const controller = new AbortController();
    const aborted = browseLookupDocument(lookupDocument(), {
      input: abortedInput,
      output: abortedOutput,
      signal: controller.signal,
      environment: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });
    controller.abort();
    await assert.rejects(aborted, { name: 'AbortError' });
    assert.equal(abortedInput.isRaw, false);
    assert.equal(abortedInput.listenerCount('data'), 0);

    const failingInput = new BrowserInput();
    const failingOutput = new BrowserOutput();
    const originalWrite = failingOutput.write.bind(failingOutput);
    failingOutput.write = (chunk: string) => {
      if (chunk.includes('\u001b[?1049l')) throw new Error('fixture terminal restore failure');
      return originalWrite(chunk);
    };
    const failedCleanup = browseLookupDocument(lookupDocument(), {
      input: failingInput,
      output: failingOutput,
      environment: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });
    failingInput.emit('data', 'q');
    await assert.rejects(failedCleanup, /terminal restore failure/u);
    assert.equal(failingInput.isRaw, false);
    assert.equal(failingInput.listenerCount('data'), 0);

    const combinedInput = new BrowserInput();
    const combinedOutput = new BrowserOutput();
    const combinedController = new AbortController();
    const combinedWrite = combinedOutput.write.bind(combinedOutput);
    combinedOutput.write = (chunk: string) => {
      if (chunk.includes('\u001b[?1049l')) throw new Error('combined restore failure');
      return combinedWrite(chunk);
    };
    const combinedFailure = browseLookupDocument(lookupDocument(), {
      input: combinedInput,
      output: combinedOutput,
      signal: combinedController.signal,
      environment: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });
    combinedController.abort();
    await assert.rejects(combinedFailure, /Aborted; terminal cleanup also failed: combined restore failure/u);
    assert.equal(combinedInput.isRaw, false);
    assert.equal(combinedInput.listenerCount('data'), 0);
  });

  test('renders progress before one Deep collection and transitions to final panels in one terminal lifecycle', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    let collectionCalls = 0;
    let releaseCollection!: () => void;
    const collectionHold = new Promise<void>((resolve) => { releaseCollection = resolve; });
    const browsing = browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'deep',
      plannedSources: ['rdap', 'dns'],
      color: false,
      environment: { TERM: 'xterm' },
      collect: async ({ onSourceSettled }) => {
        collectionCalls += 1;
        onSourceSettled({
          source: 'rdap',
          state: 'success',
          complete: true,
          truncated: false,
          fragment: { status: 'success', limitation: 'Fixture source settled.' },
        });
        await collectionHold;
        return lookupDocument();
      },
    });
    assert.equal(collectionCalls, 0);
    assert.match(output.value, /Collection in progress/u);
    assert.match(output.value, /rdap\s+pending/u);
    assert.match(output.value, /dns\s+pending/u);

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(collectionCalls, 1);
    assert.match(output.value, /rdap\s+success · complete · Fixture source settled\./u);
    releaseCollection();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(output.value, /View 1\/9/u);
    input.emit('data', 'q');
    assert.equal((await browsing).schema, 'whoisleuth.cli.lookup');
    assert.equal(collectionCalls, 1);
    assert.equal(output.value.split('\u001b[?1049h').length - 1, 1);
    assert.equal(output.value.split('\u001b[?1049l').length - 1, 1);
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('keeps Fast progress coarse and cancels the single active collection from the browser', async () => {
    const frame = buildLookupCollectionFrame('example.test', 'fast', [], {
      width: 48,
      height: 12,
      color: false,
    });
    assert.match(frame, /Registration evidence\s+collecting/u);
    assert.match(frame, /Per-source states are not fabricated/u);
    assert.doesNotMatch(frame, /rdap|dns|whois/u);

    const input = new BrowserInput();
    const output = new BrowserOutput();
    let collectionSignal: AbortSignal | null = null;
    const browsing = browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'fast',
      color: false,
      environment: { TERM: 'xterm' },
      collect: ({ signal }) => new Promise((_resolve, reject) => {
        collectionSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.emit('data', 'q');
    await assert.rejects(browsing, { name: 'AbortError' });
    assert.ok(collectionSignal);
    assert.equal((collectionSignal as AbortSignal).aborted, true);
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('returns from collection help without cancelling, then cancels on an explicit q', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    let collectionSignal: AbortSignal | null = null;
    let collectionCalls = 0;
    const browsing = browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'fast',
      color: false,
      environment: { TERM: 'xterm' },
      collect: ({ signal }) => new Promise((_resolve, reject) => {
        collectionCalls += 1;
        collectionSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.emit('data', '?');
    assert.match(output.value, /q \/ Ctrl-C\s+cancel the active collection/u);
    assert.match(output.value, /\? \/ Esc\s+return to collection progress/u);
    input.emit('data', '\u001b');
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.ok(collectionSignal);
    assert.equal((collectionSignal as AbortSignal).aborted, false);
    assert.equal(collectionCalls, 1);
    assert.match(output.value, /Collection in progress/u);
    input.emit('data', 'q');
    await assert.rejects(browsing, { name: 'AbortError' });
    assert.equal((collectionSignal as AbortSignal).aborted, true);
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('fails closed for duplicate or unplanned Deep settlements and ignores late events after cleanup', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    let lateSettlement: ((value: LookupSourceSettlement) => void) | null = null;
    const browsing = browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'deep',
      plannedSources: ['rdap'],
      color: false,
      environment: { TERM: 'xterm' },
      collect: async ({ onSourceSettled }) => {
        lateSettlement = onSourceSettled;
        const value = {
          source: 'rdap', state: 'success', complete: true, truncated: false, fragment: { status: 'success' },
        } as const;
        onSourceSettled(value);
        onSourceSettled(value);
        return lookupDocument();
      },
    });
    await assert.rejects(browsing, /unplanned or duplicate source settlement/u);
    const afterCleanup = output.value;
    const late = lateSettlement as ((value: LookupSourceSettlement) => void) | null;
    late?.({ source: 'whois', state: 'error', complete: false, truncated: false, fragment: { status: 'error' } });
    assert.equal(output.value, afterCleanup);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('provides bounded help and rendered-panel search without exposing omitted evidence', async () => {
    const document = lookupDocument();
    const panels = buildLookupBrowserPanels(document);
    const matches = findLookupBrowserMatches(panels, 'DNS');
    assert.ok(matches.matches.length >= 1);
    assert.equal(matches.truncated, false);
    assert.equal(findLookupBrowserMatches(panels, 'privateCertificateBytes').matches.length, 0);
    assert.throws(() => boundedSearchText('x'.repeat(MAX_LOOKUP_BROWSER_SEARCH_SCALARS + 1)), /limited/u);
    assert.throws(
      () => boundedSearchText('界'.repeat(Math.floor(MAX_LOOKUP_BROWSER_SEARCH_BYTES / 3) + 1)),
      /limited/u,
    );
    assert.throws(() => boundedSearchText('safe\u202eunsafe'), /limited/u);
    assert.throws(() => boundedSearchText('safe\u009bunsafe'), /limited/u);

    const help = buildLookupBrowserHelpFrame(document, { width: 40, height: 12, color: false });
    const search = buildLookupBrowserSearchFrame(document, 'dns', '', { width: 40, height: 12, color: false });
    assert.match(help, /evidence browser help/u);
    assert.match(search, /Search\s+dns/u);
    for (const frame of [help, search]) {
      assert.ok(frame.trimEnd().split('\n').length <= 12);
      assert.ok(frame.trimEnd().split('\n').every((line) => terminalDisplayWidth(line) <= 40));
    }

    const input = new BrowserInput();
    const output = new BrowserOutput();
    const browsing = browseLookupDocument(document, {
      input,
      output,
      color: false,
      environment: { TERM: 'xterm' },
    });
    input.emit('data', '?');
    assert.match(output.value, /evidence browser help/u);
    input.emit('data', '?');
    input.emit('data', '/DNS\r');
    assert.match(output.value, /Match 1\//u);
    assert.match(output.value, /DNS:/u);
    input.emit('data', 'nNq');
    await browsing;
  });

  test('maps search results to wrapped display lines and recomputes that position after resize', async () => {
    const document = lookupDocument();
    document.availability.dns.records.a = [
      `${'192.0.2.10 long retained registration detail '.repeat(4)}`,
      'needle.example.test',
    ];
    const panels = buildLookupBrowserPanels(document);
    const dnsIndex = panels.findIndex((panel) => panel.label === 'DNS');
    const dnsPanel = panels[dnsIndex]!;
    const result = findLookupBrowserMatches(panels, 'needle.example.test');
    const match = result.matches.find((candidate) => candidate.panelIndex === dnsIndex)!;
    const narrowOffset = renderedPanelLineOffset(dnsPanel, match.lineIndex, 40);
    const wideOffset = renderedPanelLineOffset(dnsPanel, match.lineIndex, 92);
    assert.ok(narrowOffset > wideOffset);

    const input = new BrowserInput();
    const output = new BrowserOutput();
    output.columns = 40;
    const browsing = browseLookupDocument(document, { input, output, color: false, environment: { TERM: 'xterm' } });
    input.emit('data', '/needle.example.test\r');
    let latestFrame = output.value.split('\u001b[2J\u001b[H').at(-1) || '';
    assert.match(latestFrame, /needle\.example\.test/u);
    output.columns = 92;
    output.emit('resize');
    latestFrame = output.value.split('\u001b[2J\u001b[H').at(-1) || '';
    assert.match(latestFrame, /needle\.example\.test/u);
    input.emit('data', 'q');
    await browsing;
  });

  test('handles split UTF-8 search input, rejects malformed bytes, and consumes overlay Escape prefixes once', async () => {
    const document = lookupDocument();
    document.availability.dns.records.ns = ['ns.界.example.test'];
    const input = new BrowserInput();
    const output = new BrowserOutput();
    const browsing = browseLookupDocument(document, { input, output, color: false, environment: { TERM: 'xterm' } });

    input.emit('data', '?');
    input.emit('data', Buffer.from('\u001bx'));
    assert.equal(input.listenerCount('data'), 1);
    input.emit('data', '?');
    assert.match(output.value, /evidence browser help/u);
    input.emit('data', '?');
    input.emit('data', '/');
    const encoded = Buffer.from('界');
    input.emit('data', encoded.subarray(0, 1));
    input.emit('data', encoded.subarray(1, 2));
    input.emit('data', encoded.subarray(2));
    input.emit('data', '\r');
    assert.match(output.value, /Match 1\//u);

    input.emit('data', '/');
    input.emit('data', Buffer.from([0xe7]));
    input.emit('data', Buffer.from([0x0d]));
    assert.match(output.value, /valid UTF-8/u);
    input.emit('data', Buffer.from('\u001bx'));
    assert.equal(input.listenerCount('data'), 1);
    input.emit('data', '/safe\u009b');
    assert.match(output.value, /Search input is not valid bounded UTF-8 text/u);
    assert.doesNotMatch(output.value, /\u009b/u);
    input.emit('data', '\u001b');
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    input.emit('data', 'q');
    await browsing;
  });

  test('attaches navigation before resume can cancel and never starts collection afterwards', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    let collectionCalls = 0;
    input.resume = () => {
      input.paused = false;
      input.emit('data', 'q');
    };
    await assert.rejects(browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'fast',
      color: false,
      environment: { TERM: 'xterm' },
      collect: async () => { collectionCalls += 1; return lookupDocument(); },
    }), { name: 'AbortError' });
    assert.equal(collectionCalls, 0);
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('does not start collection when buffered cancellation flushes on the next tick', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    let collectionCalls = 0;
    input.resume = () => {
      input.paused = false;
      process.nextTick(() => input.emit('data', 'q'));
    };
    await assert.rejects(browseLookupOperation({
      input,
      output,
      query: 'example.test',
      mode: 'fast',
      color: false,
      environment: { TERM: 'xterm' },
      collect: async () => { collectionCalls += 1; return lookupDocument(); },
    }), { name: 'AbortError' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(collectionCalls, 0);
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('treats Ctrl-D and terminal end as cancellation with complete cleanup', async () => {
    for (const terminate of [
      (input: BrowserInput) => input.emit('data', '\u0004'),
      (input: BrowserInput) => input.emit('end'),
    ]) {
      const collectingInput = new BrowserInput();
      const collectingOutput = new BrowserOutput();
      let signal: AbortSignal | null = null;
      const collecting = browseLookupOperation({
        input: collectingInput,
        output: collectingOutput,
        query: 'example.test',
        mode: 'fast',
        color: false,
        environment: { TERM: 'xterm' },
        collect: ({ signal: supplied }) => new Promise((_resolve, reject) => {
          signal = supplied;
          supplied.addEventListener('abort', () => reject(supplied.reason), { once: true });
        }),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      terminate(collectingInput);
      await assert.rejects(collecting, { name: 'AbortError' });
      assert.ok(signal);
      assert.equal((signal as AbortSignal).aborted, true);
      assert.equal(collectingInput.isRaw, false);
      assert.equal(collectingInput.listenerCount('data'), 0);
      assert.equal(collectingInput.listenerCount('end'), 0);

      const finalInput = new BrowserInput();
      const finalOutput = new BrowserOutput();
      const final = browseLookupDocument(lookupDocument(), {
        input: finalInput, output: finalOutput, color: false, environment: { TERM: 'xterm' },
      });
      terminate(finalInput);
      await assert.rejects(final, { name: 'AbortError' });
      assert.equal(finalInput.isRaw, false);
      assert.equal(finalInput.listenerCount('data'), 0);
      assert.equal(finalInput.listenerCount('end'), 0);
      assert.match(finalOutput.value, /\u001b\[\?1049l/u);
    }
  });

  test('rejects oversized input chunks before decoding or retaining search text', async () => {
    const input = new BrowserInput();
    const output = new BrowserOutput();
    const browsing = browseLookupDocument(lookupDocument(), {
      input, output, color: false, environment: { TERM: 'xterm' },
    });
    input.emit('data', '/');
    input.emit('data', Buffer.alloc(MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES + 1, 0x61));
    assert.match(output.value, /Search input is limited/u);
    assert.doesNotMatch(output.value, new RegExp(`a{${MAX_LOOKUP_BROWSER_SEARCH_SCALARS}}`, 'u'));
    input.emit('data', '\u001b');
    await new Promise((resolve) => setTimeout(resolve, 50));
    input.emit('data', 'q');
    await browsing;

    for (const oversized of [
      Buffer.alloc(MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES + 1, 0x61),
      'a'.repeat(MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES + 1),
    ]) {
      const pendingInput = new BrowserInput();
      const pendingOutput = new BrowserOutput();
      const pending = browseLookupDocument(lookupDocument(), {
        input: pendingInput, output: pendingOutput, color: false, environment: { TERM: 'xterm' },
      });
      pendingInput.emit('data', '\u001b[');
      pendingInput.emit('data', oversized);
      pendingInput.emit('data', 'q');
      await pending;
      assert.equal(pendingInput.listenerCount('data'), 0);
      assert.equal(pendingInput.isRaw, false);
    }
  });
});

describe('lookup browse CLI contract', () => {
  test('parses the explicit presentation flag and rejects incompatible output paths and modes', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--deep', '--browse']), {
      action: 'lookup', query: 'example.test', output: 'terminal', deep: true, detail: 'standard', strictExit: false,
      events: false, plan: false, includeAttribution: true, observerLabel: null, vantageLabel: null,
      quiet: false, color: true, browse: true,
    });
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--browse', '--json']), /terminal output/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--browse', '--verbose']), /cannot be combined/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--browse', '--output', 'result.txt']), /interactive terminal/u);
  });

  test('fails browser preflight before collection and reserves interactive stdin for navigation', async () => {
    let collected = 0;
    const stderr = capture();
    const unsupported = await runCli(['lookup', 'example.test', '--browse'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      canBrowseLookup: () => false,
      runUnifiedLookup: async () => { collected += 1; return lookupDocument(); },
    });
    assert.equal(unsupported, EXIT_CODES.USAGE);
    assert.equal(collected, 0);
    assert.match(stderr.value(), /interactive terminal input and output/u);

    const missing = await runCli(['lookup', '--browse'], {
      stdout: capture().stream,
      stderr: capture().stream,
      canBrowseLookup: () => true,
      runUnifiedLookup: async () => { collected += 1; return lookupDocument(); },
    });
    assert.equal(missing, EXIT_CODES.USAGE);
    assert.equal(collected, 0);
  });

  test('collects once, passes the exact document to the browser, and keeps ordinary stdout empty', async () => {
    const stdout = capture();
    let collected = 0;
    let browsed = 0;
    const code = await runCli(['lookup', 'example.test', '--deep', '--browse'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      canBrowseLookup: () => true,
      runUnifiedLookup: async () => { collected += 1; return lookupDocument(); },
      browseLookupOperation: async (options) => {
        browsed += 1;
        const document = await options.collect!({
          signal: new AbortController().signal,
          onSourceSettled: () => undefined,
        });
        assert.equal(document.schema, 'whoisleuth.cli.lookup');
        assert.equal(document.query, 'example.test');
        assert.equal(document.mode, 'deep');
        return document;
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(collected, 1);
    assert.equal(browsed, 1);
    assert.equal(stdout.value(), '');
  });

  test('reports abort plus terminal-cleanup failure as an operational failure', async () => {
    const controller = new AbortController();
    const stderr = capture();
    const code = await runCli(['lookup', 'example.test', '--browse'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      signal: controller.signal,
      canBrowseLookup: () => true,
      runUnifiedLookup: async () => lookupDocument(),
      browseLookupOperation: async () => {
        controller.abort();
        throw new AggregateError(
          [new DOMException('Aborted', 'AbortError'), new Error('fixture terminal cleanup failed')],
          'Aborted; terminal cleanup also failed: fixture terminal cleanup failed',
        );
      },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /terminal cleanup also failed/u);
    assert.doesNotMatch(stderr.value(), /^Cancelled by analyst\.$/mu);
  });

  test('passes the selected palette and writes the exact completed document only after browser cleanup', async () => {
    const stderr = capture();
    const events: string[] = [];
    let savedPath = '';
    let savedContent = '';
    const code = await runCli([
      'lookup', 'example.test', '--deep', '--browse', '--palette', 'light', '--save-lookup', 'fixture-review.json',
    ], {
      stdout: capture().stream,
      stderr: stderr.stream,
      canBrowseLookup: () => true,
      runUnifiedLookup: async () => lookupDocument(),
      browseLookupOperation: async (options) => {
        assert.equal(options.palette, 'light');
        events.push('browser-start');
        const document = await options.collect!({
          signal: new AbortController().signal,
          onSourceSettled: () => undefined,
        });
        events.push('browser-closed');
        return document;
      },
      writePrivateFile: async (path, content, options) => {
        events.push('saved');
        savedPath = String(path);
        savedContent = content;
        assert.match(options?.existingFileMessage || '', /already exists/u);
        return savedPath;
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(events, ['browser-start', 'browser-closed', 'saved']);
    assert.equal(savedPath, 'fixture-review.json');
    const saved = JSON.parse(savedContent);
    assert.equal(saved.schema, 'whoisleuth.cli.lookup');
    assert.equal(saved.query, 'example.test');
    assert.equal(saved.mode, 'deep');
    assert.match(stderr.value(), /Saved the completed private Lookup JSON/u);
    assert.match(stderr.value(), /raw public registry and WHOIS responses.*review it before sharing/u);
  });
});
