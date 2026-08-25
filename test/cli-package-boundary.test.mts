import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import packageJson from '../package.json' with { type: 'json' };
import packageTemplate from '../packages/cli/package.template.json' with { type: 'json' };
import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../lib/project-metadata.mts';
import { CLI_PACKAGE_SUPPORT_FILES } from '../tools/cli-package.mts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('CLI package boundary', () => {
  test('remains private and does not advertise an application library entry point', () => {
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.license, 'AGPL-3.0-only');
    assert.equal(Object.hasOwn(packageJson, 'main'), false);
    assert.match(packageJson.description, /local-first domain intelligence/u);
    assert.deepEqual(packageJson.keywords, [
      'whois',
      'rdap',
      'dns',
      'domain-intelligence',
      'brand-protection',
      'typosquatting',
      'certificate-transparency',
      'osint',
      'threat-intelligence',
      'asn',
    ]);
  });

  test('leaves distributable metadata to the scoped package builder', () => {
    const packageReadme = readFileSync(join(__dirname, '..', 'packages', 'cli', 'README.md'), 'utf8');
    assert.equal(Object.hasOwn(packageJson, 'files'), false);
    assert.equal(Object.hasOwn(packageJson, 'bin'), false);
    assert.equal(packageTemplate.private, true);
    assert.equal(packageTemplate.author, 'slicedearth');
    assert.deepEqual(packageTemplate.contentPolicy, { class: 'dual-use' });
    assert.deepEqual(packageTemplate.bin, { whoisleuth: 'bin/whoisleuth.mjs' });
    assert.equal(packageTemplate.repository.url, WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL);
    assert.equal(packageTemplate.homepage, WHOISLEUTH_PROJECT_URL);
    assert.equal(packageTemplate.bugs.url, WHOISLEUTH_SOURCE_ISSUES_URL);
    assert.match(readFileSync(join(__dirname, '..', 'DISCLOSURE'), 'utf8'), /defensive domain investigation/u);
    assert.match(readFileSync(join(__dirname, '..', 'SECURITY.md'), 'utf8'), /private vulnerability reporting/u);
    assert.match(packageReadme, /npm install --global --ignore-scripts @slicedearth\/whoisleuth-cli/u);
    assert.match(packageReadme, /does not use the hosted WHOISleuth login or workspace/u);
    assert.match(packageReadme, /private channel in `SECURITY\.md`/u);
    assert.doesNotMatch(packageReadme, /whois-rdap-tool/u);
  });

  test('keeps the source CLI entry point executable for repository use', () => {
    const mode = statSync(join(__dirname, '..', 'bin/whoisleuth.mts')).mode;
    assert.notEqual(mode & 0o111, 0);
  });

  test('keeps relative Markdown links inside the installed support-file boundary', () => {
    const packagedDestinations = new Set<string>(
      CLI_PACKAGE_SUPPORT_FILES.map(([, destination]) => destination),
    );
    for (const [source, destination] of CLI_PACKAGE_SUPPORT_FILES) {
      if (!source.endsWith('.md')) continue;
      const markdown = readFileSync(join(__dirname, '..', source), 'utf8');
      for (const match of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
        const href = match[1] ?? '';
        if (/^(?:https?:|mailto:|#)/u.test(href)) continue;
        const path = href.split(/[?#]/u, 1)[0] ?? '';
        const resolved = posix.normalize(posix.join(posix.dirname(destination), path));
        assert.ok(
          packagedDestinations.has(resolved),
          `${destination} links to ${href}, which is not included in the installed package.`,
        );
      }
    }
  });
});
