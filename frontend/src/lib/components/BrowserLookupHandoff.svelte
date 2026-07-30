<script lang="ts">
  import { goto } from '$app/navigation';
  import { buildBrowserLookupHandoff, type BrowserLookupHandoff } from '$lib/analysis/browser-lookup-handoff.ts';

  let input = $state('');
  let preview = $state<BrowserLookupHandoff | null>(null);
  let message = $state('');

  function prepare(event: SubmitEvent) {
    event.preventDefault();
    try {
      preview = buildBrowserLookupHandoff(input);
      message = '';
    } catch (cause) {
      preview = null;
      message = cause instanceof Error ? cause.message : 'Could not prepare the handoff.';
    }
  }

  async function copy() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(new URL(preview.path, location.origin).toString());
      message = 'Copied a hostname-only Lookup link.';
    } catch {
      message = 'The browser did not allow clipboard access. Open the handoff instead.';
    }
  }
</script>

<section class="browser-handoff card" aria-labelledby="browser-handoff-title">
  <div>
    <p class="eyebrow">Hostname-only handoff</p>
    <h2 id="browser-handoff-title">Move a browser target into Lookup</h2>
    <p>Paste a domain or URL. The preview removes credentials, port, path, query, and fragment before it creates a Lookup link.</p>
  </div>
  <form onsubmit={prepare}>
    <label for="browser-target">Domain or URL</label>
    <div><input id="browser-target" bind:value={input} maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://suspicious.example/path?token=…"><button type="submit" class="btn">Prepare</button></div>
  </form>
  {#if preview}
    <div class="preview">
      <div><span>Target</span><strong>{preview.domain}</strong></div>
      <p>{preview.discarded.length ? `Removed: ${preview.discarded.join(', ')}.` : 'No path, query, credentials, port, or fragment was present.'}</p>
      <div class="actions"><button type="button" class="primary" onclick={() => void goto(preview?.path ?? '/lookup')}>Open Lookup</button><button type="button" class="btn" onclick={() => void copy()}>Copy safe link</button></div>
      <small>{preview.limitations[1]}</small>
    </div>
  {/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
</section>

<style>
  .browser-handoff{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.9fr);gap:18px;margin-top:28px;padding:20px}
  h2,p{margin:0}.browser-handoff>div:first-child h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}.browser-handoff>div:first-child p:last-child{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  form{display:grid;gap:6px;align-content:start}label{font:700 var(--text-xs) var(--mono)}form>div{display:flex;gap:7px}input{min-width:0;flex:1}
  .preview{grid-column:1/-1;display:grid;gap:8px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .preview>div:first-child{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between}.preview span,.preview p,.preview small{color:var(--muted);font-size:var(--text-xs)}.preview strong{font-family:var(--mono);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px}.message{grid-column:1/-1;color:var(--accent);font-size:var(--text-xs)}
  @media(max-width:760px){.browser-handoff{grid-template-columns:1fr}.preview,.message{grid-column:auto}}
  @media(max-width:520px){form>div{display:grid}.actions button{flex:1}}
</style>
