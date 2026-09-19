import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailRecipient, recipientMailto } from '../packages/evidence/email-recipient.mts';
import { outreachAction } from '../frontend/src/lib/drafts.ts';
import { resolveAbuseRecipients } from '../frontend/src/lib/analysis/abuse-recipient-resolver.ts';

function resolved(contact: string) {
  return resolveAbuseRecipients({ registryInsights: { version: 1, publications: [], abuseRouting: [
    { kind: 'registrar', channel: 'email', contact, source: 'Fixture publication' },
  ] } }).recipients;
}

test('a contact cannot add recipients or headers to a manually opened message', () => {
  for (const address of ['abuse@example.test?subject=injected&body=text', 'abuse@example.test#part',
    'abuse@example.test,bcc@example.test', 'abuse@example.test&bcc=another@example.test',
    'abuse@example.test\r\nBcc: another@example.test', 'a'.repeat(321)]) {
    assert.equal(emailRecipient(address), null, address);
    assert.equal(recipientMailto(address), null, address);
    assert.equal(outreachAction('example.test', { email: address }), null, address);
    assert.deepEqual(resolved(address), [], address);
  }
});

test('plus-addressing and literal percent characters stay in the recipient, while only authored headers are emitted', () => {
  const address = 'review+case%23@example.test';
  const uri = recipientMailto(address, { subject: 'Reviewed & bounded', body: 'Line 1\nLine 2' });
  assert.ok(uri);
  assert.equal(uri, 'mailto:review%2Bcase%2523@example.test?subject=Reviewed%20%26%20bounded&body=Line%201%0ALine%202');
  const parsed = new URL(uri);
  assert.equal(decodeURIComponent(parsed.pathname), address);
  assert.deepEqual([...parsed.searchParams], [['subject', 'Reviewed & bounded'], ['body', 'Line 1\nLine 2']]);
  assert.equal(parsed.hash, '');
  assert.equal(resolved('mailto:review%2Bcase@example.test?bcc=ignored@example.test')[0]?.contact, 'review+case@example.test');
  assert.deepEqual(resolved('mailto:review%0D%0ABcc%3Aother@example.test'), []);
});
