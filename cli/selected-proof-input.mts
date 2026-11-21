import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { assembleSelectedProofInput, SELECTED_PROOF_FILES, type SelectedProofFile, type SelectedProofKind } from '../packages/evidence/selected-proof-input.mts';
import { boundedInteractiveAnswer, canReadInteractiveLine, readBoundedInteractiveLine } from './terminal-input.mts';
import type { WritableTerminal } from './terminal-presentation.mts';
import { CliUsageError } from './errors.mts';

export async function readAssistedProofInput(kind: SelectedProofKind, options: Readonly<{
  output: WritableTerminal; signal?: AbortSignal; question?: (prompt: string) => Promise<string>;
  readFile?: (path: string) => Uint8Array | Promise<Uint8Array>;
}>) {
  if (!options.question && !canReadInteractiveLine(process.stdin, options.output)) throw new CliUsageError('Assisted proof review requires terminal input and stderr. Use a versioned JSON input for scripts.');
  const ask = async (prompt: string) => {
    options.signal?.throwIfAborted();
    const answer = boundedInteractiveAnswer(await (options.question ? options.question(prompt)
      : readBoundedInteractiveLine(prompt, { input: process.stdin, output: options.output, ...(options.signal ? { signal: options.signal } : {}) })));
    options.signal?.throwIfAborted(); return answer;
  };
  const files: Record<string, SelectedProofFile[]> = {};
  for (const field of SELECTED_PROOF_FILES[kind]) {
    files[field.id] = [];
    for (let index = 0; index < field.maximumFiles; index++) {
      const path = await ask(`${field.label}${field.maximumFiles > 1 ? ` ${index + 1} (blank to finish)` : ''} file: `);
      if (!path && field.optional) break;
      if (!path || path === '-') throw new CliUsageError('Choose a named local proof file; stdin is not a material file.');
      const bytes = options.readFile ? await options.readFile(path) : await readBoundedRegularFile(path, {
        maximumBytes: field.maximumBytes, minimumBytes: 1, label: field.label, ...(options.signal ? { signal: options.signal } : {}),
      });
      if (bytes.length < 1 || bytes.length > field.maximumBytes) throw new CliUsageError('Selected proof material exceeds its file byte limit or is empty.');
      files[field.id]!.push({ size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
    }
  }
  const fields = kind === 'timestamp' ? { policy: await ask('Expected timestamp policy OID: '), nonce: await ask('Expected nonce hex (optional): ') } : {};
  return assembleSelectedProofInput(kind, files, fields, options.signal);
}
