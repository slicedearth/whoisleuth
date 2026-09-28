import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRITICAL_MUTATION_MANIFEST,
  assertUniqueCriticalMutationPattern,
  isCriticalMutationSource,
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

let applications = 0;
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith('file:')) return loaded;
    const relative = path.relative(repositoryRoot, fileURLToPath(url)).split(path.sep).join('/');
    if (!isCriticalMutationSource(relative)) return loaded;
    const source = typeof loaded.source === 'string'
      ? loaded.source
      : Buffer.isBuffer(loaded.source) || loaded.source instanceof Uint8Array
        ? Buffer.from(loaded.source).toString('utf8')
        : '';
    if (!source.includes(mutant.search)) return loaded;
    assertUniqueCriticalMutationPattern(source, mutant.search, `Critical mutant ${mutant.id} at load time`);
    applications += 1;
    return { ...loaded, source: source.replace(mutant.search, mutant.replacement) };
  },
});

process.on('exit', () => {
  process.stderr.write(`WHOISLEUTH_MUTATION_APPLICATION ${requestedId} ${applications}\n`);
  if (applications !== 1 && (!process.exitCode || process.exitCode === 0)) process.exitCode = 97;
});
