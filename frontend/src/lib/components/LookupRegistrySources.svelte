<script lang="ts">
  import RdapDomainSource from '$lib/components/RdapDomainSource.svelte';
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import {
    projectEvidenceMatrix,
    type MatrixInput,
  } from '$lib/analysis/visualization-models.ts';
  import { buildRdapReverseSearchPreviews } from '$lib/analysis/rdap-reverse-search-preview.ts';

  type JsonRecord = Record<string, unknown>;
  type DisplayRow = { label: string; value: string; datetime?: string };
  type ComparisonRow = {
    label: string;
    rdapValue: string;
    whoisValue: string;
    status: string;
    rdapMatrixState: string;
    whoisMatrixState: string;
    assessment: string;
    tone: string;
  };
  type PublicationComparisonRow = {
    label: string;
    registryValue: string;
    registrarValue: string;
    status: string;
    registryMatrixState: string;
    registrarMatrixState: string;
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
  const rdapCapabilities = $derived(asRecord(insights.rdapCapabilities));
  const registryCapabilities = $derived(asRecord(rdapCapabilities.registry));
  const registrarCapabilities = $derived(asRecord(rdapCapabilities.registrar));
  const registryDeclarations = $derived(asRecords(registryCapabilities.declarations));
  const registrarDeclarations = $derived(asRecords(registrarCapabilities.declarations));
  const registryReverseSearch = $derived(asRecord(registryCapabilities.reverseSearch));
  const registrarReverseSearch = $derived(asRecord(registrarCapabilities.reverseSearch));
  const registryReversePreviews = $derived(buildRdapReverseSearchPreviews(rdapParsed, registryCapabilities));
  const registrarReversePreviews = $derived(buildRdapReverseSearchPreviews(registrar.parsed, registrarCapabilities));
  let showRegistryReversePreview = $state(false);
  let showRegistrarReversePreview = $state(false);
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
  const comparisonMatrix = $derived.by(() => {
    const columns = ['Registry RDAP', 'WHOIS'];
    if (registrar.comparisonRows?.length) columns.splice(1, 0, 'Registrar RDAP');
    const rows = new Map<string, MatrixInput>();
    const rowFor = (label: string) => {
      const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `field-${rows.size}`;
      const current = rows.get(id) ?? { id, label, cells: [] };
      rows.set(id, current);
      return current;
    };
    for (const row of comparisonRows) {
      const current = rowFor(row.label);
      current.cells.push(
        { column: 'Registry RDAP', state: row.rdapMatrixState, detail: row.rdapValue },
        { column: 'WHOIS', state: row.whoisMatrixState, detail: row.whoisValue },
      );
    }
    for (const row of registrar.comparisonRows ?? []) {
      const current = rowFor(row.label);
      current.cells.push(
        { column: 'Registry RDAP', state: row.registryMatrixState, detail: row.registryValue },
        { column: 'Registrar RDAP', state: row.registrarMatrixState, detail: row.registrarValue },
      );
    }
    return projectEvidenceMatrix(columns, [...rows.values()]);
  });

  function traceStateLabel(state: TraceState): string {
    return state === 'not_collected' ? 'Not collected' : state.replaceAll('_', ' ');
  }
  type PlotCell = { x: number; width: number };
  const PUBLICATION_COLOURS: Readonly<Record<string, string>> = Object.freeze({
    'Registry RDAP': 'var(--source-registry)',
    'Registrar RDAP': 'var(--source-registrar)',
    WHOIS: 'var(--source-whois)',
  });
  const publicationColour = (source: string): string => PUBLICATION_COLOURS[source] ?? 'var(--source-structured)';
  const markerX = (cell: PlotCell): number => cell.x + cell.width / 2;
  const trackStart = (cells: readonly PlotCell[]): number => cells[0] ? markerX(cells[0]) : 210;
  const trackEnd = (cells: readonly PlotCell[]): number => {
    const cell = cells.at(-1);
    return cell ? markerX(cell) : 870;
  };
  const diamondPoints = (x: number, y: number, radius = 7): string => (
    `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`
  );
  const hexagonPoints = (x: number, y: number, radius = 8): string => (
    [
      [x - radius * 0.86, y - radius / 2],
      [x, y - radius],
      [x + radius * 0.86, y - radius / 2],
      [x + radius * 0.86, y + radius / 2],
      [x, y + radius],
      [x - radius * 0.86, y + radius / 2],
    ].map(([pointX, pointY]) => `${pointX},${pointY}`).join(' ')
  );
  const comparisonGlyph = (state: string): string => {
    if (state === 'equal') return '=';
    if (state === 'different') return '≠';
    if (state === 'partial') return '~';
    if (state === 'conflict') return '!';
    if (state === 'observed') return '•';
    if (state === 'unavailable') return '×';
    return '?';
  };
  const comparisonStateLabel = (state: string): string => ({
    equal: 'Equivalent',
    conflict: 'Source conflict',
    observed: 'Source-only value',
    partial: 'Incomplete / redacted',
    unavailable: 'Unavailable',
    not_collected: 'Not collected',
    different: 'Different value',
  } as Record<string, string>)[state] ?? 'Unknown';
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

{#if comparisonMatrix.rows.length}
  <section class="agreement-matrix card" aria-labelledby="registration-agreement-title">
    <header class="section-head">
      <div>
        <p class="eyebrow">Publication comparison</p>
        <h4 id="registration-agreement-title">Registration source agreement</h4>
        <p>Connected markers compare each field across separately attributed publications. A conflict means two collected sources publish materially different normalised values. A source-only value was usable in just one publication. Incomplete / redacted means a publication could not provide a complete comparable value. Exact values remain in the tables below.</p>
      </div>
      {#if comparisonMatrix.truncated}<span class="partial">Partial visual</span>{/if}
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable matrix must be keyboard reachable -->
    <div class="matrix-frame" role="img" tabindex="0" aria-label={`Registration agreement plot with ${comparisonMatrix.rows.length} fields`}>
      <svg viewBox={`0 0 ${comparisonMatrix.width} ${comparisonMatrix.height}`} aria-hidden="true">
        {#each comparisonMatrix.columns as column}
          <g class="publication-header" style={`--publication-color:${publicationColour(column.label)}`}>
            <line x1={column.x + column.width / 2} x2={column.x + column.width / 2} y1="44" y2={comparisonMatrix.height - 14} class="column-guide" />
            <circle cx={column.x + column.width / 2} cy="17" r="5" class="publication-marker" />
            <text x={column.x + column.width / 2} y="38" text-anchor="middle" class="column-label">{column.label}</text>
          </g>
        {/each}
        {#each comparisonMatrix.rows as row}
          <line x1={trackStart(row.cells)} x2={trackEnd(row.cells)} y1={row.y + row.height / 2} y2={row.y + row.height / 2} class="agreement-track" />
          <text x="8" y={row.y + row.height / 2 + 3} class="row-label">{row.label}</text>
          {#each row.cells as cell}
            <g class={`agreement-node state-${cell.state}`}>
              <title>{row.label}, {cell.column}: {comparisonStateLabel(cell.state)}{cell.detail ? `: ${cell.detail}` : ''}</title>
              {#if cell.state === 'different' || cell.state === 'partial'}
                <polygon points={diamondPoints(markerX(cell), row.y + row.height / 2)} class="agreement-marker" />
              {:else if cell.state === 'conflict'}
                <polygon points={hexagonPoints(markerX(cell), row.y + row.height / 2)} class="agreement-marker" />
              {:else if cell.state === 'observed'}
                <rect x={markerX(cell) - 7} y={row.y + row.height / 2 - 7} width="14" height="14" rx="3" class="agreement-marker" />
              {:else}
                <circle cx={markerX(cell)} cy={row.y + row.height / 2} r="7" class="agreement-marker" />
              {/if}
              <text x={markerX(cell)} y={row.y + row.height / 2 + 3} text-anchor="middle" class="agreement-glyph">{comparisonGlyph(cell.state)}</text>
            </g>
          {/each}
        {/each}
      </svg>
    </div>
    <div class="matrix-mobile" role="group" aria-label={`Registration agreement for ${comparisonMatrix.rows.length} fields`}>
      {#each comparisonMatrix.rows as row}
        <article>
          <h5>{row.label}</h5>
          <ul>
            {#each row.cells as cell}
              <li class={`state-${cell.state}`} style={`--publication-color:${publicationColour(cell.column)}`}>
                <span class="mobile-publication">{cell.column}</span>
                <span class="mobile-agreement-marker" aria-hidden="true">{comparisonGlyph(cell.state)}</span>
                <span class="mobile-agreement-state">{comparisonStateLabel(cell.state)}</span>
                {#if cell.detail}<small>{cell.detail}</small>{/if}
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </div>
    <ul class="matrix-legend" aria-label="Registration source comparison states">
      <li class="state-equal"><span>=</span>Equivalent</li>
      <li class="state-conflict"><span>!</span>Source conflict</li>
      <li class="state-observed"><span>•</span>Source-only value</li>
      <li class="state-partial"><span>~</span>Incomplete / redacted</li>
      <li class="state-unavailable"><span>×</span>Unavailable</li>
      <li class="state-not_collected"><span>?</span>Not collected</li>
    </ul>
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
    <details class="rdap-capabilities">
      <summary>RDAP capability declarations · {registryDeclarations.length + registrarDeclarations.length}</summary>
      <div class="capability-sources">
        <article>
          <header><strong>Registry RDAP</strong><span class={`chip ${registryCapabilities.state === 'complete' ? 'ok' : registryCapabilities.state === 'partial' ? 'warn' : ''}`}>{display(registryCapabilities.state)}</span></header>
          {#if registryDeclarations.length}
            <ul>{#each registryDeclarations as declaration}<li><code>{String(declaration.identifier || '')}</code><span>{String(declaration.capability || '')}</span>{#if declaration.status === 'obsolete'}<small>Registered as obsolete</small>{:else if declaration.category === 'unknown'}<small>Unclassified; retained without interpretation</small>{/if}</li>{/each}</ul>
          {:else}<p>No usable declaration was retained from this response.</p>{/if}
          <p><strong>Reverse search:</strong> {display(registryReverseSearch.state)}. {String(registryReverseSearch.detail || '')}</p>
          {#if registryReversePreviews.length}
            <button class="preview-control" type="button" aria-expanded={showRegistryReversePreview} onclick={() => showRegistryReversePreview = !showRegistryReversePreview}>
              {showRegistryReversePreview ? 'Hide' : 'Prepare'} disclosure preview
            </button>
            {#if showRegistryReversePreview}
              <ul class="reverse-preview">
                {#each registryReversePreviews as preview (preview.id)}
                  <li><code>{preview.queryShape}</code><span>{preview.disclosure}</span><small>Published {preview.sourceRole} entity · preview only</small></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </article>
        <article>
          <header><strong>Registrar RDAP</strong><span class={`chip ${registrarCapabilities.state === 'complete' ? 'ok' : registrarCapabilities.state === 'partial' ? 'warn' : ''}`}>{display(registrarCapabilities.state)}</span></header>
          {#if registrarDeclarations.length}
            <ul>{#each registrarDeclarations as declaration}<li><code>{String(declaration.identifier || '')}</code><span>{String(declaration.capability || '')}</span>{#if declaration.status === 'obsolete'}<small>Registered as obsolete</small>{:else if declaration.category === 'unknown'}<small>Unclassified; retained without interpretation</small>{/if}</li>{/each}</ul>
          {:else}<p>No usable declaration was retained from this response.</p>{/if}
          <p><strong>Reverse search:</strong> {display(registrarReverseSearch.state)}. {String(registrarReverseSearch.detail || '')}</p>
          {#if registrarReversePreviews.length}
            <button class="preview-control" type="button" aria-expanded={showRegistrarReversePreview} onclick={() => showRegistrarReversePreview = !showRegistrarReversePreview}>
              {showRegistrarReversePreview ? 'Hide' : 'Prepare'} disclosure preview
            </button>
            {#if showRegistrarReversePreview}
              <ul class="reverse-preview">
                {#each registrarReversePreviews as preview (preview.id)}
                  <li><code>{preview.queryShape}</code><span>{preview.disclosure}</span><small>Published {preview.sourceRole} entity · preview only</small></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </article>
      </div>
      <p class="capability-limit">Declarations are response metadata, not proof that an operation is authorised, anonymous, complete, or correctly implemented. A preview reveals the exact public identifier that a later confirmed request would disclose, but does not issue a help or reverse-search request.</p>
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
    <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparisonRows as row}<tr class:conflict={row.status === 'conflict'}><th scope="row" data-label="Field">{row.label}</th><td data-label="Registry RDAP">{row.rdapValue}</td><td data-label="WHOIS">{row.whoisValue}</td><td data-label="Assessment"><span class={`chip ${row.tone}`}>{row.assessment}</span></td></tr>{/each}</tbody></table></div>
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
  <details class="registrar-rdap evidence-card card" aria-labelledby="registrar-rdap-title">
    <summary class="evidence-summary">
      <span class="evidence-summary-row">
        <span class="evidence-summary-copy">
          <span class="eyebrow">Registration source</span>
          <span class="evidence-summary-title" id="registrar-rdap-title" role="heading" aria-level="4">Registrar RDAP</span>
          <span class="evidence-summary-detail">Separately attributed sponsoring-registrar publication</span>
        </span>
        <span class="evidence-status {evidenceStatusTone(registrar.label)}">{registrar.label}</span>
      </span>
    </summary>
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
          <div class="table-wrap"><table><thead><tr><th>Field</th><th>Registry RDAP</th><th>Registrar RDAP</th><th>Assessment</th></tr></thead><tbody>{#each registrar.comparisonRows || [] as row}<tr class:conflict={row.status === 'conflict'}><th scope="row" data-label="Field">{row.label}</th><td data-label="Registry RDAP">{row.registryValue}</td><td data-label="Registrar RDAP">{row.registrarValue}</td><td data-label="Assessment"><span class={`chip ${row.tone}`}>{row.assessment}</span></td></tr>{/each}</tbody></table></div>
        </section>
      {/if}
      <RdapDomainSource parsed={registrar.parsed} source="Registrar" />
    {:else}<p class:error={registrar.error} class="registrar-state">{registrar.stateDetail}</p>{/if}
  </details>
{/if}

<style>
  .registry-insights,.comparison,.sources>details,.registrar-rdap{padding:0;overflow:hidden}
  .authority-trace{padding:var(--card-pad)}
  .agreement-matrix{padding:var(--card-pad);margin-top:12px}
  .agreement-matrix h4{margin:2px 0 0;font:700 var(--text-md) var(--mono)}
  .agreement-matrix .section-head p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .matrix-frame{max-width:100%;margin-top:13px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);overscroll-behavior-x:contain}
  .matrix-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .matrix-frame svg{display:block;width:100%;min-width:680px;height:auto}
  .matrix-mobile{display:none}
  .column-label,.row-label{fill:var(--muted);font-family:var(--mono);font-size:9px}
  .publication-marker{fill:var(--publication-color);stroke:color-mix(in srgb,var(--publication-color) 40%,var(--panel));stroke-width:3}
  .column-guide{stroke:color-mix(in srgb,var(--publication-color) 14%,var(--border));stroke-width:1;stroke-dasharray:2 5}
  .row-label{fill:var(--text)}
  .agreement-track{stroke:var(--border-strong);stroke-width:1.5}
  .agreement-marker{fill:var(--panel);stroke:var(--muted);stroke-width:1.7}
  .agreement-glyph{fill:var(--muted);font:750 9px var(--mono);pointer-events:none}
  .agreement-node.state-equal .agreement-marker{fill:color-mix(in srgb,var(--success) 16%,var(--panel));stroke:var(--success)}
  .agreement-node.state-equal .agreement-glyph{fill:var(--success)}
  .agreement-node.state-different .agreement-marker,.agreement-node.state-partial .agreement-marker{fill:rgb(var(--amber-rgb) / .15);stroke:var(--amber)}
  .agreement-node.state-different .agreement-glyph,.agreement-node.state-partial .agreement-glyph{fill:var(--amber)}
  .agreement-node.state-conflict .agreement-marker{fill:rgb(var(--danger-rgb) / .13);stroke:var(--danger);stroke-width:2}
  .agreement-node.state-conflict .agreement-glyph{fill:var(--danger)}
  .agreement-node.state-observed .agreement-marker{fill:rgb(var(--accent-rgb) / .14);stroke:var(--accent)}
  .agreement-node.state-observed .agreement-glyph{fill:var(--accent)}
  .agreement-node.state-not_collected .agreement-marker,.agreement-node.state-unavailable .agreement-marker,.agreement-node.state-unknown .agreement-marker{fill:var(--panel);stroke:var(--muted);stroke-dasharray:2 2}
  .matrix-legend{display:flex;flex-wrap:wrap;gap:7px 14px;margin:9px 0 0;padding:0;color:var(--muted);font:650 var(--text-2xs) var(--mono);list-style:none}
  .matrix-legend li{display:flex;align-items:center;gap:6px}.matrix-legend span{display:grid;width:16px;height:16px;place-items:center;border:1px solid var(--border);border-radius:50%;background:var(--panel);font:750 9px var(--mono)}
  .matrix-legend .state-equal span{border-color:var(--success);background:color-mix(in srgb,var(--success) 16%,var(--panel));color:var(--success)}
  .matrix-legend .state-partial span{border-color:var(--amber);border-radius:0;background:rgb(var(--amber-rgb) / .15);color:var(--amber);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
  .matrix-legend .state-conflict span{border-color:var(--danger);background:rgb(var(--danger-rgb) / .13);color:var(--danger);clip-path:polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%)}
  .matrix-legend .state-not_collected span{border-color:var(--muted);border-style:dashed}
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
  .rdap-capabilities{margin:0 var(--card-pad) var(--card-pad);border:1px solid var(--border);border-radius:var(--radius-sm)}.rdap-capabilities>summary{padding:10px 11px}.capability-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--border)}.capability-sources article{min-width:0;padding:11px;background:var(--panel)}.capability-sources header{display:flex;justify-content:space-between;gap:8px;align-items:center}.capability-sources ul{display:grid;gap:7px;padding:0;margin:10px 0;list-style:none}.capability-sources li{display:grid;grid-template-columns:minmax(105px,.6fr) minmax(0,1fr);gap:4px 8px;align-items:start}.capability-sources code{color:var(--accent);font-size:var(--text-2xs);overflow-wrap:anywhere}.capability-sources li span,.capability-sources p,.capability-limit{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.capability-sources li small{grid-column:2;color:var(--muted);font-size:var(--text-2xs)}.capability-limit{margin:10px 11px}
  .preview-control{min-height:34px;padding:6px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:650 var(--text-2xs) var(--mono);cursor:pointer}.preview-control:hover{border-color:var(--accent);color:var(--accent)}.preview-control:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.capability-sources .reverse-preview{margin:8px 0 0}.capability-sources .reverse-preview li{display:grid;grid-template-columns:1fr;gap:4px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.capability-sources .reverse-preview li small{grid-column:1}
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
  .registrar-provenance{display:grid;gap:5px;padding:14px var(--card-pad);border-top:1px solid var(--border);font-size:var(--text-xs)}
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
    .insight-grid,.publication-list,.capability-sources{grid-template-columns:1fr}
    .capability-sources li{grid-template-columns:1fr}.capability-sources li small{grid-column:1}
    .matrix-frame{display:none}
    .matrix-mobile{display:grid;gap:8px;margin-top:13px}
    .matrix-mobile article{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
    .matrix-mobile h5{margin:0;padding:9px 10px;border-bottom:1px solid var(--border);font:700 var(--text-xs) var(--mono)}
    .matrix-mobile ul{display:grid;gap:1px;margin:0;padding:0;background:var(--border);list-style:none}
    .matrix-mobile li{display:grid;grid-template-columns:minmax(0,1fr) 20px auto;gap:6px;align-items:center;min-width:0;padding:8px 9px;background:var(--panel)}
    .mobile-publication{display:flex;align-items:center;gap:7px;min-width:0;overflow-wrap:anywhere;font:650 var(--text-2xs) var(--mono)}
    .mobile-publication::before{content:"";flex:0 0 auto;width:7px;height:7px;border:2px solid var(--publication-color);border-radius:50%;background:var(--panel)}
    .mobile-agreement-marker{display:grid;width:17px;height:17px;place-items:center;border:1.5px solid var(--muted);border-radius:50%;color:var(--muted);background:var(--panel);font:750 9px var(--mono)}
    .mobile-agreement-state{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}
    .matrix-mobile small{grid-column:1/-1;min-width:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere}
    .matrix-mobile .state-equal .mobile-agreement-marker{border-color:var(--success);color:var(--success);background:color-mix(in srgb,var(--success) 16%,var(--panel))}
    .matrix-mobile .state-different .mobile-agreement-marker,.matrix-mobile .state-partial .mobile-agreement-marker{border-color:var(--amber);border-radius:0;color:var(--amber);background:rgb(var(--amber-rgb) / .15);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);line-height:1}
    .matrix-mobile .state-conflict .mobile-agreement-marker{border-color:var(--danger);color:var(--danger);background:rgb(var(--danger-rgb) / .13);clip-path:polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%)}
    .matrix-mobile .state-observed .mobile-agreement-marker{border-color:var(--accent);border-radius:3px;color:var(--accent);background:rgb(var(--accent-rgb) / .14)}
    .matrix-mobile .state-not_collected .mobile-agreement-marker,.matrix-mobile .state-unavailable .mobile-agreement-marker,.matrix-mobile .state-unknown .mobile-agreement-marker{border-style:dashed}
    .comparison .table-wrap,.publication-comparison .table-wrap{overflow:visible;border-top:0}
    .comparison table,.comparison tbody,.comparison tr,.comparison th[scope='row'],.comparison td,.publication-comparison table,.publication-comparison tbody,.publication-comparison tr,.publication-comparison th[scope='row'],.publication-comparison td{display:block;width:100%}
    .comparison thead,.publication-comparison thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
    .comparison tbody,.publication-comparison tbody{display:grid;gap:8px;padding:0 var(--card-pad) var(--card-pad)}
    .publication-comparison tbody{padding:10px}
    .comparison tr,.publication-comparison tr{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    .comparison th[scope='row'],.comparison td,.publication-comparison th[scope='row'],.publication-comparison td{display:grid;grid-template-columns:minmax(88px,108px) minmax(0,1fr);gap:8px;min-width:0;padding:8px 9px;border-top:1px solid var(--border);overflow-wrap:anywhere}
    .comparison th[scope='row'],.publication-comparison th[scope='row']{border-top:0;color:var(--text);font-size:var(--text-xs);text-align:left}
    .comparison th[scope='row']::before,.comparison td::before,.publication-comparison th[scope='row']::before,.publication-comparison td::before{content:attr(data-label);color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
    .comparison td>*,.publication-comparison td>*{grid-column:2;min-width:0}
    dl{grid-template-columns:1fr;gap:4px}
    dt:not(:first-child){margin-top:7px}
  }
</style>
