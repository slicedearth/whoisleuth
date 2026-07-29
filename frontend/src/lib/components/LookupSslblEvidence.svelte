<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';

  let {
    status,
    verdict,
    complete,
    detail,
    fingerprint,
    referenceUrl,
    sourceUpdatedAt,
    generatedAt,
    entryCount,
    digest,
    limitations,
  }: {
    status: string;
    verdict: string;
    complete: boolean;
    detail: string;
    fingerprint: string;
    referenceUrl: string;
    sourceUpdatedAt: string;
    generatedAt: string;
    entryCount: number | null;
    digest: string;
    limitations: string[];
  } = $props();

  const SHA1_RE = /^[a-f0-9]{40}$/u;
  const listed = $derived(verdict === 'listed');
  const toneStatus = $derived(listed ? 'warning' : status);
  const safeReferenceUrl = $derived.by(() => {
    const normalizedFingerprint = fingerprint.trim().toLowerCase();
    if (!listed || !SHA1_RE.test(normalizedFingerprint)) return '';
    const expected = `https://sslbl.abuse.ch/ssl-certificates/sha1/${normalizedFingerprint}/`;
    return referenceUrl === expected ? expected : '';
  });
</script>

<details class="sslbl-card evidence-card card" aria-labelledby="sslbl-title">
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy">
        <span class="eyebrow">Local warning-data comparison</span>
        <span class="evidence-summary-title" id="sslbl-title" role="heading" aria-level="4">SSLBL certificate match</span>
        <span class="evidence-summary-detail">{detail}</span>
      </span>
      <span class="evidence-status {evidenceStatusTone(toneStatus, { complete })}">{verdict.replaceAll('_', ' ')}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="stat-grid">
      <article><small>Comparison state</small><strong>{status}</strong></article>
      <article><small>Exact result</small><strong class:listed>{verdict.replaceAll('_', ' ')}</strong></article>
      <article><small>Snapshot updated</small><strong>{sourceUpdatedAt || 'Unavailable'}</strong></article>
      <article><small>Snapshot entries</small><strong>{entryCount === null ? 'Unavailable' : entryCount.toLocaleString()}</strong></article>
    </div>
    {#if fingerprint}
      <dl class="detail-grid">
        <dt>Leaf certificate SHA-1</dt><dd class="hash">{fingerprint}</dd>
        <dt>Snapshot generated</dt><dd>{generatedAt || 'Unavailable'}</dd>
        <dt>Snapshot digest</dt><dd class="hash">{digest || 'Unavailable'}</dd>
      </dl>
    {/if}
    <p class:list-warning={listed} class="callout">{detail}</p>
    <p class="source-note">
      Source: <a href="https://sslbl.abuse.ch/blacklist/" target="_blank" rel="noopener noreferrer">SSLBL certificate blacklist</a>.
      {#if safeReferenceUrl}<a href={safeReferenceUrl} target="_blank" rel="noopener noreferrer">Review the matching provider record</a>.{/if}
    </p>
    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">This exact local comparison makes no provider request and does not change availability or Risk scoring.</p>
  </div>
</details>

<style>
  .stat-grid{margin:0}
  .listed{color:var(--danger)}
  .detail-grid{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:8px;margin:14px 0 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font-size:var(--text-xs)}
  .detail-grid dt{color:var(--muted)}
  .detail-grid dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .hash{font-family:var(--mono)}
  .callout{margin:12px 0 0}
  .list-warning{border-color:color-mix(in srgb,var(--danger) 45%,var(--border));color:var(--danger)}
  .source-note,.card-note{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .source-note a+a{margin-left:10px}
  @media(max-width:650px){
    .detail-grid{grid-template-columns:1fr;gap:4px}
    .detail-grid dt:not(:first-child){margin-top:7px}
    .source-note a{display:block;margin-top:5px}
    .source-note a+a{margin-left:0}
  }
</style>
