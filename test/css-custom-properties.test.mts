import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const FRONTEND_SOURCE = fileURLToPath(new URL('../frontend/src/', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:css|svelte)$/u.test(entry.name) ? [path] : [];
  });
}

test('every CSS custom-property reference has a definition or explicit fallback', () => {
  const definitions = new Set<string>();
  const references: Array<{ file: string; property: string; hasFallback: boolean }> = [];
  for (const file of sourceFiles(FRONTEND_SOURCE)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?<![\w-])(--[a-z][\w-]*)\s*:/giu)) {
      const property = match[1];
      if (property) definitions.add(property);
    }
    for (const match of source.matchAll(/var\(\s*(--[a-z][\w-]*)(\s*,)?/giu)) {
      const property = match[1];
      if (property) references.push({
        file: file.slice(FRONTEND_SOURCE.length + 1),
        property,
        hasFallback: Boolean(match[2]),
      });
    }
  }

  const unresolved = references
    .filter(({ property, hasFallback }) => !definitions.has(property) && !hasFallback)
    .map(({ file, property }) => `${file}: ${property}`)
    .sort();
  assert.deepEqual(unresolved, []);
});
