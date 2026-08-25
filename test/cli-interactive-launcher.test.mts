import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_INTERACTIVE_ANSWER_BYTES,
  MAX_INTERACTIVE_ANSWER_SCALARS,
  boundedInteractiveAnswer,
  canLaunchInteractiveCli,
  launchInteractiveCli,
  readBoundedInteractiveLine,
} from '../cli/interactive-launcher.mts';

class LauncherInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;
  setRawMode(value: boolean) { this.isRaw = value; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
  isPaused() { return this.paused; }
}

class LauncherOutput extends EventEmitter {
  isTTY = true;
  columns = 92;
  rows = 24;
  value = '';
  write(chunk: string) { this.value += chunk; return true; }
}

function launcherFixture() {
  return { input: new LauncherInput(), output: new LauncherOutput() };
}

function questionAnswers(values: readonly string[]) {
  let index = 0;
  return async () => values[index++] || '';
}

describe('interactive CLI launcher', () => {
  test('requires the complete evidence-browser terminal capability boundary', () => {
    const { input, output } = launcherFixture();
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm-256color' }), true);

    input.isTTY = false;
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm-256color' }), false);
    input.isTTY = true;
    output.isTTY = false;
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm-256color' }), false);
    output.isTTY = true;
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'dumb' }), false);
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm', CI: '1' }), false);
    output.columns = 39;
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm' }), false);
    output.columns = 92;
    output.rows = 11;
    assert.equal(canLaunchInteractiveCli(input, output, { TERM: 'xterm' }), false);
  });

  test('returns ordinary explicit argv for confirmed Fast and Deep lookups', async () => {
    const fast = launcherFixture();
    assert.deepEqual(await launchInteractiveCli({
      ...fast,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['1', 'example.test', 'y']),
    }), ['lookup', 'example.test', '--fast', '--browse']);
    assert.match(fast.output.value, /Fast Lookup/u);
    assert.match(fast.output.value, /normalised target is sent/u);
    assert.match(fast.output.value, /Network requests made: no/u);
    assert.match(fast.output.value, /Collection requires network: yes/u);

    const deep = launcherFixture();
    assert.deepEqual(await launchInteractiveCli({
      ...deep,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['2', 'example.test', 'yes']),
    }), ['lookup', 'example.test', '--deep', '--browse']);
    assert.match(deep.output.value, /Deep Lookup/u);
    assert.match(deep.output.value, /bounded DNS, HTTP, TLS/u);
    assert.match(deep.output.value, /Collection requires network: yes/u);
  });

  test('keeps commands and workflow planning offline and defaults collection confirmation to no', async () => {
    const commands = launcherFixture();
    assert.deepEqual(await launchInteractiveCli({
      ...commands,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['4']),
    }), ['commands']);

    const workflow = launcherFixture();
    assert.deepEqual(await launchInteractiveCli({
      ...workflow,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['3', '1', 'example.test']),
    }), ['workflow-plan', 'domain-triage', 'example.test']);

    const cancelled = launcherFixture();
    assert.equal(await launchInteractiveCli({
      ...cancelled,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['1', 'example.test', '']),
    }), null);
  });

  test('rejects ambiguous targets, invalid selections, controls, and over-bound answers', async () => {
    const ambiguous = launcherFixture();
    await assert.rejects(launchInteractiveCli({
      ...ambiguous,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['1', 'report.json']),
    }), /unambiguous domain/u);

    const invalid = launcherFixture();
    await assert.rejects(launchInteractiveCli({
      ...invalid,
      environment: { TERM: 'xterm' },
      question: questionAnswers(['9']),
    }), /Choose 1, 2, 3, 4, or q/u);

    assert.throws(() => boundedInteractiveAnswer('safe\u202eunsafe'), /bounded text/u);
    assert.throws(() => boundedInteractiveAnswer('safe\u009bunsafe'), /bounded text/u);
    for (const character of ['\u00ad', '\u034f', '\u180e', '\u200d', '\u2060', '\ufe0f']) {
      assert.throws(() => boundedInteractiveAnswer(`safe${character}unsafe`), /bounded text/u);
    }
    assert.throws(
      () => boundedInteractiveAnswer('界'.repeat(Math.floor(MAX_INTERACTIVE_ANSWER_BYTES / 3) + 2)),
      /bounded text/u,
    );
    assert.throws(
      () => boundedInteractiveAnswer('x'.repeat(MAX_INTERACTIVE_ANSWER_SCALARS + 1)),
      /bounded text/u,
    );
  });

  test('reads one bounded raw line and restores raw, paused, and listener state', async () => {
    const { input, output } = launcherFixture();
    const reading = readBoundedInteractiveLine('Target: ', { input, output });
    assert.equal(input.isRaw, true);
    assert.equal(input.paused, false);
    input.emit('data', 'example.tesx');
    input.emit('data', '\u007ft\r');
    assert.equal(await reading, 'example.test');
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('end'), 0);
    assert.equal(output.value, 'Target: example.tesx\b \bt\n');
  });

  test('decodes UTF-8 scalars split across terminal chunks and rejects malformed sequences', async () => {
    for (const character of ['é', '界', '😀']) {
      const { input, output } = launcherFixture();
      const reading = readBoundedInteractiveLine('Value: ', { input, output });
      const encoded = Buffer.from(character);
      for (const byte of encoded) input.emit('data', Buffer.from([byte]));
      input.emit('data', Buffer.from('\r'));
      assert.equal(await reading, character);
      assert.equal(output.value, `Value: ${character}\n`);
    }

    const malformed = launcherFixture();
    const reading = readBoundedInteractiveLine('Value: ', malformed);
    malformed.input.emit('data', Buffer.from([0xe7]));
    malformed.input.emit('data', Buffer.from('\r'));
    await assert.rejects(reading, /bounded text without control characters/u);
    assert.equal(malformed.input.listenerCount('data'), 0);

    const c1Control = launcherFixture();
    const rejected = readBoundedInteractiveLine('Value: ', c1Control);
    c1Control.input.emit('data', Buffer.from('\u009b'));
    await assert.rejects(rejected, /bounded text without control characters/u);
    assert.equal(c1Control.output.value, 'Value: ');

    const defaultIgnorable = launcherFixture();
    const defaultIgnorableReading = readBoundedInteractiveLine('Value: ', defaultIgnorable);
    defaultIgnorable.input.emit('data', Buffer.from('\u00ad'));
    await assert.rejects(defaultIgnorableReading, /bounded text without control characters/u);
    assert.equal(defaultIgnorable.output.value, 'Value: ');
  });

  test('aborts without retaining partial input and still restores terminal state', async () => {
    const { input, output } = launcherFixture();
    const reading = readBoundedInteractiveLine('Target: ', { input, output });
    input.emit('data', 'partial');
    input.emit('data', '\u0003');
    await assert.rejects(reading, { name: 'AbortError' });
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('end'), 0);
  });

  test('settles with both the original failure and a terminal cleanup failure', async () => {
    const { input, output } = launcherFixture();
    const originalSetRawMode = input.setRawMode.bind(input);
    input.setRawMode = (enabled: boolean) => {
      if (!enabled) throw new Error('fixture raw restore failure');
      originalSetRawMode(enabled);
    };
    const reading = readBoundedInteractiveLine('Target: ', { input, output });
    input.emit('data', '\u0003');
    await assert.rejects(reading, /Aborted; terminal cleanup also failed: fixture raw restore failure/u);
    assert.equal(input.listenerCount('data'), 0);
    assert.equal(input.listenerCount('end'), 0);
  });

  test('attaches listeners before resume can flush buffered input', async () => {
    const { input, output } = launcherFixture();
    input.resume = () => {
      input.paused = false;
      input.emit('data', Buffer.from('ready\r'));
    };
    assert.equal(await readBoundedInteractiveLine('Value: ', { input, output }), 'ready');
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('restores state when the signal aborts during raw-mode setup', async () => {
    const { input, output } = launcherFixture();
    const controller = new AbortController();
    const originalSetRawMode = input.setRawMode.bind(input);
    input.setRawMode = (enabled: boolean) => {
      originalSetRawMode(enabled);
      if (enabled) controller.abort();
    };
    await assert.rejects(readBoundedInteractiveLine('Value: ', {
      input, output, signal: controller.signal,
    }), { name: 'AbortError' });
    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.equal(input.listenerCount('data'), 0);
  });

  test('rejects an over-bound chunk before decoding or echoing it', async () => {
    const { input, output } = launcherFixture();
    const reading = readBoundedInteractiveLine('Value: ', { input, output });
    input.emit('data', Buffer.alloc(MAX_INTERACTIVE_ANSWER_BYTES + 1, 0x61));
    await assert.rejects(reading, /bounded text without control characters/u);
    assert.equal(output.value, 'Value: ');
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('data'), 0);
  });
});
