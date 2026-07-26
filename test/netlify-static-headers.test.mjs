import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function headerRules(source) {
  return source
    .split('[[headers]]')
    .slice(1)
    .map((block) => block.split(/\n\[\[/, 1)[0]);
}

test('prerendered responses resist edge script injection without weakening immutable assets', async () => {
  const source = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const rules = headerRules(source);
  const immutableIndex = rules.findIndex((rule) => /for = "\/_app\/immutable\/\*"/.test(rule));
  const fallbackIndex = rules.findIndex((rule) => /for = "\/\*"/.test(rule));

  assert.notEqual(immutableIndex, -1);
  assert.notEqual(fallbackIndex, -1);
  assert.ok(immutableIndex < fallbackIndex, 'the immutable rule must precede the fallback rule');
  assert.match(rules[immutableIndex], /Cache-Control = "public, max-age=31536000, immutable"/);
  assert.doesNotMatch(rules[immutableIndex], /no-transform/);
  for (const header of [
    'X-Content-Type-Options = "nosniff"',
    'X-Frame-Options = "DENY"',
    'Referrer-Policy = "strict-origin-when-cross-origin"',
    'Permissions-Policy = "camera=(), microphone=(), geolocation=()"',
    'Strict-Transport-Security = "max-age=31536000"',
  ]) {
    assert.ok(rules[immutableIndex].includes(header), `expected immutable response header: ${header}`);
  }
  assert.match(
    rules[fallbackIndex],
    /Cache-Control = "public, max-age=0, must-revalidate, no-transform"/,
  );
});
