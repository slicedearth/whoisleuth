<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    BROWSER_HANDOFF_DESTINATION_KINDS,
    buildBrowserLookupHandoff,
    type BrowserHandoffDestinationKind,
    type BrowserHandoffDisclosureFormat,
    type BrowserLookupHandoff,
  } from '$lib/analysis/browser-lookup-handoff.ts';
  import { editCase, loadCases, type CaseRecord } from '$lib/cases';

  let input = $state('');
  let destinationKind = $state<BrowserHandoffDestinationKind>('lookup');
  let endpoint = $state('');
  let disclosureFormat = $state<BrowserHandoffDisclosureFormat>('domain');
  let preview = $state<BrowserLookupHandoff | null>(null);
  let cases = $state<CaseRecord[]>([]);
  let caseId = $state('');
  let disclosureConfirmed = $state(false);
  let message = $state('');
  let openError = $state('');

  onMount(() => {
    void loadCases().then((records) => {
      cases = records.filter((record) => record.status !== 'resolved').slice(0, 500);
    }).catch(() => {
      message = 'Saved cases are unavailable. You can still prepare and open a handoff.';
    });
  });

  function prepare(event: SubmitEvent) {
    event.preventDefault();
    openError = '';
    try {
      preview = buildBrowserLookupHandoff(input, {
        destinationKind,
        endpoint,
        disclosureFormat,
      });
      disclosureConfirmed = destinationKind === 'lookup';
      message = '';
    } catch (cause) {
      preview = null;
      message = cause instanceof Error ? cause.message : 'Could not prepare the handoff.';
    }
  }

  async function copy() {
    if (!preview) return;
    openError = '';
    try {
      await navigator.clipboard.writeText(new URL(preview.destinationUrl, location.origin).toString());
      message = 'Copied the exact reviewed handoff URL.';
    } catch {
      message = 'The browser did not allow clipboard access. Open the handoff instead.';
    }
  }

  function openHandoff() {
    if (!preview || !disclosureConfirmed) return;
    openError = '';
    if (preview.destinationKind === 'lookup') {
      void goto(preview.path);
      return;
    }
    const opened = window.open('', '_blank');
    if (!opened) {
      openError = 'The new tab was blocked. Allow pop-ups for this site, then try again.';
      return;
    }
    try {
      const destination = new URL(preview.destinationUrl, location.origin);
      opened.opener = null;
      opened.location.replace(destination.href);
    } catch {
      opened.close();
      openError = 'The reviewed destination could not be opened.';
    }
  }

  async function recordHandoff() {
    if (!preview || !caseId) return;
    const record = cases.find((candidate) => candidate.id === caseId);
    if (!record) {
      message = 'Select an available open case before recording the handoff.';
      return;
    }
    try {
      await editCase(record.id, {
        trailEvent: {
          kind: 'handoff',
          summary: `Prepared ${preview.destinationLabel} handoff for ${preview.domain}.`,
          target: `browser-handoff:${preview.destinationKind}:${preview.domain}`,
        },
      });
      message = `Recorded the reviewed handoff in the case for ${record.domain}. No external result was saved.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not record the handoff in the selected case.';
    }
  }
</script>

<section class="browser-handoff card" aria-labelledby="browser-handoff-title">
  <div>
    <p class="eyebrow">Hostname-only handoff</p>
    <h2 id="browser-handoff-title">Move a browser target into Lookup</h2>
    <p>Paste a domain or URL, choose an explicit destination, and inspect the exact value and visibility before anything opens.</p>
  </div>
  <form onsubmit={prepare}>
    <label for="browser-target">Domain or URL</label>
    <input id="browser-target" bind:value={input} maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://suspicious.example/path?token=…" />
    <div class="configuration">
      <div class="configuration-field">
        <label for="handoff-destination">Destination</label>
        <select id="handoff-destination" bind:value={destinationKind} onchange={() => { preview = null; disclosureConfirmed = false; }}>
          {#each BROWSER_HANDOFF_DESTINATION_KINDS as kind}
            <option value={kind}>{kind === 'lookup' ? 'WHOISleuth Lookup' : kind === 'local_companion' ? 'Local companion endpoint' : 'External HTTPS service'}</option>
          {/each}
        </select>
      </div>
      <div class="configuration-field">
        <label for="handoff-format">Disclose</label>
        <select id="handoff-format" bind:value={disclosureFormat} onchange={() => { preview = null; disclosureConfirmed = false; }}>
          <option value="domain">Normalised domain</option>
          <option value="sanitized_url">Sanitised HTTP(S) origin</option>
        </select>
      </div>
    </div>
    {#if destinationKind !== 'lookup'}
      <label for="handoff-endpoint">Exact endpoint</label>
      <input
        id="handoff-endpoint"
        bind:value={endpoint}
        maxlength="2048"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        placeholder={destinationKind === 'local_companion' ? 'http://127.0.0.1:4312/review' : 'https://service.example/review'}
      />
      <small>WHOISleuth does not discover or validate this endpoint. It appends one <code>target</code> query parameter only after you open the reviewed preview.</small>
    {/if}
    <button type="submit" class="btn">Prepare exact preview</button>
  </form>
  {#if preview}
    <div class="preview">
      <dl>
        <div><dt>Destination</dt><dd>{preview.destinationLabel}</dd></div>
        <div><dt>Disclosed value</dt><dd><code>{preview.disclosedValue}</code></dd></div>
        <div><dt>Visibility</dt><dd>{preview.visibility.replaceAll('_', ' ')}</dd></div>
        <div><dt>Exact destination</dt><dd><code>{preview.destinationUrl}</code></dd></div>
      </dl>
      <p>{preview.discarded.length ? `Removed: ${preview.discarded.join(', ')}.` : 'No path, query, credentials, port, or fragment was present.'}</p>
      {#if preview.destinationKind !== 'lookup'}
        <label class="consent">
          <input type="checkbox" bind:checked={disclosureConfirmed} />
          I reviewed the exact endpoint and understand that opening it discloses only the value shown above.
        </label>
      {/if}
      <div class="actions">
        <button type="button" class="primary" disabled={!disclosureConfirmed} onclick={openHandoff}>{preview.destinationKind === 'lookup' ? 'Open Lookup' : 'Open reviewed destination'}{#if preview.destinationKind !== 'lookup'}<span class="sr-only"> (opens in a new tab)</span>{/if}</button>
        <button type="button" class="btn" onclick={() => void copy()}>Copy reviewed URL</button>
      </div>
      {#if cases.length}
        <div class="case-trail">
          <label for="handoff-case">Optional case trail</label>
          <select id="handoff-case" bind:value={caseId}>
            <option value="">Do not record</option>
            {#each cases as record}<option value={record.id}>{record.domain}</option>{/each}
          </select>
          <button type="button" class="btn" disabled={!caseId} onclick={() => void recordHandoff()}>Record handoff locally</button>
        </div>
      {/if}
      <small>{preview.limitations[1]}</small>
    </div>
  {/if}
  {#if openError}<p class="message error" role="alert">{openError}</p>{/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
</section>

<style>
  .browser-handoff{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.9fr);gap:18px;margin-top:28px;padding:20px}
  h2,p{margin:0}.browser-handoff>div:first-child h2{margin:4px 0 7px;font:700 var(--text-lg) var(--mono)}.browser-handoff>div:first-child p:last-child{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  form{display:grid;gap:7px;align-content:start}label{font:700 var(--text-xs) var(--mono)}input,select{min-width:0;width:100%}.configuration{display:grid;grid-template-columns:1fr;gap:8px}.configuration-field{display:grid;min-width:0;gap:6px}.configuration-field select{padding-inline:8px 24px;font-size:var(--text-xs)}form small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .preview{grid-column:1/-1;display:grid;gap:8px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0}dl div{min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:4px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}.preview p,.preview small{color:var(--muted);font-size:var(--text-xs)}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions button:disabled{cursor:not-allowed;opacity:.5}.consent{display:flex;align-items:flex-start;gap:8px;padding:9px;border:1px solid var(--amber);border-radius:var(--radius-sm);font:var(--text-xs) var(--font-sans);line-height:1.4}.consent input{width:auto;margin-top:2px}.case-trail{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center;padding-top:8px;border-top:1px solid var(--border)}.message{grid-column:1/-1;color:var(--accent);font-size:var(--text-xs)}.message.error{padding:9px 11px;border:1px dotted var(--danger);border-radius:var(--radius-sm);color:var(--danger)}
  @media(max-width:760px){.browser-handoff{grid-template-columns:1fr}.preview,.message{grid-column:auto}}
  @media(max-width:620px){.configuration,.case-trail,dl{grid-template-columns:1fr}.actions button{flex:1}}
</style>
