import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCapabilityManifestMarkdown } from './capability-manifest-renderer.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(ROOT, 'docs', 'capability-manifest.md');
const MAX_RETAINED_DOCUMENT_BYTES = 1024 * 1024;

function retainedDocument(): string | null {
  if (!existsSync(OUTPUT_PATH)) return null;
  const status = statSync(OUTPUT_PATH);
  if (!status.isFile() || status.size > MAX_RETAINED_DOCUMENT_BYTES) {
    throw new Error('Retained capability document is not a bounded regular file.');
  }
  return readFileSync(OUTPUT_PATH, 'utf8');
}

function writeAtomically(content: string): void {
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o644);
    writeFileSync(descriptor, content, 'utf8');
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, OUTPUT_PATH);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (argv.length !== 1 || !['--check', '--write'].includes(argv[0] ?? '')) {
    throw new Error('Usage: node tools/capability-manifest.mts --check|--write');
  }
  const expected = renderCapabilityManifestMarkdown();
  if (Buffer.byteLength(expected, 'utf8') > MAX_RETAINED_DOCUMENT_BYTES) {
    throw new Error('Generated capability document exceeds its byte budget.');
  }
  if (argv[0] === '--write') {
    writeAtomically(expected);
    process.stdout.write('Updated docs/capability-manifest.md.\n');
    return 0;
  }
  if (retainedDocument() !== expected) {
    process.stderr.write('docs/capability-manifest.md is out of date. Run the writer deliberately.\n');
    return 1;
  }
  process.stdout.write('Capability manifest documentation is current.\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export { MAX_RETAINED_DOCUMENT_BYTES, OUTPUT_PATH, main, retainedDocument, writeAtomically };
