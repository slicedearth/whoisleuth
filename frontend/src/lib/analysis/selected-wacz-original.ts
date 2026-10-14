import { parseWaczEvidenceArchive, type WaczFindingOrigin, type WaczImportReport } from './wacz-evidence-import.ts';
import type { ExternalFinding } from './external-findings-import.ts';
import type { SelectedFindingOriginal } from './selected-finding-original.ts';

/** Container/record identity only; discarded HTTP and page content stay excluded. */
export async function parseSelectedWacz(input: ArrayBuffer, fileName: string): Promise<{
  report: WaczImportReport; original: SelectedFindingOriginal;
}> {
  const byteLength = input.byteLength;
  const origins = new Map<ExternalFinding, WaczFindingOrigin[]>();
  const report = await parseWaczEvidenceArchive(input, fileName, (finding, locations) => {
    const previous = origins.get(finding);
    if (previous) previous.push(...locations); else origins.set(finding, [...locations]);
  });
  for (const locations of origins.values()) Object.freeze(locations);
  let active = true;
  const belongs = (document: WaczImportReport['document'], finding: ExternalFinding) => active && document === report.document && origins.has(finding);
  const original: SelectedFindingOriginal = Object.freeze({
    locate(document, finding) {
      return { state: 'unavailable', reason: belongs(document, finding)
        ? 'This field is derived from an archive record, not one original scalar. Review the selected archive provenance; discarded URLs, headers and bodies are not displayed.'
        : 'The selected original no longer belongs to this preview.' };
    },
    archive(document, finding) {
      return belongs(document, finding) ? Object.freeze({ digestSha256: report.archiveDigestSha256, byteLength,
        manifestDigest: report.manifestDigest, origins: origins.get(finding)! }) : null;
    },
    dispose() { active = false; origins.clear(); },
  });
  return { report, original };
}
