<script lang="ts">
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import { onDestroy } from 'svelte';
  import type { BrandProfile } from '$lib/brand-profiles';
  import MailReportDetails from './MailReportDetails.svelte';
  import { runMailReportWorker } from '$lib/mail-report-worker.ts';
  import {
    MAX_MAIL_REPORT_FILE_BYTES,
    MAX_MAIL_REPORT_INPUT_BYTES,
    MAX_MAIL_REPORT_INPUT_FILES,
    type MailReportReview,
    type ParsedMailReport,
  } from '$lib/analysis/mail-report-workbench.ts';

  let { active, available = true }: { active: BrandProfile; available?: boolean } = $props();

  let reports = $state.raw<ParsedMailReport[]>([]);
  let review = $state.raw<MailReportReview | null>(null);
  let busy = $state(false);
  let message = $state('');
  let profileId = $state('');
  let profileSignature = $state('');
  let reviewGeneration = 0;
  let pendingImports = $state(0);
  let processing: AbortController | null = null;
  function cancelProcessing() { processing?.abort(); processing = null; }
  onDestroy(() => { reviewGeneration += 1; cancelProcessing(); });

  function formatNumber(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  function safeFilename(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'mail-reports';
  }

  async function importReports(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const selected = [...(input.files || [])];
    input.value = '';
    if (!selected.length || busy || !available) return;
    const expectedProfileId = active.id;
    const officialDomains = [...active.officialDomains];
    const retainedReports = [...reports];
    const generation = ++reviewGeneration;
    cancelProcessing();
    const controller = new AbortController();
    processing = controller;
    busy = true;
    pendingImports += 1;
    message = '';
    try {
      if (selected.length > MAX_MAIL_REPORT_INPUT_FILES) {
        throw new Error(`Select no more than ${MAX_MAIL_REPORT_INPUT_FILES} files at once.`);
      }
      const totalBytes = selected.reduce((total, file) => total + file.size, 0);
      if (totalBytes > MAX_MAIL_REPORT_INPUT_BYTES) {
        throw new Error(`Selected files are limited to ${MAX_MAIL_REPORT_INPUT_BYTES / (1024 * 1024)} MB in total.`);
      }
      const files: { name: string; bytes: Uint8Array }[] = [];
      for (const file of selected) {
        if (file.size < 1 || file.size > MAX_MAIL_REPORT_FILE_BYTES) throw new Error(`Each mail report file must be between 1 byte and ${MAX_MAIL_REPORT_FILE_BYTES / (1024 * 1024)} MiB.`);
        files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        if (generation !== reviewGeneration || active.id !== expectedProfileId) return;
      }
      const reply = await runMailReportWorker({ kind: 'import', files, retained: retainedReports, officialDomains }, { signal: controller.signal });
      if (generation !== reviewGeneration || active.id !== expectedProfileId) return;
      if (reply.kind !== 'import') throw new Error('The mail report import returned an unexpected result.');
      const result = reply.result;
      reports = [...result.review.reports];
      review = result.review;
      message = `Loaded ${result.loadedReports} report${result.loadedReports === 1 ? '' : 's'} locally; ${reports.length} unique report${reports.length === 1 ? '' : 's'} in this review.${result.duplicateReports ? ` Ignored ${result.duplicateReports} duplicate source${result.duplicateReports === 1 ? '' : 's'}.` : ''}`;
    } catch (cause) {
      if (generation !== reviewGeneration || active.id !== expectedProfileId) return;
      message = cause instanceof Error ? cause.message : 'The selected mail reports could not be reviewed.';
    } finally {
      pendingImports -= 1;
      if (generation === reviewGeneration) busy = false;
    }
  }

  function clear(): void {
    reviewGeneration += 1;
    cancelProcessing();
    reports = [];
    review = null;
    busy = false;
    message = 'Cleared imported mail reports from this tab.';
  }

  function download(): void {
    if (!review || busy || !available) return;
    downloadLocalFile(new Blob([`${JSON.stringify(review, null, 2)}\n`], { type: 'application/json' }), `${safeFilename(active.name)}-mail-report-review.json`);
  }

  $effect(() => {
    const nextSignature = `${active.id}\u0000${available ? 'ready' : 'unavailable'}\u0000${active.officialDomains.join('\u0000')}`;
    if (nextSignature === profileSignature) return;
    profileSignature = nextSignature;
    const generation = ++reviewGeneration;
    cancelProcessing();
    busy = false;
    if (active.id !== profileId) {
      profileId = active.id;
      reports = [];
      review = null;
      message = '';
      busy = false;
    } else if (!available) {
      review = null;
      message = reports.length ? 'Review paused until the saved profile is available. Imported reports remain in this tab.' : '';
    } else if (reports.length) {
      const expectedProfileId = active.id;
      const retainedReports = [...reports];
      const officialDomains = [...active.officialDomains];
      review = null;
      busy = true;
      message = 'Reconciling the retained reports with the updated active profile…';
      const controller = new AbortController();
      processing = controller;
      void runMailReportWorker({ kind: 'review', reports: retainedReports, officialDomains }, { signal: controller.signal }).then((reply) => {
        if (generation === reviewGeneration && active.id === expectedProfileId) {
          if (reply.kind !== 'review') throw new Error('The mail report reconciliation returned an unexpected result.');
          review = reply.result;
          message = 'Reconciled the retained reports with the updated active profile.';
        }
      }).catch(() => {
        if (generation === reviewGeneration && active.id === expectedProfileId) {
          review = null;
          message = 'The imported mail reports could not be reconciled with the active profile.';
        }
      }).finally(() => {
        if (generation === reviewGeneration && active.id === expectedProfileId) busy = false;
      });
    }
  });
</script>

<section class="mail-workbench card" aria-labelledby="mail-workbench-title" aria-busy={busy || pendingImports > 0}>
  <header>
    <div>
      <p class="eyebrow">Local report review</p>
      <h2 id="mail-workbench-title">DMARC and SMTP TLS reports</h2>
      <p>Review aggregate DMARC XML and TLS-RPT JSON without uploading the files. Gzip and ZIP containers are expanded locally within fixed byte and entry limits.</p>
    </div>
    <div class="actions">
      <label class="btn file-btn">
        {busy ? 'Reading…' : 'Choose reports'}
        <input type="file" multiple disabled={busy || !available} accept=".xml,.json,.gz,.zip,application/xml,application/json,application/gzip,application/zip" onchange={importReports}>
      </label>
      <button class="btn" type="button" disabled={!review || busy || !available} onclick={download}>Export review</button>
      <button class="btn" type="button" disabled={!reports.length || busy} onclick={clear}>Clear</button>
    </div>
  </header>

  <p class="privacy-note">Files and parsed values stay in this tab until cleared or the page is left. They are not uploaded or saved to the Brand Profile.</p>
  {#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

  {#if review}
    <div class="summary" role="group" aria-label="Imported mail report summary">
      <article><strong>{review.summary.dmarcReports}</strong><span>DMARC reports</span></article>
      <article><strong>{formatNumber(review.summary.dmarcMessages)}</strong><span>Messages in retained rows</span></article>
      <article><strong>{formatNumber(review.summary.dmarcBothFailed)}</strong><span>Both checks failed</span></article>
      <article><strong>{review.summary.tlsReports}</strong><span>TLS reports</span></article>
      <article><strong>{formatNumber(review.summary.tlsFailedSessions)}</strong><span>TLS failures</span></article>
    </div>

    {#if review.profileScope.outsideScopeDomains.length}
      <p class="scope-warning"><strong>Outside active profile:</strong> {review.profileScope.outsideScopeDomains.join(', ')}</p>
    {/if}
    {#if review.profileScope.unresolvedScopeDomains.length}
      <p class="scope-warning"><strong>Profile scope unresolved:</strong> {review.profileScope.unresolvedScopeDomains.join(', ')}</p>
    {/if}

    <div class="reports">
      {#each reports as report, index (report.source.digestSha256)}
        <MailReportDetails {report} position={index + 1} />
      {/each}
    </div>

    <ul class="limitations">{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  {:else}
    <p class="empty">Choose one or more aggregate report files to begin a transient review.</p>
  {/if}
</section>

<style>
  .mail-workbench{margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
  h2{margin:4px 0 0;font:700 var(--text-lg) var(--mono)}
  header p:not(.eyebrow),.privacy-note,.empty,.limitations{color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  header p:not(.eyebrow){max-width:760px;margin:7px 0 0}
  .actions{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:8px}
  .privacy-note{margin:14px 0 0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .message{margin:12px 0 0;color:var(--accent);font-size:var(--text-sm)}
  .summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:14px}
  .summary article{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .summary strong,.summary span{display:block}.summary strong{color:var(--accent);font:700 var(--text-lg) var(--mono)}.summary span{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  .scope-warning{overflow-wrap:anywhere;margin:12px 0 0;padding:10px;border:1px solid color-mix(in srgb,var(--amber) 45%,var(--border));border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-xs)}
  .scope-warning strong{color:var(--amber)}
  .reports{display:grid;gap:10px;margin-top:14px}
  .limitations{margin:14px 0 0;padding-left:18px}
  .empty{margin-bottom:0}
  @media(max-width:900px){.summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:700px){
    header{align-items:stretch;flex-direction:column}.actions{display:grid;grid-template-columns:1fr;justify-content:stretch}.actions .btn{width:100%}
    .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
  @media(max-width:390px){.summary{grid-template-columns:1fr}}
</style>
