import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPublicLinks, MAX_PUBLIC_LINK_TEXT_BYTES, MAX_PUBLIC_LINK_URL_BYTES } from '../frontend/src/lib/analysis/public-link-inspector.ts';
import { MAX_INTAKE_LINKS } from '../packages/contracts/message-intake.mts';

test('public link review distinguishes supplied spelling, normalised host and displayed destination without collection', () => {
  const supplied = 'hxxps://EXAMPLE[.]COM/private?token=private-marker#local';
  const result = inspectPublicLinks('link', supplied, 'different.example');
  assert.equal(result.state, 'reviewed');
  if (result.state !== 'reviewed') return;
  assert.equal(supplied, 'hxxps://EXAMPLE[.]COM/private?token=private-marker#local');
  assert.equal(result.intake.links[0]?.hostname, 'example.com');
  assert.equal(result.intake.links[0]?.displayedHostname, 'different.example');
  assert.equal(result.intake.links[0]?.displayedDestination, 'different_host');
  assert.equal(result.intake.targets[0]?.exactUrl, 'https://example.com/private?token=private-marker#local');
  assert.ok(!JSON.stringify(result.intake.links).includes('private-marker'));
});

test('public link review preserves exact supported path punctuation and separate embedded link identity', () => {
  const direct = inspectPublicLinks('link', 'https://parent.example/report!');
  assert.equal(direct.state, 'reviewed');
  if (direct.state !== 'reviewed') return;
  assert.equal(direct.intake.targets[0]?.exactUrl, 'https://parent.example/report!');
  const nested = inspectPublicLinks('link', 'https://parent.example/?next=https%3A%2F%2Fchild.example%2Fprivate%3Ftoken%3Dchild-marker');
  assert.equal(nested.state, 'reviewed');
  if (nested.state !== 'reviewed') return;
  assert.deepEqual(nested.intake.links.map(link => [link.id, link.hostname, link.parentId]), [
    ['link-1', 'parent.example', null], ['link-2', 'child.example', 'link-1'],
  ]);
  assert.equal(nested.intake.targets[1]?.exactUrl, 'https://child.example/private?token=child-marker');
});

test('public link review rejects unsupported destinations through fixed non-sensitive explanations', () => {
  for (const input of ['https://private-user:private-password@target.example/', 'ftp://target.example/private-marker', 'https://127.0.0.1/', 'https://localhost/', 'https://target.example:8443/', 'javascript:private-marker', 'https://[::1]/']) {
    const result = inspectPublicLinks('link', input);
    assert.equal(result.state, 'reviewed');
    if (result.state !== 'reviewed') continue;
    assert.equal(result.intake.links.length, 0);
    assert.equal(result.intake.targets.length, 0);
    assert.equal(result.intake.rejected, 1);
    assert.ok(result.intake.limitations.length > 0);
    assert.doesNotMatch(JSON.stringify(result.intake), /private-(?:user|password|marker)/u);
  }
});

test('public input byte admission accepts its exact boundary and refuses multibyte overflow before parsing', () => {
  const prefix = 'https://boundary.example/?x=';
  const exact = prefix + 'a'.repeat(MAX_PUBLIC_LINK_URL_BYTES - prefix.length);
  const accepted = inspectPublicLinks('link', exact);
  assert.equal(accepted.state, 'reviewed');
  if (accepted.state === 'reviewed') assert.equal(accepted.intake.links.length, 1);
  assert.equal(inspectPublicLinks('link', exact + 'a').state, 'unavailable');
  assert.equal(inspectPublicLinks('link', 'é'.repeat(MAX_PUBLIC_LINK_URL_BYTES / 2 + 1)).state, 'unavailable');
  assert.equal(inspectPublicLinks('text', 'a'.repeat(MAX_PUBLIC_LINK_TEXT_BYTES)).state, 'reviewed');
  assert.equal(inspectPublicLinks('text', 'a'.repeat(MAX_PUBLIC_LINK_TEXT_BYTES + 1)).state, 'unavailable');
  assert.equal(inspectPublicLinks('link', 'https://target.example/', 'é'.repeat(MAX_PUBLIC_LINK_URL_BYTES / 2 + 1)).state, 'unavailable');
  assert.equal(inspectPublicLinks('text', '').state, 'unavailable');
});

test('pasted text uses existing prose cleanup, Unicode admission and bounded output without favourable conclusions', () => {
  const result = inspectPublicLinks('text', 'Supplied <script>private-marker</script> (https://example.com/path). https://b\u00fccher.example/');
  assert.equal(result.state, 'reviewed');
  if (result.state !== 'reviewed') return;
  assert.deepEqual(result.intake.targets.map(target => target.exactUrl), ['https://example.com/path', 'https://xn--bcher-kva.example/']);
  assert.doesNotMatch(JSON.stringify(result.intake.links), /<script>|private-marker/u);
  const bounded = inspectPublicLinks('text', Array.from({ length: MAX_INTAKE_LINKS + 1 }, (_, index) => `https://link-${index}.example/`).join('\n'));
  assert.equal(bounded.state, 'reviewed');
  if (bounded.state !== 'reviewed') return;
  assert.equal(bounded.intake.links.length, MAX_INTAKE_LINKS);
  assert.equal(bounded.intake.bounded, true);
});
