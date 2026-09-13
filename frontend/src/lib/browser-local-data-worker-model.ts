import { BROWSER_LOCAL_COLLECTIONS } from './browser-local-data-definitions.ts';
import {
  BrowserLocalDataError,
  MAX_LOCAL_DATA_COLLECTIONS,
  decodeLocalDataSnapshots,
  plaintextJsonCodec,
  prepareLocalDataContent,
  type AnyLocalDataCollectionDefinition,
  type CapturedLocalDataCollection,
  type PreparedLocalDataContent,
} from './browser-local-data.ts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from './bounded-json.ts';
import { createBrandProfileId, MAX_PROFILE_STORE_BYTES, mergeBrandProfiles, type BrandProfile } from './analysis/brand-profile-model.ts';
import { MAX_PROFILE_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

export type LocalDataDecodeRequest = Readonly<{ captured: readonly CapturedLocalDataCollection[] }>;
export type LocalDataDecodeResponse =
  | Readonly<{ kind: 'decoded'; documents: readonly Readonly<{ collection: string; document: unknown }>[] }>
  | Readonly<{ kind: 'error'; code: string; detail: string }>;

export type BrandProfileFileMerge = ReturnType<typeof mergeBrandProfiles>;
export type LocalDataWorkerRequest =
  | Readonly<{ kind: 'decode'; input: LocalDataDecodeRequest }>
  | Readonly<{ kind: 'prepare'; collection: string; input: unknown }>
  | Readonly<{ kind: 'import-profiles'; current: readonly BrandProfile[]; file: Blob; nowIso: string }>;
export type LocalDataWorkerResponse = LocalDataDecodeResponse
  | Readonly<{ kind: 'prepared'; collection: string; content: PreparedLocalDataContent }>
  | Readonly<{ kind: 'profiles-merged'; result: BrandProfileFileMerge }>;

/** One bounded operation; no storage, network or commit access. */
export async function runLocalDataWorkerRequest(request: LocalDataWorkerRequest): Promise<LocalDataWorkerResponse> {
  try {
    switch (request?.kind) {
      case 'decode': return await decodeLocalDataWorkerRequest(request.input);
      case 'prepare': {
        const definition: AnyLocalDataCollectionDefinition | undefined = BROWSER_LOCAL_COLLECTIONS.find((candidate) => candidate.id === request.collection);
        if (!definition) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'The workspace collection is unavailable.');
        return { kind: 'prepared', collection: definition.id, content: await prepareLocalDataContent(definition, request.input, plaintextJsonCodec) };
      }
      case 'import-profiles': {
        if (!(request.file instanceof Blob)) throw new Error('Choose a Brand Profile JSON file.');
        if (request.file.size > MAX_PROFILE_IMPORT_BYTES) throw new Error(`Profile imports are limited to ${MAX_PROFILE_IMPORT_BYTES / 1024 / 1024} MiB.`);
        if (!Number.isFinite(Date.parse(request.nowIso))) throw new Error('The profile import time is invalid.');
        const value = parseBoundedJson(await request.file.text(), {
          label: 'Profile import', maximumBytes: MAX_PROFILE_IMPORT_BYTES,
          limits: boundedJsonLimitsForBytes(MAX_PROFILE_STORE_BYTES),
        });
        return { kind: 'profiles-merged', result: mergeBrandProfiles(request.current, value, { makeId: createBrandProfileId, nowIso: request.nowIso }) };
      }
      default: throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'The browser-local operation is unsupported.');
    }
  } catch (cause) {
    return {
      kind: 'error', code: cause instanceof BrowserLocalDataError ? cause.code : 'INVALID_LOCAL_DATA',
      detail: (cause instanceof Error ? cause.message : 'Browser-local preparation failed. Saved records were not changed.')
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, 240),
    };
  }
}

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
