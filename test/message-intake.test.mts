import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkIntake } from '../packages/investigation/link-intake.mts';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import { MAX_INTAKE_LINKS, MAX_MESSAGE_INTAKE_BYTES } from '../packages/contracts/message-intake.mts';
import { reviewIdentityIncident } from '../packages/investigation/identity-incident-review.mts';

const now = '2026-09-22T00:00:00Z';
const bytes = (value: string) => new TextEncoder().encode(value);

test('links expose independent displayed and embedded destinations without following them', () => {
  const intake = createLinkIntake();
  intake.add('https://redirect.example/next?url=https%3A%2F%2Fdestination.test%2Fprivate%3Ftoken%3Dsecret', 'html_link', 'https://trusted.example');
  const result = intake.result();
  assert.equal(result.links.length, 2);
  assert.equal(result.links[0]?.displayedDestination, 'different_host');
  assert.equal(result.links[1]?.parentId, result.links[0]?.id);
  assert.equal(result.links[1]?.origin, 'https://destination.test');
  assert.equal(JSON.stringify(result.links).includes('secret'), false);
  assert.match(result.targets[1]!.exactUrl, /token=secret/u);
});

test('authorisation parameters are claims, duplicates are not arbitrarily selected and tokens are omitted', () => {
  const intake = createLinkIntake();
  intake.add('https://identity.example/authorize?client_id=abc-123&scope=openid%20mail.read&redirect_uri=https%3A%2F%2Fapplication.test%2Fcallback%3Fprivate%3Dsecret&response_type=code&state=secret&login_hint=person%40example.test', 'text');
  intake.add('https://identity.example/authorize?client_id=first&client_id=second&scope=mail.read', 'text');
  const result = intake.result();
  const auth = result.links[0]!.authorisation!;
  assert.deepEqual(auth.scopes, ['openid', 'mail.read']);
  assert.equal(auth.clientId, 'abc-123');
  assert.equal(auth.redirectOrigin, 'https://application.test');
  assert.equal(result.links[2]?.authorisation?.clientId, null);
  assert.deepEqual(result.links[2]?.authorisation?.duplicateParameters, ['client_id']);
  for (const secret of ['secret', 'person@', 'callback', 'login_hint']) assert.equal(JSON.stringify(result.links).includes(secret), false);
});

test('unsupported links and work limits remain visible', () => {
  const intake = createLinkIntake();
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.test', 'http://127.0.0.1/', 'https://example.test:8443']) intake.add(value, 'text');
  assert.equal(intake.result().rejected, 5);
  for (let i = 0; i <= MAX_INTAKE_LINKS; i++) intake.add(`https://d${i}.example.test/`, 'text');
  assert.equal(intake.result().links.length, MAX_INTAKE_LINKS);
  assert.equal(intake.result().bounded, true);
});

test('email review separates claimed identities, reported authentication and actual links', async () => {
  const source = 'From: Example Support <private-sender@brand.example>\r\nReply-To: person@different.test\r\nAuthentication-Results: mail.example; spf=pass; dkim=fail; dmarc=fail\r\nSubject: private subject\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<a href="https://destination.test/secret?token=private-value">https://brand.example</a><script>https://not-executed.example/</script><p>Copy and paste into the terminal to verify you are human.</p>';
  const result = await reviewMessageInput(bytes(source), 'email', now);
  assert.equal(result.report.source.byteLength, bytes(source).byteLength);
  assert.match(result.report.source.digestSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(result.report.identities.some(item => item.role === 'from' && item.domain === 'brand.example'));
  assert.ok(result.report.identities.some(item => item.role === 'reply_to' && item.domain === 'different.test'));
  assert.deepEqual(result.report.authenticationClaims.map(item => [item.method, item.result]), [['spf', 'pass'], ['dkim', 'fail'], ['dmarc', 'fail']]);
  assert.ok(result.report.links.some(item => item.displayedDestination === 'different_host'));
  assert.equal(result.report.links.some(item => item.hostname === 'not-executed.example'), false);
  assert.ok(result.report.actionHints.includes('clipboard_instruction'));
  for (const privateValue of ['private-sender', 'private subject', 'private-value', 'Example Support', 'person@']) assert.equal(JSON.stringify(result.report).includes(privateValue), false);
});

test('nested messages and calendars are parsed without opening attachments', async () => {
  const source = 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: message/rfc822\r\n\r\nFrom: child@nested.example\r\nContent-Type: text/plain\r\n\r\nhttps://nested.example/path\r\n--x\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR\r\nURL:https://calendar.example/\r\nDESCRIPTION:Visit https://event.example/\r\nEND:VCALENDAR\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nbm90LWV4ZWN1dGVk\r\n--x--';
  const result = await reviewMessageInput(bytes(source), 'email', now);
  assert.ok(result.report.identities.some(item => item.domain === 'nested.example'));
  for (const host of ['nested.example', 'calendar.example', 'event.example']) assert.ok(result.report.links.some(item => item.hostname === host), host);
  assert.equal(result.report.coverage.unreviewedAttachments, 1);
  assert.equal(result.report.coverage.state, 'partial');
});

test('message and header reviews share quoted-address and authentication-clause semantics', async () => {
  const source = 'From: "Display @ unrelated.example" <sender@actual.example>\r\nAuthentication-Results: mail.example; spf=fail (comment; spf=pass); dkim=pass\r\nDKIM-Signature: v=1; b="ignored; d=wrong.example"; d=signer.example\r\nContent-Type: text/plain\r\n\r\nReview only';
  const { report } = await reviewMessageInput(bytes(source), 'email', now);
  assert.deepEqual(report.identities.filter(item => item.role === 'from').map(item => item.domain), ['actual.example']);
  assert.deepEqual(report.identities.filter(item => item.role === 'dkim').map(item => item.domain), ['signer.example']);
  assert.deepEqual(report.authenticationClaims.map(item => [item.method, item.result]), [['spf', 'fail'], ['dkim', 'pass']]);
  assert.equal(JSON.stringify(report).includes('wrong.example'), false);
});

test('folded calendar fields and defanged links stay offline and private', async () => {
  const result = await reviewMessageInput(bytes('BEGIN:VCALENDAR\r\nATTENDEE:mailto:private@example.test\r\nURL:https://calendar.exam\r\n ple/secret\r\nDESCRIPTION:hxxps://other[.]example/path\r\nEND:VCALENDAR'), 'calendar', now);
  assert.deepEqual(result.report.links.map(link => link.hostname), ['calendar.example', 'other.example']);
  assert.equal(JSON.stringify(result.report).includes('private'), false);
});

test('intake rejects unsupported and oversized inputs before parsing', async () => {
  await assert.rejects(reviewMessageInput(new Uint8Array(MAX_MESSAGE_INTAKE_BYTES + 1), 'email', now), /16 MiB/u);
  await assert.rejects(reviewMessageInput(bytes('x'), 'email', '2026-09-22'), /timestamp/u);
  await assert.rejects(reviewMessageInput(bytes('x'), 'qr', now), /decoded text/u);
});

test('identity recovery comes only from reported actions and never treats page removal as account recovery', () => {
  assert.deepEqual(reviewIdentityIncident({ reportedActions: [] }).nextSteps, []);
  const opened = reviewIdentityIncident({ reportedActions: ['opened_link'] });
  assert.equal(opened.nextSteps.some(step => step.id === 'password'), false);
  const consent = reviewIdentityIncident({ reportedActions: ['entered_device_code', 'granted_consent', 'executed_command'] });
  for (const id of ['sessions', 'grants', 'endpoint', 'persistence', 'followup']) assert.ok(consent.nextSteps.some(step => step.id === id));
  assert.match(consent.nextSteps.find(step => step.id === 'followup')!.detail, /does not show/u);
  assert.throws(() => reviewIdentityIncident({ reportedActions: ['unknown'] }), /Reported action/u);
});
