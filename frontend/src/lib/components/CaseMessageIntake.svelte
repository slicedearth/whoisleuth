<script lang="ts">
  import { goto } from '$app/navigation';
  import type { CaseRecord } from '$lib/cases';
  import type { PersistCaseOperation } from '$lib/analysis/case-response-stage.ts';
  import type { MessageIntakeResult } from '../../../../packages/contracts/message-intake.mts';
  import { messageCaseEvidence } from '../../../../packages/investigation/message-case-evidence.mts';
  import { prepareCaseAttachmentFiles, retainCaseAttachments } from '$lib/case-attachments.ts';
  import MessageIntake from './MessageIntake.svelte';

  let { record, mutationBusy, persistOperation }: { record: CaseRecord; mutationBusy: boolean; persistOperation: PersistCaseOperation } = $props();
  async function save(result: MessageIntakeResult, original: File, retainOriginal: boolean): Promise<boolean> {
    const id = record.id;
    const report = new File([JSON.stringify(result.report, null, 2)], 'message-review.json', { type: 'application/json' });
    const files = await prepareCaseAttachmentFiles(retainOriginal ? [report, original] : [report], 'Analyst-selected message review', null);
    if (id !== record.id) return false;
    const reviewSummary = messageCaseEvidence(result.report, files[0]!.attachment.digestSha256);
    return persistOperation(() => retainCaseAttachments(id, files, { reviewSummary }), 'Saved the minimised message review and its source hash.', null);
  }
</script>

<MessageIntake disabled={mutationBusy} onsave={save} onselect={target => goto(`/lookup?${new URLSearchParams({ q: target, case: record.id })}`)} />
