<script lang="ts">
  import type { CaseRecord } from '$lib/analysis/case-model.ts';
  import { caseNumber } from '../../../../packages/cases/case-workflow-metadata.mts';
  let { id, records, selectedId = '', disabled = false, select }: {
    id: string;
    records: readonly CaseRecord[];
    selectedId?: string;
    disabled?: boolean;
    select: (id: string) => boolean | void;
  } = $props();
</script>

<label class="case-picker" for={id}>Incident Case
  <select {id} value={selectedId} {disabled} onchange={(event) => {
    if (select(event.currentTarget.value) === false) event.currentTarget.value = selectedId;
  }}>
    <option value="" disabled>Choose an incident</option>
    {#each records as record (record.id)}<option value={record.id}>{record.title || record.domain} · Case …{caseNumber(record.id).slice(-8)}</option>{/each}
  </select>
</label>

<style>
  .case-picker { display: grid; gap: 6px; min-width: 0; margin-block: 10px; font-size: var(--text-sm); }
  select { width: 100%; min-width: 0; max-width: 100%; min-height: 44px; }
</style>
