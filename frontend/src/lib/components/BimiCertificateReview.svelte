<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { loadDeferredModule } from '#lib/deferred-module.ts';
  import { downloadLocalFile } from '#lib/download-local-file.ts';
  import { BIMI_CERTIFICATE_INPUT_SCHEMA, BIMI_CERTIFICATE_VERSION, MAX_BIMI_PEM_BYTES, MAX_BIMI_LOGO_BYTES, MAX_BIMI_INPUT_BYTES } from '../../../../packages/contracts/bimi-certificate.mts';
  import type { reviewBimiCertificate } from '../../../../packages/evidence/bimi-certificate-review.mts';
  let { contextId }: { contextId: string } = $props();
  let domain = $state('');
  let certificate = $state<File | null>(null), anchors = $state<File | null>(null), logo = $state<File | null>(null);
  let report = $state<Awaited<ReturnType<typeof reviewBimiCertificate>> | null>(null);
  let busy = $state(false), message = $state('');
  let generation = 0, controller: AbortController | null = null;
  let form: HTMLFormElement;
  const headingId = $props.id();

  function invalidate() {
    generation++; controller?.abort(); controller = null; report = null; busy = false; message = '';
  }
  $effect(() => {
    contextId;
    untrack(() => { invalidate(); domain = ''; certificate = anchors = logo = null; form?.reset(); });
  });
  onDestroy(invalidate);

  function select(event: Event, kind: 'certificate' | 'anchors' | 'logo') {
    invalidate();
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0] ?? null;
    if (kind === 'certificate') certificate = null;
    else if (kind === 'anchors') anchors = null;
    else logo = null;
    if (file && file.size > (kind === 'logo' ? MAX_BIMI_LOGO_BYTES : MAX_BIMI_PEM_BYTES)) {
      message = kind === 'logo' ? 'Choose an SVG no larger than 32 KiB.' : 'Choose certificate PEM no larger than 256 KiB.';
      input.value = ''; return;
    }
    if (kind === 'certificate') certificate = file;
    else if (kind === 'anchors') anchors = file;
    else logo = file;
  }

  async function review(event: SubmitEvent) {
    event.preventDefault();
    if (!certificate || !anchors || busy) return;
    invalidate();
    const request = generation, abort = new AbortController(); controller = abort; busy = true;
    const owns = () => generation === request && !abort.signal.aborted;
    const selection = { certificate, anchors, logo, domain };
    try {
      if (selection.certificate.size + selection.anchors.size + (selection.logo?.size ?? 0) > MAX_BIMI_INPUT_BYTES) throw new TypeError('Selected files exceed the combined 512 KiB budget.');
      const [certificatePem, trustAnchorsPem, logoSvg] = await Promise.all([selection.certificate.text(), selection.anchors.text(), selection.logo ? selection.logo.text() : null]);
      const input = { schema: BIMI_CERTIFICATE_INPUT_SCHEMA, version: BIMI_CERTIFICATE_VERSION, domain: selection.domain, certificatePem, trustAnchorsPem, logoSvg };
      if (!owns()) return;
      const module = await loadDeferredModule(() => import('../../../../packages/evidence/bimi-certificate-review.mts'), { signal: abort.signal });
      if (!owns()) return;
      const next = await module.reviewBimiCertificate(input, new Date().toISOString(), abort.signal);
      if (owns()) report = next;
    } catch (cause) {
      if (owns()) message = cause instanceof TypeError ? cause.message : 'The selected certificate material could not be reviewed. Check the files and try again.';
    } finally { if (owns()) { busy = false; controller = null; } }
  }

  function download() {
    if (report) downloadLocalFile(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }), 'bimi-certificate-review.json');
  }
</script>

<details class="bimi-review compact-disclosure">
  <summary>BIMI certificate and logo review <span>Offline</span></summary>
  <div>
    <p>Check selected mark-certificate and logo files against CA anchors you deliberately trust. The files stay in this tab; no certificate URL or source is contacted.</p>
    <form bind:this={form} onsubmit={review} aria-label="Offline BIMI certificate review">
      <label>Exact domain <input bind:value={domain} oninput={invalidate} maxlength="253" placeholder="example.test" autocomplete="off" autocapitalize="none" spellcheck="false" disabled={busy} required /></label>
      <label>Certificate PEM <small>Leaf first, followed by any intermediate certificates · 256 KiB maximum</small><input type="file" accept=".pem,.crt,.cer,text/plain" onchange={event => select(event, 'certificate')} disabled={busy} required /></label>
      <label>Trusted CA anchors PEM <small>Your selected trust basis, not a downloaded or built-in list · 256 KiB maximum</small><input type="file" accept=".pem,.crt,.cer,text/plain" onchange={event => select(event, 'anchors')} disabled={busy} required /></label>
      <label>Logo SVG <small>Optional comparison with the certificate’s embedded mark · 32 KiB maximum</small><input type="file" accept=".svg,image/svg+xml" onchange={event => select(event, 'logo')} disabled={busy} /></label>
      <div class="actions"><button class="btn" type="submit" disabled={busy || !domain.trim() || !certificate || !anchors}>{busy ? 'Reviewing files…' : 'Review selected files offline'}</button>{#if busy}<button class="btn" type="button" onclick={invalidate}>Cancel review</button>{/if}</div>
    </form>
    {#if message}<p role="alert">{message}</p>{/if}
    {#if report}
      <section aria-labelledby={headingId}>
        <header><h3 id={headingId}>{report.domain}</h3><button class="btn" type="button" onclick={download}>Download review</button></header>
        <p>{report.state === 'checks_passed' ? 'The supported checks passed.' : 'Some checks need review.'} Reviewed {new Date(report.reviewedAt).toLocaleString()}.</p>
        <dl>{#each report.checks as check (check.id)}<div><dt>{check.label}</dt><dd><strong>{check.state.replaceAll('_', ' ')}</strong><span>{check.detail}</span></dd></div>{/each}</dl>
        <details class="compact-disclosure"><summary>Verification scope and file digests</summary><ul>{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul><p>Certificate SHA-256: <code>{report.certificate.digestSha256}</code></p>{#each report.selectedAnchorDigests as digest}<p>Selected anchor SHA-256: <code>{digest}</code></p>{/each}</details>
      </section>
    {/if}
  </div>
</details>

<style>
  .bimi-review{margin-top:18px;border-top:1px solid var(--border);padding-top:12px}summary{font-weight:700}summary>span{float:inline-end;margin-inline-start:12px;color:var(--muted);font-size:var(--text-xs)}.bimi-review>div{padding-top:10px;min-width:0}p,li{font-size:var(--text-sm);line-height:1.6;color:var(--muted)}form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}label{display:grid;align-content:start;gap:6px;font-weight:650;font-size:var(--text-sm);min-width:0}small{color:var(--muted);font-size:var(--text-xs);font-weight:400;line-height:1.5}input{width:100%;min-width:0}input[type="file"]{font-size:var(--text-xs)}.actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}header{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center}h3{margin:0;font-family:var(--mono);overflow-wrap:anywhere}section{margin-top:20px}dl{display:grid;gap:0;margin-block:12px}dl>div{padding-block:10px;border-top:1px solid var(--border);min-width:0}dt{font-weight:650;font-size:var(--text-sm)}dd{display:grid;grid-template-columns:minmax(90px,.25fr) minmax(0,1fr);gap:12px;margin:6px 0 0;font-size:var(--text-xs);line-height:1.6}dd>strong{text-transform:capitalize;color:var(--interface-accent)}dd>span{color:var(--muted)}code{overflow-wrap:anywhere;white-space:normal}
  @media(max-width:640px){form{grid-template-columns:minmax(0,1fr)}dd{grid-template-columns:minmax(0,1fr);gap:4px}}
</style>
