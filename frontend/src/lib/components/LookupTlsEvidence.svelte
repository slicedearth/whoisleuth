<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import { projectCertificateValidity } from '$lib/analysis/visualization-models.ts';
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
    validFrom = null,
    validTo = null,
    observedAt = null,
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
    validFrom?: string | null;
    validTo?: string | null;
    observedAt?: string | null;
    initiallyExpanded?: boolean;
  } = $props();

  const validity = $derived(projectCertificateValidity({ validFrom, validTo, observedAt }));
</script>

<details class="tls-card evidence-card card" aria-labelledby="tls-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy"><span class="eyebrow">Deep-scan evidence</span><span class="evidence-summary-title" id="tls-title" role="heading" aria-level="4">TLS and certificate intelligence</span><span class="evidence-summary-detail">Expand for certificate, validation, provenance, and limitation detail</span></span>
      <span class="evidence-status {evidenceStatusTone(status, { complete })}">{status}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="tls-grid stat-grid">
      {#each rows as row}<article><small>{row.label}</small><strong class:danger-text={row.danger}>{row.value}</strong></article>{/each}
    </div>
    {#if findings.length}
      <ul class="finding-list tls-findings">{#each findings as finding}<li class="callout {finding.tone === 'warning' ? 'warn' : 'info'}"><strong>{finding.label}</strong><span>{finding.detail}</span></li>{/each}</ul>
    {/if}
    {#if validity.available || chain.length}
      <section class="certificate-visual" aria-labelledby="certificate-visual-title">
        <div><p class="eyebrow">Certificate structure</p><h5 id="certificate-visual-title">Validity and chain</h5></div>
        {#if validity.available}
          <div class="validity-chart" role="img" aria-label={`Certificate validity from ${validity.validFrom} to ${validity.validTo}${validity.hasObservation ? `, observed ${validity.observedAt}` : ''}`}>
            <svg viewBox={`0 0 ${validity.width} ${validity.height}`} aria-hidden="true">
              <line x1={validity.fromX} x2={validity.toX} y1="54" y2="54" class="validity-line"></line>
              <circle cx={validity.fromX} cy="54" r="7" class="validity-bound"></circle>
              <circle cx={validity.toX} cy="54" r="7" class="validity-bound"></circle>
              {#if validity.hasObservation}
                <line x1={validity.observedX} x2={validity.observedX} y1="24" y2="84" class:outside={!validity.observedWithinValidity} class="observed-line"></line>
                <text x={validity.observedX} y="17" text-anchor="middle">Observed</text>
              {/if}
              <text x={validity.fromX} y="93" text-anchor="middle">{validity.validFrom.slice(0, 10)}</text>
              <text x={validity.toX} y="93" text-anchor="middle">{validity.validTo.slice(0, 10)}</text>
            </svg>
          </div>
          <dl class="validity-mobile" aria-label="Certificate validity dates">
            <div><dt>Valid from</dt><dd>{validity.validFrom.slice(0, 10)}</dd></div>
            {#if validity.hasObservation}<div><dt>Observed</dt><dd>{validity.observedAt.slice(0, 10)}</dd></div>{/if}
            <div><dt>Valid to</dt><dd>{validity.validTo.slice(0, 10)}</dd></div>
          </dl>
        {/if}
        {#if chain.length}
          <ol class="chain-flow" aria-label="Observed certificate chain">
            {#each chain as certificate, index}
              <li>
                <span>{index + 1}</span>
                <div><strong>{certificate.label}</strong><small>{certificate.subject}</small></div>
              </li>
            {/each}
          </ol>
        {/if}
      </section>
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
  .certificate-visual{margin-top:13px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  .certificate-visual h5{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  .validity-chart{max-width:100%;margin-top:9px;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .validity-chart svg{display:block;width:100%;min-width:0;height:auto}
  .validity-mobile{display:none}
  .validity-line{stroke:var(--accent);stroke-width:5;stroke-linecap:round}
  .validity-bound{fill:var(--panel);stroke:var(--accent);stroke-width:3}
  .observed-line{stroke:var(--success);stroke-width:3}
  .observed-line.outside{stroke:var(--danger)}
  .validity-chart text{fill:var(--muted);font:600 9px var(--mono)}
  .chain-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px;margin:12px 0 0;padding:0;list-style:none}
  .chain-flow li{display:grid;position:relative;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:center;min-width:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .chain-flow li>span{display:grid;width:26px;height:26px;place-items:center;border:1px solid var(--border-strong);border-radius:50%;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .chain-flow strong,.chain-flow small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chain-flow strong{font-size:var(--text-xs)}.chain-flow small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .disclosure ol,.disclosure ul{display:grid;gap:7px;margin:10px 12px;padding-left:18px}
  .disclosure li{font-size:var(--text-xs);overflow-wrap:anywhere}
  .disclosure li strong,.disclosure li b,.disclosure li small{display:block;margin-top:2px;font-weight:400}
  .disclosure li b,.disclosure li small{color:var(--muted)}
  .disclosure dl{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:8px;margin:10px 12px;padding:0;font-size:var(--text-xs)}
  .disclosure dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .http-hash{overflow-wrap:anywhere;font-family:var(--mono)}
  @media(max-width:650px){
    .validity-chart{display:none}
    .validity-mobile{display:grid;gap:1px;margin:9px 0 0;background:var(--border)}
    .validity-mobile div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;padding:8px 9px;background:var(--panel-raised)}
    .validity-mobile dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
    .validity-mobile dd{min-width:0;margin:0;font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
    .chain-flow{grid-template-columns:1fr}
    .disclosure dl{grid-template-columns:1fr;gap:4px}
    .disclosure dt{margin-top:6px}
  }
</style>
