import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import { reviewPhoneCandidates, validatePhoneReview, MAX_SELECTED_INTAKE_PHONES } from '../packages/investigation/intake-phones.mts';
import { MAX_INTAKE_INDICATOR_TEXT } from '../packages/investigation/intake-indicators.mts';
import { applyIntakeContextInput, parseIntakeContextInput, withIntakeSelectedEvidence, validateIntakeExtensions, readIntakePhoneDeclaration, INTAKE_SELECTED_EVIDENCE_LIMITATIONS, type IntakeSelectedEvidenceInput } from '../packages/investigation/intake-context.mts';
import { createLinkIntake, projectIntakeDestination } from '../packages/investigation/link-intake.mts';
import { messageCaseEvidence } from '../packages/investigation/message-case-evidence.mts';
import { sha256ArtifactBytes } from '../packages/evidence/artifact-integrity.mts';
import type { IntakePhoneDeclaration, CurrentMessageIntakeReport, MessageIntakeResult } from '../packages/contracts/message-intake.mts';
import { runMessageIntakeOperation } from '../frontend/src/lib/message-intake-worker-model.ts';
import { runIntakeCommand, formatMessageIntake } from '../cli/intake-command.mts';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import type { CliCommandContext } from '../cli/runner-types.mts';
import { addCaseAttachments } from '../packages/cases/case-attachment-model.mts';
import { createCase, updateCase, serializeCaseStore, normalizeCaseStore, buildCaseExport, mergeCases, projectCaseForAudience } from '../packages/cases/case-model.mts';
import { localCaseReviewPin } from '../packages/cases/case-review-summary.mts';
import { buildStixIndicatorExport } from '../packages/interchange/stix-indicator-export.mts';
import { buildMispIndicatorExport } from '../packages/interchange/misp-indicator-export.mts';

const NOW = '2026-01-02T03:04:05.000Z', bytes = (value: string) => new TextEncoder().encode(value);
const declaration: IntakePhoneDeclaration = { sourceLabel: 'Selected support snippet', observedAt: null, basis: 'supplied_text', role: 'advertised_support_contact', countryCallingCode: null };
const destinationPair: NonNullable<IntakeSelectedEvidenceInput['destinationPair']> = {
  displayed: 'store.example.test', destination: 'https://store.example.test.attacker.invalid/private?item=PRIVATE-DESTINATION',
  displayedDeclaration: { sourceLabel: 'Selected advert', observedAt: null, basis: 'manual_transcription', role: 'displayed_claim' },
  destinationDeclaration: { sourceLabel: 'Supplied redirect file', observedAt: NOW, basis: 'supplied_text', role: 'supplied_redirect' },
};
function selection(result: MessageIntakeResult, indexes = [0], supplied = declaration): IntakeSelectedEvidenceInput {
  return { sourceDigestSha256: result.report.source.digestSha256,
    phones: indexes.map(index => { const candidate = result.phoneReview!.candidates[index]!; return { start: candidate.start, end: candidate.end, declaration: supplied }; }), destinationPair: null };
}

test('URL-free plaintext phone candidates remain transient until a digest-and-span-bound selection', async () => {
  const source = 'Fictional support: +1 202 555 0107\nPRIVATE-NOTE unrelated@example.test';
  const result = await reviewMessageInput(bytes(source), 'text', NOW);
  assert.equal(result.report.links.length, 0);
  assert.equal(result.phoneReview?.candidates.length, 1);
  const candidate = result.phoneReview!.candidates[0]!;
  assert.equal(candidate.original, '+1 202 555 0107');
  assert.equal(candidate.canonical, '+12025550107');
  assert.equal(source.slice(candidate.start, candidate.end), candidate.original);
  assert.doesNotMatch(JSON.stringify(result.report) + formatMessageIntake(result.report), /202 555|1202555|PRIVATE-NOTE|unrelated@/u);
  const report = withIntakeSelectedEvidence(result, selection(result));
  assert.deepEqual(report.selectedEvidence!.phones[0]!.occurrences, [{ original: candidate.original, start: candidate.start, end: candidate.end }]);
  assert.equal(report.selectedEvidence!.phones[0]!.declaration.observedAt, null);
  assert.equal(report.selectedEvidence!.sourceDigestSha256, await sha256ArtifactBytes(bytes(source)));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE-NOTE|unrelated@/u);
  assert.deepEqual(withIntakeSelectedEvidence({ ...result, report }, null), result.report);
});

test('BOM and supplementary characters count as exact original UTF-16 units, not code points', async () => {
  const source = '\uFEFF🧭 Support: +1\u00a0202\u2011555\u202f0107';
  const result = await reviewMessageInput(bytes(source), 'text', NOW);
  const candidate = result.phoneReview!.candidates[0]!;
  assert.equal(candidate.start, source.indexOf('+'));
  assert.equal(candidate.end, source.length);
  assert.equal(result.phoneReview!.sourceTextLength, source.length);
  assert.equal(source.slice(candidate.start, candidate.end), candidate.original);
  assert.equal(candidate.canonical, '+12025550107');
  validatePhoneReview(result);
  const report = withIntakeSelectedEvidence(result, selection(result));
  validateIntakeExtensions(report);
  assert.throws(() => withIntakeSelectedEvidence(result, { ...selection(result), phones: [{ ...selection(result).phones[0], start: candidate.start - 1 }] }), /exact reviewed/u);
  await assert.rejects(reviewMessageInput(new Uint8Array([0xff, 0xfe, 0x31]), 'text', NOW));
});

test('sentence-final phone periods preserve source bytes, exact spans and explicit selection', async () => {
  for (const original of ['+1 202 555 0107', '(202) 555-0107', '+1 202 555 0107 ext. 17']) {
    for (const suffix of ['.', '. ', '.\n', '.\r\n', '.\t', '.\u00a0', '.\u202f', '', '!', '. 7654321']) {
      const prefix = '\uFEFF🧭 Support: ', source = prefix + original + suffix;
      const result = await reviewMessageInput(bytes(source), 'text', NOW);
      const digest = await sha256ArtifactBytes(bytes(source));
      assert.equal(result.phoneReview!.candidates.length, 1, JSON.stringify(source));
      const candidate = result.phoneReview!.candidates[0]!;
      assert.equal(result.phoneReview!.sourceDigestSha256, digest);
      assert.equal(result.phoneReview!.sourceTextLength, source.length);
      assert.equal(candidate.start, prefix.length);
      assert.equal(candidate.end, prefix.length + original.length);
      assert.equal(source.slice(candidate.start, candidate.end), original);
      assert.equal(candidate.original, original);
      assert.equal(candidate.canonical, original.startsWith('+') ? '+12025550107' : null);
      assert.equal(candidate.state, original.startsWith('+') ? 'international_candidate' : 'national_ambiguous');
      assert.equal(candidate.extension, original.includes('ext.') ? '17' : null);
      validatePhoneReview(result);
      assert.ok(result.report.schemaVersion === 2);
      assert.equal(result.report.selectedEvidence, undefined);
      const report = withIntakeSelectedEvidence(result, selection(result));
      assert.equal(report.selectedEvidence!.sourceDigestSha256, digest);
      assert.deepEqual(report.selectedEvidence!.phones[0]!.occurrences,
        [{ original, start: prefix.length, end: prefix.length + original.length }]);
      assert.doesNotMatch(JSON.stringify(report), /Support:|🧭|7654321/u);
      assert.throws(() => withIntakeSelectedEvidence(result, { ...selection(result), sourceDigestSha256: 'sha256:' + '0'.repeat(64) }), /complete input digest/u);
      assert.throws(() => withIntakeSelectedEvidence(result, { ...selection(result), phones: [{ ...selection(result).phones[0], end: candidate.end + 1 }] }), TypeError);
    }
  }
});

test('prose-period exception does not admit embedded identifiers, URI bodies or unlabelled national numbers', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  const sources = [
    'Call: 2025550107.25', 'Support: +12025550107.25', 'Phone: 12345678.90', 'Version: +12025550107.1',
    ...['.example', '._id', './path', '.+1234', '..', '.Next'].map(suffix => 'Support: +12025550107' + suffix),
    ...['.', 'a', '_', '/', ':', '@'].map(prefix => prefix + '+12025550107.'),
    '192.0.2.17.', '2001:db8::17.', 'Call: 2026-10-04.', 'Account: +12025550107.',
    'Order: 2025550107.', 'Reference: 2025550107.', 'SHA256:' + '1'.repeat(64) + '.',
    'https://example.test/+12025550107.', 'hxxps[:]//example[.]test/+12025550107.', 'tel:+12025550107.',
    'value=urn:phone:+12025550107.', 'value=data:text/plain,+12025550107.', '+12025550107@example.test',
    'Authorization: +12025550107.', 'Cookie: +12025550107.', '<a title="+12025550107.">text</a>',
    '<a title="+12025550107.', '<script>+12025550107.</script>', '<style>+12025550107.</style>',
    '2025550107.', '(202) 555-0107.',
  ];
  for (const source of sources) assert.deepEqual(reviewPhoneCandidates(source, digest).candidates, [], source);
});

test('equivalent explicit international formatting groups only compatible declarations and preserves each source span', async () => {
  const result = await reviewMessageInput(bytes('+1 202 555 0107\n+1 (202) 555-0107\nPhone: (202) 555-0107\nPhone: 202 555 0107'), 'text', NOW);
  assert.equal(result.phoneReview!.candidates.length, 4);
  const report = withIntakeSelectedEvidence(result, selection(result, [0, 1, 2, 3]));
  assert.equal(report.selectedEvidence!.phones.length, 3);
  assert.equal(report.selectedEvidence!.phones[0]!.occurrences.length, 2);
  assert.equal(report.selectedEvidence!.phones[1]!.canonical, null);
  assert.equal(report.selectedEvidence!.phones[2]!.state, 'national_ambiguous');
  const conflicting = withIntakeSelectedEvidence(result, selection(result, [0, 1], { ...declaration, countryCallingCode: '+61' }));
  assert.equal(conflicting.selectedEvidence!.phones.length, 2);
  assert.equal(conflicting.selectedEvidence!.phones[0]!.state, 'country_context_conflict');
  assert.equal(conflicting.selectedEvidence!.phones[0]!.canonical, null);
  const national = withIntakeSelectedEvidence(result, selection(result, [2], { ...declaration, countryCallingCode: '+1' }));
  assert.equal(national.selectedEvidence!.phones[0]!.canonical, null);
});

test('phone extensions stay separate and distinct numbers or provenance do not collapse', async () => {
  const result = await reviewMessageInput(bytes('+1 202 555 0107 ext. 17\n+1 202 555 0107 x18\n+1 202 555 0108'), 'text', NOW);
  const input = selection(result, [0, 1, 2]);
  const report = withIntakeSelectedEvidence(result, input);
  assert.deepEqual(report.selectedEvidence!.phones.map(phone => phone.extension), ['17', '18', null]);
  assert.equal(report.selectedEvidence!.phones.length, 3);
  const same = await reviewMessageInput(bytes('+1 202 555 0107\n+1 202 555 0107'), 'text', NOW);
  const base = selection(same, [0, 1]);
  assert.equal(withIntakeSelectedEvidence(same, { ...base, phones: [base.phones[0], { ...base.phones[1], declaration: { ...declaration, basis: 'ocr_text' } }] }).selectedEvidence!.phones.length, 2);
});

test('unsupported Unicode digits, bidi and confusable plus signs preserve exact spans without becoming selected numbers', async () => {
  const source = '+１ ２０２ ５５５ ０１０７.\n＋1 202 555 0107.\n+1 202\u202e555 0107.';
  const result = await reviewMessageInput(bytes(source), 'text', NOW);
  assert.equal(result.phoneReview!.candidates.length, 3);
  for (const candidate of result.phoneReview!.candidates) {
    assert.equal(candidate.state, 'unsupported'); assert.equal(candidate.canonical, null);
    assert.equal(source.slice(candidate.start, candidate.end), candidate.original);
  }
  assert.throws(() => withIntakeSelectedEvidence(result, selection(result)), /Unsupported phone/u);
  assert.doesNotMatch(JSON.stringify(result.report), /２０２|202.*555/u);
});

test('dates, IDs, account fields, hashes, IPs, URI bodies, markup and credentials are not phone observations', async () => {
  const source = [
    '2026-10-04', 'Call: 2026-10-04', 'Order: 2025550107', 'Account: +1 202 555 0107', '192.0.2.17', '2001:db8::17',
    'SHA256:' + '1'.repeat(64), 'https://example.test/private?contact=+12025550107', 'value=urn:phone:+12025550107',
    'value=data:text/plain,+12025550107', 'Authorization: +1 202 555 0107', '<a data-phone="+1 202 555 0107">label</a>',
    '<script>+1 202 555 0107</script>', '<style>+1 202 555 0107</style>',
  ].join('\n');
  assert.deepEqual((await reviewMessageInput(bytes(source), 'text', NOW)).phoneReview!.candidates, []);
  for (const kind of ['email', 'calendar', 'qr'] as const) {
    const result = await reviewMessageInput(bytes(kind === 'email' ? 'Content-Type: text/plain\r\n\r\n+1 202 555 0107' : '+1 202 555 0107'), kind, NOW, []);
    assert.equal(result.phoneReview, undefined);
    assert.throws(() => withIntakeSelectedEvidence(result, { sourceDigestSha256: result.report.source.digestSha256, phones: [{ start: 0, end: 15, declaration }], destinationPair: null }), /fresh plaintext/u);
  }
});

test('phone work, text, candidate, match and aggregate selection limits are explicit', async () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  assert.equal(reviewPhoneCandidates('x'.repeat(MAX_INTAKE_INDICATOR_TEXT + 1), digest).state, 'partial');
  const long = reviewPhoneCandidates('+' + '1'.repeat(200), digest);
  assert.equal(long.state, 'partial'); assert.deepEqual(long.candidates, []);
  const bounded = reviewPhoneCandidates(Array.from({ length: 520 }, () => '+1 202 555 0107').join('\n'), digest);
  assert.equal(bounded.state, 'partial'); assert.equal(bounded.candidates.length, 512);
  const work = reviewPhoneCandidates(Array.from({ length: 4100 }, () => 'ID: 12345678').join('\n'), digest);
  assert.equal(work.state, 'partial'); assert.equal(work.candidatesReviewed, 4096);
  const result = await reviewMessageInput(bytes(Array.from({ length: MAX_SELECTED_INTAKE_PHONES + 1 }, () => '+1 202 555 0107').join('\n')), 'text', NOW);
  assert.throws(() => withIntakeSelectedEvidence(result, selection(result, Array.from({ length: 65 }, (_, i) => i))));
});

test('quoted markup and matching raw-text tags exclude private numbers without changing later source spans', async () => {
  for (const markup of [
    '<a data-note="head > +1 202 555 0107">label</a>',
    "<a data-note='head > +1 202 555 0107'>label</a>",
    '<script data-note="head > value"> </style> +1 202 555 0107 </SCRIPT >',
    '<STYLE data-note="head > value"> </script> +1 202 555 0107 </style>',
    '<script> </scripted> +1 202 555 0107 </script>',
  ]) {
    const source = '\uFEFF🧭 ' + markup + '\nSupport: +1 202 555 0108';
    const result = await reviewMessageInput(bytes(source), 'text', NOW);
    assert.equal(result.phoneReview!.candidates.length, 1, markup);
    const candidate = result.phoneReview!.candidates[0]!;
    assert.equal(candidate.original, '+1 202 555 0108');
    assert.equal(candidate.start, source.lastIndexOf('+'));
    assert.equal(candidate.end, source.length);
    assert.equal(source.slice(candidate.start, candidate.end), candidate.original);
    assert.deepEqual(withIntakeSelectedEvidence(result, selection(result)).selectedEvidence!.phones[0]!.occurrences,
      [{ original: candidate.original, start: candidate.start, end: candidate.end }]);
    assert.throws(() => withIntakeSelectedEvidence(result, { ...selection(result), phones: [{ start: source.indexOf('+'), end: source.indexOf('+') + 15, declaration }] }), /exact reviewed/u);
  }
});

test('unmatched quoted markup and raw-text tags never offer their remainder as phone evidence', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  for (const source of [
    '<a data-note="head > +1 202 555 0107',
    '<a data-note="head > +1 202 555 0107\nSupport: +1 202 555 0108',
    '<script> </style> +1 202 555 0107',
    '<style> </script> +1 202 555 0107',
  ]) assert.deepEqual(reviewPhoneCandidates(source, digest).candidates, [], source);
  const prefix = '<a data-note="', phone = '+1 202 555 0107';
  const bounded = prefix + '>'.repeat(MAX_INTAKE_INDICATOR_TEXT - prefix.length - phone.length) + phone;
  assert.equal(bounded.length, MAX_INTAKE_INDICATOR_TEXT);
  assert.equal(reviewPhoneCandidates(bounded, digest).state, 'reviewed');
  assert.deepEqual(reviewPhoneCandidates(bounded, digest).candidates, []);
});

test('partial phone-only extraction is disclosed in selected reports and respects CLI strict exit', async () => {
  const source = Array.from({ length: 520 }, () => '+1 202 555 0107').join('\n');
  const result = await reviewMessageInput(bytes(source), 'text', NOW);
  assert.equal(result.report.coverage.state, 'reviewed');
  assert.equal(result.phoneReview!.state, 'partial');
  const report = withIntakeSelectedEvidence(result, selection(result));
  assert.equal(report.selectedEvidence!.phoneCoverage.state, 'partial');
  validateIntakeExtensions(report);
  let stdout = '', stderr = '';
  assert.equal(await runCli(['intake', 'text', '--json', '--strict-exit'], { stdin: Readable.from([source]), stdout: { write(value: string) { stdout += value; } }, stderr: { write(value: string) { stderr += value; } }, now: () => NOW }), 4);
  assert.match(stderr, /coverage partial/u);
  assert.doesNotMatch(stdout + stderr, /202 555|12025550107/u);
});

test('separate long digit runs and malformed extension lines are not silently normalised together', async () => {
  const result = await reviewMessageInput(bytes('Call: 1234567 7654321\n+1234567 7654321\nPhone: 123)456(789'), 'text', NOW);
  assert.ok(result.phoneReview!.candidates.length >= 2);
  for (const candidate of result.phoneReview!.candidates) assert.equal(candidate.state, 'unsupported');
  assert.throws(() => withIntakeSelectedEvidence(result, selection(result)), /Unsupported/u);
  const ordinary = await reviewMessageInput(bytes('+1 202 555 0107'), 'text', NOW);
  const report = withIntakeSelectedEvidence(ordinary, selection(ordinary));
  const phone = report.selectedEvidence!.phones[0]!;
  assert.throws(() => validateIntakeExtensions({ ...report, selectedEvidence: { ...report.selectedEvidence!, sourceTextLength: 24, phones: [{ ...phone, extension: '17', occurrences: [{ original: '+1 202 555 0107 ext.\n17', start: 0, end: 22 }] }] } }), /malformed|Unsupported|length/u);
});

test('source changes, duplicate spans and changed declarations are revalidated when applying selections', async () => {
  const result = await reviewMessageInput(bytes('+1 202 555 0107'), 'text', NOW), input = selection(result);
  assert.throws(() => withIntakeSelectedEvidence(result, { ...input, sourceDigestSha256: 'sha256:' + '0'.repeat(64) }), /complete input digest/u);
  assert.throws(() => withIntakeSelectedEvidence(result, { ...input, phones: [input.phones[0], input.phones[0]] }), /at most once/u);
  for (const changed of [{ role: 'verified_owner' }, { observedAt: '2026-01-02T03:04:05' }, { basis: 'independent_collection' }, { countryCallingCode: 'US' }, { sourceLabel: '+1 202 555 0107' }])
    assert.throws(() => readIntakePhoneDeclaration({ ...declaration, ...changed }));
  const report = withIntakeSelectedEvidence(result, input);
  const changed = { ...report, selectedEvidence: { ...report.selectedEvidence!, phones: [{ ...report.selectedEvidence!.phones[0]!, declaration: { ...declaration, countryCallingCode: '+61' } }] } };
  assert.throws(() => validateIntakeExtensions(changed), /contradicts/u);
  const forged = { ...result, phoneReview: { ...result.phoneReview!, candidates: [{ ...result.phoneReview!.candidates[0]!, end: 1 }] } };
  assert.throws(() => validatePhoneReview(forged), /span/u);
});

test('strict selected extension readers reject unknown fields, false comparisons and hidden private URLs', async () => {
  const result = await reviewMessageInput(bytes('+1 202 555 0107'), 'text', NOW);
  const report = withIntakeSelectedEvidence(result, { ...selection(result), destinationPair });
  validateIntakeExtensions(JSON.parse(JSON.stringify(report)));
  for (const changed of [{ version: 2 }, { offsetUnit: 'codepoint' }, { sourceTextLength: 1 }, { rawSnippet: 'private' }, { limitations: [] }])
    assert.throws(() => validateIntakeExtensions({ ...report, selectedEvidence: { ...report.selectedEvidence!, ...changed } } as CurrentMessageIntakeReport));
  const pair = report.selectedEvidence!.destinationPair!;
  assert.throws(() => validateIntakeExtensions({ ...report, selectedEvidence: { ...report.selectedEvidence!, destinationPair: { ...pair, state: 'same_host' } } }), /comparison/u);
  assert.throws(() => validateIntakeExtensions({ ...report, selectedEvidence: { ...report.selectedEvidence!, destinationPair: { ...pair, destination: { ...pair.destination, origin: 'https://example.test/private?key=PRIVATE' } } } }), /canonical origin/u);
});

test('context v1 meaning is preserved and v2 adds optional digest-bound selections without upgrading old reports', async () => {
  const context = { channel: 'advertisement', observedAt: NOW, sourceLabel: 'Selected advert', reference: null, observerLabel: null, vantageLabel: null };
  const v1 = JSON.stringify({ schema: 'whoisleuth.intake-context', version: 1, context });
  assert.deepEqual(parseIntakeContextInput(v1), context);
  const result = await reviewMessageInput(bytes('+1 202 555 0107'), 'text', NOW);
  assert.deepEqual(applyIntakeContextInput(result, v1), { ...result.report, distributionContext: context });
  const input = { schema: 'whoisleuth.intake-context', version: 2, context: null, review: selection(result) };
  const report = applyIntakeContextInput(result, JSON.stringify(input));
  assert.equal(report.selectedEvidence!.phones.length, 1);
  assert.deepEqual(applyIntakeContextInput(result, JSON.stringify({ schema: input.schema, version: 2, context: null })), result.report);
  assert.throws(() => applyIntakeContextInput(result, JSON.stringify({ ...input, version: 1 })));
  assert.throws(() => applyIntakeContextInput(result, JSON.stringify({ ...input, version: 3 })));
  assert.throws(() => applyIntakeContextInput(result, JSON.stringify({ ...input, extra: true })));
  assert.throws(() => applyIntakeContextInput(result, JSON.stringify({ ...input, padding: 'x'.repeat(8192) })));
  const { indicators: _i, indicatorCoverage: _c, distributionContext: _d, ...fields } = result.report as CurrentMessageIntakeReport;
  const legacy = { ...fields, schemaVersion: 1 as const };
  validateIntakeExtensions(legacy);
  assert.throws(() => withIntakeSelectedEvidence({ report: legacy, targets: [] }, selection(result)), /Historical/u);
});

test('manual pairs and HTML anchor comparison share safe host interpretation without retaining exact inputs', async () => {
  const result = await reviewMessageInput(bytes('Selected supplied encounter'), 'text', NOW);
  const report = withIntakeSelectedEvidence(result, { ...selection(result, []), destinationPair });
  const pair = report.selectedEvidence!.destinationPair!;
  assert.equal(pair.state, 'different_host');
  assert.equal(pair.displayed.hostname, 'store.example.test');
  assert.equal(pair.destination.hostname, 'store.example.test.attacker.invalid');
  assert.equal(pair.destination.registrationDomain, 'attacker.invalid');
  assert.equal(pair.destinationDeclaration.role, 'supplied_redirect');
  const links = createLinkIntake(); links.add(destinationPair.destination, 'html_link', destinationPair.displayed);
  assert.equal(links.result().links[0]!.displayedDestination, pair.state);
  assert.doesNotMatch(JSON.stringify(report) + formatMessageIntake(report), /PRIVATE-DESTINATION|\/private|\?item=/u);
  assert.match(report.selectedEvidence!.limitations.join(' '), /redirects are not followed/u);
});

test('tracking, missing, malformed, userinfo and IDNA pairs retain uncertainty and declared roles', async () => {
  const result = await reviewMessageInput(bytes('Supplied text'), 'text', NOW);
  const compare = (displayed: string, destination: string) => withIntakeSelectedEvidence(result, { ...selection(result, []), destinationPair: { ...destinationPair, displayed, destination } }).selectedEvidence!.destinationPair!;
  assert.equal(compare('store.example.test', 'https://tracking.example.test/go').state, 'different_host');
  assert.equal(compare('store.example.test', '').state, 'insufficient_evidence');
  assert.equal(compare('not a host', 'https://store.example.test').state, 'insufficient_evidence');
  assert.equal(compare('store.example.test', 'https://store.example.test@attacker.invalid/').destination.state, 'unsupported');
  assert.equal(compare('store.example.test', 'https://store.example.test:8443/').state, 'insufficient_evidence');
  const idn = compare('bücher.example', 'https://xn--bcher-kva.example/');
  assert.equal(idn.state, 'same_host'); assert.ok(idn.displayed.normalisation.includes('unicode_hostname_to_ascii'));
  assert.equal(compare('store.example.test', 'https://store.example.test\u202e.attacker.invalid').state, 'insufficient_evidence');
  assert.equal(projectIntakeDestination('https://store.example.test\\@attacker.invalid').state, 'unsupported');
});

test('HTML host comparisons keep the admitted canonical destination when its private path needs URL encoding', async () => {
  for (const [hostname, state] of [['attacker.invalid', 'different_host'], ['store.example.test', 'same_host']] as const) {
    const href = `https://${hostname}/some path?note=PRIVATE-DESTINATION`;
    const source = `Content-Type: text/html\r\n\r\n<a href="${href}">store.example.test</a>`;
    const result = await reviewMessageInput(bytes(source), 'email', NOW);
    assert.equal(result.report.links.length, 1);
    assert.equal(result.report.links[0]!.displayedDestination, state);
    assert.equal(result.report.links[0]!.hostname, hostname);
    assert.equal(result.targets[0]!.exactUrl, new URL(href).href);
    assert.doesNotMatch(JSON.stringify(result.report), /some(?: |%20)path|PRIVATE-DESTINATION/u);
    assert.equal(projectIntakeDestination(href).state, 'unsupported');
    const links = createLinkIntake();
    links.add(`https://${hostname}/` + ' '.repeat(3000) + 'end', 'html_link', 'store.example.test');
    assert.equal(links.result().links[0]!.displayedDestination, state);
  }
});

test('retained private report survives reload and portable Case references without entering public or trusted summaries', async () => {
  const result = await reviewMessageInput(bytes('Support: +1 202 555 0107\nPRIVATE-SURROUNDING'), 'text', NOW);
  const report = withIntakeSelectedEvidence(result, { ...selection(result), destinationPair });
  const raw = JSON.stringify(report), reportBytes = bytes(raw), digest = await sha256ArtifactBytes(reportBytes);
  validateIntakeExtensions(JSON.parse(new TextDecoder().decode(reportBytes)));
  let record = createCase({ domain: 'example.test' }, NOW);
  record = addCaseAttachments(record, [{ id: 'selected-report', fileName: 'message-review.json', mediaType: 'application/json', source: 'Selected local review', observedAt: null, retainedAt: NOW, byteLength: reportBytes.length, digestSha256: digest }], NOW);
  const summary = messageCaseEvidence(report, digest);
  record = updateCase([record], record.id, { evidencePin: localCaseReviewPin(summary) }, NOW).record;
  const restored = mergeCases([], buildCaseExport(normalizeCaseStore(JSON.parse(serializeCaseStore([record]))).cases, NOW)).cases[0]!;
  assert.deepEqual(restored.attachments, record.attachments);
  assert.equal(restored.attachments![0]!.digestSha256, await sha256ArtifactBytes(reportBytes));
  for (const audience of ['public', 'trusted'] as const) {
    const output = JSON.stringify(projectCaseForAudience(restored, audience));
    assert.doesNotMatch(output, /12025550107|202 555|PRIVATE-SURROUNDING|PRIVATE-DESTINATION|attacker\.invalid/u);
    assert.match(output, /no supported STIX or MISP mapping/u);
    assert.equal(projectCaseForAudience(restored, audience).attachments, undefined);
  }
  assert.doesNotMatch(JSON.stringify(summary), /202 555|12025550107|PRIVATE-SURROUNDING|attacker\.invalid/u);
});

test('unsupported interchange mappings never coerce selected phone observations into STIX or MISP properties', async () => {
  const result = await reviewMessageInput(bytes('+1 202 555 0107'), 'text', NOW), report = withIntakeSelectedEvidence(result, selection(result));
  const bulk = { domain: 'example.test', availability: 'registered', risk: 80, trusted: null, status: 'complete', profileContext: { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' }, selectedEvidence: report.selectedEvidence };
  let id = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
  const stix = buildStixIndicatorExport([bulk], { generatedAt: NOW, idFactory: (type: string) => `${type}--${uuid()}` });
  const misp = buildMispIndicatorExport([bulk], { generatedAt: NOW, uuidFactory: uuid });
  assert.doesNotMatch(stix.content + misp.content, /12025550107|202 555|phone|telephone/u);
  assert.match(report.selectedEvidence!.limitations.join(' '), /not mapped to STIX or MISP/u);
});

test('browser and CLI retain identical selected reports, while default CLI output omits transient candidates', async () => {
  const source = '🧭 Support: +1 202 555 0107.';
  const result = await reviewMessageInput(bytes(source), 'text', NOW);
  const worker = await runMessageIntakeOperation({ kind: 'text', file: new Blob([bytes(source)]), reviewedAt: NOW });
  assert.deepEqual(worker, { kind: 'review', result });
  let output = '', diagnostics = '', requests = 0;
  assert.equal(await runCli(['intake', 'text', '--json'], { stdin: Readable.from([source]), stdout: { write(value: string) { output += value; } }, stderr: { write(value: string) { diagnostics += value; } }, now: () => NOW, runUnifiedLookup: async () => { requests++; throw new Error('No collection'); } }), 0);
  assert.doesNotMatch(output, /12025550107|202 555/u);
  assert.doesNotMatch(diagnostics, /12025550107|202 555/u);
  assert.match(diagnostics, /Transient phone candidates: 1/u);
  assert.ok(diagnostics.includes(`UTF-16 span [${source.indexOf('+')}, ${source.length - 1})`));
  assert.match(diagnostics, /--intake-context with version 2/u);
  const input = JSON.stringify({ schema: 'whoisleuth.intake-context', version: 2, context: null, review: { ...selection(result), destinationPair } });
  const args = parseCliArguments(['intake', 'text', 'selected.txt', '--intake-context', 'context.json', '--json']);
  if (args.action !== 'intake') throw new Error('Wrong action');
  output = '';
  const context = { setFailureLabel() {}, now: () => NOW, writeStdout(value: string) { output += value; }, writeStderr(value: string) { diagnostics += value; }, readInput: async (path: string, maximum: number) => { assert.equal(path, 'context.json'); assert.equal(maximum, 8192); return input; } } as unknown as CliCommandContext;
  assert.equal(await runIntakeCommand(args, { readBinaryArtifactInput: () => bytes(source) }, context), 0);
  assert.deepEqual(JSON.parse(output), applyIntakeContextInput(result, input));
  assert.equal(JSON.parse(output).selectedEvidence.sourceDigestSha256, await sha256ArtifactBytes(bytes(source)));
  assert.deepEqual(JSON.parse(output).selectedEvidence.phones[0].occurrences,
    [{ original: '+1 202 555 0107', start: source.indexOf('+'), end: source.length - 1 }]);
  assert.equal(requests, 0);
  assert.equal(INTAKE_SELECTED_EVIDENCE_LIMITATIONS.length, 4);
});
