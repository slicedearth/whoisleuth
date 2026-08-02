import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from '../lib/security-headers.mts';

function headerRules(source: string): string[] {
  return source
    .split('[[headers]]')
    .slice(1)
    .map((block: string) => requiredValue(block.split(/\n\[\[/, 1)[0]));
}

test('prerendered responses resist edge script injection without weakening immutable assets', async () => {
  const source = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const rules = headerRules(source);
  const immutableIndex = rules.findIndex((rule: string) => /for = "\/_app\/immutable\/\*"/.test(rule));
  const fallbackIndex = rules.findIndex((rule: string) => /for = "\/\*"/.test(rule));

  assert.notEqual(immutableIndex, -1);
  assert.notEqual(fallbackIndex, -1);
  assert.ok(immutableIndex < fallbackIndex, 'the immutable rule must precede the fallback rule');
  assert.match(requiredValue(rules[immutableIndex]), /Cache-Control = "public, max-age=31536000, immutable"/);
  assert.doesNotMatch(requiredValue(rules[immutableIndex]), /no-transform/);
  for (const header of [
    'X-Content-Type-Options = "nosniff"',
    'X-Frame-Options = "DENY"',
    'Referrer-Policy = "strict-origin-when-cross-origin"',
    'Permissions-Policy = "camera=(), microphone=(), geolocation=()"',
    'Strict-Transport-Security = "max-age=31536000"',
  ]) {
    assert.ok(requiredValue(rules[immutableIndex]).includes(header), `expected immutable response header: ${header}`);
  }
  assert.match(
    requiredValue(rules[fallbackIndex]),
    /Cache-Control = "public, max-age=0, must-revalidate, no-transform"/,
  );
  assert.ok(
    requiredValue(rules[fallbackIndex]).includes(
      `Content-Security-Policy = "${HTTP_BASELINE_CONTENT_SECURITY_POLICY}"`,
    ),
  );
  assert.doesNotMatch(requiredValue(rules[immutableIndex]), /Content-Security-Policy/);
});
