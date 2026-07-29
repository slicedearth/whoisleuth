#!/usr/bin/env node

// Contributor-facing scaffold for adding one bounded technology signature and
// its mandatory positive and benign-negative fixtures. It deliberately accepts
// only fixed catalogue metadata, never copied live HTML or response headers.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

type WritableLike = { write(value: string): unknown };
type TechnologyCategory =
  | 'content management'
  | 'commerce'
  | 'site builder'
  | 'web framework'
  | 'static site generator'
  | 'web server'
  | 'delivery platform';
type TechnologyEvidenceSource = 'generator' | 'html' | 'resource' | 'server';
type ScaffoldArguments = Readonly<{
  id: string;
  name: string;
  category: TechnologyCategory;
  source: TechnologyEvidenceSource;
}>;
type ScaffoldMainOptions = Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const CATEGORIES = new Set<TechnologyCategory>([
  'content management',
  'commerce',
  'site builder',
  'web framework',
  'static site generator',
  'web server',
  'delivery platform',
]);
const SOURCES = new Set<TechnologyEvidenceSource>(['generator', 'html', 'resource', 'server']);

function optionValue(args: readonly string[], name: string): string {
  const prefix = `${name}=`;
  const matches = args.filter((arg) => arg.startsWith(prefix));
  if (matches.length !== 1) throw new TypeError(`${name}=VALUE is required exactly once.`);
  return matches[0]?.slice(prefix.length) ?? '';
}

function boundedLabel(value: string, label: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be plain text no longer than ${maximum} characters.`);
  }
  return normalized;
}

export function parseTechnologySignatureScaffoldArguments(
  args: readonly string[],
): ScaffoldArguments {
  const allowedPrefixes = ['--id=', '--name=', '--category=', '--source='];
  const unknown = args.find((arg) => !allowedPrefixes.some((prefix) => arg.startsWith(prefix)));
  if (unknown) throw new TypeError(`Unknown option: ${unknown}`);

  const id = optionValue(args, '--id').trim().toLowerCase();
  const name = boundedLabel(optionValue(args, '--name'), 'Technology name', 120);
  const category = optionValue(args, '--category').trim().toLowerCase() as TechnologyCategory;
  const source = optionValue(args, '--source').trim().toLowerCase() as TechnologyEvidenceSource;
  if (!ID_RE.test(id) || id.length > 64) {
    throw new TypeError('Technology id must be a lowercase hyphenated identifier no longer than 64 characters.');
  }
  if (!CATEGORIES.has(category)) {
    throw new TypeError(`Category must be one of: ${[...CATEGORIES].join(', ')}.`);
  }
  if (!SOURCES.has(source)) {
    throw new TypeError(`Source must be one of: ${[...SOURCES].join(', ')}.`);
  }
  return Object.freeze({ id, name, category, source });
}

function evidenceTemplate(source: TechnologyEvidenceSource): {
  evidence: string;
  positiveInput: string;
  benignInput: string;
} {
  switch (source) {
    case 'generator':
      return {
        evidence: "generatorEvidence(/^fixture-product(?:\\s|$)/i, 'Generator metadata identifies the product.')",
        positiveInput: "{ generator: 'Fixture Product 1.0' }",
        benignInput: "{ generator: 'Unrelated Fixture 1.0' }",
      };
    case 'html':
      return {
        evidence: "htmlEvidence(['data-fixture-product='], 'Static markup contains a product-specific attribute.')",
        positiveInput: "{ html: '<main data-fixture-product=\"true\"></main>' }",
        benignInput: "{ html: '<main>Documentation mentions Fixture Product without implementation markup.</main>' }",
      };
    case 'resource':
      return {
        evidence: "resourceEvidence(['assets.fixture.invalid'], 'A retained resource origin uses product-specific infrastructure.')",
        positiveInput: "{ resourceOrigins: ['https://assets.fixture.invalid'] }",
        benignInput: "{ resourceOrigins: ['https://assets.example.invalid'] }",
      };
    case 'server':
      return {
        evidence: "serverEvidence(/^fixture-server(?:\\s|$|\\/)/i, 'The selected response server header identifies the product.')",
        positiveInput: "{ httpServer: 'Fixture-Server/1.0' }",
        benignInput: "{ httpServer: 'Example-Server/1.0' }",
      };
  }
}

export function buildTechnologySignatureScaffold(input: ScaffoldArguments): string {
  const template = evidenceTemplate(input.source);
  return [
    '// Synthetic authoring scaffold. Replace fixture markers with a narrowly',
    '// documented signature; never paste live page data, credentials, contacts,',
    '// target URLs, or raw response bodies into the catalogue or fixture corpus.',
    '',
    '// lib/website-technology.mts',
    '{',
    `  id: '${input.id}', name: ${JSON.stringify(input.name)}, category: '${input.category}',`,
    `  evidence: [${template.evidence}],`,
    '},',
    '',
    '// fixtures/technology-signature-fixtures.mts: mandatory positive fixture',
    `positive('${input.id}', ${template.positiveInput}),`,
    '',
    '// fixtures/technology-signature-fixtures.mts: mandatory benign non-match',
    'negative(',
    `  'negative-${input.id}-ordinary-reference',`,
    `  '${input.name} named without an implementation marker',`,
    `  ${template.benignInput},`,
    `  ['${input.id}'],`,
    '),',
    '',
    '// Review checklist',
    '// [ ] Marker is specific to one implementation and bounded to captured evidence.',
    '// [ ] Resource-origin-only matches require independent non-resource evidence.',
    '// [ ] A collision or overlap fixture covers every intentional co-detection.',
    '// [ ] At least one benign fixture demonstrates the nearest likely false positive.',
    '// [ ] npm run benchmark:technology reports zero lint, collision, or fixture failures.',
    '',
  ].join('\n');
}

export function main(
  args = process.argv.slice(2),
  options: ScaffoldMainOptions = {},
): number {
  try {
    const input = parseTechnologySignatureScaffoldArguments(args);
    (options.stdout ?? process.stdout).write(buildTechnologySignatureScaffold(input));
    return 0;
  } catch (error) {
    (options.stderr ?? process.stderr).write(
      `${error instanceof Error ? error.message : 'Technology-signature scaffold failed.'}\n`,
    );
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export type {
  ScaffoldArguments,
  ScaffoldMainOptions,
  TechnologyCategory,
  TechnologyEvidenceSource,
};
