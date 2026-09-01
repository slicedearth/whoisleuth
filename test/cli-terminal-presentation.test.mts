import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import EXIT_CODES from '../cli/exit-codes.mts';
import {
  appendDeliveryMetadataLines,
  appendPublicationMetadataLines,
} from '../cli/formatters/terminal-metadata.mts';
import { createTerminalProgress, safeProgressMessage } from '../cli/progress.mts';
import { runCli } from '../cli/runner.mts';
import {
  HTTP_DELIVERY_LIMITATIONS,
  PAGE_PUBLICATION_LIMITATIONS,
} from '../lib/homepage-metadata-contract.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  wrapTerminalOutput,
  type WritableTerminal,
} from '../cli/terminal-presentation.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

function captureTerminal({ isTTY = true, columns = 52 }: { isTTY?: boolean; columns?: number } = {}) {
  let value = '';
  const stream: WritableTerminal = {
    isTTY,
    columns,
    write(chunk) {
      value += chunk;
    },
  };
  return { stream, value: () => value };
}

describe('CLI terminal presentation', () => {
  test('enables semantic colour and bounded wrapping only for an interactive terminal', () => {
    const output = captureTerminal({ columns: 48 });
    const presentation = terminalPresentation(output.stream, true, { TERM: 'xterm-256color' });
    assert.deepEqual(presentation, { color: true, interactive: true, palette: 'auto', width: 48 });

    const rendered = presentTerminalOutput(
      'Target:\nAvailability   Success\nAccess note    This deliberately long source limitation wraps at a word boundary.\n',
      presentation,
    );
    assert.match(rendered, /\u001b\[/u);
    const plain = rendered.replace(/\u001b\[[0-9;]*m/gu, '');
    assert.ok(plain.split('\n').filter(Boolean).every((line) => line.length <= 48));
    assert.match(plain, /Target:/u);
    assert.match(plain, /Success/u);
  });

  test('keeps redirected output plain and byte-shaped without terminal wrapping', () => {
    const output = captureTerminal({ isTTY: false, columns: 20 });
    const presentation = terminalPresentation(output.stream, true, { TERM: 'xterm-256color' });
    const source = 'Detail         This line remains unchanged when output is redirected.\n';
    assert.deepEqual(presentation, { color: false, interactive: false, palette: 'auto', width: null });
    assert.equal(presentTerminalOutput(source, presentation), source);
  });

  test('respects explicit and conventional colour opt-outs', () => {
    const output = captureTerminal();
    assert.equal(terminalPresentation(output.stream, false, { TERM: 'xterm' }).color, false);
    assert.equal(terminalPresentation(output.stream, true, { TERM: 'xterm', NO_COLOR: '1' }).color, false);
    assert.equal(terminalPresentation(output.stream, true, { TERM: 'xterm', NO_COLOR: '' }).color, true);
    assert.equal(terminalPresentation(output.stream, true, { TERM: 'dumb' }).interactive, false);
  });

  test('uses explicit light and dark palettes without changing colour eligibility', () => {
    const output = captureTerminal();
    const light = terminalPresentation(output.stream, true, { TERM: 'xterm' }, 'light');
    const dark = terminalPresentation(output.stream, true, { TERM: 'xterm' }, 'dark');
    assert.equal(light.palette, 'light');
    assert.equal(dark.palette, 'dark');
    assert.match(presentTerminalOutput('Target:\n', light), /\u001b\[1;34m/u);
    assert.match(presentTerminalOutput('Target:\n', dark), /\u001b\[1;96m/u);

    const redirected = captureTerminal({ isTTY: false });
    const plain = terminalPresentation(redirected.stream, true, { TERM: 'xterm' }, 'dark');
    assert.equal(plain.palette, 'dark');
    assert.equal(plain.color, false);
    assert.equal(presentTerminalOutput('Target:\n', plain), 'Target:\n');
  });

  test('preserves long unbroken evidence values instead of silently truncating them', () => {
    const token = 'x'.repeat(70);
    assert.equal(wrapTerminalOutput(`Value          ${token}\n`, 40), `Value          ${token}\n`);
  });

  test('keeps command examples copyable at the narrow terminal floor', () => {
    const command = '  cat domains.txt | whoisleuth bulk --jsonl';
    assert.equal(wrapTerminalOutput(`${command}\n`, 40), `${command}\n`);
  });
});

describe('CLI homepage metadata presentation', () => {
  test('renders publication summaries and keeps absent declarations explicit', () => {
    const observed: string[] = [];
    appendPublicationMetadataLines(observed, pagePublicationMetadataFixture(), 'standard');
    assert.deepEqual(observed, [
      'Publication    Complete · robots Observed · card Observed',
      'Robots         follow, index',
      'Card type      summary_large_image',
      'Static page    headings 2 · images 2 · blocking candidates 2',
    ]);

    const absent = pagePublicationMetadataFixture();
    absent.robots = {
      status: 'not_observed', complete: true, truncated: false, directives: [],
      recognizedDirectiveCount: 0, unknownDirectiveCount: 0, conflicting: false,
    };
    const absentLines: string[] = [];
    appendPublicationMetadataLines(absentLines, absent, 'standard');
    assert.match(absentLines.join('\n'), /No declaration observed in captured static HTML/u);

    const ignored: string[] = [];
    appendPublicationMetadataLines(ignored, observed, 'verbose');
    appendPublicationMetadataLines(ignored, pagePublicationMetadataFixture(), 'summary');
    assert.deepEqual(ignored, []);
  });

  test('renders verbose partial publication counts without weakening validation', () => {
    const complete = pagePublicationMetadataFixture();
    const partial = {
      ...complete,
      status: 'partial',
      complete: false,
      truncated: true,
      limitations: [
        PAGE_PUBLICATION_LIMITATIONS.scope,
        PAGE_PUBLICATION_LIMITATIONS.bounds,
      ],
      robots: {
        ...complete.robots,
        status: 'partial',
        complete: false,
        truncated: true,
      },
    };
    const lines: string[] = [];
    appendPublicationMetadataLines(lines, partial, 'verbose');
    assert.match(lines.join('\n'), /Publication\s+Partial/u);
    assert.match(lines.join('\n'), /Image alt\s+missing 1 · empty 0 · non-empty 1 · unclassified 0/u);
    assert.match(lines.join('\n'), /Blocking\s+scripts 1 · stylesheets 1 · static candidates only/u);
  });

  test('renders delivery declarations and distinguishes absent validators', () => {
    const observed: string[] = [];
    appendDeliveryMetadataLines(observed, httpDeliveryMetadataFixture(), true);
    assert.match(observed.join('\n'), /Delivery\s+Complete · encoding Observed · cache Observed/u);
    assert.match(observed.join('\n'), /Content coding\s+br, gzip/u);
    assert.match(observed.join('\n'), /Cache policy\s+public, immutable/u);
    assert.match(observed.join('\n'), /Validators\s+ETag, Last-Modified/u);

    const absent = {
      ...httpDeliveryMetadataFixture(),
      contentEncoding: { status: 'not_observed', codings: [], encoded: null, unknownCodingCount: 0 },
      cachePolicy: {
        status: 'not_observed',
        noStore: false, noCache: false, mustRevalidate: false, public: false, private: false, immutable: false,
        maxAgeSeconds: null, sMaxAgeSeconds: null, ageSeconds: null,
        maxAgePresent: false, sMaxAgePresent: false, agePresent: false, unknownDirectiveCount: 0,
        etag: { present: false, valid: null },
        lastModified: { present: false, valid: null },
        expires: { present: false, valid: null },
      },
    };
    const absentLines: string[] = [];
    appendDeliveryMetadataLines(absentLines, absent, true);
    assert.deepEqual(absentLines, [
      'Delivery       Complete · encoding Not observed · cache Not observed',
      'Validators     No validator declaration observed',
    ]);

    const ignored: string[] = [];
    appendDeliveryMetadataLines(ignored, null, true);
    assert.deepEqual(ignored, []);
  });

  test('renders partial delivery state without inventing absent coding evidence', () => {
    const partial = {
      ...httpDeliveryMetadataFixture(),
      status: 'partial',
      complete: false,
      truncated: true,
      limitations: [
        HTTP_DELIVERY_LIMITATIONS.scope,
        HTTP_DELIVERY_LIMITATIONS.bounds,
      ],
      contentEncoding: { status: 'partial', codings: [], encoded: null, unknownCodingCount: 0 },
    };
    const lines: string[] = [];
    appendDeliveryMetadataLines(lines, partial);
    assert.deepEqual(lines, [
      'Delivery       Partial · encoding Partial · cache Observed',
      'Cache policy   public, immutable',
    ]);
  });
});

describe('CLI progress presentation', () => {
  test('writes transient bounded status only to an enabled interactive stream', () => {
    const output = captureTerminal();
    const progress = createTerminalProgress(output.stream, {
      enabled: true,
      color: false,
      environment: { TERM: 'xterm' },
      now: () => 1_000,
    });
    progress.start('Collecting\nsource evidence');
    progress.update('Collected one source');
    progress.stop();
    assert.equal(progress.enabled, true);
    assert.match(output.value(), /Collecting source evidence/u);
    assert.match(output.value(), /Collected one source/u);
    assert.ok(output.value().endsWith('\r\u001b[2K'));
  });

  test('stays silent for pipes and sanitizes messages independently', () => {
    const output = captureTerminal({ isTTY: false });
    const progress = createTerminalProgress(output.stream, {
      enabled: true,
      color: true,
      environment: { TERM: 'xterm' },
    });
    progress.start('Should remain hidden');
    progress.stop();
    assert.equal(progress.enabled, false);
    assert.equal(output.value(), '');
    assert.equal(safeProgressMessage('  hello\nworld\u0000  '), 'hello world');
  });

  test('runner emits progress for deep terminal collection but not JSON', async () => {
    const terminalStdout = captureTerminal();
    const terminalStderr = captureTerminal();
    const runUnifiedLookup = async (_classified: ClassifiedQuery, options: {
      fast?: boolean;
      compact?: boolean;
      onSourceSettled?: (value: LookupSourceSettlement) => void;
    } = {}) => {
      options.onSourceSettled?.({
        source: 'rdap',
        state: 'success',
        complete: true,
        truncated: false,
        fragment: { status: 'success' },
      });
      return {
        availability: { applicable: false },
        rdap: { parsed: {} },
        whois: { parsed: {} },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'success' } },
      };
    };
    const code = await runCli(['lookup', 'AS65536', '--deep', '--no-color'], {
      stdout: terminalStdout.stream,
      stderr: terminalStderr.stream,
      environment: { TERM: 'xterm' },
      classifyQuery: () => ({ type: 'asn', value: 'AS65536' }),
      runUnifiedLookup,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(terminalStderr.value(), /Collected 1 source · rdap success/u);
    assert.doesNotMatch(terminalStdout.value(), /\u001b\[/u);

    const jsonStdout = captureTerminal();
    const jsonStderr = captureTerminal();
    assert.equal(await runCli(['lookup', 'AS65536', '--deep', '--json'], {
      stdout: jsonStdout.stream,
      stderr: jsonStderr.stream,
      environment: { TERM: 'xterm' },
      classifyQuery: () => ({ type: 'asn', value: 'AS65536' }),
      runUnifiedLookup,
    }), EXIT_CODES.SUCCESS);
    assert.equal(jsonStderr.value(), '');
    assert.doesNotMatch(jsonStdout.value(), /\u001b\[/u);
    assert.equal(JSON.parse(jsonStdout.value()).schema, 'whoisleuth.cli.lookup');
  });
});
