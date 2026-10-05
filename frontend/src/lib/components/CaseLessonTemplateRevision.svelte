<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import type { InvestigationTemplate } from '#lib/investigation-templates.ts';
  let { record }: { record: CaseRecord } = $props();
  let selected = $state('');
  let templates = $state<InvestigationTemplate[]>([]);
  let loadState = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let manager = $state<typeof import('./InvestigationTemplateManager.svelte').default>();
  let loading = $state(false);
  let lifetime = 0;
  let caseIdentity = '';
  const lesson = $derived(record.notes.find(note => note.id === selected));
  $effect(() => { if (caseIdentity !== record.id) { caseIdentity = record.id; selected = ''; } });
  onDestroy(() => { lifetime += 1; });
  async function load() {
    if (loading || loadState === 'ready') return;
    const current = lifetime;
    loading = true;
    loadState = 'loading';
    try {
      const [{ default: component }, { loadInvestigationTemplates }] = await Promise.all([import('./InvestigationTemplateManager.svelte'), import('#lib/investigation-templates.ts')]);
      const saved = await loadInvestigationTemplates();
      if (current !== lifetime) return;
      manager = component; templates = saved; loadState = 'ready';
    } catch { if (current === lifetime) loadState = 'unavailable'; }
    finally { if (current === lifetime) loading = false; }
  }
</script>

<details ontoggle={(event) => { if (event.currentTarget.open) void load(); }}>
  <summary>Use a saved lesson to revise a template</summary>
  {#if !record.notes.length}<p>Save an after-action review or another Case note first.</p>
  {:else}
    <label class="field">Saved lesson<select bind:value={selected}><option value="">Select one note</option>{#each record.notes as note}<option value={note.id}>{note.createdAt.slice(0, 10)} · {note.body.slice(0, 90)}</option>{/each}</select></label>
    {#if lesson}<blockquote>{lesson.body}</blockquote>{/if}
    {#if loadState === 'unavailable'}<p role="status">Saved templates could not be loaded.</p><button type="button" class="btn" onclick={load}>Retry loading templates</button>
    {:else if loadState === 'loading'}<p role="status">Loading saved templates.</p>
    {:else if lesson && manager}{@const Manager = manager}<Manager {templates} {loadState} onchange={next => { templates = next; }} lessonSource={{ identity: `${record.id}:${lesson.id}`, body: lesson.body }} />{/if}
  {/if}
</details>

<style>blockquote{margin:12px 0;padding:12px;border-left:2px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}.field{margin-top:12px}select{min-width:0;width:100%}</style>
