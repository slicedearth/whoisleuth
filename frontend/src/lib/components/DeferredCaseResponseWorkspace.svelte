<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { preloadBestEffort } from '$lib/idle-preload';
  import type { CaseRecord } from '$lib/cases';

  let {
    record,
    onsaved,
    oncommitted,
    onmessage,
    openInitially = false,
  }: {
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
    openInitially?: boolean;
  } = $props();

  let open = $state(false);
  const moduleController = new AbortController();
  const sectionId = $derived(`case-response-${record.id}`);

  function preloadWorkspace(): void {
    preloadBestEffort(() => import('$lib/components/CaseResponseWorkspace.svelte'), moduleController.signal);
  }

  onDestroy(() => moduleController.abort());

  $effect(() => {
    if (openInitially) {
      preloadWorkspace();
      open = true;
    }
  });

  async function restoreDeepLinkFocus() {
    if (!openInitially) return;
    await tick();
    if (new URL(window.location.href).searchParams.get('response') === '1') {
      const preflight = document.getElementById(`case-response-preflight-${record.id}`) as HTMLDetailsElement | null;
      if (preflight) {
        preflight.open = true;
        preflight.scrollIntoView({ block: 'center' });
        preflight.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
        return;
      }
    }
    if (window.location.hash !== `#${sectionId}`) return;
    const section = document.getElementById(sectionId);
    section?.scrollIntoView({ block: 'start' });
    section?.focus({ preventScroll: true });
  }
</script>

<details class="response-disclosure card" id={sectionId} tabindex="-1" bind:open>
  <summary onpointerenter={preloadWorkspace} onfocus={preloadWorkspace}>
    <span><strong>Case response and packet workspace</strong><small>Open response planning, evidence packets, action tracking, and closure review</small></span>
    <span>{open ? 'Close workspace' : 'Open workspace'}</span>
  </summary>
  {#if open}
    <div class="response-body">
      <DeferredSurface
        load={() => import('$lib/components/CaseResponseWorkspace.svelte')}
        loadingLabel="Loading Case response and packet workspace…"
        unavailableLabel="The Case response workspace could not be loaded."
        onready={restoreDeepLinkFocus}
        props={{ record, onsaved, oncommitted, onmessage, sectionId: `${sectionId}-workspace`, advancedInitially: openInitially }}
      />
    </div>
  {/if}
</details>

<style>
  .response-disclosure{min-width:0;margin-top:14px;padding:0;overflow:hidden;scroll-margin-top:88px}
  .response-disclosure>summary{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:16px;padding:14px;cursor:pointer;list-style:none}
  .response-disclosure>summary::-webkit-details-marker{display:none}
  .response-disclosure>summary span:first-child{display:grid;min-width:0;gap:4px}
  .response-disclosure>summary strong{overflow-wrap:anywhere;color:var(--text);font:700 var(--text-sm) var(--mono)}
  .response-disclosure>summary small{overflow-wrap:anywhere;color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  .response-disclosure>summary span:last-child{flex:0 0 auto;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .response-disclosure>summary span:last-child::before{content:'+';display:inline-block;width:1.2em}
  .response-disclosure[open]>summary{border-bottom:1px solid var(--border);background:var(--panel-raised)}
  .response-disclosure[open]>summary span:last-child::before{content:'−'}
  .response-body{min-width:0;padding:14px;overflow-wrap:anywhere}
  @media(max-width:620px){.response-disclosure>summary{align-items:flex-start;flex-direction:column;gap:10px}.response-disclosure>summary span:last-child{white-space:normal}}
</style>
