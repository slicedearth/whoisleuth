<script lang="ts">
  type Row = { label: string; value: string; danger?: boolean; hash?: boolean };
  type Finding = { label: string; detail: string; tone: string };
  type ChainEntry = { label: string; subject: string; fingerprint: string };

  let {
    status,
    complete,
    rows,
    findings,
    leafCertificate,
    alternativeNames,
    alternativeNamesTruncated,
    chain,
    chainTruncated,
    validationDetails,
    limitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    rows: Row[];
    findings: Finding[];
    leafCertificate: Row[];
    alternativeNames: Array<{ type: string; value: string }>;
    alternativeNamesTruncated: boolean;
    chain: ChainEntry[];
    chainTruncated: boolean;
    validationDetails: Row[];
    limitations: string[];
    initiallyExpanded?: boolean;
  } = $props();
</script>

<details class="tls-card evidence-card card" aria-labelledby="tls-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy"><span class="eyebrow">Deep-scan evidence</span><span class="evidence-summary-title" id="tls-title" role="heading" aria-level="4">TLS and certificate intelligence</span><span class="evidence-summary-detail">Expand for certificate, validation, provenance, and limitation detail</span></span>
      <span class:partial={!complete} class="evidence-status">{status}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="tls-grid stat-grid">
      {#each rows as row}<article><small>{row.label}</small><strong class:danger-text={row.danger}>{row.value}</strong></article>{/each}
    </div>
    {#if findings.length}
      <ul class="finding-list tls-findings">{#each findings as finding}<li class="callout {finding.tone === 'warning' ? 'warn' : 'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>
    {/if}
    {#if leafCertificate.length}
      <details class="tls-detail http-detail disclosure"><summary>Leaf certificate</summary><dl>{#each leafCertificate as row}<dt>{row.label}</dt><dd class:http-hash={row.hash}>{row.value}</dd>{/each}</dl></details>
    {/if}
    {#if alternativeNames.length}
      <details class="tls-detail http-detail disclosure"><summary>Subject alternative names · {alternativeNames.length}{alternativeNamesTruncated ? ' · capped' : ''}</summary><ul>{#each alternativeNames as name}<li><strong>{name.type}</strong><b>{name.value}</b></li>{/each}</ul></details>
    {/if}
    {#if chain.length}
      <details class="tls-detail http-detail disclosure"><summary>Certificate chain · {chain.length}{chainTruncated ? ' · capped' : ''}</summary><ol>{#each chain as certificate}<li><strong>{certificate.label}</strong><b>{certificate.subject}</b><small>{certificate.fingerprint}</small></li>{/each}</ol></details>
    {/if}
    {#if validationDetails.length}
      <details class="tls-detail http-detail disclosure"><summary>Collection and validation detail</summary><dl>{#each validationDetails as row}<dt>{row.label}</dt><dd>{row.value}</dd>{/each}</dl></details>
    {/if}
    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">Point-in-time evidence from one connection to one validated public address. Trust and hostname findings describe this runtime observation; wildcard certificates and shared certificate infrastructure are not inherently suspicious.</p>
  </div>
</details>

<style>
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .tls-grid .danger-text{color:var(--danger)}
  .finding-list{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .finding-list .callout{margin:0}
  .finding-list strong{display:block;color:var(--text);font-size:var(--text-xs)}
  .finding-list span{display:block;margin-top:3px}
  .disclosure ol,.disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .disclosure li strong,.disclosure li b,.disclosure li small{display:block;margin-top:2px;font-weight:400}
  .disclosure li b,.disclosure li small{color:var(--muted)}
  .disclosure dl{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  .disclosure dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .http-hash{overflow-wrap:anywhere;font-family:var(--mono)}
  @media(max-width:650px){
    .disclosure dl{grid-template-columns:1fr;gap:4px}
    .disclosure dt{margin-top:6px}
  }
</style>
