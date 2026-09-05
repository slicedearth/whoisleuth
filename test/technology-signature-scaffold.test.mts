import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import {
  TECHNOLOGY_CATEGORIES,
  TECHNOLOGY_EVIDENCE_SOURCES,
} from '../lib/website-technology.mts';
import {
  TECHNOLOGY_SCAFFOLD_SOURCE_MAP,
  buildTechnologySignatureScaffold,
  main,
  parseTechnologySignatureScaffoldArguments,
  technologySignatureScaffoldTemplate,
} from '../tools/technology-signature-scaffold.mts';

type ScaffoldInput = Readonly<{
  generator?: string;
  html?: string;
  resourceOrigins?: readonly string[];
  httpServer?: string;
  responseHeaders?: Readonly<Record<string, string>>;
}>;

const templateFactories = Object.freeze({
  generatorEvidence: (pattern: RegExp) => ({
    matches: (input: ScaffoldInput) => pattern.test(input.generator || ''),
  }),
  htmlEvidence: (markers: readonly string[]) => ({
    matches: (input: ScaffoldInput) => markers.some((marker) => (
      (input.html || '').toLowerCase().includes(marker.toLowerCase())
    )),
  }),
  resourceEvidence: (hosts: readonly string[]) => ({
    matches: (input: ScaffoldInput) => (input.resourceOrigins || []).some((origin) => {
      const hostname = new URL(origin).hostname.toLowerCase();
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    }),
  }),
  serverEvidence: (pattern: RegExp) => ({
    matches: (input: ScaffoldInput) => pattern.test(input.httpServer || ''),
  }),
  responseHeaderEvidence: (name: string, pattern: RegExp) => ({
    matches: (input: ScaffoldInput) => pattern.test(input.responseHeaders?.[name] || ''),
  }),
});

describe('technology-signature authoring scaffold', () => {
  test('creates paired synthetic positive and benign-negative fixtures', () => {
    const input = parseTechnologySignatureScaffoldArguments([
      '--id=fixture-commerce',
      '--name=Fixture Commerce',
      '--category=commerce',
      '--source=html',
    ]);
    const scaffold = buildTechnologySignatureScaffold(input);
    assert.match(scaffold, /id: 'fixture-commerce'/u);
    assert.match(scaffold, /positive\('fixture-commerce'/u);
    assert.match(scaffold, /negative-/u);
    assert.match(scaffold, /likely false positive/u);
    assert.match(scaffold, /never paste live page data/iu);
    assert.doesNotMatch(scaffold, /https:\/\/example\.com/u);
  });

  test('supports each bounded evidence-source template', () => {
    for (const source of Object.keys(TECHNOLOGY_SCAFFOLD_SOURCE_MAP)) {
      const input = parseTechnologySignatureScaffoldArguments([
        `--id=fixture-${source}`,
        `--name=Fixture ${source}`,
        '--category=application runtime',
        `--source=${source}`,
      ]);
      const scaffold = buildTechnologySignatureScaffold(input);
      assert.match(scaffold, new RegExp(`fixture-${source}`, 'u'));
      assert.match(scaffold, /npm run benchmark:technology/u);

      const template = technologySignatureScaffoldTemplate(input.source);
      const matcher = runInNewContext(template.evidence, templateFactories) as {
        matches(candidate: ScaffoldInput): boolean;
      };
      const positive = runInNewContext(`(${template.positiveInput})`) as ScaffoldInput;
      const benign = runInNewContext(`(${template.benignInput})`) as ScaffoldInput;
      assert.equal(matcher.matches(positive), true, `${source} positive template must match`);
      assert.equal(matcher.matches(benign), false, `${source} benign template must not match`);
    }

    assert.deepEqual(
      [...new Set(Object.values(TECHNOLOGY_SCAFFOLD_SOURCE_MAP))].sort(),
      [...TECHNOLOGY_EVIDENCE_SOURCES].sort(),
    );
    assert.ok(TECHNOLOGY_CATEGORIES.includes('application runtime'));
  });

  test('quotes permitted names as valid string literals', () => {
    const name = "Analyst's \\ Fixture";
    const input = parseTechnologySignatureScaffoldArguments([
      '--id=fixture-quoted',
      `--name=${name}`,
      '--category=application runtime',
      '--source=response-header',
    ]);
    const scaffold = buildTechnologySignatureScaffold(input);
    const labelLine = scaffold.split('\n').find((line) => (
      line.includes('named without an implementation marker')
    ));
    assert.ok(labelLine);
    assert.equal(
      JSON.parse(labelLine.trim().replace(/,$/u, '')),
      `${name} named without an implementation marker`,
    );
  });

  test('rejects unknown fields and unsafe metadata without writing a scaffold', () => {
    assert.throws(
      () => parseTechnologySignatureScaffoldArguments([
        '--id=fixture',
        '--name=Fixture',
        '--category=commerce',
        '--source=html',
        '--html=<script>',
      ]),
      /Unknown option/u,
    );

    let stdout = '';
    let stderr = '';
    assert.equal(main([
      '--id=Fixture Space',
      '--name=Fixture',
      '--category=commerce',
      '--source=html',
    ], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
    }), 2);
    assert.equal(stdout, '');
    assert.match(stderr, /lowercase hyphenated/u);
  });
});
