import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const PRIVACY_PATH = new URL('../PRIVACY.md', import.meta.url);
const PRIVACY_PAGE_PATH = new URL('../frontend/src/routes/(public)/privacy/+page.svelte', import.meta.url);

describe('authoritative DNS privacy copy', () => {
  test('documents the bounded direct record queries in both privacy surfaces', async () => {
    const [documentation, page] = await Promise.all([
      readFile(PRIVACY_PATH, 'utf8'),
      readFile(PRIVACY_PAGE_PATH, 'utf8'),
    ]);
    for (const text of [documentation, page]) {
      assert.match(text, /query A, AAAA, CAA,? and MX once through one selected\s+public address per nameserver/iu);
      assert.match(text, /retaining at most sixteen normalised values\s+for each record type/iu);
    }
  });
});
