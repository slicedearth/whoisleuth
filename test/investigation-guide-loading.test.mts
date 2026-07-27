import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consoleLayout = await readFile(
  new URL('../frontend/src/routes/(console)/+layout.svelte', import.meta.url),
  'utf8',
);
const storageBoundary = await readFile(
  new URL('../frontend/src/lib/investigation-guide-storage.ts', import.meta.url),
  'utf8',
);

test('console layout loads the investigation guide only when stored or requested', () => {
  assert.doesNotMatch(
    consoleLayout,
    /import\s+InvestigationGuide\s+from\s+['"]\$lib\/components\/InvestigationGuide\.svelte['"]/u,
  );
  assert.match(
    consoleLayout,
    /import\(['"]\$lib\/components\/InvestigationGuide\.svelte['"]\)/u,
  );
  assert.match(consoleLayout, /hasStoredInvestigationGuide\(\)/u);
  assert.match(consoleLayout, /INVESTIGATION_GUIDE_EVENT/u);
});

test('guide presence check remains independent of the full guide model', () => {
  assert.doesNotMatch(storageBoundary, /from\s+['"].*investigation-guide(?:\.ts)?['"]/u);
  assert.doesNotMatch(storageBoundary, /from\s+['"](?:tldts|.*analysis.*)['"]/u);
  assert.match(storageBoundary, /sessionStorage\.getItem/u);
});
