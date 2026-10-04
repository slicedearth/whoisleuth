import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import {
  createIndicatorIntake,
  intakeIndicators,
  intakeIndicatorSource,
  MAX_INTAKE_INDICATOR_TEXT,
} from '../packages/investigation/intake-indicators.mts';
import {
  readIntakeDistributionContext,
  withIntakeDistributionContext,
  validateIntakeExtensions,
  parseIntakeContextInput,
  INTAKE_CONTEXT_SCHEMA,
} from '../packages/investigation/intake-context.mts';
import { createDocumentIntake } from '../packages/investigation/document-intake.mts';
import { messageCaseEvidence } from '../packages/investigation/message-case-evidence.mts';
import {
  MAX_INTAKE_INDICATORS,
  MAX_INTAKE_INDICATOR_CANDIDATES,
  type LegacyMessageIntakeReport,
  type CurrentMessageIntakeReport,
} from '../packages/contracts/message-intake.mts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';
import { formatMessageIntake, runIntakeCommand } from '../cli/intake-command.mts';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import type { CliCommandContext } from '../cli/runner-types.mts';

const NOW = '2026-01-02T03:04:05.000Z',
  bytes = (value: string) => new TextEncoder().encode(value);
const supplied = {
  channel: 'sms',
  observedAt: NOW,
  sourceLabel: 'Reported message',
  reference: 'CASE-17',
  observerLabel: 'Reviewer A',
  vantageLabel: 'Selected device',
} as const;
const contextInput = { schema: INTAKE_CONTEXT_SCHEMA, version: 1, context: supplied };

test('literal IP and explicitly labelled hash observations retain exact source linkage without new targets', async () => {
  const input =
    '192.0.2.17 [2001:0db8:0:0::17] 10.0.0.1\nSHA-256: ' +
    'A'.repeat(64) +
    '\nmd5=' +
    'b'.repeat(32) +
    '\nsha1 ' +
    'C'.repeat(40);
  const result = await reviewMessageInput(bytes(input), 'text', NOW);
  assert.deepEqual(
    intakeIndicators(result.report).map((item) => [item.kind, item.value]),
    [
      ['sha256', 'a'.repeat(64)],
      ['md5', 'b'.repeat(32)],
      ['sha1', 'c'.repeat(40)],
      ['ipv4', '192.0.2.17'],
      ['ipv6', '2001:db8::17'],
      ['ipv4', '10.0.0.1'],
    ],
  );
  for (const indicator of intakeIndicators(result.report)) {
    assert.deepEqual(indicator.location, { partId: 'input', page: null });
    assert.equal(
      intakeIndicatorSource(result.report, indicator),
      result.report.source.digestSha256,
    );
  }
  assert.deepEqual(result.targets, []);
  validateIntakeExtensions(result.report);
});

test('separate message and document parts remain separate observations, with no body retained', async () => {
  const source =
    'Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\n192.0.2.17\r\n--x\r\nContent-Type: message/rfc822\r\n\r\nFrom: private@source.example\r\n\r\n192.0.2.17\r\n--x--';
  const { report } = await reviewMessageInput(bytes(source), 'email', NOW);
  assert.deepEqual(
    intakeIndicators(report).map((item) => item.location.partId),
    ['message-1', 'message-2'],
  );
  assert.notEqual(
    intakeIndicatorSource(report, intakeIndicators(report)[0]!),
    intakeIndicatorSource(report, intakeIndicators(report)[1]!),
  );
  assert.doesNotMatch(JSON.stringify(report), /private@|Content-Type|boundary=x/u);
  const document = await createDocumentIntake(bytes('selected document'), 'pdf', NOW);
  await document.text('192.0.2.17', 1);
  await document.text('192.0.2.17', 2);
  const selected = document.finish().report;
  assert.deepEqual(
    intakeIndicators(selected).map((item) => item.location),
    [
      { partId: 'part-1', page: 1 },
      { partId: 'part-2', page: 2 },
    ],
  );
  validateIntakeExtensions(selected);
});

test('sensitive URL, address and credential material is removed before indicator extraction', async () => {
  const secret = 'd'.repeat(64);
  const input = [
    `https://192.0.2.90/${secret}?hash=SHA256:${secret}`,
    `hxxps[:]//example[.]test/?v=192.0.2.91#sha256:${secret}`,
    `Authorization: SHA256:${secret} 192.0.2.92`,
    `token=${secret} 192.0.2.93`,
    `${secret}@example.test`,
    secret,
    '<script>192.0.2.94 SHA256:' + secret + '</script>',
    '<p>192.0.2.17</p>',
  ].join('\n');
  const { report } = await reviewMessageInput(
    bytes(`Content-Type: text/html\r\n\r\n${input}`),
    'email',
    NOW,
  );
  const indicators = JSON.stringify(intakeIndicators(report));
  for (const value of [secret, ...[90, 91, 92, 93, 94].map((n) => `192.0.2.${n}`)])
    assert.equal(indicators.includes(value), false, value);
  assert.equal(indicators.includes('192.0.2.17'), true);
});

test('indicator bounds stop accumulation and mark independent partial coverage', () => {
  const intake = createIndicatorIntake();
  intake.addText(
    Array.from(
      { length: MAX_INTAKE_INDICATORS + 1 },
      (_, n) => `192.0.${Math.floor(n / 256)}.${n % 256}`,
    ).join(' '),
    'text',
    { partId: 'input', page: null },
  );
  assert.equal(intake.result().indicators.length, MAX_INTAKE_INDICATORS);
  assert.equal(intake.result().indicatorCoverage.state, 'partial');
  const work = createIndicatorIntake();
  work.addText('not.address '.repeat(MAX_INTAKE_INDICATOR_CANDIDATES + 1), 'text', {
    partId: 'input',
    page: null,
  });
  assert.equal(work.result().indicatorCoverage.candidatesReviewed, MAX_INTAKE_INDICATOR_CANDIDATES);
  assert.equal(work.result().indicatorCoverage.state, 'partial');
  const text = createIndicatorIntake();
  text.addText('x'.repeat(MAX_INTAKE_INDICATOR_TEXT + 1), 'text', { partId: 'input', page: null });
  assert.equal(text.result().indicatorCoverage.state, 'partial');
  assert.deepEqual(text.result().indicators, []);
  const punctuation = createIndicatorIntake();
  punctuation.addText('a-'.repeat(100_000), 'text', { partId: 'input', page: null });
  assert.deepEqual(punctuation.result().indicators, []);
});

test('opaque and protocol-relative URI spans cannot leak nested indicators while literal IPv6 and hash labels remain readable', () => {
  const hash = 'e'.repeat(64),
    intake = createIndicatorIntake();
  intake.addText(
    [
      'data:text/plain,192.0.2.90',
      `(urn:sha256:${hash})`,
      'custom+scheme:body,192.0.2.91',
      '//example.test/value,192.0.2.92',
      'https[:]//example[.]test/value,192.0.2.93',
      `value=urn:sha256:${hash}`,
      'value=data:text/plain,192.0.2.94',
      'field=(custom+scheme:body,192.0.2.95)',
      'fe80::17 [fd00::18] [2001:db8::19] 192.0.2.17',
      `SHA256:${'a'.repeat(64)}`,
    ].join('\n'),
    'text',
    { partId: 'input', page: null },
  );
  assert.deepEqual(
    intake.result().indicators.map((item) => [item.kind, item.value]),
    [
      ['sha256', 'a'.repeat(64)],
      ['ipv6', 'fe80::17'],
      ['ipv6', 'fd00::18'],
      ['ipv6', '2001:db8::19'],
      ['ipv4', '192.0.2.17'],
    ],
  );
  assert.equal(intake.result().indicatorCoverage.state, 'reviewed');
});

test('HTML inline markup preserves credential context without suppressing ordinary observations', async () => {
  const secret = 'd'.repeat(64), observed = 'a'.repeat(64);
  const html = `<div>Authorization: <b>SHA256:${secret}</b></div>
    <p>API <span>key</span> = <strong>192.0.2.90</strong></p>
    <p>Cookie:<br><span>SHA256:${secret}</span></p>
    <p>Pass<span>word</span>: <i>192.0.2.91</i></p>
    <script>192.0.2.92</script><style>SHA256:${secret}</style>
    <p>SHA256:<strong>${observed}</strong> 192.0.2.17</p>`;
  const { report } = await reviewMessageInput(bytes(`Content-Type: text/html\r\n\r\n${html}`), 'email', NOW);
  assert.deepEqual(intakeIndicators(report).map(({ kind, value }) => [kind, value]), [
    ['sha256', observed], ['ipv4', '192.0.2.17'],
  ]);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret, 'u'));
  const oversized = await reviewMessageInput(bytes(`Content-Type: text/html\r\n\r\n<p>${'x'.repeat(MAX_INTAKE_INDICATOR_TEXT + 1)}</p>`), 'email', NOW);
  assert.equal(oversized.report.schemaVersion, 2);
  assert.equal((oversized.report as CurrentMessageIntakeReport).indicatorCoverage.state, 'partial');
  assert.deepEqual(intakeIndicators(oversized.report), []);
});

test('historical v1 reports remain readable without invented indicator coverage or declarations', async () => {
  const current = (await reviewMessageInput(bytes('https://example.test/'), 'text', NOW)).report;
  if (current.schemaVersion !== 2) throw new Error('Expected current report');
  const {
    indicators: _indicators,
    indicatorCoverage: _coverage,
    distributionContext: _context,
    ...fields
  } = current;
  const legacy: LegacyMessageIntakeReport = { ...fields, schemaVersion: 1 };
  const frozen = JSON.stringify(legacy);
  validateIntakeExtensions(legacy);
  assert.deepEqual(intakeIndicators(legacy), []);
  assert.doesNotMatch(formatMessageIntake(legacy), /Indicator coverage|declared distribution/u);
  assert.doesNotMatch(
    messageCaseEvidence(legacy, `sha256:${'a'.repeat(64)}`).summary,
    /indicators|distribution/u,
  );
  assert.throws(() => withIntakeDistributionContext(legacy, supplied), /Historical/u);
  assert.equal(JSON.stringify(legacy), frozen);
  assert.throws(
    () =>
      validateIntakeExtensions({
        ...legacy,
        indicators: [],
      } as unknown as LegacyMessageIntakeReport),
    /Version-1/u,
  );
});

test('versioned worker additions reject invented source linkage and scans of sensitive input families', async () => {
  const report = (await reviewMessageInput(bytes('192.0.2.17'), 'text', NOW))
    .report as CurrentMessageIntakeReport;
  const first = report.indicators[0]!;
  for (const source of ['document_text', 'calendar'] as const)
    assert.throws(
      () => validateIntakeExtensions({ ...report, indicators: [{ ...first, source }] }),
      /source kind/u,
    );
  assert.throws(
    () =>
      validateIntakeExtensions({
        ...report,
        indicatorCoverage: { state: 'not_reviewed', candidatesReviewed: 1 },
      }),
    /coverage/u,
  );
  for (const kind of ['identity', 'har', 'qr'] as const)
    assert.throws(() =>
      validateIntakeExtensions({ ...report, source: { ...report.source, kind } }),
    );
  const document = await createDocumentIntake(bytes('selected document'), 'pdf', NOW);
  await document.text('192.0.2.17', 1);
  const selected = document.finish().report as CurrentMessageIntakeReport;
  assert.throws(
    () =>
      validateIntakeExtensions({
        ...selected,
        documentReview: {
          ...selected.documentReview!,
          parts: selected.documentReview!.parts.map((part) => ({ ...part, kind: 'links' })),
        },
      }),
    /source kind/u,
  );
  assert.throws(
    () =>
      validateIntakeExtensions({
        ...report,
        indicators: [{ ...first, extra: 'unadmitted' }],
      } as unknown as CurrentMessageIntakeReport),
    /structure/u,
  );
});

test('distribution declarations require exact fields, bounded labels and explicit source time', async () => {
  assert.deepEqual(parseIntakeContextInput(JSON.stringify(contextInput)), supplied);
  for (const context of [
    { ...supplied, observedAt: '2026-01-02' },
    { ...supplied, sourceLabel: 'person@example.test' },
    { ...supplied, reference: 'https://example.test/private?token=value' },
    { ...supplied, channel: 'inferred' },
    { ...supplied, extra: true },
  ])
    assert.throws(() => readIntakeDistributionContext(context));
  assert.throws(
    () => parseIntakeContextInput(JSON.stringify({ ...contextInput, version: 2 })),
    /Unsupported/u,
  );
  assert.throws(() => parseIntakeContextInput('{"schema":"a","schema":"b"}'), /duplicate/iu);
  const base = (await reviewMessageInput(bytes('192.0.2.17'), 'text', NOW)).report;
  const report = withIntakeDistributionContext(base, supplied);
  assert.equal(base.schemaVersion === 2 && base.distributionContext, null);
  validateIntakeExtensions(report);
  assert.match(formatMessageIntake(report), /supplied claims.*not verified/u);
  const summary = messageCaseEvidence(report, `sha256:${'a'.repeat(64)}`);
  assert.doesNotMatch(JSON.stringify(summary), /192\.0\.2\.17|CASE-17|Reviewer A|Selected device/u);
  assert.match(summary.summary, /separately declared distribution context/u);
});

test('browser and CLI extraction agree and no network capability is invoked', async () => {
  const input = '192.0.2.17 SHA256:' + 'a'.repeat(64);
  const direct = await reviewMessageInput(bytes(input), 'text', NOW);
  assert.deepEqual(
    await runMessageIntakeOperation({ kind: 'text', file: new Blob([input]), reviewedAt: NOW }),
    { kind: 'review', result: direct },
  );
  let output = '',
    requests = 0;
  const status = await runCli(['intake', 'text', '--json'], {
    stdin: Readable.from([input]),
    stdout: {
      write: (value: string) => {
        output += value;
      },
    },
    stderr: { write: () => {} },
    now: () => NOW,
    runUnifiedLookup: async () => {
      requests++;
      throw new Error('No collection');
    },
  });
  assert.equal(status, 0);
  assert.equal(requests, 0);
  assert.deepEqual(JSON.parse(output), direct.report);
});

test('CLI distribution input is explicit, bounded and separate from selected message bytes', async () => {
  const args = parseCliArguments([
    'intake',
    'text',
    'selected.txt',
    '--intake-context',
    'context.json',
    '--json',
  ]);
  if (args.action !== 'intake') throw new Error('Wrong command');
  let output = '',
    readContext = 0;
  const context = {
    setFailureLabel() {},
    now: () => NOW,
    writeStdout: (value: string) => {
      output += value;
    },
    readInput: async (source: string, maximum: number) => {
      assert.equal(source, 'context.json');
      assert.equal(maximum, 8_192);
      readContext++;
      return JSON.stringify(contextInput);
    },
  } as unknown as CliCommandContext;
  assert.equal(
    await runIntakeCommand(
      args,
      { readBinaryArtifactInput: async () => bytes('192.0.2.17') },
      context,
    ),
    0,
  );
  assert.equal(readContext, 1);
  assert.deepEqual(JSON.parse(output).distributionContext, supplied);
});
