#!/usr/bin/env node

// Exercises one deterministic browser-to-CLI-to-browser portability path
// through the production archive, verification and merge owners. It uses only
// reserved synthetic data and performs no network request or durable write.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildInterchangeFidelityReport } from '../cli/interchange-report.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { createCase, mergeCases } from '../packages/cases/case-model.mts';
import {
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  readWorkspaceArchive,
} from '../packages/workspace/workspace-archive.mts';

const SYNTHETIC_TIME = '2026-09-05T00:00:00.000Z';
const SYNTHETIC_DOMAIN = 'roundtrip.example.test';

type WritableLike = { write(value: string): unknown };

function archiveDigest(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

function sectionData(
  archive: Awaited<ReturnType<typeof readWorkspaceArchive>>,
  id: string,
): unknown {
  const section = archive.sections.find((candidate) => candidate.id === id);
  if (!section || section.status !== 'ready') {
    throw new Error(`Synthetic round trip could not read the ${id} section.`);
  }
  return section.data;
}

export async function buildInterchangeRoundTripReport() {
  const syntheticCase = createCase({
    domain: SYNTHETIC_DOMAIN,
    source: 'manual',
    tags: ['synthetic', 'interchange'],
  }, SYNTHETIC_TIME);
  const sourceArchive = await buildWorkspaceArchive({ cases: [syntheticCase] }, {
    generatedAt: SYNTHETIC_TIME,
  });
  const sourceRaw = JSON.stringify(sourceArchive);

  const verification = await verifyOfflineArtifact(sourceRaw);
  const fidelity = await buildInterchangeFidelityReport(sourceRaw, {
    generatedAt: SYNTHETIC_TIME,
  });
  const preview = await previewWorkspaceArchive(sourceArchive, {});
  const parsed = await readWorkspaceArchive(sourceArchive);
  const importedCases = mergeCases([], sectionData(parsed, 'cases'));
  const restoredArchive = await buildWorkspaceArchive({ cases: importedCases.cases }, {
    generatedAt: SYNTHETIC_TIME,
  });
  const restoredRaw = JSON.stringify(restoredArchive);

  const failures: string[] = [];
  if (verification.artifact.kind !== 'workspace_archive'
    || verification.checks.structure !== 'verified'
    || verification.checks.contentIntegrity !== 'verified') {
    failures.push('The CLI verifier did not validate the workspace structure and section integrity.');
  }
  if (!fidelity.recognised
    || fidelity.artifact.id !== 'workspace'
    || !fidelity.verification.assuranceSatisfied
    || fidelity.compatibility.fullyImportable !== true) {
    failures.push('The CLI fidelity report did not classify the workspace as fully importable.');
  }
  const casePreview = preview.sections.find((section) => section.id === 'cases');
  if (casePreview?.status !== 'ready'
    || casePreview.added !== 1
    || casePreview.updated !== 0
    || casePreview.skipped !== 0) {
    failures.push('The browser import preview did not admit exactly one synthetic Case.');
  }
  if (importedCases.added !== 1
    || importedCases.updated !== 0
    || importedCases.skipped !== 0
    || importedCases.cases[0]?.domain !== SYNTHETIC_DOMAIN) {
    failures.push('The canonical Case merge did not preserve the synthetic Case identity.');
  }
  if (restoredRaw !== sourceRaw) {
    failures.push('The restored browser archive changed after canonical import and re-export.');
  }
  if (failures.length > 0) throw new Error(failures.join(' '));

  return Object.freeze({
    archiveSchema: sourceArchive.schema,
    archiveVersion: sourceArchive.version,
    archiveBytes: Buffer.byteLength(sourceRaw, 'utf8'),
    archiveDigestSha256: archiveDigest(sourceRaw),
    cliVerificationState: verification.state,
    cliFidelity: fidelity.compatibility.fidelity,
    importReadySections: preview.readyCount,
    importedCases: importedCases.added,
    canonicalReExportMatched: true,
    networkRequests: 0,
    limitations: Object.freeze([
      'This check uses one reserved-domain synthetic Case and no live evidence.',
      'It proves the current canonical archive path preserves this fixture; it does not prove evidence truth or compatibility with undeclared formats.',
    ]),
  });
}

export function formatInterchangeRoundTripReport(
  report: Awaited<ReturnType<typeof buildInterchangeRoundTripReport>>,
): string {
  return [
    'WHOISleuth synthetic interchange round trip',
    `Archive: ${report.archiveSchema} v${report.archiveVersion}`,
    `Bytes: ${report.archiveBytes}`,
    `Digest: ${report.archiveDigestSha256}`,
    `CLI verification: ${report.cliVerificationState}`,
    `CLI fidelity: ${report.cliFidelity}`,
    `Browser import: ${report.importedCases} Case; ${report.importReadySections} ready sections`,
    `Canonical re-export: ${report.canonicalReExportMatched ? 'matched' : 'changed'}`,
    `Network requests: ${report.networkRequests}`,
    '',
    ...report.limitations.map((item) => `Limitation: ${item}`),
    '',
  ].join('\n');
}

export async function main(
  args = process.argv.slice(2),
  output: WritableLike = process.stdout,
  errors: WritableLike = process.stderr,
): Promise<number> {
  try {
    if (args.length > 0) throw new TypeError('Usage: npm run interchange:roundtrip');
    output.write(formatInterchangeRoundTripReport(await buildInterchangeRoundTripReport()));
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Error ? error.message : 'Synthetic interchange round trip failed.'}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
