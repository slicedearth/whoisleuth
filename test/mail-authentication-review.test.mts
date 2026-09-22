import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewMailAuthentication, selectReceiverTrust } from '../packages/investigation/mail-authentication-review.mts';
import { MAX_AUTHENTICATION_CLAUSES, MAX_AUTHENTICATION_VALUE_LENGTH } from '../packages/contracts/mail-authentication.mts';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import { buildCliMailHeaderReview } from '../cli/mail-header-review.mts';
import { runCli } from '../cli/runner.mts';
const NOW = '2026-09-23T00:00:00.000Z';
const field = (value: string) => ({ name: 'authentication-results', value });

test('authentication evidence preserves physical sources, duplicate headers and explicit trust', () => {
  const first = field('receiver.example; spf=pass smtp.mailfrom=private-sender@sender.example; dkim=fail header.d=sender.example');
  const review = reviewMailAuthentication([{ name: 'from', value: 'sender@sender.example' }, first,
    field('receiver.example; spf=fail smtp.mailfrom=other.example'), first]);
  assert.deepEqual(review.headers.map(value => [value.headerIndex, value.authservId, value.duplicateOf, value.receiverTrust]),
    [[2, 'receiver.example', null, 'not_established'], [3, 'receiver.example', null, 'not_established'], [4, 'receiver.example', 2, 'not_established']]);
  assert.deepEqual(review.headers[0]!.claims.map(value => [value.method, value.result]), [['spf', 'pass'], ['dkim', 'fail']]);
  assert.deepEqual(review.headers[0]!.claims[0]!.domains, [{ property: 'smtp.mailfrom', domain: 'sender.example' }]);
  assert.equal(JSON.stringify(review).includes('private-sender'), false);
  const trusted = selectReceiverTrust(review, ['1:2']);
  assert.deepEqual(trusted.headers.map(value => value.receiverTrust), ['analyst_selected', 'not_established', 'not_established']);
  assert.equal(review.headers[0]!.receiverTrust, 'not_established');
  for (const input of [['1:99'], ['1:2', '1:2'], ['receiver.example'], ['0:2']]) assert.throws(() => selectReceiverTrust(review, input), /Select each/u);
});

test('comments, quoting, method versions and ambiguous identity properties cannot manufacture a result', () => {
  const review = reviewMailAuthentication([
    field('(ignored) "receiver.example" 1; spf (ignored) = fail (reason; spf=pass) smtp.mailfrom="private@sender.example"; dkim/2=pass header.d=signer.example'),
    field('receiver.example; dmarc=pass header.from=first.example header.from=second.example reason="secret; dkim=pass"'),
    field('receiver.example 2; spf=pass'), field('receiver.example; none'),
    field('receiver.example; spf=pass (unclosed'), field('"private@example.test"; spf=pass'),
    field('receiver.example; spf=pass smtp.mailfrom=a@one.example,b@two.example'),
  ]);
  assert.equal(review.headers[0]!.state, 'partial');
  assert.deepEqual(review.headers[0]!.claims.map(value => [value.method, value.result, value.state]), [['spf', 'fail', 'reported'], ['dkim', 'pass', 'unsupported']]);
  assert.deepEqual(review.headers[1]!.claims[0]!.duplicateProperties, ['header.from']);
  assert.deepEqual(review.headers[1]!.claims[0]!.domains, []);
  assert.equal(review.headers[2]!.state, 'unsupported'); assert.deepEqual(review.headers[2]!.claims, []);
  assert.equal(review.headers[3]!.state, 'none'); assert.deepEqual(review.headers[3]!.claims, []);
  assert.equal(review.headers[4]!.state, 'malformed');
  assert.equal(review.headers[5]!.authservId, null);
  assert.deepEqual(review.headers[6]!.claims[0]!.domains, []);
  assert.doesNotMatch(JSON.stringify(review), /private|secret|first\.example|second\.example/u);
  for (const selected of ['1:3', '1:5', '1:6']) assert.throws(() => selectReceiverTrust(review, [selected]), /cannot be trusted/u);
});

test('Received-SPF stays separately attributed and bounds are explicit rather than silent absence', () => {
  const review = reviewMailAuthentication([
    { name: 'received-spf', value: 'pass (example); receiver=receiver.example; client-ip=192.0.2.1; envelope-from=private@sender.example; helo=mail.sender.example' },
    field('receiver.example; ' + Array.from({ length: MAX_AUTHENTICATION_CLAUSES + 1 }, () => 'dkim=pass').join('; ')),
    field('receiver.example; ' + 'x'.repeat(MAX_AUTHENTICATION_VALUE_LENGTH)),
  ]);
  assert.equal(review.headers[0]!.authservId, 'receiver.example');
  assert.deepEqual(review.headers[0]!.claims[0]!.domains, [{ property: 'smtp.mailfrom', domain: 'sender.example' }, { property: 'smtp.helo', domain: 'mail.sender.example' }]);
  assert.equal(review.headers[1]!.claims.length, MAX_AUTHENTICATION_CLAUSES);
  assert.equal(review.headers[1]!.state, 'partial');
  assert.equal(review.headers[2]!.state, 'malformed');
  assert.doesNotMatch(JSON.stringify(review), /192\.0\.2\.1|private@/u);
  assert.equal(reviewMailAuthentication([field('receiver.example; none'), field('receiver.example; none')], 1, 1).omittedHeaders, 1);
  assert.equal(reviewMailAuthentication([{ name: 'received-spf', value: 'p'.repeat(100) }]).headers[0]!.state, 'malformed');
});

test('nested messages keep distinct byte identities and never inherit receiver trust', async () => {
  const source = 'Authentication-Results: receiver.example; spf=pass\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: message/rfc822\r\n\r\nAuthentication-Results: receiver.example; spf=fail\r\nFrom: child@nested.example\r\n\r\nBody\r\n--x--';
  const { report } = await reviewMessageInput(new TextEncoder().encode(source), 'email', NOW);
  assert.equal(report.messageParts.length, 2);
  assert.equal(report.messageParts[0]!.digestSha256, report.source.digestSha256);
  assert.equal(report.messageParts[1]!.parentPart, 1);
  assert.notEqual(report.messageParts[0]!.digestSha256, report.messageParts[1]!.digestSha256);
  const trusted = selectReceiverTrust(report.authenticationReview, ['1:1']);
  assert.deepEqual(trusted.headers.map(value => [value.part, value.headerIndex, value.claims[0]!.result, value.receiverTrust]), [[1, 1, 'pass', 'analyst_selected'], [2, 1, 'fail', 'not_established']]);
  const unsupported = await reviewMessageInput(new TextEncoder().encode('Authentication-Results: receiver.example 2; spf=pass\r\n\r\nBody'), 'email', NOW);
  assert.equal(unsupported.report.coverage.state, 'partial');
  assert.deepEqual(unsupported.report.authenticationReview.headers[0]!.claims, []);
});

test('CLI header and message paths expose the same per-source review and reject invalid trust selections', async () => {
  const source = 'From: sender@sender.example\r\nAuthentication-Results: receiver.example; dmarc=pass header.from=sender.example\r\n\r\nhttps://example.test';
  const direct = buildCliMailHeaderReview(source, NOW, ['1:2']);
  assert.equal(direct.version, 2);
  for (const argv of [['mail-headers', 'message.eml'], ['intake', 'email', 'message.eml']]) {
    let output = '', errors = '';
    const execute = (selection: string) => runCli([...argv, '--trusted-auth-header', selection, '--json'], {
      stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } }, now: () => NOW,
      readMailHeaderInput: async () => source,
      readBinaryArtifactInput: async () => new TextEncoder().encode(source),
      runUnifiedLookup: async () => { throw new Error('Must stay offline.'); },
    });
    assert.equal(await execute('1:2'), 0); assert.equal(errors, '');
    assert.deepEqual(JSON.parse(output).authenticationReview, direct.authenticationReview);
    output = ''; assert.equal(await execute('1:99'), 2); assert.equal(output, '');
    assert.match(errors, /Select each/u);
  }
});
