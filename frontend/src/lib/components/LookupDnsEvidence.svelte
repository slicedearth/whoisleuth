<script lang="ts">
  import DnsChangeRehearsal from '$lib/components/DnsChangeRehearsal.svelte';
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  let {
    status,
    complete,
    rows,
    failureDetail,
    truncated,
    delegation = null,
    rehearsalEvidence = {},
    domain = '',
    allowRehearsal = false,
    initiallyExpanded = false,
    title = 'DNS intelligence',
    summaryDetail = 'Expand for observed records, provenance, and limitations',
    note = 'Point-in-time resolver evidence. Shared DNS infrastructure can connect investigations but does not prove common ownership or maliciousness.',
  }: {
    status: string;
    complete: boolean;
    rows: Array<{ label: string; value: string }>;
    failureDetail: string;
    truncated: boolean;
    delegation?: {
      status: string;
      complete: boolean;
      detail: string;
      parentNameservers: readonly string[];
      registryNameservers: readonly string[];
      findings: readonly {
        id: string;
        label: string;
        state: string;
        summary: string;
        detail: string;
        remediation: string;
      }[];
      authorities: readonly {
        nameserver: string;
        state: string;
        addressSource: string;
        addresses: readonly string[];
        nameservers: readonly string[];
        soaPrimary: string;
        soa?: {
          nsname: string | null;
          hostmaster: string | null;
          serial: number | null;
          refresh: number | null;
          retry: number | null;
          expire: number | null;
          minttl: number | null;
        } | null;
      }[];
      recordMatrix: readonly {
        type: string;
        state: string;
        observations: readonly {
          nameserver: string;
          state: string;
          values: readonly string[];
          error: string;
          truncated: boolean;
          discarded: number;
        }[];
      }[];
      limitations: readonly string[];
    } | null;
    rehearsalEvidence?: {
      currentGlue?: readonly unknown[];
      currentDs?: readonly unknown[];
      currentMx?: readonly unknown[];
      currentCaa?: readonly unknown[];
      currentCriticalAddresses?: readonly unknown[];
      currentRegistrationStatuses?: readonly unknown[];
      currentTlsSpkiSha256?: unknown;
    };
    domain?: string;
    allowRehearsal?: boolean;
    initiallyExpanded?: boolean;
    title?: string;
    summaryDetail?: string;
    note?: string;
  } = $props();
</script>

<details class="dns-card evidence-card card" aria-labelledby="dns-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy"><span class="eyebrow">Deep-scan evidence</span><span class="evidence-summary-title" id="dns-title" role="heading" aria-level="4">{title}</span><span class="evidence-summary-detail">{summaryDetail}</span></span>
      <span class="evidence-status {evidenceStatusTone(status, { complete })}">{status}</span>
    </span>
  </summary>
  <div class="evidence-body">
    <div class="dns-grid stat-grid">
      {#each rows as row}<article><small>{row.label}</small><strong>{row.value}</strong></article>{/each}
    </div>
    {#if failureDetail}
      <p class="callout warn dns-warning">Partial observation: {failureDetail}. A resolver failure is not evidence that a record is absent.</p>
    {/if}
    {#if delegation}
      <section class="delegation" aria-labelledby="delegation-title">
        <div class="delegation-head">
          <div><p class="eyebrow">Delegation review</p><h5 id="delegation-title">Authoritative DNS health</h5></div>
          <span class="evidence-status {evidenceStatusTone(delegation.status, { complete: delegation.complete })}">{delegation.status}</span>
        </div>
        <p class="delegation-detail">{delegation.detail}</p>
        <div class="delegation-sources">
          <article><small>Parent resolver view</small><strong>{delegation.parentNameservers.join(' · ') || 'Unavailable'}</strong></article>
          <article><small>Registry publication</small><strong>{delegation.registryNameservers.join(' · ') || 'Unavailable'}</strong></article>
        </div>
        <div class="delegation-findings">
          {#each delegation.findings as finding}
            <article class={`delegation-finding state-${finding.state}`}>
              <div><strong>{finding.label}</strong><span>{finding.state}</span></div>
              <p>{finding.summary}</p>
              <small>{finding.detail}</small>
              {#if finding.state !== 'healthy'}<b>Review: {finding.remediation}</b>{/if}
            </article>
          {/each}
        </div>
        {#if delegation.authorities.length}
          <details class="authority-detail">
            <summary>Direct nameserver observations</summary>
            <div>
              {#each delegation.authorities as authority}
                <article>
                  <div><strong>{authority.nameserver}</strong><span class={`authority-state state-${authority.state}`}>{authority.state}</span></div>
                  <p>{authority.addresses.join(' · ') || 'No eligible public address'} · {authority.addressSource}</p>
                  <small>NS answer: {authority.nameservers.join(' · ') || 'Unavailable'} · SOA primary: {authority.soaPrimary || 'Unavailable'}</small>
                  {#if authority.soa}
                    <dl class="soa-detail">
                      <div><dt>Serial</dt><dd>{authority.soa.serial ?? 'Unavailable'}</dd></div>
                      <div><dt>Refresh</dt><dd>{authority.soa.refresh ?? 'Unavailable'}{authority.soa.refresh !== null ? ' s' : ''}</dd></div>
                      <div><dt>Retry</dt><dd>{authority.soa.retry ?? 'Unavailable'}{authority.soa.retry !== null ? ' s' : ''}</dd></div>
                      <div><dt>Expire</dt><dd>{authority.soa.expire ?? 'Unavailable'}{authority.soa.expire !== null ? ' s' : ''}</dd></div>
                    </dl>
                  {/if}
                </article>
              {/each}
            </div>
          </details>
        {/if}
        {#if delegation.recordMatrix.length}
          <details class="authority-detail record-matrix">
            <summary>Authoritative record agreement</summary>
            <div>
              {#each delegation.recordMatrix as row}
                <article>
                  <div><strong>{row.type}</strong><span class={`authority-state matrix-${row.state}`}>{row.state}</span></div>
                  <ul>
                    {#each row.observations as observation}
                      <li>
                        <b>{observation.nameserver}</b>
                        <span>{observation.values.join(' · ') || (observation.state === 'not_found' ? 'No record observed' : observation.error || observation.state)}</span>
                        {#if observation.truncated || observation.discarded > 0}
                          <small>Retained values are incomplete{observation.discarded > 0 ? ` · ${observation.discarded} discarded` : ''}.</small>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </article>
              {/each}
            </div>
          </details>
        {/if}
        {#if allowRehearsal && domain}
          <DnsChangeRehearsal
            {domain}
            currentNameservers={delegation.parentNameservers}
            registryNameservers={delegation.registryNameservers}
            currentGlue={rehearsalEvidence.currentGlue ?? []}
            currentDs={rehearsalEvidence.currentDs ?? []}
            currentMx={rehearsalEvidence.currentMx ?? []}
            currentCaa={rehearsalEvidence.currentCaa ?? []}
            currentCriticalAddresses={rehearsalEvidence.currentCriticalAddresses ?? []}
            currentRegistrationStatuses={rehearsalEvidence.currentRegistrationStatuses ?? []}
            currentTlsSpkiSha256={rehearsalEvidence.currentTlsSpkiSha256 ?? null}
            evidenceComplete={delegation.complete}
          />
        {/if}
        {#each delegation.limitations as limitation}<p class="delegation-limitation">{limitation}</p>{/each}
      </section>
    {/if}
    <p class="card-note">{note}{truncated ? ' Some record inventories were capped.' : ''}</p>
  </div>
</details>

<style>
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .delegation{margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
  .delegation-head,.delegation-finding>div,.authority-detail article>div{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .delegation-head h5{margin:2px 0 0;font-size:var(--text-md)}
  .delegation-detail,.delegation-limitation{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .delegation-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
  .delegation-sources article,.delegation-finding,.authority-detail article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .delegation-sources small,.delegation-sources strong{display:block}
  .delegation-sources small,.delegation-finding small,.authority-detail small,.authority-detail p{color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  .delegation-sources strong{margin-top:5px;font:600 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .delegation-findings{display:grid;gap:7px;margin-top:8px}
  .delegation-finding{border-left:3px solid var(--border)}
  .delegation-finding.state-healthy{border-left-color:var(--accent)}
  .delegation-finding.state-warning{border-left-color:var(--amber)}
  .delegation-finding.state-danger{border-left-color:var(--danger)}
  .delegation-finding>div span,.authority-state{text-transform:uppercase;font:650 var(--text-2xs) var(--mono);letter-spacing:.04em}
  .delegation-finding p{margin:6px 0 0;font-size:var(--text-xs)}
  .delegation-finding small{display:block;margin-top:5px}
  .delegation-finding b{display:block;margin-top:7px;color:var(--muted);font-size:var(--text-2xs);font-weight:500;line-height:1.5}
  .authority-detail{margin-top:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .authority-detail>summary{padding:9px 11px;cursor:pointer;font:600 var(--text-xs) var(--mono)}
  .authority-detail>div{display:grid;gap:7px;padding:0 8px 8px}
  .authority-detail p{margin:5px 0 0;overflow-wrap:anywhere}
  .record-matrix ul{display:grid;gap:5px;margin:8px 0 0;padding:0;list-style:none}
  .record-matrix li{display:grid;grid-template-columns:minmax(100px,.7fr) minmax(0,1.3fr);gap:8px;font-size:var(--text-2xs);line-height:1.5}
  .record-matrix li b{font-family:var(--mono);overflow-wrap:anywhere}
  .record-matrix li span{color:var(--muted);overflow-wrap:anywhere}
  .record-matrix li small{grid-column:2;color:var(--amber);overflow-wrap:anywhere}
  .matrix-aligned{color:var(--accent)}
  .matrix-different{color:var(--amber)}
  .matrix-partial,.matrix-insufficient{color:var(--muted)}
  .soa-detail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:8px 0 0}
  .soa-detail div{min-width:0;padding:6px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .soa-detail dt{color:var(--muted);font:var(--text-2xs) var(--mono)}
  .soa-detail dd{margin:3px 0 0;overflow-wrap:anywhere;font:600 var(--text-2xs) var(--mono)}
  .authority-state.state-success{color:var(--accent)}
  .authority-state.state-partial{color:var(--amber)}
  .authority-state.state-lame{color:var(--danger)}
  .authority-state.state-unreachable{color:var(--amber)}
  @media(max-width:640px){.delegation-sources{grid-template-columns:1fr}.soa-detail{grid-template-columns:repeat(2,minmax(0,1fr))}.record-matrix li{grid-template-columns:1fr;gap:2px}.record-matrix li small{grid-column:1}}
</style>
