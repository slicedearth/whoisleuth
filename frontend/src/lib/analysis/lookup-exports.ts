import { downloadLocalFile } from '../download-local-file.ts';
import { buildLookupEvidence, evidenceFilename, serializeLookupEvidence } from './evidence-export.ts';
import { buildLookupReadableReport, lookupReadableReportFilename } from './lookup-readable-report.ts';
import { formatLookupInvestigationBriefMarkdown, lookupInvestigationBriefFilename } from './lookup-investigation-brief.ts';
import { buildLookupClaimPassport } from './lookup-claim-passport.ts';
import type { LookupHttpResponse } from './lookup-response.ts';

type Download = typeof downloadLocalFile;
type EvidenceOptions = NonNullable<Parameters<typeof buildLookupEvidence>[1]>;
export type LookupEvidenceExportProjection = Readonly<{
  document: ReturnType<typeof buildLookupEvidence> | null;
  error: string | null;
}>;

function portableOutputBoundFailure(cause: unknown): boolean {
  return (cause instanceof TypeError || cause instanceof RangeError)
    && /(?:Lookup response|Lookup evidence|Readable Lookup report).*(?:bound|exceed|limit)/iu.test(cause.message);
}

export function prepareLookupEvidenceExport(
  result: LookupHttpResponse | null,
  options: EvidenceOptions,
): LookupEvidenceExportProjection {
  if (!result) return { document: null, error: null };
  try {
    return { document: buildLookupEvidence(result, options), error: null };
  } catch (cause) {
    if (!portableOutputBoundFailure(cause)) throw cause;
    return {
      document: null,
      error: 'Portable evidence and readable report exports are unavailable because this response exceeds the bounded evidence structure. The separately attributed Lookup result remains available.',
    };
  }
}

/** A null status leaves the current UI message unchanged; a string replaces it. */
export function exportLookupEvidence(
  result: LookupHttpResponse | null,
  projection: LookupEvidenceExportProjection,
  download: Download = downloadLocalFile,
): string | null {
  if (!result) return null;
  if (!projection.document) return `Evidence JSON was not created. ${projection.error || 'Evidence export is unavailable for this result.'}`;
  try {
    const body = serializeLookupEvidence(projection.document, true);
    download(new Blob([body], { type: 'application/json' }), evidenceFilename(result));
    return '';
  } catch (cause) {
    if (!portableOutputBoundFailure(cause)) throw cause;
    return 'Evidence export was not created because the retained result exceeds the portable evidence bounds.';
  }
}

export function exportLookupReadableReport(
  result: LookupHttpResponse | null,
  projection: LookupEvidenceExportProjection,
  options: NonNullable<Parameters<typeof buildLookupReadableReport>[1]>,
  download: Download = downloadLocalFile,
): string | null {
  if (!result) return null;
  if (projection.error) return `Readable report was not created. ${projection.error}`;
  try {
    const body = buildLookupReadableReport(result, options);
    download(new Blob([body], { type: 'text/markdown;charset=utf-8' }), lookupReadableReportFilename(result));
    return null;
  } catch (cause) {
    if (!portableOutputBoundFailure(cause)) throw cause;
    return 'Readable report export was not created because the retained result exceeds its bounded report structure.';
  }
}

export function exportLookupInvestigationBrief(
  brief: Parameters<typeof formatLookupInvestigationBriefMarkdown>[0],
  download: Download = downloadLocalFile,
): void {
  download(new Blob([formatLookupInvestigationBriefMarkdown(brief)], { type: 'text/markdown;charset=utf-8' }), lookupInvestigationBriefFilename(brief));
}

export async function exportLookupClaimPassport(
  input: Parameters<typeof buildLookupClaimPassport>[0],
  download: Download = downloadLocalFile,
): Promise<string> {
  const exported = await buildLookupClaimPassport(input);
  download(new Blob([exported.content], { type: 'application/json;charset=utf-8' }), exported.filename);
  return `Downloaded a portable passport for ${exported.document.claim.label}.`;
}
