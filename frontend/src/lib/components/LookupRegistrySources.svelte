<script lang="ts">
  import RdapDomainSource from '$lib/components/RdapDomainSource.svelte';

  type JsonRecord = Record<string, unknown>;
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
  type TraceState = 'complete' | 'partial' | 'unavailable' | 'not_collected';
  const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  const asRecords = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const display = (value: unknown): string => typeof value === 'string' && value ? value.replaceAll('_', ' ') : 'unavailable';

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
    insights = {},
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
    insights?: JsonRecord;
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

  const disclosure = $derived(asRecord(insights.contactDisclosure));
  const registryDisclosure = $derived(asRecord(disclosure.registryRdap));
  const whoisDisclosure = $derived(asRecord(disclosure.whois));
  const lifecycle = $derived(asRecord(insights.lifecycle));
  const lifecycleLocks = $derived(asRecord(lifecycle.locks));
  const reconciliation = $derived(asRecord(insights.reconciliation));
  const publications = $derived(asRecords(insights.publications));
  const abuseRouting = $derived(asRecords(insights.abuseRouting));
  const registryTraceState = $derived<TraceState>(rdapError
    ? 'unavailable'
    : rdapPartialDetail
      ? 'partial'
      : rdapRows.length || Object.keys(rdapParsed).length
        ? 'complete'
        : 'unavailable');
  const registrarTraceState = $derived<TraceState>(!registrar.visible
    ? 'not_collected'
    : registrar.success
      ? 'complete'
      : registrar.error
        ? 'unavailable'
        : 'partial');
  const whoisTraceState = $derived<TraceState>(whoisError
    ? 'unavailable'
    : whoisRows.length
      ? 'complete'
      : 'not_collected');

  function traceStateLabel(state: TraceState): string {
    return state === 'not_collected' ? 'Not collected' : state.replaceAll('_', ' ');
  }
</script>

{#if resultType === 'domain'}
  <section class="authority-trace card" aria-labelledby="registration-authority-trace-title">
    <header>
      <div>
        <p class="eyebrow">Source authority</p>
        <h4 id="registration-authority-trace-title">Registration authority trace</h4>
      </div>
      <span>Existence decisions remain registry-led</span>
    </header>
    <div class="trace-sources">
      <article data-state={registryTraceState}>
        <div><strong>Registry RDAP</strong><span class="trace-state">{traceStateLabel(registryTraceState)}</span></div>
        <p><b>Authority:</b> primary publication for domain existence when the authoritative bootstrap route settles.</p>
        <small>Primary for lifecycle, registry status, delegation, sponsoring registrar, and registry disclosure where published.</small>
      </article>
      <article data-state={registrarTraceState}>
        <div><strong>Registrar RDAP</strong><span class="trace-state">{traceStateLabel(registrarTraceState)}</span></div>
        <p><b>Authority:</b> separately attributed sponsoring-registrar publication. It cannot decide domain existence.</p>
        <small>Useful for comparing registrar-maintained lifecycle, status, contact, and disclosure fields where advertised.</small>
      </article>
      <article data-state={whoisTraceState}>
        <div><strong>WHOIS</strong><span class="trace-state">{traceStateLabel(whoisTraceState)}</span></div>
        <p><b>Authority:</b> compatibility publication used as corroborating registration context. It cannot override an authoritative existence result.</p>
        <small>Useful for source comparison, registry or registrar identifiers, lifecycle, status, delegation, and published contacts.</small>
      </article>
    </div>
    <p class="trace-limit">These roles describe how WHOISleuth interprets the named publications. Partial, unavailable, or conflicting fields remain visible and are never converted into absence.</p>
  </section>
{/if}

{#if insights.version === 1}
  <details class="registry-insights card">
    <summary>Registry interpretation · {display(lifecycle.label)}</summary>
    <div class="insight-grid">
      <article>
        <span>Lifecycle</span>
        <strong>{display(lifecycle.label)}</strong>
        <small>Redemption: {lifecycle.redemption === true ? 'observed' : 'not observed'} · pending delete: {lifecycle.pendingDelete === true ? 'observed' : 'not observed'}</small>
      </article>
      <article>
        <span>Registration locks</span>
        <strong>{lifecycleLocks.client === true ? 'Client lock observed' : 'No client lock observed'} · {lifecycleLocks.server === true ? 'server lock observed' : 'no server lock observed'}</strong>
        <small>These point-in-time statuses do not prove protection remains enabled.</small>
      </article>
      <article>
        <span>Contact disclosure</span>
        <strong>RDAP: {display(registryDisclosure.state)} · WHOIS: {display(whoisDisclosure.state)}</strong>
        <small>Missing, redacted, withheld, proxy, public, and unavailable states remain distinct.</small>
      </article>
      <article>
        <span>Reconciliation</span>
        <strong>{display(reconciliation.state)}</strong>
        <small>{String(reconciliation.summary || 'No comparable publication summary was available.')}</small>
      </article>
    </div>
    {#if asStrings(lifecycle.rawStatuses).length}
      <div class="raw-statuses"><strong>Raw source statuses</strong><div>{#each asStrings(lifecycle.rawStatuses) as status}<code>{status}</code>{/each}</div></div>
    {/if}
    {#if asStrings(lifecycle.acquisitionPath).length}
      <section class="acquisition-path"><strong>Lifecycle-aware next steps</strong><ol>{#each asStrings(lifecycle.acquisitionPath) as step}<li>{step}</li>{/each}</ol><p>{String(lifecycle.limitation || '')}</p></section>
    {/if}
    <details class="publication-quality">
      <summary>Publication quality · {publications.filter((item) => item.state === 'complete').length} complete</summary>
      <div class="publication-list">{#each publications as publication}<article><strong>{display(publication.source)}</strong><span class={`chip ${publication.state === 'complete' ? 'ok' : publication.state === 'partial' ? 'warn' : ''}`}>{display(publication.state)}</span>{#if publication.observedAt}<small>{String(publication.observedAt)}</small>{/if}{#each asStrings(publication.issues) as issue}<p>{issue}</p>{/each}</article>{/each}</div>
    </details>
    {#if abuseRouting.length}
      <details class="routing">
        <summary>Published escalation routes · {abuseRouting.length}</summary>
        <ul>{#each abuseRouting as route}<li><strong>{display(route.kind)} {display(route.channel)}</strong><span>{String(route.contact || '')}</span><small>{String(route.source || '')}</small>{#each asStrings(route.limitations) as limitation}<small>{limitation}</small>{/each}</li>{/each}</ul>
      </details>
    {/if}
    <p class="interpretation-limit">{String(disclosure.limitation || '')}</p>
  </details>
{/if}

{#if comparisonRows.length}
  <details class="comparison card" open={comparisonHasConflicts}>
    <summary>{comparisonSummary}</summary>
    <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparisonRows as row}<tr class:conflict={row.status === 'conflict'}><th scope="row">{row.label}</th><td>{row.rdapValue}</td><td>{row.whoisValue}</td><td><span class={`chip ${row.tone}`}>{row.assessment}</span></td></tr>{/each}</tbody></table></div>
  </details>
{/if}

<div class="sources">
  <details class="card">
    <summary>RDAP structured data</summary>
    {#if rdapError}<p class="error source-error">{rdapError}</p>
    {:else if resultType === 'domain'}<RdapDomainSource parsed={rdapParsed} source="Registry" />
    {:else}
      {#if rdapPartialDetail}<p class="callout warn source-partial"><strong>Server-declared partial response.</strong> {rdapPartialDetail}</p>{/if}
      <dl>{#each rdapRows as row}<dt>{row.label}</dt><dd>{#if row.datetime}<time datetime={row.datetime}>{row.value}</time>{:else}{row.value}{/if}</dd>{/each}</dl>
    {/if}
  </details>
  <details class="card">
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
  .registry-insights,.comparison,.sources>details,.registrar-rdap{padding:0;overflow:hidden}
  .authority-trace{padding:var(--card-pad)}
  .authority-trace>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .authority-trace h4{margin:2px 0 0;font:700 var(--text-md) var(--mono)}
  .authority-trace>header>span{max-width:230px;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-align:right;text-transform:uppercase}
  .trace-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}
  .trace-sources article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .trace-sources article[data-state='partial']{border-color:color-mix(in srgb,var(--amber) 45%,var(--border))}
  .trace-sources article[data-state='unavailable'],.trace-sources article[data-state='not_collected']{border-style:dashed}
  .trace-sources article>div{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .trace-sources strong{font:700 var(--text-xs) var(--mono)}
  .trace-state{flex:none;color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  [data-state='complete'] .trace-state{color:var(--success)}
  [data-state='partial'] .trace-state{color:var(--amber)}
  .trace-sources p,.trace-sources small,.trace-limit{color:var(--muted);font-size:var(--text-2xs);line-height:1.48}
  .trace-sources p{margin:8px 0 0}
  .trace-sources p b{color:var(--text)}
  .trace-sources small{display:block;margin-top:6px}
  .trace-limit{margin:10px 0 0}
  .registry-insights>summary{color:var(--accent)}
  .insight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;padding:0 var(--card-pad) var(--card-pad);background:var(--border)}
  .insight-grid article{min-width:0;padding:12px;background:var(--panel)}
  .insight-grid span,.insight-grid strong,.insight-grid small{display:block;overflow-wrap:anywhere}
  .insight-grid span{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .insight-grid strong{margin-top:5px;font-size:var(--text-sm)}
  .insight-grid small{margin-top:5px;color:var(--muted)}
  .raw-statuses,.acquisition-path,.interpretation-limit{margin:0 var(--card-pad) var(--card-pad)}
  .raw-statuses>strong,.acquisition-path>strong{font:700 var(--text-xs) var(--mono)}
  .raw-statuses>div{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.raw-statuses code{padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--muted);font-size:var(--text-2xs)}
  .acquisition-path ol{margin:8px 0;padding-left:20px}.acquisition-path li,.acquisition-path p,.interpretation-limit{color:var(--muted);font-size:var(--text-xs);line-height:1.55}.acquisition-path p{margin:8px 0 0}
  .publication-quality,.routing{margin:0 var(--card-pad) var(--card-pad);border:1px solid var(--border);border-radius:var(--radius-sm)}.publication-quality>summary,.routing>summary{padding:10px 11px}
  .publication-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--border)}.publication-list article{padding:10px;background:var(--panel)}.publication-list strong,.publication-list small{display:block}.publication-list .chip{display:inline-block;margin:5px 0}.publication-list small,.publication-list p{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.publication-list p{margin:5px 0 0}
  .routing ul{display:grid;gap:1px;margin:0;padding:0;background:var(--border);list-style:none}.routing li{padding:10px;background:var(--panel)}.routing strong,.routing span,.routing small{display:block;overflow-wrap:anywhere}.routing span{margin-top:4px}.routing small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
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
    .authority-trace>header{display:grid}.authority-trace>header>span{max-width:none;text-align:left}.trace-sources{grid-template-columns:1fr}
    .insight-grid,.publication-list{grid-template-columns:1fr}
    dl{grid-template-columns:1fr;gap:4px}
    dt:not(:first-child){margin-top:7px}
  }
</style>
