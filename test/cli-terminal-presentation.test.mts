import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import EXIT_CODES from '../cli/exit-codes.mts';
import { createTerminalProgress, safeProgressMessage } from '../cli/progress.mts';
import { runCli } from '../cli/runner.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  wrapTerminalOutput,
  type WritableTerminal,
} from '../cli/terminal-presentation.mts';

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
    assert.deepEqual(presentation, { color: true, interactive: true, width: 48 });

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
    assert.deepEqual(presentation, { color: false, interactive: false, width: null });
    assert.equal(presentTerminalOutput(source, presentation), source);
  });

  test('respects explicit and conventional colour opt-outs', () => {
    const output = captureTerminal();
    assert.equal(terminalPresentation(output.stream, false, { TERM: 'xterm' }).color, false);
    assert.equal(terminalPresentation(output.stream, true, { TERM: 'xterm', NO_COLOR: '1' }).color, false);
    assert.equal(terminalPresentation(output.stream, true, { TERM: 'dumb' }).interactive, false);
  });

  test('preserves long unbroken evidence values instead of silently truncating them', () => {
    const token = 'x'.repeat(70);
    assert.equal(wrapTerminalOutput(`Value          ${token}\n`, 40), `Value          ${token}\n`);
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
