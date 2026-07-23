const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { dirname, extname, join, relative, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const DOCS_DIRECTORY = join(ROOT, 'docs');
const DOCUMENTATION_FILES = [
  join(ROOT, 'README.md'),
  ...readdirSync(DOCS_DIRECTORY)
    .filter((name) => extname(name).toLowerCase() === '.md')
    .sort()
    .map((name) => join(DOCS_DIRECTORY, name)),
];
const REQUIRED_GUIDES = [
  'docs/application-guide.md',
  'docs/getting-started.md',
  'docs/operations.md',
];

function sourceLinesOutsideFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  const visible = [];
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence === null) visible.push({ line, lineNumber: index + 1 });
  }

  return visible;
}

function githubHeadingSlug(value) {
  return value
    .replace(/`([^`]*)`/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownHeadingAnchors(file) {
  const counts = new Map();
  const anchors = new Set();

  for (const { line } of sourceLinesOutsideFences(readFileSync(file, 'utf8'))) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = githubHeadingSlug(match[1]);
    if (!base) continue;
    const count = counts.get(base) || 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }

  return anchors;
}

function localMarkdownLinks(file) {
  const links = [];
  const linkPattern = /!?\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;

  for (const { line, lineNumber } of sourceLinesOutsideFences(readFileSync(file, 'utf8'))) {
    for (const match of line.matchAll(linkPattern)) {
      const target = match[1];
      if (/^(?:https?:|mailto:)/i.test(target) || target.startsWith('/')) continue;
      links.push({ lineNumber, target });
    }
  }

  return links;
}

describe('documentation links', () => {
  test('keeps the operator and application guides in the documentation set', () => {
    const documented = new Set(DOCUMENTATION_FILES.map((file) => relative(ROOT, file)));
    for (const guide of REQUIRED_GUIDES) assert.equal(documented.has(guide), true, `${guide} is not covered`);
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
