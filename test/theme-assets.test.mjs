import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the shared magnifying-glass logo keeps its lens transparent', async () => {
  const svg = await readFile(new URL('../frontend/static/favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /<circle cx="26" cy="26" r="18" fill="none"/);
  assert.doesNotMatch(svg, /<circle cx="26" cy="26" r="18" fill="#[0-9a-f]+"/i);
});
