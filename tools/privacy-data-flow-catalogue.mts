import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderPrivacyDataFlowCatalogueJson,
  renderPrivacyDataFlowCatalogueMarkdown,
  renderPrivacyDataFlowSummaryModule,
} from './privacy-data-flow-catalogue-renderer.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRIVACY_CATALOGUE_JSON_PATH = resolve(ROOT, 'docs', 'privacy-data-flow-catalogue.json');
export const PRIVACY_CATALOGUE_MARKDOWN_PATH = resolve(ROOT, 'docs', 'privacy-data-flow-catalogue.md');
export const PRIVACY_CATALOGUE_FRONTEND_SUMMARY_PATH = resolve(
  ROOT,
  'frontend',
  'src',
  'lib',
  'generated',
  'privacy-data-flow-summary.ts',
);
export const MAX_PRIVACY_CATALOGUE_RETAINED_ARTIFACT_BYTES = 2 * 1024 * 1024;

type RetainedArtifact = Readonly<{
  path: string;
  displayPath: string;
  content: string;
}>;

function retainedArtifact(path: string): string | null {
  if (!existsSync(path)) return null;
  const status = statSync(path);
  if (!status.isFile() || status.size > MAX_PRIVACY_CATALOGUE_RETAINED_ARTIFACT_BYTES) {
    throw new Error('Retained privacy catalogue artefact is not a bounded regular file.');
  }
  return readFileSync(path, 'utf8');
}

function writeAtomically(path: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_PRIVACY_CATALOGUE_RETAINED_ARTIFACT_BYTES) {
    throw new Error('Generated privacy catalogue artefact exceeds its retained-file byte budget.');
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  let descriptor: number | null = null;
  let created = false;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o644);
    created = true;
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (created && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function expectedArtifacts(): readonly RetainedArtifact[] {
  return Object.freeze([
    Object.freeze({
      path: PRIVACY_CATALOGUE_JSON_PATH,
      displayPath: 'docs/privacy-data-flow-catalogue.json',
      content: renderPrivacyDataFlowCatalogueJson(),
    }),
    Object.freeze({
      path: PRIVACY_CATALOGUE_MARKDOWN_PATH,
      displayPath: 'docs/privacy-data-flow-catalogue.md',
      content: renderPrivacyDataFlowCatalogueMarkdown(),
    }),
    Object.freeze({
      path: PRIVACY_CATALOGUE_FRONTEND_SUMMARY_PATH,
      displayPath: 'frontend/src/lib/generated/privacy-data-flow-summary.ts',
      content: renderPrivacyDataFlowSummaryModule(),
    }),
  ]);
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length !== 1 || !['--check', '--write'].includes(argv[0] ?? '')) {
    throw new Error('Usage: node tools/privacy-data-flow-catalogue.mts --check|--write');
  }
  const artifacts = expectedArtifacts();
  if (argv[0] === '--write') {
    for (const artifact of artifacts) writeAtomically(artifact.path, artifact.content);
    process.stdout.write(`Updated ${artifacts.map((item) => item.displayPath).join(', ')}.\n`);
    return 0;
  }
  const drift = artifacts.filter((artifact) => retainedArtifact(artifact.path) !== artifact.content);
  if (drift.length > 0) {
    process.stderr.write(`Privacy catalogue artefacts are out of date: ${drift.map((item) => item.displayPath).join(', ')}. Run the writer deliberately.\n`);
    return 1;
  }
  process.stdout.write('Privacy data-flow catalogue artefacts are current.\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
