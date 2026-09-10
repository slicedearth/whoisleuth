import { BROWSER_LOCAL_COLLECTIONS } from './browser-local-data-definitions.ts';
import {
  BrowserLocalDataError,
  MAX_LOCAL_DATA_COLLECTIONS,
  decodeLocalDataSnapshots,
  plaintextJsonCodec,
  type AnyLocalDataCollectionDefinition,
  type CapturedLocalDataCollection,
} from './browser-local-data.ts';

export type LocalDataDecodeRequest = Readonly<{ captured: readonly CapturedLocalDataCollection[] }>;
export type LocalDataDecodeResponse =
  | Readonly<{ kind: 'decoded'; documents: readonly Readonly<{ collection: string; document: unknown }>[] }>
  | Readonly<{ kind: 'error'; code: string; detail: string }>;

/** Uses the same definitions and integrity checks as the provider, without storage access. */
export async function decodeLocalDataWorkerRequest(request: LocalDataDecodeRequest): Promise<LocalDataDecodeResponse> {
  try {
    if (!Array.isArray(request?.captured) || !request.captured.length
      || request.captured.length > MAX_LOCAL_DATA_COLLECTIONS
      || new Set(request.captured.map((entry) => entry?.manifest?.collection)).size !== request.captured.length) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local snapshot is incomplete.');
    }
    const definitions: AnyLocalDataCollectionDefinition[] = request.captured.map((entry) => {
      const definition = BROWSER_LOCAL_COLLECTIONS.find((candidate) => candidate.id === entry?.manifest?.collection);
      if (!definition || !Array.isArray(entry.records) || entry.records.length > definition.maximumRecords) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local snapshot contains an invalid collection.');
      }
      return definition;
    });
    const documents = await decodeLocalDataSnapshots(definitions, request.captured, plaintextJsonCodec);
    return { kind: 'decoded', documents: documents.map((document, index) => ({ collection: definitions[index]!.id, document })) };
  } catch (cause) {
    return {
      kind: 'error',
      code: cause instanceof BrowserLocalDataError ? cause.code : 'LOCAL_DATA_INTEGRITY',
      detail: cause instanceof BrowserLocalDataError ? cause.message : 'Browser-local data could not be verified. Saved records were not changed.',
    };
  }
}
