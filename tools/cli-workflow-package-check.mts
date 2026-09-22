import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Byte, Encoder } from '@nuintun/qrcode';
import { encode } from 'fast-png';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';
import { CLI_INVESTIGATION_RUN_SCHEMA, CLI_INVESTIGATION_RUN_VERSION, MAX_INVESTIGATION_RUN_BYTES } from '../packages/contracts/investigation-run.mts';

/** Offline resumption, retained artefact reuse and independent review approval. */
export async function checkInstalledCliWorkflows(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const workflowFixture = path.join(temporaryRoot, 'workflow.json');
  await writeFile(workflowFixture, await readBoundedRegularFileWithin(repositoryRoot, 'test/fixtures/cli-investigation-run-v2.json', {
    maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Public workflow checkpoint fixture',
  }), { mode: 0o600, flag: 'wx' });
  const workflow = record(JSON.parse(await run([
    'workflow-run', 'domain-triage', 'example.test', '--resume', workflowFixture,
    '--use-artifact', 'export:1=collect', '--use-artifact', 'verify:1=export', '--json',
  ], 'offline workflow artefact reuse', 4)), 'Installed workflow');
  if (workflow.schema !== CLI_INVESTIGATION_RUN_SCHEMA || workflow.version !== CLI_INVESTIGATION_RUN_VERSION || workflow.state !== 'partial'
    || !Array.isArray(workflow.completedSteps) || workflow.completedSteps.length !== 3
    || record(workflow.completedSteps[1], 'Installed workflow export').command !== 'export'
    || record(workflow.completedSteps[2], 'Installed workflow verification').command !== 'verify-artifact') {
    throw new TypeError('Installed workflow did not retain and reuse the partial public observation offline.');
  }
  const handoffEvidence = path.join(temporaryRoot, 'handoff-evidence.json');
  const handoffCases = path.join(temporaryRoot, 'handoff-cases.json');
  const handoffCheckpoint = path.join(temporaryRoot, 'handoff-checkpoint.json');
  const publicCases = record(JSON.parse((await readBoundedRegularFileWithin(repositoryRoot,
    'test/fixtures/case-lifecycle/cli-case-pack-v2-case-v15.json', {
      maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Public Case-pack fixture',
    })).toString('utf8')), 'Public Case-pack fixture');
  await writeFile(handoffEvidence, JSON.stringify(record(workflow.completedSteps[1], 'Retained export').result), { flag: 'wx', mode: 0o600 });
  await writeFile(handoffCases, JSON.stringify({ version: publicCases.version, exportedAt: publicCases.exportedAt, cases: publicCases.cases }), { flag: 'wx', mode: 0o600 });
  const handoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--select', `verify=${handoffEvidence}`,
    '--select', `package=${handoffCases}`, '--confirm-review', 'package', '--json',
  ], 'offline handoff review boundary')), 'Installed handoff');
  if (handoff.state !== 'awaiting_review_confirmation' || record(handoff.currentStep, 'Handoff review step').id !== 'lint'
    || !Array.isArray(handoff.completedSteps) || handoff.completedSteps.length !== 2
    || JSON.stringify(handoff.artifactBindings) !== JSON.stringify([{ stepId: 'lint', input: 1, sourceStepId: 'package' }])) {
    throw new TypeError('Installed handoff did not pause before the separately declared sharing review.');
  }
  await writeFile(handoffCheckpoint, JSON.stringify(handoff), { flag: 'wx', mode: 0o600 });
  const resumedHandoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--resume', handoffCheckpoint, '--json',
  ], 'offline handoff checkpoint approval isolation')), 'Resumed handoff');
  if (resumedHandoff.state !== 'awaiting_review_confirmation' || !Array.isArray(resumedHandoff.reviewsConfirmedForThisRun)
    || resumedHandoff.reviewsConfirmedForThisRun.length !== 0) throw new TypeError('A handoff checkpoint granted a review confirmation.');
  const reviewedHandoff = record(JSON.parse(await run([
    'workflow-run', 'evidence-handoff', 'Example review', '--resume', handoffCheckpoint, '--confirm-review', 'lint', '--json',
  ], 'offline handoff completion')), 'Reviewed handoff');
  if (reviewedHandoff.state !== 'complete' || !Array.isArray(reviewedHandoff.completedSteps)
    || reviewedHandoff.completedSteps.length !== 3 || reviewedHandoff.networkApprovedForThisRun !== false) {
    throw new TypeError('Installed handoff did not finish offline after the selected review confirmation.');
  }
  await checkInstalledIntakeAndContext(repositoryRoot, temporaryRoot, run);
}

async function checkInstalledIntakeAndContext(repositoryRoot: string, temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const emailFile = path.join(temporaryRoot, 'selected-message.eml');
  await writeFile(emailFile, 'From: private-local-part@sender.example\r\nContent-Type: text/html\r\n\r\n<a href="https://destination.example/private?token=excluded-value">https://sender.example</a>', { flag: 'wx', mode: 0o600 });
  const intake = record(JSON.parse(await run(['intake', 'email', emailFile, '--reported-action', 'entered_password', '--json'], 'offline message and identity intake')), 'Installed intake');
  const links = intake.links;
  if (intake.schema !== 'whoisleuth.message-intake' || !Array.isArray(links) || links.length !== 2
    || record(links[0], 'Intake link').displayedDestination !== 'different_host'
    || JSON.stringify(intake).includes('excluded-value') || JSON.stringify(intake).includes('private-local-part')
    || !JSON.stringify(intake.identityRecovery).includes('entered_password')) throw new TypeError('Installed message intake lost its extraction or minimisation contract.');
  const symbol = new Encoder().encode(new Byte('https://qr.example/private?token=excluded-qr-value'));
  const width = (symbol.size + 8) * 4, pixels = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor(x / 4) - 4, sy = Math.floor(y / 4) - 4;
    const colour = sx >= 0 && sy >= 0 && sx < symbol.size && sy < symbol.size && symbol.get(sx, sy) ? 0 : 255;
    pixels.set([colour, colour, colour, 255], (y * width + x) * 4);
  }
  const qrFile = path.join(temporaryRoot, 'selected-qr.png');
  await writeFile(qrFile, encode({ width, height: width, data: pixels, channels: 4 }), { flag: 'wx', mode: 0o600 });
  const qr = record(JSON.parse(await run(['intake', 'qr', qrFile, '--json'], 'offline PNG QR intake')), 'Installed QR intake');
  if (!Array.isArray(qr.links) || qr.links.length !== 1 || record(qr.links[0], 'QR link').origin !== 'https://qr.example'
    || JSON.stringify(qr).includes('excluded-qr-value')) throw new TypeError('Installed PNG QR intake did not decode and minimise the selected image.');

  const caseExport = record(JSON.parse((await readBoundedRegularFileWithin(repositoryRoot, 'test/fixtures/case-lifecycle/case-export-v16.json', {
    maximumBytes: MAX_INVESTIGATION_RUN_BYTES, minimumBytes: 1, label: 'Current editable Case fixture',
  })).toString('utf8')), 'Current Case export');
  if (!Array.isArray(caseExport.cases) || !caseExport.cases.length) throw new TypeError('The package history fixture needs one retained Case.');
  const date = '2026-09-22T00:00:00.000Z';
  const storefront = (hostname: string) => ({ hostname, observedAt: date, source: 'Selected fixture', brandNames: ['Example shop'], contactDomains: [], policyHashes: [], checkoutOrigins: [], paymentMethods: ['card'], assetHashes: [] });
  const contexts = [
    { kind: 'domain_history', schema: 'whoisleuth.domain-history.input', evidence: { caseExport, caseId: record(caseExport.cases[0], 'Selected Case').id, declarations: { expectedChanges: [], retiredDependencies: [] } } },
    { kind: 'platform_continuity', schema: 'whoisleuth.platform-continuity.input', evidence: [{ platformOrigin: 'https://platform.example', objectType: 'extension', objectId: 'extension-17', version: '1.0.0', observedAt: date, source: 'Selected manifest', report: 'acknowledged', providerOutcome: 'provider_reports_resolved', recheck: 'still_observed', recheckedAt: date }] },
    { kind: 'storefront', schema: 'whoisleuth.storefront-review.input', evidence: { official: storefront('official.example'), candidate: storefront('candidate.example'), authorisedComparator: true, resellerStatus: 'unknown', resellerSource: null } },
    { kind: 'connector', schema: 'whoisleuth.connector-review.input', evidence: { current: { servers: { selected: { url: 'https://connector.example/private?token=excluded-connector-value', headers: { Authorization: 'excluded-auth-value' } } } }, previous: null } },
    { kind: 'incident_sequence', schema: 'whoisleuth.incident-sequence.input', evidence: [{ id: 'stage-1', kind: 'credential_entry', basis: 'reported_action', description: 'The reporter described entering a password.', occurredAt: null, hostname: 'example.test', source: 'Selected interview', reference: 'interview-17', referenceSha256: null, completeness: 'unknown', limitations: [] }] },
  ];
  for (const context of contexts) {
    const selected = path.join(temporaryRoot, `${context.kind}.json`);
    await writeFile(selected, JSON.stringify({ schema: context.schema, version: 1, evidence: context.evidence }), { flag: 'wx', mode: 0o600 });
    const output = record(JSON.parse(await run(['review-evidence', selected, '--json'], `offline ${context.kind} review`)), 'Installed context review');
    const result = record(output.result, 'Context result');
    if (output.kind !== context.kind || result.kind !== context.kind || result.schema !== 'whoisleuth.context-review'
      || !Array.isArray(result.observations) || !['reviewed', 'partial'].includes(String(result.state))
      || /excluded-connector-value|excluded-auth-value/u.test(JSON.stringify(output))) throw new TypeError('Installed contextual review changed its evidence or privacy contract.');
    if (context.kind === 'incident_sequence') {
      if (record(result.observations[0], 'Incident observation').observedAt !== null) throw new TypeError('Installed incident review invented an event time.');
      await run(['review-evidence', selected, '--json', '--strict-exit'], 'offline partial incident exit', 4);
    }
  }
}
