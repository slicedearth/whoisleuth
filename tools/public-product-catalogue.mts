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
  renderPublicCliCatalogueModule,
  renderPublicCliGuidanceModule,
  renderPublicCliIndexModule,
  renderPublicCoverageModule,
  renderPublicCoverageSummaryModule,
  renderPublicExamplesIndexModule,
  renderPublicExamplesModule,
  renderPublicMethodologyModule,
} from './public-product-catalogue-renderer.mts';
import { renderPublicSitemap } from '../lib/prerendered-routes.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIRECTORY = resolve(ROOT, 'frontend', 'src', 'lib', 'generated');
const STATIC_DIRECTORY = resolve(ROOT, 'frontend', 'static');
const MAX_PUBLIC_PRODUCT_ARTIFACT_BYTES = 512 * 1024;

const OUTPUTS = Object.freeze([
  Object.freeze({ name: 'public-cli-catalogue.ts', directory: OUTPUT_DIRECTORY, render: renderPublicCliCatalogueModule }),
  Object.freeze({ name: 'public-cli-guidance.ts', directory: OUTPUT_DIRECTORY, render: renderPublicCliGuidanceModule }),
  Object.freeze({ name: 'public-cli-index.ts', directory: OUTPUT_DIRECTORY, render: renderPublicCliIndexModule }),
  Object.freeze({ name: 'public-coverage.ts', directory: OUTPUT_DIRECTORY, render: renderPublicCoverageModule }),
  Object.freeze({ name: 'public-coverage-summary.ts', directory: OUTPUT_DIRECTORY, render: renderPublicCoverageSummaryModule }),
  Object.freeze({ name: 'public-examples.ts', directory: OUTPUT_DIRECTORY, render: renderPublicExamplesModule }),
  Object.freeze({ name: 'public-examples-index.ts', directory: OUTPUT_DIRECTORY, render: renderPublicExamplesIndexModule }),
  Object.freeze({ name: 'public-methodology.ts', directory: OUTPUT_DIRECTORY, render: renderPublicMethodologyModule }),
  Object.freeze({ name: 'sitemap.xml', directory: STATIC_DIRECTORY, render: renderPublicSitemap }),
]);

function retained(path: string): string | null {
  if (!existsSync(path)) return null;
  const status = statSync(path);
  if (!status.isFile() || status.size > MAX_PUBLIC_PRODUCT_ARTIFACT_BYTES) {
    throw new Error('Retained public-product artefact is not a bounded regular file.');
  }
  return readFileSync(path, 'utf8');
}

function writeAtomically(path: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_PUBLIC_PRODUCT_ARTIFACT_BYTES) {
    throw new Error('Generated public-product artefact exceeds its retained byte limit.');
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o644);
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length !== 1 || !['--check', '--write'].includes(argv[0] ?? '')) {
    throw new Error('Usage: node tools/public-product-catalogue.mts --check|--write');
  }
  const expected = OUTPUTS.map((output) => Object.freeze({
    path: resolve(output.directory, output.name),
    name: output.name,
    content: output.render(),
  }));
  if (argv[0] === '--write') {
    for (const artifact of expected) writeAtomically(artifact.path, artifact.content);
    process.stdout.write(`Updated ${expected.map((artifact) => artifact.name).join(', ')}.\n`);
    return 0;
  }
  const drift = expected.filter((artifact) => retained(artifact.path) !== artifact.content);
  if (drift.length > 0) {
    process.stderr.write(`Public-product artefacts are out of date: ${drift.map((artifact) => artifact.name).join(', ')}. Run the writer deliberately.\n`);
    return 1;
  }
  process.stdout.write('Public-product generated artefacts are current.\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export { MAX_PUBLIC_PRODUCT_ARTIFACT_BYTES, OUTPUTS, main };
