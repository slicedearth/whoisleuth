import path from 'node:path';
import { writeFile } from 'node:fs/promises';
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
}
