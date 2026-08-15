import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { SCHEMA_SOURCE_CLASSIFICATIONS } from '../fixtures/schema-source-classifications.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';
import {
  discoverSchemaIdentifiersInSource,
  discoverSchemaSources,
  MAX_SCHEMA_SOURCE_CANDIDATE_BYTES,
  MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH,
  MAX_SCHEMA_SOURCE_FILE_BYTES,
  MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS,
  SCHEMA_SOURCE_NON_SOURCE_FILES,
  SCHEMA_SOURCE_ROOTS,
  validateSchemaSourceCoverage,
} from '../tools/schema-source-coverage.mts';
import type { SchemaCompatibilityEntry } from '../packages/contracts/schema-compatibility.mts';

const NOW = '2026-08-16T00:00:00.000Z';
const POLICY_SOURCE_FILE_BYTES = 2_097_152;
const POLICY_SOURCE_DIRECTORY_DEPTH = 32;
const POLICY_SCHEMA_CANDIDATE_BYTES = 4_096;
const POLICY_STATIC_EVALUATION_STEPS = 4_096;
const POLICY_SOURCE_ROOTS = Object.freeze([
  'bin',
  'cli',
  'frontend/src',
  'lib',
  'netlify/functions',
  'packages',
  'tools',
]);
const POLICY_NON_SOURCE_FILES = Object.freeze([
  'frontend/src/app.css',
  'frontend/src/app.html',
  'lib/generated/cisa-kev-catalog.sha256',
  'lib/generated/retire-browser-catalog.sha256',
  'packages/cli/README.md',
  'packages/web-capture/README.md',
]);

async function fixtureRepository(t: { after(callback: () => Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'whoisleuth-schema-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(POLICY_SOURCE_ROOTS.map((relative) => mkdir(path.join(root, relative), { recursive: true })));
  for (const relative of POLICY_NON_SOURCE_FILES) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), '', 'utf8');
  }
  await writeFile(path.join(root, 'server.mts'), 'export {};\n', 'utf8');
  return root;
}

function fixtureEntry(owner = 'lib/owner.mts'): SchemaCompatibilityEntry {
  return {
    id: 'derived.fixture',
    kind: 'derived',
    schema: 'whoisleuth.fixture',
    currentVersion: 1,
    supportedVersions: [1],
    acceptsUnversionedLegacy: false,
    futureVersionBehavior: 'reject',
    migration: 'exact_current_only',
    writeSemantics: 'none',
    byteBudget: null,
    owner,
    note: 'Synthetic schema-source ownership fixture.',
  };
}

describe('schema source coverage', () => {
  test('treats the reviewed lifecycle contract as metadata rather than a schema emitter', () => {
    const result = discoverSchemaIdentifiersInSource(`
      export function readLifecycle(value: { schema: string }) {
        return { schema: value.schema };
      }
    `, 'packages/contracts/schema-lifecycle.mts');
    assert.deepEqual(result.emitters, []);
    assert.deepEqual(result.dynamicConstructions, []);
  });

  test('keeps the independent source-scope and parser-bound policy fixed', () => {
    assert.deepEqual(SCHEMA_SOURCE_ROOTS, POLICY_SOURCE_ROOTS);
    assert.deepEqual(SCHEMA_SOURCE_NON_SOURCE_FILES, POLICY_NON_SOURCE_FILES);
    assert.equal(MAX_SCHEMA_SOURCE_FILE_BYTES, POLICY_SOURCE_FILE_BYTES);
    assert.equal(MAX_SCHEMA_SOURCE_DIRECTORY_DEPTH, POLICY_SOURCE_DIRECTORY_DEPTH);
    assert.equal(MAX_SCHEMA_SOURCE_CANDIDATE_BYTES, POLICY_SCHEMA_CANDIDATE_BYTES);
    assert.equal(MAX_SCHEMA_SOURCE_STATIC_EVALUATION_STEPS, POLICY_STATIC_EVALUATION_STEPS);
  });
  test('discovers literals and definitions while excluding comments', () => {
    const result = discoverSchemaIdentifiersInSource(`
      // const HIDDEN_SCHEMA = 'whoisleuth.hidden';
      const FIRST_SCHEMA = 'whoisleuth.alpha';
      const second = "https://whoisleuth.com/reference";
      const third = \`whoisleuth.beta\`;
      const dynamic = \`whoisleuth.dynamic-\${suffix}\`;
    `, 'fixture.mts');

    assert.deepEqual(
      [...new Set(result.occurrences.map((item) => item.identifier))].sort(),
      ['whoisleuth.alpha', 'whoisleuth.beta', 'whoisleuth.com'],
    );
    assert.deepEqual(result.definitions.map((item) => [item.identifier, item.symbol]), [
      ['whoisleuth.alpha', 'FIRST_SCHEMA'],
    ]);
    assert.equal(result.dynamicConstructions.length, 1);
    assert.equal(result.dynamicConstructions[0]?.identifier, null);
  });

  test('rejects case-shifted and dynamically assembled schema declarations', () => {
    const result = discoverSchemaIdentifiersInSource(`
      const CASE_SCHEMA = 'WHOISleuth.CaseShifted';
      const JOIN_SCHEMA = ['whoisleuth', '.joined'].join('');
      const REPLACE_SCHEMA = 'whoisleuth.base'.replace('base', 'replaced');
      const SPLIT_SCHEMA = 'whoisleuth' + '.split';
    `, 'fixture.mts');
    assert.ok(result.dynamicConstructions.some((item) => item.reason === 'case_changed'));
    assert.ok(result.dynamicConstructions.filter((item) => item.reason === 'non_literal_schema_declaration').length >= 3);
    assert.ok(result.dynamicConstructions.some((item) => item.identifier === 'whoisleuth.joined'));
    assert.ok(result.dynamicConstructions.some((item) => item.identifier === 'whoisleuth.replaced'));
    assert.ok(result.dynamicConstructions.some((item) => item.identifier === 'whoisleuth.split'));
  });

  test('bounds static reconstruction before allocation and rejects unresolved schema slots', () => {
    const joinParts = Array.from({ length: 5_000 }, () => "''").join(',');
    const separator = 'x'.repeat(10_000);
    assert.throws(
      () => discoverSchemaIdentifiersInSource(
        `const AMPLIFIED_SCHEMA = [${joinParts}].join('${separator}');`,
        'join-amplification.mts',
      ),
      (error: unknown) => error instanceof TypeError
        && !(error instanceof RangeError)
        && /candidate bytes/iu.test(error.message),
    );
    assert.throws(
      () => discoverSchemaIdentifiersInSource(
        `const AMPLIFIED_SCHEMA = 'whoisleuth.fixture'.replaceAll('', '${'x'.repeat(5_000)}');`,
        'replace-amplification.mts',
      ),
      (error: unknown) => error instanceof TypeError
        && !(error instanceof RangeError)
        && /candidate bytes/iu.test(error.message),
    );

    const reduce = discoverSchemaIdentifiersInSource(
      "export const output = { schema: ['whoisleuth', '.hidden'].reduce((left, right) => left + right) };",
      'reduce.mts',
    );
    assert.ok(reduce.dynamicConstructions.some((item) => item.reason === 'unresolved_schema_emitter'));
    assert.ok(reduce.emitters.some((item) => item.role === 'writer' && item.identifier === null));

    const dag = ["const S0 = '';", ...Array.from(
      { length: 32 },
      (_, index) => `const S${index + 1} = S${index} + S${index};`,
    ), "const DAG_SCHEMA = S32 + 'whoisleuth.fixture';"].join('\n');
    const dagResult = discoverSchemaIdentifiersInSource(dag, 'shared-dag.mts');
    assert.ok(dagResult.dynamicConstructions.some((item) => item.identifier === 'whoisleuth.fixture'));

    const stepParts = Array.from({ length: POLICY_STATIC_EVALUATION_STEPS + 1 }, () => "''").join(',');
    assert.throws(
      () => discoverSchemaIdentifiersInSource(
        `const STEP_SCHEMA = [${stepParts}].join('');`,
        'step-budget.mts',
      ),
      /static-evaluation steps/iu,
    );
  });

  test('does not truncate malformed or underscore-suffixed identifiers into valid tokens', () => {
    const result = discoverSchemaIdentifiersInSource(`
      const values = [
        'whoisleuth.false_extra',
        'whoisleuth.bad..suffix',
        'xwhoisleuth.false',
        'whoisleuth.valid-contract',
      ];
    `, 'boundaries.mts');
    assert.deepEqual(result.occurrences.map((item) => item.identifier), ['whoisleuth.valid-contract']);

    for (const value of ['whoisleuth.hidden_bad', 'whoisleuth.bad..suffix', 'whoisleuth.trailing.']) {
      const typeScript = discoverSchemaIdentifiersInSource(`export const value = { schema: '${value}' };`, 'malformed.mts');
      const json = discoverSchemaIdentifiersInSource(JSON.stringify({ schema: value }), 'malformed.json');
      assert.ok(typeScript.dynamicConstructions.some((item) => item.reason === 'malformed_schema_identifier'));
      assert.ok(json.dynamicConstructions.some((item) => item.reason === 'malformed_schema_identifier'));
    }
  });

  test('discovers Svelte script and markup identifiers without reading comments', () => {
    const result = discoverSchemaIdentifiersInSource(`
      <!-- whoisleuth.hidden -->
      <script lang="ts">
        export const PANEL_SCHEMA = 'whoisleuth.panel';
      </script>
      <a href="https://whoisleuth.com/help">Help</a>
    `, 'fixture.svelte');
    assert.deepEqual(
      [...new Set(result.occurrences.map((item) => item.identifier))].sort(),
      ['whoisleuth.com', 'whoisleuth.panel'],
    );
    assert.equal(result.definitions[0]?.symbol, 'PANEL_SCHEMA');
  });

  test('parses quoted greater-than characters in Svelte script attributes', () => {
    const result = discoverSchemaIdentifiersInSource(`
      <script lang="ts" data-label="angle > marker">
        export const PANEL_SCHEMA = 'whoisleuth.panel';
      </script>
    `, 'quoted-attribute.svelte');
    assert.equal(result.definitions[0]?.identifier, 'whoisleuth.panel');
  });

  test('ignores commented Svelte scripts and expression comments', () => {
    const result = discoverSchemaIdentifiersInSource(`
      <!-- <script>const HIDDEN_SCHEMA = 'whoisleuth.hidden-script';</script> -->
      {/* whoisleuth.hidden-expression */}
      <script lang="ts">export const VISIBLE_SCHEMA = 'whoisleuth.visible';</script>
    `, 'fixture.svelte');
    assert.deepEqual(result.occurrences.map((item) => item.identifier), ['whoisleuth.visible']);
  });

  test('reports the exact line for repeated Svelte markup identifiers', () => {
    const result = discoverSchemaIdentifiersInSource([
      '<p>whoisleuth.com</p>',
      '<p>unrelated</p>',
      '<p>whoisleuth.com</p>',
    ].join('\n'), 'fixture.svelte');
    assert.deepEqual(result.occurrences.map((item) => item.line), [1, 3]);
  });

  test('discovers identifiers in parsed JSON values', () => {
    const result = discoverSchemaIdentifiersInSource(JSON.stringify({
      schema: 'whoisleuth.fixture',
      homepage: 'https://whoisleuth.com/',
    }), 'fixture.json');
    assert.deepEqual(
      [...new Set(result.occurrences.map((item) => item.identifier))].sort(),
      ['whoisleuth.com', 'whoisleuth.fixture'],
    );
    assert.deepEqual(result.definitions, []);
  });

  test('discovers JSON keys without prefix false positives and bounds deep input', () => {
    const result = discoverSchemaIdentifiersInSource(JSON.stringify({
      'whoisleuth.key-contract': true,
      unrelated: 'notwhoisleuth.false-positive',
    }), 'fixture.json');
    assert.deepEqual(result.occurrences.map((item) => item.identifier), ['whoisleuth.key-contract']);

    const deep = `${'['.repeat(5_000)}null${']'.repeat(5_000)}`;
    assert.throws(
      () => discoverSchemaIdentifiersInSource(deep, 'deep.json'),
      (error: unknown) => error instanceof TypeError && !(error instanceof RangeError) && /nesting|level/iu.test(error.message),
    );
  });

  test('scans every admitted JavaScript and TypeScript source extension and rejects invalid syntax', () => {
    for (const extension of ['cjs', 'cts', 'js', 'jsx', 'mjs', 'mts', 'ts', 'tsx']) {
      const result = discoverSchemaIdentifiersInSource(
        `export const FIXTURE_SCHEMA = 'whoisleuth.${extension}-fixture';`,
        `fixture.${extension}`,
      );
      assert.equal(result.definitions[0]?.identifier, `whoisleuth.${extension}-fixture`);
    }
    assert.throws(
      () => discoverSchemaIdentifiersInSource('const BROKEN_SCHEMA = ;', 'broken.ts'),
      /valid source syntax/iu,
    );
    const deeplyNested = `${'('.repeat(1_000)}'whoisleuth.fixture'${')'.repeat(1_000)}`;
    assert.throws(
      () => discoverSchemaIdentifiersInSource(deeplyNested, 'deep.ts'),
      (error: unknown) => error instanceof TypeError
        && !(error instanceof RangeError)
        && /nesting|levels/iu.test(error.message),
    );
  });

  test('enforces the per-file source bound before parsing', () => {
    assert.throws(
      () => discoverSchemaIdentifiersInSource('x'.repeat(POLICY_SOURCE_FILE_BYTES + 1), 'oversize.mts'),
      /exceeds/iu,
    );
  });

  test('uses deterministic repository-relative evidence and refuses linked or invalid source bytes', async (t) => {
    const root = await fixtureRepository(t);
    await writeFile(path.join(root, 'lib', 'fixture.mts'), "export const FIXTURE_SCHEMA = 'whoisleuth.fixture';\n", 'utf8');
    const first = await discoverSchemaSources(root);
    const second = await discoverSchemaSources(root);
    assert.deepEqual(first.files, ['lib/fixture.mts', 'server.mts']);
    assert.equal(first.digestSha256, second.digestSha256);
    assert.equal(first.repositoryRoot, root);

    await symlink(path.join(root, 'lib', 'fixture.mts'), path.join(root, 'cli', 'linked.mts'));
    await assert.rejects(discoverSchemaSources(root), /must not be a symbolic link/iu);
    await rm(path.join(root, 'cli', 'linked.mts'));
    await writeFile(path.join(root, 'cli', 'invalid.mts'), Buffer.from([0xc3, 0x28]));
    await assert.rejects(discoverSchemaSources(root), /valid UTF-8/iu);
  });

  test('enforces file and traversal bounds before source accumulation', async (t) => {
    const root = await fixtureRepository(t);
    await writeFile(path.join(root, 'lib', 'oversize.mts'), Buffer.alloc(POLICY_SOURCE_FILE_BYTES + 1, 0x20));
    await assert.rejects(discoverSchemaSources(root), /exceeds .* bytes/iu);
    await rm(path.join(root, 'lib', 'oversize.mts'));

    let directory = path.join(root, 'lib');
    for (let depth = 0; depth <= POLICY_SOURCE_DIRECTORY_DEPTH; depth += 1) {
      directory = path.join(directory, `d${depth}`);
      await mkdir(directory);
    }
    await assert.rejects(discoverSchemaSources(root), /exceeds .* levels/iu);
  });

  test('fails closed when a new top-level source area is not classified', async (t) => {
    const root = await fixtureRepository(t);
    await mkdir(path.join(root, 'new-runtime'));
    await writeFile(
      path.join(root, 'new-runtime', 'contract.mts'),
      "export const NEW_SCHEMA = 'whoisleuth.new-runtime';\n",
      'utf8',
    );
    await assert.rejects(discoverSchemaSources(root), /unclassified source path.*new-runtime/iu);
    await rm(path.join(root, 'new-runtime'), { recursive: true, force: true });

    await mkdir(path.join(root, '.runtime'));
    await writeFile(path.join(root, '.runtime', 'contract.mts'), 'export {};\n', 'utf8');
    await assert.rejects(discoverSchemaSources(root), /unclassified source path.*\.runtime/iu);
    await rm(path.join(root, '.runtime'), { recursive: true, force: true });

    await mkdir(path.join(root, 'new-runtime'));
    await writeFile(path.join(root, 'new-runtime', 'contract.py'), 'SCHEMA = "whoisleuth.hidden"\n', 'utf8');
    await assert.rejects(discoverSchemaSources(root), /unclassified source path.*new-runtime/iu);
  });

  test('admits only the exact non-source files reviewed inside source roots', async (t) => {
    const root = await fixtureRepository(t);
    const discovery = await discoverSchemaSources(root);
    assert.deepEqual(discovery.files, ['server.mts']);

    await writeFile(
      path.join(root, 'frontend', 'src', 'unreviewed.html'),
      '<script type="application/json">{"schema":"whoisleuth.hidden"}</script>\n',
      'utf8',
    );
    await assert.rejects(discoverSchemaSources(root), /unclassified source path.*unreviewed\.html/iu);
    await rm(path.join(root, 'frontend', 'src', 'unreviewed.html'));

    const removedAllowance = POLICY_NON_SOURCE_FILES[0];
    assert.ok(removedAllowance);
    await rm(path.join(root, removedAllowance));
    await assert.rejects(discoverSchemaSources(root), /allowance is stale or missing.*app\.css/iu);
  });

  test('resolves exact imported aliases and rejects unrelated names and duplicate inline emitters', async (t) => {
    const root = await fixtureRepository(t);
    await mkdir(path.join(root, 'packages', 'contracts'), { recursive: true });
    await writeFile(
      path.join(root, 'packages', 'contracts', 'fixture.mts'),
      "export const FIXTURE_SCHEMA = 'whoisleuth.fixture';\n",
      'utf8',
    );
    await writeFile(
      path.join(root, 'lib', 'owner.mts'),
      "import { FIXTURE_SCHEMA as IMPORTED_SCHEMA } from '../packages/contracts/fixture.mts';\nconst OWNER_SCHEMA = IMPORTED_SCHEMA;\nexport const document = { schema: OWNER_SCHEMA };\n",
      'utf8',
    );
    const imported = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry()], imported, []),
      /not the canonical definition or a reviewed producer or reader/iu,
    );

    await writeFile(
      path.join(root, 'lib', 'owner.mts'),
      "import { FIXTURE_SCHEMA as IMPORTED_SCHEMA } from '../packages/contracts/fixture.mts';\nfunction wrap(IMPORTED_SCHEMA: string) { return { schema: IMPORTED_SCHEMA }; }\nexport { wrap };\n",
      'utf8',
    );
    const shadowed = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry()], shadowed, []),
      /do(?:es)? not resolve to canonical schema definitions?/iu,
    );

    await writeFile(
      path.join(root, 'lib', 'owner.mts'),
      "declare const FIXTURE_SCHEMA: string;\nexport const document = { schema: FIXTURE_SCHEMA };\n",
      'utf8',
    );
    const unrelated = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry()], unrelated, []),
      /do(?:es)? not resolve|owner .* is not bound/iu,
    );

    await writeFile(
      path.join(root, 'packages', 'contracts', 'fixture.mts'),
      "export const FIXTURE_SCHEMA = 'whoisleuth.fixture';\n",
      'utf8',
    );
    await writeFile(path.join(root, 'lib', 'owner.mts'), "export const first = { schema: 'whoisleuth.fixture' };\n", 'utf8');
    await writeFile(path.join(root, 'cli', 'second.mts'), "export const second = { schema: 'whoisleuth.fixture' };\n", 'utf8');
    const disconnected = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry()], disconnected, []),
      /unreviewed disconnected inline emitter/iu,
    );

    await writeFile(path.join(root, 'packages', 'contracts', 'fixture.mts'), 'export {};\n', 'utf8');
    await writeFile(path.join(root, 'lib', 'owner.mts'), "export const first = { schema: 'whoisleuth.fixture' };\n", 'utf8');
    await writeFile(path.join(root, 'cli', 'second.mts'), "export const second = { schema: 'whoisleuth.fixture' };\n", 'utf8');
    const duplicated = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry()], duplicated, []),
      /multiple inline emitters without one canonical definition/iu,
    );
  });

  test('fails closed for every reviewed dynamic schema-emitter form', async (t) => {
    const root = await fixtureRepository(t);
    const cases = [
      "export const value = { schema: 'whoisleuth'.concat('.hidden') };\n",
      "const schema = 'whoisleuth'.concat('.hidden'); export const value = { schema };\n",
      "const key = 'schema'; const value = 'whoisleuth.hidden'; export const output = { [key]: value };\n",
      "export const value = Object.freeze({ schema: 'whoisleuth'.concat('.hidden') });\n",
      "export const value = { schema: ['whoisleuth', '.hidden'].reduce((left, right) => left + right) };\n",
      "export const value = { get schema() { return 'whoisleuth'.concat('.hidden'); } };\n",
      "export class Value { schema = 'whoisleuth'.concat('.hidden'); }\n",
      "const value: Record<string, unknown> = {}; value.schema ||= 'whoisleuth'.concat('.hidden'); export { value };\n",
      "const value = {}; Object.defineProperty(value, 'schema', { value: 'whoisleuth'.concat('.hidden'), enumerable: true }); export { value };\n",
      "const value = {}; Reflect.set(value, 'schema', 'whoisleuth'.concat('.hidden')); export { value };\n",
      "const value = {}; Reflect.defineProperty(value, 'schema', { value: 'whoisleuth'.concat('.hidden'), enumerable: true }); export { value };\n",
      "export const value = <Widget schema={'whoisleuth'.concat('.hidden')} />;\n",
      "const key = ['sch', 'ema'].reduce((left, right) => left + right); const prefix = 'whois' + 'leuth'; export const value = { [key]: prefix + '.hidden' };\n",
      "const key = 'schema'; const value: Record<string, unknown> = {}; value[key] = 'whoisleuth.hidden'; export { value };\n",
      "const key = 'schema'; export const value = Object.fromEntries([[key, 'whoisleuth.hidden']]);\n",
      "const key = ['sch', 'ema'].reduce((left, right) => left + right); const prefix = ['whois', 'leuth'].reduce((left, right) => left + right); export const value = { [key]: prefix + '.hidden' };\n",
    ];
    for (const [index, source] of cases.entries()) {
      const extension = source.includes('<Widget') ? 'tsx' : 'mts';
      await writeFile(path.join(root, 'lib', `dynamic-${index}.${extension}`), source, 'utf8');
      const discovery = await discoverSchemaSources(root);
      assert.ok(discovery.emitters.length > 0 || discovery.dynamicConstructions.length > 0);
      await assert.rejects(
        validateSchemaSourceCoverage([], discovery, []),
        /unsafe|do(?:es)? not resolve|not inventoried/iu,
      );
      await rm(path.join(root, 'lib', `dynamic-${index}.${extension}`));
    }


    for (const [index, source] of [
      "<Widget schema={'whoisleuth'.concat('.hidden')} />",
      "<Widget value={{ schema: 'whoisleuth'.concat('.hidden') }} />",
      '<Widget schema="whoisleuth.hidden" />',
      '<Widget schema="whois&#108;euth.hidden" />',
      '<Widget schema="whois&#x6c;euth.hidden" />',
      '<Widget schema="whoisleuth&period;hidden" />',
      "<script>const schema = 'whoisleuth'.concat('.hidden');</script><Widget {schema} />",
      "<script>const schema = 'whoisleuth'.concat('.hidden');</script><Widget {...schema} />",
      "<script>const marker = 'whoisleuth'.concat('.hidden');</script><Widget bind:schema={marker} />",
    ].entries()) {
      await writeFile(path.join(root, 'frontend', 'src', `dynamic-markup-${index}.svelte`), source, 'utf8');
      const discovery = await discoverSchemaSources(root);
      assert.ok(discovery.emitters.length > 0 || discovery.dynamicConstructions.length > 0);
      await assert.rejects(validateSchemaSourceCoverage([], discovery, []), /unsafe|do(?:es)? not resolve|not inventoried/iu);
      await rm(path.join(root, 'frontend', 'src', `dynamic-markup-${index}.svelte`));
    }

    await mkdir(path.join(root, 'packages', 'contracts'), { recursive: true });
    await writeFile(
      path.join(root, 'packages', 'contracts', 'fixture.mts'),
      "export const FIXTURE_SCHEMA = 'whoisleuth.fixture';\n",
      'utf8',
    );
    await writeFile(
      path.join(root, 'lib', 'renamed-import.mts'),
      "import { FIXTURE_SCHEMA as marker } from '../packages/contracts/fixture.mts';\ndeclare function key(): string;\nconst aliased = marker;\nconst pairs = [['schema', marker]];\nlet reassigned: unknown[] = []; reassigned = [['schema', marker]];\nconst pushed: unknown[] = []; pushed.push(['schema', marker]);\nconst first = { [key()]: marker };\nconst second: Record<string, unknown> = {}; second[key()] = aliased;\nconst third = Object.fromEntries(pairs);\nconst fourth = Object.fromEntries(reassigned);\nconst fifth = Object.fromEntries(pushed);\nexport { first, second, third, fourth, fifth };\n",
      'utf8',
    );
    const renamedImport = await discoverSchemaSources(root);
    assert.ok(renamedImport.emitters.filter((item) => item.file === 'lib/renamed-import.mts').length >= 5
      || renamedImport.dynamicConstructions.filter((item) => item.file === 'lib/renamed-import.mts').length >= 5);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry('packages/contracts/fixture.mts')], renamedImport, []),
      /unsafe|do(?:es)? not resolve|not inventoried|unreviewed disconnected/iu,
    );

    for (const source of [
      "import { FIXTURE_SCHEMA as marker } from '../packages/contracts/fixture.mts'; declare function key(): string; { const value = 'ordinary'; void value; } { const value = marker; const output: Record<string, unknown> = {}; output[key()] = value; void output; }",
      "import { FIXTURE_SCHEMA as marker } from '../packages/contracts/fixture.mts'; { const pairs: unknown[] = []; void pairs; } { const pairs = [['schema', marker]]; Object.fromEntries(pairs); }",
      "import { FIXTURE_SCHEMA as marker } from '../packages/contracts/fixture.mts'; { const pair: unknown[] = []; void pair; } { const pair = ['schema', marker]; Object.fromEntries([pair]); }",
    ]) {
      const collision = discoverSchemaIdentifiersInSource(source, 'lib/collision.mts');
      assert.ok(collision.emitters.length > 0 || collision.dynamicConstructions.length > 0);
    }
  });

  test('does not let non-schema classifications or metadata registries mask ownership', async (t) => {
    const root = await fixtureRepository(t);
    await writeFile(path.join(root, 'lib', 'project-metadata.mts'), "export const homepage = 'https://whoisleuth.com/';\n", 'utf8');
    await writeFile(path.join(root, 'cli', 'emitter.mts'), "export const output = { schema: 'whoisleuth.com' };\n", 'utf8');
    const masked = await discoverSchemaSources(root);
    await assert.rejects(validateSchemaSourceCoverage([], masked, [{
      identifier: 'whoisleuth.com',
      kind: 'non_schema',
      reason: 'public_site_hostname',
      owner: 'lib/project-metadata.mts',
      sourceUses: [{ file: 'lib/project-metadata.mts', literalOccurrences: 1, dynamicConstructions: 0 }],
      relatedEntryIds: [],
      note: 'Synthetic public hostname classification.',
    }]), /cannot mask a schema emitter|expected 0 literal/iu);

    await writeFile(path.join(root, 'cli', 'emitter.mts'), "export class Contract { schema = 'whoisleuth.com'; }\n", 'utf8');
    const classFieldMasked = await discoverSchemaSources(root);
    await assert.rejects(validateSchemaSourceCoverage([], classFieldMasked, [{
      identifier: 'whoisleuth.com',
      kind: 'non_schema',
      reason: 'public_site_hostname',
      owner: 'lib/project-metadata.mts',
      sourceUses: [{ file: 'lib/project-metadata.mts', literalOccurrences: 1, dynamicConstructions: 0 }],
      relatedEntryIds: [],
      note: 'Synthetic public hostname classification.',
    }]), /cannot mask a schema emitter|expected 0 literal/iu);

    await rm(path.join(root, 'cli', 'emitter.mts'));
    await rm(path.join(root, 'lib', 'project-metadata.mts'));
    await mkdir(path.join(root, 'packages', 'contracts'), { recursive: true });
    await writeFile(
      path.join(root, 'packages', 'contracts', 'fixture.mts'),
      "export const FIXTURE_SCHEMA = 'whoisleuth.fixture';\n",
      'utf8',
    );
    await writeFile(
      path.join(root, 'tools', 'schema-compatibility.mts'),
      "import { FIXTURE_SCHEMA } from '../packages/contracts/fixture.mts';\nexport const reference = FIXTURE_SCHEMA;\n",
      'utf8',
    );
    const circular = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry('tools/schema-compatibility.mts')], circular, []),
      /not the canonical definition or a reviewed producer or reader/iu,
    );


    await writeFile(
      path.join(root, 'tools', 'schema-catalogue.mts'),
      "import { FIXTURE_SCHEMA } from '../packages/contracts/fixture.mts';\nexport const catalogue = [{ schema: FIXTURE_SCHEMA }];\n",
      'utf8',
    );
    const newlyNamedMetadata = await discoverSchemaSources(root);
    await assert.rejects(
      validateSchemaSourceCoverage([fixtureEntry('tools/schema-catalogue.mts')], newlyNamedMetadata, []),
      /not the canonical definition or a reviewed producer or reader/iu,
    );
  });

  test('fails closed for missing coverage, stale ownership, dynamic construction, and duplicate definitions', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const discovery = await discoverSchemaSources();
    const withoutThreatResult = inventory.entries.filter((entry) => entry.id !== 'derived.threat-intelligence-result');
    await assert.rejects(
      validateSchemaSourceCoverage(withoutThreatResult, discovery),
      /not inventoried or classified: whoisleuth\.threat-intelligence-result/iu,
    );

    const missingOwner = structuredClone(inventory.entries);
    const first = missingOwner[0];
    assert.ok(first);
    first.owner = 'lib/missing-schema-owner.mts';
    await assert.rejects(
      validateSchemaSourceCoverage(missingOwner, discovery),
      /owner .* is missing/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        dynamicConstructions: [
          ...discovery.dynamicConstructions,
          { file: 'lib/example.mts', line: 1, identifier: 'whoisleuth.lookup-progress', reason: 'dynamic' },
        ],
      }),
      /unsafe dynamic/iu,
    );

    const definition = discovery.definitions.find((item) => item.identifier === 'whoisleuth.lookup-progress');
    assert.ok(definition);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        definitions: [...discovery.definitions, { ...definition, file: 'lib/duplicate.mts', line: 1 }],
      }),
      /multiple definition owners/iu,
    );

    const dynamicAllowanceUse = discovery.emitters.find((item) => (
      item.file === 'cli/artifact-verify.mts'
      && item.symbol === 'schema'
      && item.role === 'writer'
    ));
    assert.ok(dynamicAllowanceUse);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        emitters: [...discovery.emitters, dynamicAllowanceUse],
      }),
      /dynamic-emitter allowance expected lines/iu,
    );

    const lineAllowanceUse = discovery.emitters.find((item) => (
      item.file === 'cli/archive-inspect.mts'
      && item.line === 135
      && item.symbol === null
      && item.role === 'writer'
    ));
    assert.ok(lineAllowanceUse);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        emitters: [...discovery.emitters, lineAllowanceUse],
      }),
      /dynamic-use allowance expected one use/iu,
    );
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        emitters: discovery.emitters.filter((item) => item !== lineAllowanceUse),
      }),
      /dynamic-use allowance expected one use/iu,
    );

    const inlineAllowanceUse = discovery.emitters.find((item) => (
      item.identifier === 'whoisleuth.shortlist'
      && item.file === 'frontend/src/lib/browser-local-data-definitions.ts'
      && item.role === 'writer'
    ));
    assert.ok(inlineAllowanceUse);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        emitters: [...discovery.emitters, inlineAllowanceUse],
      }),
      /inline-emitter allowance expected lines/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, discovery, [
        ...SCHEMA_SOURCE_CLASSIFICATIONS.map((item) => item.identifier === 'whoisleuth.relationship-evidence'
          ? { ...item, relatedEntryIds: ['derived.missing-entry'] }
          : item),
      ]),
      /unknown compatibility entry/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, discovery, [
        ...SCHEMA_SOURCE_CLASSIFICATIONS.map((item) => item.identifier === 'whoisleuth.relationship-evidence'
          ? { ...item, kind: 'non_schema' }
          : item),
      ]),
      /inconsistent kind metadata/iu,
    );

    const localGeoIpOccurrence = discovery.occurrences.find((item) => item.identifier === 'whoisleuth.local-geoip-evidence');
    assert.ok(localGeoIpOccurrence);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        occurrences: [
          ...discovery.occurrences,
          { ...localGeoIpOccurrence, file: 'lib/unreviewed-local-geoip-reference.mts', line: 1 },
        ],
      }),
      /expected 0 literal and 0 dynamic use\(s\).*but found 1 literal/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        occurrences: discovery.occurrences.filter((item) => item !== localGeoIpOccurrence),
      }),
      /expected 1 literal and 0 dynamic use\(s\).*but found 0 literal/iu,
    );
  });
});
