<script lang="ts">
  import type { BulkGroupBy, BulkTriageGroup } from '$lib/analysis/bulk-triage.ts';

  let {
    groupBy,
    groups,
    excluded,
    truncated,
    overlapping,
    selectedDomains,
    selectionAvailable,
    selectDomains,
  }: {
    groupBy: BulkGroupBy;
    groups: BulkTriageGroup[];
    excluded: number;
    truncated: boolean;
    overlapping: boolean;
    selectedDomains: ReadonlySet<string>;
    selectionAvailable: boolean;
    selectDomains: (domains: string[]) => void | Promise<void>;
  } = $props();

  function selectedCount(group: BulkTriageGroup): number {
    return group.domains.filter((domain) => selectedDomains.has(domain)).length;
  }
</script>

{#if groupBy}
  <section class="bulk-groups" aria-labelledby="bulk-group-title">
    <div class="group-heading">
      <div>
        <p class="eyebrow">Current filtered set</p>
        <h3 id="bulk-group-title">{groups.length} observed group{groups.length === 1 ? '' : 's'}</h3>
      </div>
      {#if truncated}<span class="partial">Partial grouping</span>{/if}
    </div>
    <p>Groups summarise compact observations already present in this scan. Shared registrars or nameservers are common and do not establish common ownership, control, coordination, intent, or abuse.</p>
    {#if overlapping}<p>Mutation groups overlap because one candidate can retain more than one generation family.</p>{/if}
    {#if excluded}<p>{excluded} row{excluded === 1 ? '' : 's'} had no value for this grouping and remain in the result table.</p>{/if}
    {#if groups.length}
      <div class="group-grid">
        {#each groups as group}
          <article>
            <div><strong>{group.label}</strong><span>{group.domains.length} domain{group.domains.length === 1 ? '' : 's'} · {selectionAvailable ? `${selectedCount(group)} selected` : 'selection unavailable'}</span></div>
            <button type="button" class="btn small" disabled={!selectionAvailable} onclick={() => selectDomains(group.domains)}>Select group</button>
          </article>
        {/each}
      </div>
    {:else}
      <p>No retained values are available for this grouping.</p>
    {/if}
  </section>
{/if}

<style>
  .bulk-groups{margin:16px 0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .group-heading{display:flex;align-items:start;justify-content:space-between;gap:12px}
  .group-heading h3,.group-heading p{margin:0}
  .bulk-groups>p{margin:7px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .group-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
  article{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article div{min-width:0}
  article strong,article span{display:block;overflow-wrap:anywhere}
  article strong{font-size:var(--text-sm)}
  article span{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  .partial{color:var(--amber);font-size:var(--text-xs)}
  @media(max-width:700px){.group-grid{grid-template-columns:1fr}.group-heading,article{align-items:stretch;flex-direction:column}}
</style>
