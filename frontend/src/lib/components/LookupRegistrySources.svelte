<script lang="ts">
  import RdapDomainSource from '$lib/components/RdapDomainSource.svelte';

  type JsonRecord = Record<string, any>;
  type DisplayRow = { label: string; value: string; datetime?: string };
  type ComparisonRow = {
    label: string;
    rdapValue: string;
    whoisValue: string;
    status: string;
    assessment: string;
    tone: string;
  };
  type PublicationComparisonRow = {
    label: string;
    registryValue: string;
    registrarValue: string;
    status: string;
    assessment: string;
    tone: string;
  };
  type ContactRole = { role: string; contacts: Array<{ identity: string; details: string[] }> };

  let {
    comparisonSummary,
    comparisonRows,
    comparisonHasConflicts,
    rdapError,
    resultType,
    rdapParsed,
    rdapPartialDetail,
    rdapRows,
    whoisError,
    whoisRows,
    whoisContactRoles,
    whoisTruncatedFields,
    registrar,
  }: {
    comparisonSummary: string;
    comparisonRows: ComparisonRow[];
    comparisonHasConflicts: boolean;
    rdapError: string;
    resultType: string;
    rdapParsed: JsonRecord;
    rdapPartialDetail: string;
    rdapRows: DisplayRow[];
    whoisError: string;
    whoisRows: DisplayRow[];
    whoisContactRoles: ContactRole[];
    whoisTruncatedFields: string[];
    registrar: {
      visible: boolean;
      label: string;
      endpoint: string;
      detail: string;
      stateDetail: string;
      error: boolean;
      success: boolean;
      parsed: JsonRecord;
      comparisonSummary?: string;
      comparisonRows?: PublicationComparisonRow[];
    };
  } = $props();
</script>

{#if comparisonRows.length}
  <details class="comparison card" open={comparisonHasConflicts}>
    <summary>{comparisonSummary}</summary>
    <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparisonRows as row}<tr class:conflict={row.status === 'conflict'}><th scope="row">{row.label}</th><td>{row.rdapValue}</td><td>{row.whoisValue}</td><td><span class={`chip ${row.tone}`}>{row.assessment}</span></td></tr>{/each}</tbody></table></div>
  </details>
{/if}

<div class="sources">
  <details class="card" open>
    <summary>RDAP structured data</summary>
    {#if rdapError}<p class="error source-error">{rdapError}</p>
    {:else if resultType === 'domain'}<RdapDomainSource parsed={rdapParsed} source="Registry" />
    {:else}
      {#if rdapPartialDetail}<p class="callout warn source-partial"><strong>Server-declared partial response.</strong> {rdapPartialDetail}</p>{/if}
      <dl>{#each rdapRows as row}<dt>{row.label}</dt><dd>{#if row.datetime}<time datetime={row.datetime}>{row.value}</time>{:else}{row.value}{/if}</dd>{/each}</dl>
    {/if}
  </details>
  <details class="card" open>
    <summary>WHOIS structured data</summary>
    {#if whoisError}<p class="error source-error">{whoisError}</p>
    {:else}
      <dl>{#each whoisRows as row}<dt>{row.label}</dt><dd>{row.value}</dd>{/each}</dl>
      {#if whoisContactRoles.length}
        <details class="contact-inventory disclosure">
          <summary>Published contacts · {whoisContactRoles.length} role{whoisContactRoles.length === 1 ? '' : 's'}{whoisTruncatedFields.length ? ' · capped' : ''}</summary>
          <div>
            {#if whoisTruncatedFields.length}<p class="callout warn">Some WHOIS fields exceeded local display limits: {whoisTruncatedFields.join(', ')}. Review the raw response or exported evidence for the complete upstream text.</p>{/if}
            {#each whoisContactRoles as contactRole}<section><h5>{contactRole.role}</h5>{#each contactRole.contacts as contact}<article><strong>{contact.identity}</strong>{#each contact.details as detail}<span>{detail}</span>{/each}</article>{/each}</section>{/each}
          </div>
        </details>
      {/if}
    {/if}
  </details>
</div>

{#if registrar.visible}
  <details class="registrar-rdap card">
    <summary>Registrar RDAP · {registrar.label}</summary>
    <div class="registrar-provenance">
      {#if registrar.endpoint}<strong>{registrar.endpoint}</strong>{/if}
      {#if registrar.detail}<span>{registrar.detail}</span>{/if}
      <p>Published by the sponsoring registrar's RDAP service, not the registry. Registrar-published contacts are relationship evidence, not proof of ownership.</p>
    </div>
    {#if registrar.success}
      {#if registrar.comparisonRows?.length}
        <section class="publication-comparison" aria-labelledby="registrar-publication-comparison-title">
          <h4 id="registrar-publication-comparison-title">{registrar.comparisonSummary}</h4>
          <p>These remain separate publications. A difference can reflect update timing or disclosure policy and does not by itself establish that either source is incorrect.</p>
          <div class="table-wrap"><table><thead><tr><th>Field</th><th>Registry RDAP</th><th>Registrar RDAP</th><th>Assessment</th></tr></thead><tbody>{#each registrar.comparisonRows || [] as row}<tr class:conflict={row.status === 'conflict'}><th scope="row">{row.label}</th><td>{row.registryValue}</td><td>{row.registrarValue}</td><td><span class={`chip ${row.tone}`}>{row.assessment}</span></td></tr>{/each}</tbody></table></div>
        </section>
      {/if}
      <RdapDomainSource parsed={registrar.parsed} source="Registrar" />
    {:else}<p class:error={registrar.error} class="registrar-state">{registrar.stateDetail}</p>{/if}
  </details>
{/if}

<style>
  .comparison,.sources>details,.registrar-rdap{padding:0;overflow:hidden}
  .comparison .table-wrap{border-top:1px solid var(--border)}
  .comparison tr.conflict{background:rgb(var(--danger-rgb) / .03)}
  .comparison .chip{white-space:normal}
  .sources{display:grid;gap:12px}
  .comparison+.sources{margin-top:12px}
  dl{display:grid;grid-template-columns:110px 1fr;gap:9px;margin:0;padding:4px var(--card-pad) var(--card-pad);font-size:var(--text-xs)}
  dd{margin:0;overflow-wrap:anywhere}
  .source-error{padding:0 var(--card-pad) var(--card-pad)}
  .source-partial{margin:0 var(--card-pad) 14px}
  .contact-inventory{margin:0 var(--card-pad) var(--card-pad)}
  .contact-inventory>div{display:grid;gap:9px;margin:11px 12px}
  .contact-inventory>div>.callout{margin:0}
  .contact-inventory section{min-width:0}
  .contact-inventory h5{margin:0 0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase;letter-spacing:.05em}
  .contact-inventory article{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .contact-inventory strong,.contact-inventory span{display:block;overflow-wrap:anywhere}
  .contact-inventory strong{font-size:var(--text-xs)}
  .contact-inventory span{margin-top:4px;color:var(--muted);font-size:var(--text-xs)}
  .registrar-rdap{margin-top:12px}
  .registrar-provenance{display:grid;gap:5px;padding:0 var(--card-pad) 14px;font-size:var(--text-xs)}
  .registrar-provenance strong,.registrar-provenance span,.registrar-provenance p{overflow-wrap:anywhere}
  .registrar-provenance strong{font-family:var(--mono)}
  .registrar-provenance span,.registrar-provenance p{color:var(--muted)}
  .registrar-provenance p{margin:4px 0 0;line-height:1.5}
  .publication-comparison{margin:0 var(--card-pad) 16px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
  .publication-comparison h4{margin:0;padding:11px 12px;border-bottom:1px solid var(--border);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}
  .publication-comparison p{margin:0;padding:10px 12px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .publication-comparison .table-wrap{border-top:1px solid var(--border)}
  .publication-comparison tr.conflict{background:rgb(var(--danger-rgb) / .03)}
  .publication-comparison .chip{white-space:normal}
  .registrar-state{margin:0;padding:0 var(--card-pad) var(--card-pad);color:var(--muted);font-size:var(--text-xs)}
  .registrar-state.error{color:var(--danger)}
  @media(max-width:650px){
    dl{grid-template-columns:1fr;gap:4px}
    dt:not(:first-child){margin-top:7px}
  }
</style>
