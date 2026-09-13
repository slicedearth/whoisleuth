import { array } from '../../../packages/evidence/artifact-structure.mts';
import { decodeLocalApplicationFiles, encodeLocalApplicationCommit, parseLocalApplicationJson, readLocalApplicationCapture } from '../../../packages/workspace/local-application-protocol.mts';
import type { LocalDataCapture, LocalDataStorageCommit, LocalDataStoredBinary } from '../../../packages/workspace/local-data-storage.mts';

export type LocalApplicationPreparation =
  | Readonly<{ operation: 'encode'; change: LocalDataStorageCommit; operationId: string }>
  | Readonly<{ operation: 'capture'; bytes: Uint8Array; count: number }>
  | Readonly<{ operation: 'files'; bytes: Uint8Array; keys: readonly string[] }>;
export type LocalApplicationPrepared =
  | Readonly<{ operation: 'encode'; bytes: Uint8Array<ArrayBuffer>; digest: string }>
  | Readonly<{ operation: 'capture'; captures: LocalDataCapture[] }>
  | Readonly<{ operation: 'files'; files: (LocalDataStoredBinary | undefined)[] }>;

/** Parse, verify and encode large storage messages outside the interactive thread. */
export async function prepareLocalApplicationData(input: LocalApplicationPreparation): Promise<LocalApplicationPrepared> {
  if (input.operation === 'capture') return { operation: input.operation,
    captures: await Promise.all(array(parseLocalApplicationJson(input.bytes), 'Workspace captures', input.count, input.count).map(readLocalApplicationCapture)) };
  if (input.operation === 'files') return { operation: input.operation, files: decodeLocalApplicationFiles(input.bytes, input.keys) };
  const encoded = encodeLocalApplicationCommit(input.change, input.operationId);
  const bytes = (encoded.buffer instanceof ArrayBuffer ? encoded : Uint8Array.from(encoded)) as Uint8Array<ArrayBuffer>;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { operation: input.operation, bytes, digest: Array.from(hash, value => value.toString(16).padStart(2, '0')).join('') };
}
