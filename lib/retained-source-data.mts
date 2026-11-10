import { decodeRetainedSourceEdition, encodeRetainedSourceEdition } from '../packages/evidence/retained-source-edition.mts';
import type { HostedSourceId } from '../packages/contracts/retained-source-edition.mts';
import { admitSslblSnapshot, sslblSnapshotHealth, type SslblSnapshot } from './sslbl-intelligence.mts';
import { admitKevProjection, kevProjectionIsCurrent, type KevProjection } from './cisa-kev-source.mts';
import { admitRegistrarStandingCatalogue, registrarStandingCatalogueHealth, type Catalogue } from './registrar-standing.mts';

export type LookupSourceEditions = Readonly<{ sslbl?: SslblSnapshot; kev?: KevProjection; registrar?: Catalogue }>;
export type EditionFile = Readonly<{ text: string; digest: string }>;

function notFuture(value: string, now: Date): void {
  if (!Number.isFinite(Date.parse(value)) || !Number.isFinite(now.getTime()) || Date.parse(value) > now.getTime()) {
    throw new TypeError('Source edition has invalid or future provenance.');
  }
}

export async function admitRetainedSourceData(file: EditionFile, expectedSource: HostedSourceId | undefined, now: Date) {
  const edition = await decodeRetainedSourceEdition(file.text, file.digest, expectedSource);
  switch (edition.source) {
    case 'sslbl': {
      const data = admitSslblSnapshot(edition.data);
      notFuture(data.generatedAt, now);
      return { source: edition.source, data, current: sslblSnapshotHealth({ snapshot: data, now }).state === 'current' } as const;
    }
    case 'kev': {
      const data = admitKevProjection(edition.data);
      notFuture(data.releasedAt, now);
      return { source: edition.source, data, current: kevProjectionIsCurrent(data, now) } as const;
    }
    case 'registrar': {
      const data = admitRegistrarStandingCatalogue(edition.data, now);
      return { source: edition.source, data, current: registrarStandingCatalogueHealth(now, data).state === 'current' } as const;
    }
    case 'infrastructure':
      throw new TypeError('An infrastructure edition is not a Lookup source.');
  }
}

export async function prepareRetainedSourceData(source: HostedSourceId, projection: unknown, now: Date): Promise<EditionFile> {
  const file = await encodeRetainedSourceEdition(source, projection);
  if (!(await admitRetainedSourceData(file, source, now)).current) throw new TypeError('Source edition is outside its review window.');
  return file;
}
