import { MAX_INVESTIGATION_RUN_BYTES } from '../packages/contracts/investigation-run.mts';
import { prepareLocalDocumentWrite } from './local-document-checkpoint.mts';

/** Preserve the workflow checkpoint interface and shared on-disk lease convention. */
export async function prepareInvestigationCheckpoint(options: Readonly<{
  destination: string;
  resumeSource: string | null;
  force: boolean;
  signal?: AbortSignal;
}>) {
  const checkpoint = await prepareLocalDocumentWrite({
    ...options, source: options.resumeSource, label: 'Workflow state',
    maximumInputBytes: MAX_INVESTIGATION_RUN_BYTES, maximumOutputBytes: MAX_INVESTIGATION_RUN_BYTES,
  });
  return Object.freeze({ resumeInput: checkpoint.sourceInput, publish: checkpoint.publish, release: checkpoint.release });
}
