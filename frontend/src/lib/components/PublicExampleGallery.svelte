<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PUBLIC_EXAMPLES_INDEX } from '$lib/generated/public-examples-index';
  import {
    DEFERRED_MODULE_RECOVERY_DETAIL,
    loadDeferredModule,
    reloadDeferredModulePage,
  } from '$lib/deferred-module';

  type FullExamples = typeof import('$lib/generated/public-examples')['PUBLIC_EXAMPLES'];
  type ExampleOutput = FullExamples['examples'][number];

  let format = $state('all');
  let openedId = $state('');
  let loadingId = $state('');
  let loadError = $state('');
  let actionStatus = $state('');
  let outputs = $state<FullExamples | null>(null);
  let outputsPromise: Promise<FullExamples> | null = null;
  let loadGeneration = 0;
  let active = true;
  const moduleController = new AbortController();

  const formats = Object.freeze([...new Set(PUBLIC_EXAMPLES_INDEX.examples.map((example) => example.format))]);
  const filtered = $derived(PUBLIC_EXAMPLES_INDEX.examples.filter((example) => format === 'all' || example.format === format));

  function outputFor(id: string): ExampleOutput | null {
    return outputs?.examples.find((example) => example.id === id) ?? null;
  }

  async function ensureOutputs(): Promise<FullExamples> {
    if (outputs) return outputs;
    outputsPromise ??= loadDeferredModule(
      () => import('$lib/generated/public-examples'),
      { signal: moduleController.signal },
    )
      .then((module) => module.PUBLIC_EXAMPLES)
      .catch((error) => {
        outputsPromise = null;
        throw error;
      });
    outputs = await outputsPromise;
    return outputs;
  }

  function preloadOutputs(): void {
    if (loadError) return;
    void ensureOutputs().catch(() => undefined);
  }

  async function toggleOutput(id: string) {
    if (loadError) return;
    if (openedId === id) {
      openedId = '';
      return;
    }
    const request = ++loadGeneration;
    loadError = '';
    actionStatus = '';
    loadingId = id;
    try {
      await ensureOutputs();
      if (!active || request !== loadGeneration) return;
      openedId = id;
    } catch {
      if (!active || request !== loadGeneration) return;
      loadError = 'Synthetic output is unavailable.';
    } finally {
      if (active && request === loadGeneration) loadingId = '';
    }
  }

  async function copyOutput(example: ExampleOutput) {
    try {
      await navigator.clipboard.writeText(example.content);
      actionStatus = `${example.title} copied.`;
    } catch {
      actionStatus = 'Copy was unavailable. The example remains visible for manual selection.';
    }
  }

  function downloadOutput(example: ExampleOutput) {
    const url = URL.createObjectURL(new Blob([example.content], { type: example.mediaType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = example.downloadName;
    anchor.click();
    URL.revokeObjectURL(url);
    actionStatus = `${example.title} downloaded as a synthetic local example.`;
  }

  onDestroy(() => {
    active = false;
    loadGeneration += 1;
    moduleController.abort();
  });
</script>

<section class="gallery" aria-labelledby="example-gallery-title" data-testid="public-example-gallery">
  <div class="gallery-heading"><div><p class="eyebrow">Example output</p><h2 id="example-gallery-title">Open a synthetic format</h2><p>Generated from reserved fixtures and marked as demonstration material.</p></div><label><span>Format</span><select bind:value={format}><option value="all">All formats</option>{#each formats as item}<option value={item}>{item}</option>{/each}</select></label></div>
  {#if loadError}<div class="load-error" role="alert"><p>{loadError}</p><small>{DEFERRED_MODULE_RECOVERY_DETAIL}</small><button type="button" onclick={reloadDeferredModulePage}>Reload page</button></div>{/if}
  <p class="action-status" role="status" aria-live="polite">{actionStatus}</p>
  <div class="example-grid independent-grid">
    {#each filtered as example (example.id)}
      <article class="card" data-example={example.id}>
        <header><span class="synthetic-chip">Synthetic</span><span>{example.format}{example.large ? ' · larger output' : ''}</span></header>
        <h3>{example.title}</h3>
        <p>{example.summary}</p>
        <code>{example.command}</code>
        <button type="button" disabled={Boolean(loadError)} aria-expanded={openedId === example.id} aria-controls={`example-output-${example.id}`} onpointerenter={preloadOutputs} onfocus={preloadOutputs} onclick={() => void toggleOutput(example.id)}>{loadingId === example.id ? 'Loading synthetic output…' : openedId === example.id ? 'Close synthetic output' : 'Open synthetic output'}</button>
        {#if openedId === example.id && outputFor(example.id)}
          {@const output = outputFor(example.id)!}
          <div class="example-output" id={`example-output-${example.id}`}>
            <strong>{output.notice}</strong>
            <textarea class="output-scroll" readonly aria-label={`${output.title} synthetic output`} value={output.content}></textarea>
            <div class="output-actions"><button type="button" onclick={() => void copyOutput(output)}>Copy example</button><button type="button" onclick={() => downloadOutput(output)}>Download example</button></div>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</section>

<style>
  .gallery-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}.gallery-heading>div{max-width:760px}.gallery-heading h2{margin:.3rem 0 .55rem;font:700 clamp(1.5rem,3vw,2.15rem) var(--mono);letter-spacing:-.04em}.gallery-heading p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.6}.gallery-heading label{display:grid;flex:0 0 180px;gap:6px}.gallery-heading label span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.gallery-heading select{padding:9px}
  .load-error{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-left:2px dotted var(--muted);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs)}.load-error p,.load-error small{margin:0;overflow-wrap:anywhere}.load-error p{color:var(--danger)}.load-error small{flex:1}.load-error button{flex:0 0 auto}.action-status{min-height:1.4em;color:var(--interface-accent);font-size:var(--text-xs)}
  .example-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.example-grid article{display:flex;min-width:0;align-items:flex-start;flex-direction:column;padding:18px}.example-grid header{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.synthetic-chip{padding:4px 7px;border:1px solid var(--amber);border-radius:999px;color:var(--amber);text-transform:uppercase}.example-grid h3{margin:15px 0 7px;font:700 var(--text-md) var(--mono)}.example-grid>article>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.example-grid>article>code{display:block;max-width:100%;margin:14px 0;color:var(--accent);font-size:var(--text-xs);overflow-wrap:anywhere}.example-grid button{padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:700 var(--text-xs) var(--mono)}.example-grid>article>button{margin-top:auto}.example-output{width:100%;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}.example-output>strong{display:block;color:var(--amber);font-size:var(--text-xs);line-height:1.5}.output-scroll{display:block;width:100%;height:320px;max-height:430px;margin:10px 0;padding:13px;resize:vertical;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font:.72rem/1.55 var(--mono);white-space:pre}.output-scroll:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.output-actions{display:flex;flex-wrap:wrap;gap:7px}
  @media(max-width:760px){.gallery-heading{align-items:flex-start;flex-direction:column}.gallery-heading label{width:100%;flex:auto}.example-grid{grid-template-columns:1fr}.load-error{align-items:stretch;flex-direction:column}.load-error button{width:100%}}
</style>
