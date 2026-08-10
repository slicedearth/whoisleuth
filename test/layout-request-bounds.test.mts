import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CONSOLE_LAYOUT = new URL('../frontend/src/routes/(console)/+layout.svelte', import.meta.url);
const PUBLIC_LAYOUT = new URL('../frontend/src/routes/(public)/+layout.svelte', import.meta.url);

test('both sign-out surfaces use the shared bounded response reader with a deadline', () => {
  for (const path of [CONSOLE_LAYOUT, PUBLIC_LAYOUT]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /requestJsonCapped\('\/api\/logout',\{method:'POST'\},\{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000\}\)/u);
    assert.doesNotMatch(source, /fetch\('\/api\/logout'/u);
  }
});
