// The scheduled acquisition path is target-free and uses fixed publisher URLs.
import { safeFetchDetailed, readTextCapped } from './safe-fetch.mts';
import { CISA_KEV_CATALOG } from './generated/cisa-kev-catalog.mts';
import { SSLBL_CERTIFICATE_SNAPSHOT } from './sslbl-certificates.generated.mts';
import { KEV_SOURCE_URL, MAX_KEV_SOURCE_BYTES, parseKevSource, assessKevPublisherUpdate } from './cisa-kev-source.mts';
import { SSLBL_SOURCE_URL, MAX_SSLBL_SOURCE_BYTES, parseSslblCertificateCsv, assessSslblSnapshotUpdate, buildSslblSnapshotData } from './sslbl-source.mts';
import { admitRetainedSourceData, prepareRetainedSourceData, type EditionFile } from './retained-source-data.mts';
import { sslblSnapshotHealth } from './sslbl-intelligence.mts';

const AUTOMATIC_PUBLISHERS = {
  sslbl: { url: SSLBL_SOURCE_URL, bytes: MAX_SSLBL_SOURCE_BYTES },
  kev: { url: KEV_SOURCE_URL, bytes: MAX_KEV_SOURCE_BYTES },
} as const;
type AutomaticSourceId = keyof typeof AUTOMATIC_PUBLISHERS;

export async function readAutomaticPublisher(
  source: AutomaticSourceId,
  signal: AbortSignal,
  fetcher: typeof safeFetchDetailed = safeFetchDetailed,
): Promise<string> {
  const { url, bytes } = AUTOMATIC_PUBLISHERS[source];
  const { response, redirectLimitReached } = await fetcher(url, { signal }, { maxRedirects: 0 });
  if (!response.ok || redirectLimitReached) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Publisher did not return a complete response.');
  }
  const body = await readTextCapped(response, bytes, { fatalUtf8: true, preserveUtf8Bom: true });
  signal.throwIfAborted();
  if (body.truncated || body.bytesRead === 0) throw new Error('Publisher response is empty or exceeds its byte bound.');
  return body.text;
}

/** Build an edition only from current, consistent publisher data. */
export async function assessAutomaticSourceEdition(source: AutomaticSourceId, text: string, prior: EditionFile | null, now: Date) {
  const baseline = prior && await admitRetainedSourceData(prior, source, now);
  try {
    if (source === 'sslbl') {
      const projection = parseSslblCertificateCsv(text);
      const current = baseline?.source === 'sslbl' ? baseline.data : SSLBL_CERTIFICATE_SNAPSHOT;
      const assessment = assessSslblSnapshotUpdate(projection, now.toISOString(), {
        currentSnapshot: current,
        allowLargeShrink: true,
      });
      if (assessment.removed > 0) return 'review_required' as const;
      // Do not refresh dates just because the same membership was fetched
      // again. A genuinely newer publisher timestamp can renew an ageing
      // snapshot, but repeated checks of the same timestamp cannot.
      if (assessment.added === 0 && (projection.sourceUpdatedAt === current.sourceUpdatedAt
        || (baseline?.current ?? sslblSnapshotHealth({ now }).state === 'current'))) {
        return 'unchanged' as const;
      }
      return await prepareRetainedSourceData(source, buildSslblSnapshotData(projection, now.toISOString()), now);
    }
    const projection = parseKevSource(text);
    const current = baseline?.source === 'kev' ? baseline.data : CISA_KEV_CATALOG;
    const { status } = assessKevPublisherUpdate(projection, current, now);
    if (status !== 'additive') return status;
    return await prepareRetainedSourceData(source, projection, now);
  } catch {
    return 'review_required' as const;
  }
}
