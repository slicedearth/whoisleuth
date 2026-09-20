<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CaseResponsePacket } from '$lib/analysis/case-response-packet.ts';

  let { packet, onvalidate, onclose }: {
    packet: CaseResponsePacket;
    onvalidate: () => Promise<void>;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let heading: HTMLHeadingElement;
  let includeAppendix = $state(false);
  let busy = $state(false);
  let printing = $state(false);
  let error = $state('');
  let mounted = false;

  onMount(() => {
    mounted = true;
    dialog.showModal();
    heading.focus({ preventScroll: true });
    const afterPrint = () => { printing = false; };
    window.addEventListener('afterprint', afterPrint);
    return () => {
      mounted = false;
      window.removeEventListener('afterprint', afterPrint);
      dialog.close();
    };
  });

  async function printReport() {
    if (busy || printing) return;
    busy = true;
    error = '';
    try {
      await onvalidate();
      if (!mounted || !dialog.open) return;
      printing = true;
      await tick();
      if (!mounted || !dialog.open) return;
      window.print();
    } catch (cause) {
      printing = false;
      error = cause instanceof Error ? cause.message : 'The prepared packet could not be checked for printing.';
    } finally {
      busy = false;
    }
  }
</script>

{#snippet timestamp(value: string | null)}
  {#if value}<time datetime={value}>{value.replace('T', ' ').replace(/Z$/u, ' UTC')}</time>{:else}<span>Time unavailable</span>{/if}
{/snippet}

<dialog class="packet-print" class:print-approved={printing} bind:this={dialog} aria-labelledby="packet-report-title" onclose={onclose}>
  <div class="print-controls">
    <div><button type="button" class="btn" onclick={() => void printReport()} disabled={busy || printing}>{busy ? 'Checking packet…' : 'Print or save PDF'}</button><button type="button" class="btn" onclick={() => dialog.close()}>Close report</button></div>
    <label><input type="checkbox" bind:checked={includeAppendix} disabled={printing}> Include exact packet JSON as a technical appendix</label>
    <p>The print dialog does not confirm that a file was saved or delivered.</p>
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
  <p class="print-guard">Use “Print or save PDF” in the report to check the prepared packet before printing.</p>
  <article class="report-content">
    <header>
      <p class="eyebrow">{packet.profile.label}</p>
      <h2 id="packet-report-title" tabindex="-1" bind:this={heading}>{packet.case.domain}</h2>
      <p class="subject">{packet.profile.subject}</p>
      <p class="status">{packet.authorisation.status === 'authorised' ? 'Authorised packet' : 'Draft — authorisation incomplete'}</p>
      <dl class="report-facts"><div><dt>Case ID</dt><dd>{packet.case.id}</dd></div><div><dt>Prepared</dt><dd>{@render timestamp(packet.generatedAt)}</dd></div><div><dt>Audience</dt><dd>{packet.profile.audience}</dd></div><div><dt>Analyst disposition</dt><dd>{packet.case.disposition.replaceAll('_', ' ')}</dd></div></dl>
    </header>

    <section aria-labelledby="packet-report-incident"><h3 id="packet-report-incident">Incident</h3>
      <dl class="report-facts"><div><dt>Category</dt><dd>{packet.incident.category}</dd></div><div><dt>Affected party</dt><dd>{packet.incident.affectedParty}</dd></div><div><dt>Observed</dt><dd>{@render timestamp(packet.incident.observedAt)}</dd></div></dl>
      <p class="prose">{packet.incident.observedHarm}</p>
      <h4>Selected URLs</h4><ul>{#each packet.incident.abusiveUrls as url}<li class="identifier">{url}</li>{/each}</ul>
    </section>

    <section aria-labelledby="packet-report-evidence"><h3 id="packet-report-evidence">Selected evidence · {packet.selectedEvidence.length}</h3>
      {#if packet.selectedEvidence.length}<ol class="evidence-list">{#each packet.selectedEvidence as evidence}<li>
        <h4>{evidence.label}</h4><p>{evidence.source} · {evidence.completeness.replaceAll('_', ' ')}</p>
        <p>{@render timestamp(evidence.observedAt)}{#if evidence.observationHostname} · {evidence.observationHostname}{/if}</p>
        <p class="reference">Reference: {evidence.id}</p>
        {#if evidence.limitations.length}<ul>{#each evidence.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
      </li>{/each}</ol>{:else}<p>No evidence was selected for this packet.</p>{/if}
    </section>

    <section aria-labelledby="packet-report-recipient"><h3 id="packet-report-recipient">Recipient and response</h3>
      {#if packet.recipientRoute}<dl class="report-facts"><div><dt>Selected recipient</dt><dd>{packet.recipientRoute.contact}</dd></div><div><dt>Route source</dt><dd>{packet.recipientRoute.source}</dd></div><div><dt>Route observed</dt><dd>{@render timestamp(packet.recipientRoute.observedAt)}</dd></div><div><dt>Route freshness at preparation</dt><dd>{packet.recipientRoute.freshness}</dd></div></dl>
        {#if packet.recipientRoute.limitations.length}<ul>{#each packet.recipientRoute.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
      {:else}<p>No recipient route is selected.</p>{/if}
      <dl class="report-facts"><div><dt>Provider outcome</dt><dd>{#if packet.responseLifecycle.latestProviderOutcome}{packet.responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')} · {@render timestamp(packet.responseLifecycle.latestProviderOutcome.occurredAt)}{:else}{packet.responseLifecycle.providerOutcomeState.replaceAll('_', ' ')}{/if}</dd></div><div><dt>Independent recheck</dt><dd>{#if packet.responseLifecycle.latestObservedEffect}{packet.responseLifecycle.latestObservedEffect.state.replaceAll('_', ' ')} · {packet.responseLifecycle.latestObservedEffect.source} · {@render timestamp(packet.responseLifecycle.latestObservedEffect.observedAt)}{:else}{packet.responseLifecycle.observedChangeState.replaceAll('_', ' ')}{/if}</dd></div></dl>
      {#if packet.responseLifecycle.closure}<p>Closure recorded: {packet.responseLifecycle.closure.reason.replaceAll('_', ' ')} · {@render timestamp(packet.responseLifecycle.closure.createdAt)}</p>{/if}
      {#if packet.responseLifecycle.limitations.length}<ul>{#each packet.responseLifecycle.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
    </section>

    <section aria-labelledby="packet-report-quality"><h3 id="packet-report-quality">Readiness and unresolved evidence</h3>
      <dl class="readiness">{#each packet.readiness.rows as row}<div><dt>{row.label} · {row.state.replaceAll('_', ' ')}</dt><dd>{row.detail}{#if row.limitations.length}<ul>{#each row.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</dd></div>{/each}</dl>
      {#if packet.contradictions.length}<h4>Contradictions retained for review</h4><ul>{#each packet.contradictions as contradiction}<li>{contradiction.statement} · {contradiction.state}{#if contradiction.limitations.length}<ul>{#each contradiction.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</li>{/each}</ul>{/if}
      {#if packet.authorisation.limitations.length}<div class="limitations-group"><h4>Authorisation limitations</h4><ul>{#each packet.authorisation.limitations as limitation}<li>{limitation}</li>{/each}</ul></div>{/if}
    </section>

    {#if packet.artefactReferences.length}<section aria-labelledby="packet-report-files"><h3 id="packet-report-files">Referenced files · {packet.artefactReferences.length}</h3><ol class="evidence-list">{#each packet.artefactReferences as file}<li><h4>{file.label}</h4><p>{file.source} · {file.mediaType} · {file.byteLength === null ? 'Byte length unavailable' : `${file.byteLength.toLocaleString('en-AU')} bytes`}</p><p>{@render timestamp(file.capturedAt)}</p><p class="identifier">SHA-256: {file.digestSha256}</p>{#if file.limitations.length}<ul>{#each file.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}</li>{/each}</ol></section>{/if}

    <footer><h3>Packet reference</h3><p class="identifier">SHA-256: {packet.integrity.digestSha256}</p><p>{packet.schema} · version {packet.schemaVersion}. The digest identifies the canonical packet JSON, not this printed layout or the truth of its evidence. No submission is performed.</p></footer>
    {#if includeAppendix}<section class="technical-appendix" aria-labelledby="packet-report-appendix"><h3 id="packet-report-appendix">Technical appendix — exact packet JSON</h3><pre>{JSON.stringify(packet, null, 2)}</pre></section>{/if}
  </article>
</dialog>

<style>
  .packet-print{box-sizing:border-box;width:min(960px,calc(100% - 24px));max-width:none;max-height:calc(100dvh - 24px);margin:auto;padding:0;border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--panel);color:var(--text);overflow:auto;overscroll-behavior:contain}
  .packet-print::backdrop{background:rgb(0 0 0 / .58)}
  .print-controls{position:sticky;top:0;z-index:1;display:grid;gap:9px;padding:14px 24px;border-bottom:1px solid var(--border);background:var(--panel)}
  .print-controls>div{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between}
  .print-controls label{display:flex;align-items:center;gap:9px;min-height:44px;font-size:var(--text-sm)}
  .print-controls input{flex:none;width:18px;height:18px}
  .print-controls p{margin:0;color:var(--muted);font-size:var(--text-xs)}
  .print-controls [role='alert']{color:var(--danger)}
  .print-guard{display:none}
  .report-content{padding:30px 36px;min-width:0;font:400 var(--text-sm)/1.65 var(--font-sans);overflow-wrap:anywhere}
  h2,h3,h4,p{margin:0}h2{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.2;font-family:var(--font-sans)}h3{margin-bottom:12px;font:700 var(--text-lg)/1.35 var(--font-sans)}h4{font:650 var(--text-sm)/1.5 var(--font-sans)}
  header{display:grid;gap:12px}.eyebrow{color:var(--muted);font-size:var(--text-xs);font-weight:600}.subject{font-size:var(--text-lg);line-height:1.4}.status{font-weight:700}
  section,footer{margin-top:26px;padding-top:22px;border-top:1px solid var(--border)}
  .report-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;margin:14px 0}.report-facts>div{min-width:0}dt{font-weight:650}dd{margin:0}time{font-variant-numeric:tabular-nums}
  ul,ol{padding-left:22px;margin:8px 0}.prose{white-space:pre-wrap;margin:14px 0}.identifier,.reference{font-family:var(--mono);font-size:var(--text-xs);overflow-wrap:anywhere}
  .evidence-list>li{padding:0 0 15px 3px}.evidence-list p{margin-top:3px}.reference{color:var(--muted)}.readiness{display:grid;gap:12px;margin:0}.readiness ul{margin-bottom:0}
  footer p{margin-top:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:400 var(--text-xs)/1.5 var(--mono);max-width:100%;margin:12px 0 0}
  @media(max-width:600px){.packet-print{width:calc(100% - 12px);max-height:calc(100dvh - 12px)}.print-controls{position:static;padding:12px}.report-content{padding:22px 16px}.report-facts{grid-template-columns:minmax(0,1fr)}}
  @media print {
    @page{margin:16mm}
    :global(html:has(dialog.packet-print[open])){background:white!important;color:#111!important;color-scheme:light!important}
    :global(body:has(dialog.packet-print[open]) *:not(dialog.packet-print):not(dialog.packet-print *):not(:has(dialog.packet-print[open]))){display:none!important}
    :global(body:has(dialog.packet-print[open])),:global(body:has(dialog.packet-print[open]) *:has(dialog.packet-print[open])){display:block!important;position:static!important;contain:none!important;transform:none!important;width:auto!important;max-width:none!important;min-width:0!important;height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important;margin:0!important;padding:0!important;border:0!important;background:white!important;box-shadow:none!important}
    :global(body:has(dialog.packet-print[open]))::before,:global(body:has(dialog.packet-print[open]))::after,:global(body:has(dialog.packet-print[open]) *:has(dialog.packet-print[open]))::before,:global(body:has(dialog.packet-print[open]) *:has(dialog.packet-print[open]))::after{display:none!important}
    .packet-print{position:static!important;inset:auto!important;display:block!important;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;margin:0!important;padding:0!important;overflow:visible!important;border:0!important;border-radius:0!important;background:white!important;color:#111!important;--muted:#333;--border:#aaa;box-shadow:none!important}
    .packet-print::backdrop,.print-controls{display:none!important}.report-content{padding:0;font-size:10pt}.report-facts{grid-template-columns:repeat(2,minmax(0,1fr))}
    h2{font-size:22pt}h3{font-size:14pt}h4{font-size:11pt}h2,h3,h4,dt{break-after:avoid}.evidence-list>li,.report-facts>div,.readiness>div{break-inside:avoid}.identifier,.reference,pre{font-size:8pt}
    .technical-appendix{break-before:page}footer,.limitations-group{break-inside:avoid}
    .packet-print:not(.print-approved) .report-content{display:none}.packet-print:not(.print-approved) .print-guard{display:block}
  }
</style>
