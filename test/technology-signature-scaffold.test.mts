import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTechnologySignatureScaffold,
  main,
  parseTechnologySignatureScaffoldArguments,
} from '../tools/technology-signature-scaffold.mts';

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
    for (const source of ['generator', 'html', 'resource', 'server']) {
      const input = parseTechnologySignatureScaffoldArguments([
        `--id=fixture-${source}`,
        `--name=Fixture ${source}`,
        '--category=web framework',
        `--source=${source}`,
      ]);
      const scaffold = buildTechnologySignatureScaffold(input);
      assert.match(scaffold, new RegExp(`fixture-${source}`, 'u'));
      assert.match(scaffold, /npm run benchmark:technology/u);
    }
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
