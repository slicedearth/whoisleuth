import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CRITICAL_MUTATION_MANIFEST,
  MAX_CRITICAL_MUTATION_TEXT_BYTES,
} from './critical-mutation-manifest.mts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedId = process.env.WHOISLEUTH_CRITICAL_MUTANT_ID ?? '';
const mutant = CRITICAL_MUTATION_MANIFEST.find((item) => item.id === requestedId);

if (!mutant || !/^[a-z0-9][a-z0-9-]{2,79}$/u.test(requestedId)) {
  throw new TypeError('Critical mutation loader requires one declared mutant ID.');
}
if (Buffer.byteLength(mutant.search, 'utf8') < 1
  || Buffer.byteLength(mutant.search, 'utf8') > MAX_CRITICAL_MUTATION_TEXT_BYTES
  || Buffer.byteLength(mutant.replacement, 'utf8') > MAX_CRITICAL_MUTATION_TEXT_BYTES) {
  throw new TypeError('Critical mutation source pattern exceeds its bound.');
}

const target = path.resolve(repositoryRoot, mutant.file);
const targetUrl = pathToFileURL(target);
if (!target.startsWith(`${repositoryRoot}${path.sep}`) || fileURLToPath(targetUrl) !== target) {
  throw new TypeError('Critical mutation target escaped the repository root.');
}
const retainedSource = readFileSync(target, 'utf8');
if (retainedSource.split(mutant.search).length !== 2
  || retainedSource.split('\n')[mutant.line - 1]?.includes(mutant.search.trim()) !== true) {
  throw new TypeError('Critical mutation source location or exact pattern drifted.');
}

let applications = 0;
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== targetUrl.href) return loaded;
    const source = typeof loaded.source === 'string'
      ? loaded.source
      : Buffer.isBuffer(loaded.source) || loaded.source instanceof Uint8Array
        ? Buffer.from(loaded.source).toString('utf8')
        : '';
    if (source.split(mutant.search).length !== 2) throw new TypeError('Critical mutation did not match exactly once at load time.');
    applications += 1;
    return { ...loaded, source: source.replace(mutant.search, mutant.replacement) };
  },
});

process.on('exit', () => {
  process.stderr.write(`WHOISLEUTH_MUTATION_APPLICATION ${requestedId} ${applications}\n`);
  if (applications !== 1 && (!process.exitCode || process.exitCode === 0)) process.exitCode = 97;
});
