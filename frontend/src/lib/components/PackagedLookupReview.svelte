<script lang="ts">
  import { onMount } from 'svelte';
  import type { LookupEvidenceReplay } from '$lib/analysis/lookup-evidence-replay.ts';
  import LookupEvidenceReading from './LookupEvidenceReading.svelte';
  let { replay, onclose }: { replay: LookupEvidenceReplay; onclose: () => void } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  onMount(() => { dialog.showModal(); heading.focus({ preventScroll: true }); return () => dialog.close(); });
</script>

<dialog bind:this={dialog} aria-labelledby={id} onclose={onclose}>
  <header><h2 {id} bind:this={heading} tabindex="-1">Temporary Lookup review</h2><button class="btn" type="button" onclick={() => dialog.close()}>Return to package</button></header>
  <p>Packaged evidence only. No source is contacted and no saved workspace is read or changed.</p>
  <LookupEvidenceReading {replay} headingId={`${id}-target`} digestDescription="matched to the package manifest; not source authentication" />
</dialog>

<style>
  dialog{width:min(1080px,calc(100% - 24px));max-height:calc(100dvh - 24px);padding:24px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel);color:var(--text);overflow:auto;overflow-wrap:anywhere}dialog::backdrop{background:rgb(0 0 0 / .6)}header{display:flex;align-items:start;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{font-family:var(--font-sans);margin:0}p{line-height:1.6}
  @media(max-width:600px){dialog{padding:16px}}
</style>
