#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReviewedAccuracyCorpusKey } from './reviewed-accuracy-status.mts';

type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{ stdout?: WritableLike; stderr?: WritableLike }>;

export const REVIEWED_ACCURACY_INTAKE_SCHEMA = 'whoisleuth.reviewed-accuracy-intake';
export const REVIEWED_ACCURACY_INTAKE_VERSION = 1;

const CATEGORIES = new Set<ReviewedAccuracyCorpusKey>([
  'lookalike-analysis',
  'page-similarity',
  'technology-detection',
  'service-deprovision-cues',
  'certificate-grouping',
]);
const SAFE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function requiredValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new TypeError(`${name} requires a value.`);
  if (args.indexOf(name, index + 1) >= 0) throw new TypeError(`${name} may be supplied only once.`);
  return args[index + 1] as string;
}

export function buildReviewedAccuracyScaffold(categoryInput: unknown, idInput: unknown): string {
  const category = typeof categoryInput === 'string' ? categoryInput.toLowerCase() as ReviewedAccuracyCorpusKey : '' as ReviewedAccuracyCorpusKey;
  const id = typeof idInput === 'string' ? idInput.toLowerCase() : '';
  if (!CATEGORIES.has(category)) throw new TypeError('Category is not a supported reviewed accuracy corpus.');
  if (!SAFE_ID_RE.test(id) || id.length > 80) throw new TypeError('Fixture id must be a lowercase hyphenated identifier no longer than 80 characters.');

  return `${JSON.stringify({
    schema: REVIEWED_ACCURACY_INTAKE_SCHEMA,
    version: REVIEWED_ACCURACY_INTAKE_VERSION,
    category,
    id,
    observedAt: 'REPLACE_WITH_UTC_TIMESTAMP',
    reviewedAt: 'REPLACE_WITH_UTC_TIMESTAMP',
    review: {
      expectedClass: 'REPLACE_WITH_POSITIVE_OR_BENIGN_COLLISION',
      expectedOutcome: 'REPLACE_WITH_REVIEWED_COMPONENT_LEVEL_OUTCOME',
      falsePositiveConsidered: false,
      secondReviewCompleted: false,
    },
    source: {
      basis: 'factual-observation',
      redistributionReviewed: false,
      termsAndLicenseReviewed: false,
    },
    minimization: {
      rawResponseRetained: false,
      targetRetained: false,
      contactsRetained: false,
      pathsOrQueriesRetained: false,
      identifiersReplacedWithReservedValues: true,
    },
    fixture: {
      target: 'fixture.example.invalid',
      note: 'Add only the minimum normalised fields required to replay the relevant analyser.',
    },
  }, null, 2)}\n`;
}

function parseArguments(args: readonly string[]) {
  const allowed = new Set(['--category', '--id']);
  if (args.length !== 4) throw new TypeError('Usage: node tools/reviewed-accuracy-scaffold.mts --category CATEGORY --id ID');
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index] || '')) throw new TypeError(`Unknown option: ${args[index] || ''}`);
  }
  return { category: requiredValue(args, '--category'), id: requiredValue(args, '--id') };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  try {
    const parsed = parseArguments(args);
    (options.stdout || process.stdout).write(buildReviewedAccuracyScaffold(parsed.category, parsed.id));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reviewed accuracy scaffold failed.';
    (options.stderr || process.stderr).write(`${message.replace(/[\r\n]+/gu, ' ').slice(0, 500)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}
