import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCUMENTATION_FILES = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
}).split('\0'))]
  .filter((file) => /^(?:[^/]+\.md|docs\/.*\.md|packages\/.*\.md)$/u.test(file))
  .map((file) => join(ROOT, file)).filter(existsSync).sort();
const REQUIRED_GUIDES = [
  'docs/application-guide.md',
  'docs/getting-started.md',
  'docs/operations.md',
];

function sourceLinesOutsideFences(markdown: string): Array<{ line: string; lineNumber: number }> {
  const lines = markdown.split(/\r?\n/);
  const visible: Array<{ line: string; lineNumber: number }> = [];
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = requiredValue(lines[index]);
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = requiredValue(fenceMatch[1]).charAt(0);
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence === null) visible.push({ line, lineNumber: index + 1 });
  }

  return visible;
}

function githubHeadingSlug(value: string): string {
  return value
    .replace(/`([^`]*)`/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownHeadingAnchors(file: string): Set<string> {
  const counts = new Map<string, number>();
  const anchors = new Set<string>();

  for (const { line } of sourceLinesOutsideFences(readFileSync(file, 'utf8'))) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = githubHeadingSlug(requiredValue(match[1]));
    if (!base) continue;
    const count = counts.get(base) || 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }

  return anchors;
}

function localMarkdownLinks(file: string): Array<{ lineNumber: number; target: string }> {
  const links: Array<{ lineNumber: number; target: string }> = [];
  const linkPattern = /!?\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
  const htmlAttributePattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

  for (const { line, lineNumber } of sourceLinesOutsideFences(readFileSync(file, 'utf8'))) {
    for (const match of line.matchAll(linkPattern)) {
      const target = requiredValue(match[1]);
      if (/^(?:https?:|mailto:|data:)/i.test(target) || target.startsWith('/')) continue;
      links.push({ lineNumber, target });
    }
    for (const match of line.matchAll(htmlAttributePattern)) {
      const target = requiredValue(match[1]);
      if (/^(?:https?:|mailto:|data:)/i.test(target) || target.startsWith('/')) continue;
      links.push({ lineNumber, target });
    }
  }

  return links;
}

describe('documentation links', () => {
  test('keeps the operator and application guides in the documentation set', () => {
    const documented = new Set(DOCUMENTATION_FILES.map((file) => relative(ROOT, file)));
    for (const guide of REQUIRED_GUIDES) assert.equal(documented.has(guide), true, `${guide} is not covered`);
    for (const document of ['README.md', 'PRIVACY.md', 'SECURITY.md']) assert.equal(documented.has(document), true, `${document} is not covered`);
    assert.equal([...documented].some((file) => /^packages\/[^/]+\/README\.md$/u.test(file)), true);
  });

  test('documents existing contributor commands without freezing wording or fence order', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const file of ['README.md', 'CONTRIBUTING.md', 'docs/getting-started.md']) {
      const commands = [...readFileSync(join(ROOT, file), 'utf8').matchAll(/npm run ([a-z][a-z0-9:.-]*)/gu)];
      assert.ok(commands.length > 0, file);
      for (const [, command] of commands) assert.ok(Object.hasOwn(manifest.scripts, command!), `${file}: unknown command ${command}`);
    }
  });

  test('resolves local paths and Markdown heading fragments', () => {
    const failures = [];
    const anchorCache = new Map();

    for (const sourceFile of DOCUMENTATION_FILES) {
      for (const { lineNumber, target } of localMarkdownLinks(sourceFile)) {
        let decoded;
        try {
          decoded = decodeURIComponent(target);
        } catch {
          failures.push(`${relative(ROOT, sourceFile)}:${lineNumber} has an invalid encoded link: ${target}`);
          continue;
        }

        const [pathPart, fragment = ''] = decoded.split('#', 2);
        const targetFile = pathPart ? resolve(dirname(sourceFile), pathPart) : sourceFile;
        if (!existsSync(targetFile)) {
          failures.push(`${relative(ROOT, sourceFile)}:${lineNumber} links to missing path ${target}`);
          continue;
        }
        if (!fragment || extname(targetFile).toLowerCase() !== '.md') continue;

        let anchors = anchorCache.get(targetFile);
        if (!anchors) {
          anchors = markdownHeadingAnchors(targetFile);
          anchorCache.set(targetFile, anchors);
        }
        if (!anchors.has(fragment.toLowerCase())) {
          failures.push(`${relative(ROOT, sourceFile)}:${lineNumber} links to missing heading ${target}`);
        }
      }
    }

    assert.deepEqual(failures, []);
  });
});
