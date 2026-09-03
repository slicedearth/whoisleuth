<script lang="ts">
  import RdapDomainSource from '$lib/components/RdapDomainSource.svelte';
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import {
    projectEvidenceMatrix,
    type MatrixInput,
  } from '$lib/analysis/visualization-models.ts';
  import { buildRdapReverseSearchPreviews } from '$lib/analysis/rdap-reverse-search-preview.ts';
  import { boundedTechnologyText } from '$lib/analysis/lookup-display-shared.ts';
  import { registrarStandingOfficialSourceUrl } from '../../../../lib/registrar-standing-catalogue-contract.mts';

  type JsonRecord = Record<string, unknown>;
  type DisplayRow = { label: string; value: string; datetime?: string };
  type ComparisonRow = {
    label: string;
    rdapValue: string;
    whoisValue: string;
    status: string;
    rdapState: string;
    whoisState: string;
    rdapMatrixTone: string;
    whoisMatrixTone: string;
    assessment: string;
    tone: string;
  };
  type PublicationComparisonRow = {
    label: string;
    registryValue: string;
    registrarValue: string;
    status: string;
    registryState: string;
    registrarState: string;
    registryMatrixTone: string;
    registrarMatrixTone: string;
    assessment: string;
    tone: string;
  };
  type ContactRole = { role: string; contacts: Array<{ identity: string; details: string[] }> };
  type TraceState = 'complete' | 'partial' | 'unavailable' | 'not_collected';
  const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  const asRecords = (value: unknown, maximum = 500): JsonRecord[] => Array.isArray(value)
    ? value.slice(0, maximum).filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
  const asStrings = (value: unknown, maximum = 500, maximumLength = 500): string[] => Array.isArray(value)
    ? value.slice(0, maximum).filter((item): item is string => typeof item === 'string')
      .map((item) => boundedTechnologyText(item, maximumLength)).filter(Boolean)
    : [];
  const display = (value: unknown): string => {
    if (typeof value === 'string' && value) return value.replaceAll('_', ' ');
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'unavailable';
  };
  const registrarComplianceSummary = (value: JsonRecord, actionCount: number): string => {
    const year = display(value.catalogueYear);
    const health = display(value.sourceHealth);
    if (value.state === 'matching_actions') return `${actionCount} matching ${year} action${actionCount === 1 ? '' : 's'} · source ${health}`;
    if (value.state === 'reviewed_no_match') return `No matching ${year} action · source ${health}`;
    if (value.state === 'not_applicable') return `Not assessed without one registrar IANA ID · source ${health}`;
    if (value.state === 'stale') return `No matching action retained · source ${health}`;
    return `${display(value.state)} · source ${health}`;
  };
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
    standing = {},
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
    standing?: JsonRecord;
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
  const standingAccreditation = $derived(asRecord(standing.accreditation));
  const standingCompliance = $derived(asRecord(standing.compliance));
  const standingAssessment = $derived(asRecord(standing.assessment));
  const standingActions = $derived(asRecords(standingCompliance.actions, 5));
  const standingLimitations = $derived(asStrings(standing.limitations, 4, 360));
  const standingNextActions = $derived(asStrings(standing.nextActions, 4, 360));
  const standingComplianceSummary = $derived(registrarComplianceSummary(standingCompliance, standingActions.length));
  const standingIanaUrl = $derived(registrarStandingOfficialSourceUrl(standingAccreditation.sourceUrl, 'iana_catalogue'));
  const standingIcannUrl = $derived(registrarStandingOfficialSourceUrl(standingCompliance.sourceUrl, 'icann_index'));
  const registryDisclosure = $derived(asRecord(disclosure.registryRdap));
  const whoisDisclosure = $derived(asRecord(disclosure.whois));
  const lifecycle = $derived(asRecord(insights.lifecycle));
  const lifecycleLocks = $derived(asRecord(lifecycle.locks));
  const reconciliation = $derived(asRecord(insights.reconciliation));
  const publications = $derived(asRecords(insights.publications, 3));
  const rdapCapabilities = $derived(asRecord(insights.rdapCapabilities));
  const registryCapabilities = $derived(asRecord(rdapCapabilities.registry));
  const registrarCapabilities = $derived(asRecord(rdapCapabilities.registrar));
  const registryDeclarations = $derived(asRecords(registryCapabilities.declarations, 50));
  const registrarDeclarations = $derived(asRecords(registrarCapabilities.declarations, 50));
  const registryReverseSearch = $derived(asRecord(registryCapabilities.reverseSearch));
  const registrarReverseSearch = $derived(asRecord(registrarCapabilities.reverseSearch));
  const registryReversePreviews = $derived(buildRdapReverseSearchPreviews(rdapParsed, registryCapabilities));
  const registrarReversePreviews = $derived(buildRdapReverseSearchPreviews(registrar.parsed, registrarCapabilities));
  let showRegistryReversePreview = $state(false);
  let showRegistrarReversePreview = $state(false);
  const abuseRouting = $derived(asRecords(insights.abuseRouting, 8));
  const hasRdapPublication = $derived(Boolean(
    rdapParsed.domain
    || rdapParsed.handle
    || rdapParsed.objectClassName
    || rdapParsed.statuses
    || rdapParsed.nameservers,
  ));
  const registryTraceState = $derived<TraceState>(rdapError
    ? 'unavailable'
    : rdapPartialDetail
      ? 'partial'
      : rdapRows.length || hasRdapPublication
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
  const comparisonLanes = $derived.by((): MatrixInput[] => {
    return [
      ...comparisonRows.map((row, index): MatrixInput => ({
        id: `registry-whois-${index}-${row.label}`,
        label: row.label,
        context: 'Registry RDAP ↔ WHOIS',
        status: row.status,
        assessment: row.assessment,
        sparse: true,
        cells: [
          { column: 'Registry RDAP', state: row.rdapState, tone: row.rdapMatrixTone, detail: row.rdapValue },
          { column: 'WHOIS', state: row.whoisState, tone: row.whoisMatrixTone, detail: row.whoisValue },
        ],
      })),
      ...(registrar.comparisonRows ?? []).map((row, index): MatrixInput => ({
        id: `registry-registrar-${index}-${row.label}`,
        label: row.label,
        context: 'Registry RDAP ↔ Registrar RDAP',
        status: row.status,
        assessment: row.assessment,
        sparse: true,
        cells: [
          { column: 'Registry RDAP', state: row.registryState, tone: row.registryMatrixTone, detail: row.registryValue },
          { column: 'Registrar RDAP', state: row.registrarState, tone: row.registrarMatrixTone, detail: row.registrarValue },
        ],
      })),
    ];
  });
  const comparisonMatrix = $derived(projectEvidenceMatrix(
    registrar.comparisonRows?.length ? ['Registry RDAP', 'Registrar RDAP', 'WHOIS'] : ['Registry RDAP', 'WHOIS'],
    comparisonLanes,
  ));

  function traceStateLabel(state: TraceState): string {
    return state === 'not_collected' ? 'Not collected' : state.replaceAll('_', ' ');
  }
  type PlotCell = { x: number; width: number };
  const PUBLICATION_COLOURS: Readonly<Record<string, string>> = Object.freeze({
    'Registry RDAP': 'var(--source-registry-stroke)',
    'Registrar RDAP': 'var(--source-registrar-stroke)',
    WHOIS: 'var(--source-whois-stroke)',
  });
  const publicationColour = (source: string): string => PUBLICATION_COLOURS[source] ?? 'var(--source-structured-stroke)';
  const markerX = (cell: PlotCell): number => cell.x + cell.width / 2;
  const trackStart = (cells: readonly PlotCell[]): number => cells[0] ? markerX(cells[0]) : 250;
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
  const sourceStateLabel = (state: string): string => state.replaceAll('_', ' ');
</script>

{#if resultType === 'domain'}
  {#if standing.version === 1}
    <section class="registrar-standing card" aria-labelledby="registrar-standing-title" data-standing-state={String(standingAssessment.state || 'unknown')}>
      <header class="section-head">
        <div>
          <p class="eyebrow">Official provider context</p>
          <h4 id="registrar-standing-title">Registrar standing</h4>
        </div>
        <span class="standing-badge">{display(standingAssessment.label)}</span>
      </header>
      <p class="standing-detail">{display(standingAssessment.detail)}</p>
      <div class="standing-sources">
        <article>
          <small>IANA accreditation</small>
          <strong>{display(standingAccreditation.state)}</strong>
          <span>IANA ID {display(standing.ianaId)} · source {display(standingAccreditation.sourceHealth)}</span>
          {#if standingIanaUrl}<a href={standingIanaUrl} target="_blank" rel="noopener noreferrer">Open IANA registrar catalogue<span class="sr-only"> (opens in a new tab)</span></a>{/if}
          {#if standingAccreditation.observedAt}
            <time datetime={String(standingAccreditation.observedAt)}>Reviewed {new Date(String(standingAccreditation.observedAt)).toLocaleDateString('en-AU')}</time>
          {/if}
        </article>
        <article>
          <small>ICANN compliance notices</small>
          <strong>{display(standingCompliance.state)}</strong>
          <span>{standingComplianceSummary}</span>
          {#if standingIcannUrl}<a href={standingIcannUrl} target="_blank" rel="noopener noreferrer">Open ICANN notice index<span class="sr-only"> (opens in a new tab)</span></a>{/if}
          {#if standingCompliance.reviewedAt}
            <time datetime={String(standingCompliance.reviewedAt)}>Reviewed {new Date(String(standingCompliance.reviewedAt)).toLocaleDateString('en-AU')}</time>
          {/if}
        </article>
      </div>
      {#if standingActions.length}
        <div class="standing-actions" aria-labelledby="registrar-standing-actions-title">
          <h5 id="registrar-standing-actions-title">Matching official notices</h5>
          <ol>
            {#each standingActions as action (String(action.noticeId))}
              {@const noticeUrl = registrarStandingOfficialSourceUrl(action.sourceUrl, 'icann_notice', String(action.noticeId || ''))}
              <li>
                <div>
                  <strong>{display(action.type)}</strong>
                  <span>Issued <time datetime={String(action.issuedOn)}>{String(action.issuedOn)}</time></span>
                </div>
                {#if noticeUrl}<a href={noticeUrl} target="_blank" rel="noopener noreferrer">Open notice<span class="sr-only"> (opens in a new tab)</span></a>{/if}
                {#if action.indexOutcome}<p><b>Index outcome:</b> {boundedTechnologyText(action.indexOutcome, 240)}</p>{/if}
              </li>
            {/each}
          </ol>
          {#if standingCompliance.truncated}<p class="partial">Additional matching notices were omitted from this bounded view.</p>{/if}
        </div>
      {/if}
      {#if standingNextActions.length}
        <details class="standing-follow-up">
          <summary>Review steps</summary>
          <ol>{#each standingNextActions as action}<li>{action}</li>{/each}</ol>
        </details>
      {/if}
      {#if standingLimitations.length}
        <details class="standing-scope">
          <summary>Scope and source limits</summary>
          <ul>{#each standingLimitations as limitation}<li>{limitation}</li>{/each}</ul>
        </details>
      {/if}
    </section>
  {/if}

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
        <h4 id="registration-agreement-title">Pairwise registration source agreement</h4>
        <p>Each lane represents one actual source comparison. Repeated fields therefore remain separate across Registry RDAP ↔ WHOIS and Registry RDAP ↔ Registrar RDAP instead of being merged. Marker styling summarises the comparison; the exact source state and value remain in the table following the plot.</p>
      </div>
      {#if comparisonMatrix.truncated}<span class="partial">Partial visual</span>{/if}
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scrollable matrix must be keyboard reachable -->
    <div class="matrix-frame" role="img" tabindex="0" aria-label={`Pairwise registration agreement plot with ${comparisonMatrix.rows.length} source comparison lanes`}>
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
          <text x="8" y={row.y + row.height / 2 - 3} class="row-label">{row.label}</text>
          <text x="8" y={row.y + row.height / 2 + 9} class="pair-label">{row.context}</text>
          {#each row.cells as cell}
            <g class={`agreement-node state-${cell.tone}`} data-source-state={cell.state}>
              <title>{row.label}, {row.context}, {cell.column}: source state {sourceStateLabel(cell.state)}; {row.assessment}{cell.detail ? `; value ${cell.detail}` : ''}</title>
              {#if cell.tone === 'different' || cell.tone === 'partial'}
                <polygon points={diamondPoints(markerX(cell), row.y + row.height / 2)} class="agreement-marker" />
              {:else if cell.tone === 'conflict'}
                <polygon points={hexagonPoints(markerX(cell), row.y + row.height / 2)} class="agreement-marker" />
              {:else if cell.tone === 'observed'}
                <rect x={markerX(cell) - 7} y={row.y + row.height / 2 - 7} width="14" height="14" rx="3" class="agreement-marker" />
              {:else}
                <circle cx={markerX(cell)} cy={row.y + row.height / 2} r="7" class="agreement-marker" />
              {/if}
              <text x={markerX(cell)} y={row.y + row.height / 2 + 3} text-anchor="middle" class="agreement-glyph">{comparisonGlyph(cell.tone)}</text>
            </g>
          {/each}
        {/each}
      </svg>
    </div>
    <div class="lane-table-wrap">
      <table class="lane-table">
        <caption>Exact pairwise registration publication comparisons</caption>
        <thead><tr><th scope="col">Field and source pair</th><th scope="col">First publication</th><th scope="col">Second publication</th><th scope="col">Assessment</th></tr></thead>
        <tbody>
          {#each comparisonLanes as row (row.id)}
            {@const first=row.cells[0]}
            {@const second=row.cells[1]}
            <tr>
              <th scope="row" data-label="Field and source pair"><strong>{row.label}</strong><small>{row.context}</small></th>
              <td data-label="First publication"><strong>{first?.column || 'Publication unavailable'}</strong><span>{first?.detail || 'No comparable value'}</span><small>Source state <code>{first?.state || 'unknown'}</code></small></td>
              <td data-label="Second publication"><strong>{second?.column || 'Publication unavailable'}</strong><span>{second?.detail || 'No comparable value'}</span><small>Source state <code>{second?.state || 'unknown'}</code></small></td>
              <td data-label="Assessment"><span>{row.assessment || sourceStateLabel(row.status || 'unknown')}</span><small>Comparison state <code>{row.status || 'unknown'}</code></small></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <section class="lane-cards" aria-labelledby="mobile-registration-comparisons-title">
      <header>
        <h5 id="mobile-registration-comparisons-title">Exact source comparisons</h5>
        <p>Each card compares one field across one source pair. Open a card to review both publications and the exact assessment.</p>
      </header>
      <ol>
        {#each comparisonLanes as row (row.id)}
          {@const first=row.cells[0]}
          {@const second=row.cells[1]}
          <li data-comparison-state={row.status || 'unknown'}>
            <details class="lane-card" open={row.status !== 'equivalent' && row.status !== 'equal'}>
              <summary>
                <span><strong>{row.label}</strong><small>{row.context}</small></span>
                <span class="lane-status">{sourceStateLabel(row.status || 'unknown')}</span>
              </summary>
              <div class="lane-card-body">
                <div class="publication-side">
                  <small>First publication</small>
                  <strong>{first?.column || 'Publication unavailable'}</strong>
                  <span>{first?.detail || 'No comparable value'}</span>
                  <em>Source state · {sourceStateLabel(first?.state || 'unknown')}</em>
                </div>
                <div class="publication-side">
                  <small>Second publication</small>
                  <strong>{second?.column || 'Publication unavailable'}</strong>
                  <span>{second?.detail || 'No comparable value'}</span>
                  <em>Source state · {sourceStateLabel(second?.state || 'unknown')}</em>
                </div>
                <p class="lane-assessment"><strong>Assessment</strong><span>{row.assessment || sourceStateLabel(row.status || 'unknown')}</span></p>
              </div>
            </details>
          </li>
        {/each}
      </ol>
    </section>
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
  <details class="registry-insights evidence-card card" aria-labelledby="registry-interpretation-title">
    <summary class="evidence-summary">
      <span class="evidence-summary-row">
        <span class="evidence-summary-copy">
          <span class="eyebrow">Derived registration context</span>
          <span class="evidence-summary-title" id="registry-interpretation-title" role="heading" aria-level="4">Registry interpretation</span>
          <span class="evidence-summary-detail">Lifecycle, lock, disclosure, publication, and capability context kept separate from source evidence</span>
        </span>
        <span class="evidence-status neutral">{display(lifecycle.label)}</span>
      </span>
    </summary>
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
        <small>{boundedTechnologyText(reconciliation.summary, 500) || 'No comparable publication summary was available.'}</small>
      </article>
    </div>
    {#if asStrings(lifecycle.rawStatuses,40,160).length}
      <div class="raw-statuses"><strong>Raw source statuses</strong><div>{#each asStrings(lifecycle.rawStatuses,40,160) as status}<code>{status}</code>{/each}</div></div>
    {/if}
    {#if asStrings(lifecycle.acquisitionPath,3,500).length}
      <section class="acquisition-path"><strong>Lifecycle-aware next steps</strong><ol>{#each asStrings(lifecycle.acquisitionPath,3,500) as step}<li>{step}</li>{/each}</ol><p>{boundedTechnologyText(lifecycle.limitation,500)}</p></section>
    {/if}
    <details class="publication-quality">
      <summary>Publication quality · {publications.filter((item) => item.state === 'complete').length} complete</summary>
      <div class="publication-list">{#each publications as publication}<article><strong>{display(publication.source)}</strong><span class={`chip ${publication.state === 'complete' ? 'factual' : publication.state === 'partial' ? 'warn' : 'unavailable'}`}>{display(publication.state)}</span>{#if publication.observedAt}<small>{boundedTechnologyText(publication.observedAt,64)}</small>{/if}{#each asStrings(publication.issues,12,500) as issue}<p>{issue}</p>{/each}</article>{/each}</div>
    </details>
    <details class="rdap-capabilities">
      <summary>RDAP capability declarations · {registryDeclarations.length + registrarDeclarations.length}</summary>
      <div class="capability-sources">
        <article>
          <header><strong>Registry RDAP</strong><span class={`chip ${registryCapabilities.state === 'complete' ? 'factual' : registryCapabilities.state === 'partial' ? 'warn' : 'unavailable'}`}>{display(registryCapabilities.state)}</span></header>
          {#if registryDeclarations.length}
            <ul>{#each registryDeclarations as declaration}<li><code>{boundedTechnologyText(declaration.identifier,160)}</code><span>{boundedTechnologyText(declaration.capability,240)}</span>{#if declaration.status === 'obsolete'}<small>Registered as obsolete</small>{:else if declaration.category === 'unknown'}<small>Unclassified; retained without interpretation</small>{/if}</li>{/each}</ul>
          {:else}<p>No usable declaration was retained from this response.</p>{/if}
          <p><strong>Reverse search:</strong> {display(registryReverseSearch.state)}. {boundedTechnologyText(registryReverseSearch.detail,500)}</p>
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
          <header><strong>Registrar RDAP</strong><span class={`chip ${registrarCapabilities.state === 'complete' ? 'factual' : registrarCapabilities.state === 'partial' ? 'warn' : 'unavailable'}`}>{display(registrarCapabilities.state)}</span></header>
          {#if registrarDeclarations.length}
            <ul>{#each registrarDeclarations as declaration}<li><code>{boundedTechnologyText(declaration.identifier,160)}</code><span>{boundedTechnologyText(declaration.capability,240)}</span>{#if declaration.status === 'obsolete'}<small>Registered as obsolete</small>{:else if declaration.category === 'unknown'}<small>Unclassified; retained without interpretation</small>{/if}</li>{/each}</ul>
          {:else}<p>No usable declaration was retained from this response.</p>{/if}
          <p><strong>Reverse search:</strong> {display(registrarReverseSearch.state)}. {boundedTechnologyText(registrarReverseSearch.detail,500)}</p>
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
        <ul>{#each abuseRouting as route}<li><strong>{display(route.kind)} {display(route.channel)}</strong><span>{boundedTechnologyText(route.contact,320)}</span><small>{boundedTechnologyText(route.source,80)}</small>{#each asStrings(route.limitations,10,300) as limitation}<small>{limitation}</small>{/each}</li>{/each}</ul>
      </details>
    {/if}
    <p class="interpretation-limit">{boundedTechnologyText(disclosure.limitation,500)}</p>
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
            {#if whoisTruncatedFields.length}<p class="callout warn">Some WHOIS fields exceeded local display limits: {whoisTruncatedFields.join(', ')}. Review the WHOIS chain in the validated lookup response for the complete accepted upstream text.</p>{/if}
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
  .registrar-standing{padding:var(--card-pad)}
  .registrar-standing h4{margin:2px 0 0;font:700 var(--text-md) var(--mono)}
  .standing-badge{max-width:260px;padding:4px 8px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:700 var(--text-2xs) var(--mono);line-height:1.35;text-align:center}
  [data-standing-state='notice_present'] .standing-badge{border-color:var(--amber);color:var(--amber)}
  [data-standing-state='terminated'] .standing-badge{border-color:var(--danger);color:var(--danger)}
  [data-standing-state='accredited'] .standing-badge{border-color:var(--success);color:var(--success)}
  .standing-detail{max-width:760px;margin:10px 0 0;color:var(--text);font-size:var(--text-sm);line-height:1.55}
  .standing-sources{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:13px}
  .standing-sources article{display:grid;align-content:start;gap:5px;min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .standing-sources small{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  .standing-sources strong{font:700 var(--text-sm) var(--mono);text-transform:capitalize}
  .standing-sources span,.standing-sources time{color:var(--muted);font-size:var(--text-2xs);line-height:1.45;overflow-wrap:anywhere}
  .standing-sources a,.standing-actions a{width:max-content;max-width:100%;color:var(--accent);font:650 var(--text-2xs) var(--mono);overflow-wrap:anywhere}
  .standing-sources a:focus-visible,.standing-actions a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .standing-actions{margin-top:13px;padding-top:12px;border-top:1px solid var(--border)}
  .standing-actions h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .standing-actions ol{display:grid;gap:8px;margin:9px 0 0;padding:0;list-style:none}
  .standing-actions li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .standing-actions li>div{display:grid;gap:3px;min-width:0}
  .standing-actions strong{font:700 var(--text-xs) var(--mono);text-transform:capitalize}
  .standing-actions span,.standing-actions p{color:var(--muted);font-size:var(--text-2xs);line-height:1.5;overflow-wrap:anywhere}
  .standing-actions p{grid-column:1/-1;margin:2px 0 0}.standing-actions p b{color:var(--text)}
  .standing-follow-up,.standing-scope{margin-top:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .standing-follow-up>summary,.standing-scope>summary{padding:9px 10px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .standing-follow-up>summary:focus-visible,.standing-scope>summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .standing-follow-up ol{display:grid;gap:5px;margin:0;padding:0 28px 11px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .standing-scope ul{display:grid;gap:5px;margin:0;padding:0 28px 11px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .authority-trace{padding:var(--card-pad)}
  .agreement-matrix{padding:var(--card-pad);margin-top:12px}
  .agreement-matrix h4{margin:2px 0 0;font:700 var(--text-md) var(--mono)}
  .agreement-matrix .section-head p:not(.eyebrow){max-width:720px;margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .matrix-frame{max-width:100%;margin-top:13px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised);overscroll-behavior-x:contain}
  .matrix-frame:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .matrix-frame svg{display:block;width:100%;min-width:680px;height:auto}
  .column-label,.row-label,.pair-label{fill:var(--muted);font-family:var(--mono);font-size:9px}
  .publication-marker{fill:var(--publication-color);stroke:color-mix(in srgb,var(--publication-color) 40%,var(--panel));stroke-width:3}
  .column-guide{stroke:color-mix(in srgb,var(--publication-color) 14%,var(--border));stroke-width:1;stroke-dasharray:2 5}
  .row-label{fill:var(--text)}
  .pair-label{font-size:8px}
  .agreement-track{stroke:var(--border-strong);stroke-width:1.5}
  .agreement-marker{fill:var(--panel);stroke:var(--muted);stroke-width:1.7}
  .agreement-glyph{fill:var(--muted);font:750 9px var(--mono);pointer-events:none}
  .agreement-node.state-equal .agreement-marker{fill:color-mix(in srgb,var(--success) 16%,var(--panel));stroke:var(--success)}
  .agreement-node.state-equal .agreement-glyph{fill:var(--success)}
  .agreement-node.state-different .agreement-marker,.agreement-node.state-partial .agreement-marker{fill:color-mix(in srgb,var(--amber) 15%,var(--panel));stroke:var(--amber)}
  .agreement-node.state-different .agreement-glyph,.agreement-node.state-partial .agreement-glyph{fill:var(--amber)}
  .agreement-node.state-conflict .agreement-marker{fill:color-mix(in srgb,var(--danger) 13%,var(--panel));stroke:var(--danger);stroke-width:2}
  .agreement-node.state-conflict .agreement-glyph{fill:var(--danger)}
  .agreement-node.state-observed .agreement-marker{fill:color-mix(in srgb,var(--accent) 14%,var(--panel));stroke:var(--accent)}
  .agreement-node.state-observed .agreement-glyph{fill:var(--accent)}
  .agreement-node.state-not_collected .agreement-marker,.agreement-node.state-unavailable .agreement-marker,.agreement-node.state-unknown .agreement-marker{fill:var(--panel);stroke:var(--muted);stroke-dasharray:2 2}
  .matrix-legend{display:flex;flex-wrap:wrap;gap:7px 14px;margin:9px 0 0;padding:0;color:var(--muted);font:650 var(--text-2xs) var(--mono);list-style:none}
  .matrix-legend li{display:flex;align-items:center;gap:6px}.matrix-legend span{display:grid;width:16px;height:16px;place-items:center;border:1px solid var(--border);border-radius:50%;background:var(--panel);font:750 9px var(--mono)}
  .matrix-legend .state-equal span{border-color:var(--success);background:color-mix(in srgb,var(--success) 16%,var(--panel));color:var(--success)}
  .matrix-legend .state-partial span{border-color:var(--amber);border-radius:0;background:color-mix(in srgb,var(--amber) 15%,var(--panel));color:var(--amber);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}
  .matrix-legend .state-conflict span{border-color:var(--danger);background:color-mix(in srgb,var(--danger) 13%,var(--panel));color:var(--danger);clip-path:polygon(25% 0,75% 0,100% 25%,100% 75%,75% 100%,25% 100%,0 75%,0 25%)}
  .matrix-legend .state-observed span{border-color:var(--accent);border-radius:3px;background:color-mix(in srgb,var(--accent) 14%,var(--panel));color:var(--accent)}
  .matrix-legend .state-not_collected span{border-color:var(--muted);border-style:dotted}
  .matrix-legend .state-unavailable span{border-color:var(--muted);border-style:dotted}
  .lane-table-wrap{margin-top:12px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md)}
  .lane-table{width:100%;border-collapse:collapse;font-size:var(--text-xs)}
  .lane-table caption{padding:9px 10px;border-bottom:1px solid var(--border);color:var(--muted);font:650 var(--text-2xs) var(--mono);text-align:left}
  .lane-table th,.lane-table td{padding:9px 10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}
  .lane-table thead th{border-top:0;color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .lane-table strong,.lane-table span,.lane-table small{display:block;min-width:0;overflow-wrap:anywhere}
  .lane-table th strong,.lane-table td>strong{font:700 var(--text-xs) var(--mono)}
  .lane-table th small,.lane-table td small{margin-top:4px;color:var(--muted);font-size:var(--text-2xs)}
  .lane-table td span{margin-top:4px}
  .lane-table code{color:var(--text);font-size:inherit}
  .lane-cards{display:none}
  .authority-trace>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .authority-trace h4{margin:2px 0 0;font:700 var(--text-md) var(--mono)}
  .authority-trace>header>span{max-width:230px;color:var(--accent);font:700 var(--text-2xs) var(--mono);text-align:right;text-transform:uppercase}
  .trace-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:13px}
  .trace-sources article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .trace-sources article[data-state='partial']{border-color:color-mix(in srgb,var(--amber) 45%,var(--border))}
  .trace-sources article[data-state='unavailable'],.trace-sources article[data-state='not_collected']{border-style:dotted}
  .trace-sources article>div{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .trace-sources strong{font:700 var(--text-xs) var(--mono)}
  .trace-state{flex:none;color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  [data-state='complete'] .trace-state{color:var(--text)}
  [data-state='partial'] .trace-state{color:var(--amber)}
  .trace-sources p,.trace-sources small,.trace-limit{color:var(--muted);font-size:var(--text-2xs);line-height:1.48}
  .trace-sources p{margin:8px 0 0}
  .trace-sources p b{color:var(--text)}
  .trace-sources small{display:block;margin-top:6px}
  .trace-limit{margin:10px 0 0}
  .registry-insights>summary{border-bottom:1px solid transparent}
  .registry-insights[open]>summary{border-bottom-color:var(--border)}
  .insight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:var(--card-pad);overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--border)}
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
    .registrar-standing .section-head{display:grid}.standing-badge{max-width:none;width:max-content;text-align:left}.standing-sources{grid-template-columns:1fr}.standing-actions li{grid-template-columns:1fr}.standing-actions li>a{grid-row:2}.standing-actions p{grid-column:1}
    .authority-trace>header{display:grid}.authority-trace>header>span{max-width:none;text-align:left}.trace-sources{grid-template-columns:1fr}
    .insight-grid,.publication-list,.capability-sources{grid-template-columns:1fr}
    .capability-sources li{grid-template-columns:1fr}.capability-sources li small{grid-column:1}
    .matrix-frame{display:none}
    .lane-table-wrap{display:none}
    .lane-cards{display:grid;gap:8px;margin-top:12px}
    .lane-cards>header{display:grid;gap:5px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
    .lane-cards h5{margin:0;font:700 var(--text-xs) var(--mono)}
    .lane-cards>header p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
    .lane-cards ol{display:grid;gap:8px;margin:0;padding:0;list-style:none}
    .lane-cards li{min-width:0}
    .lane-card{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    .lane-card>summary{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:start;gap:9px;min-width:0;padding:10px;cursor:pointer;list-style:none}
    .lane-card>summary::-webkit-details-marker{display:none}
    .lane-card>summary::after{content:'+';align-self:center;color:var(--muted);font:800 var(--text-sm) var(--mono);line-height:1}
    .lane-card[open]>summary::after{content:'\2212'}
    .lane-card>summary:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}
    .lane-card>summary>span:first-child{display:grid;gap:3px;min-width:0}
    .lane-card>summary strong,.lane-card>summary small{display:block;min-width:0;overflow-wrap:anywhere}
    .lane-card>summary strong{font:700 var(--text-xs) var(--mono)}
    .lane-card>summary small{color:var(--muted);font-size:var(--text-2xs)}
    .lane-status{align-self:start;max-width:108px;padding:3px 6px;border:1px solid var(--border-strong);border-radius:999px;color:var(--text);font:700 var(--text-2xs) var(--mono);line-height:1.25;text-align:center;text-transform:capitalize;overflow-wrap:anywhere}
    [data-comparison-state='equivalent'] .lane-status,[data-comparison-state='equal'] .lane-status{border-color:var(--success);background:color-mix(in srgb,var(--success) 8%,var(--panel));color:var(--success)}
    [data-comparison-state='different'] .lane-status{border-color:var(--amber);color:var(--amber)}
    [data-comparison-state='conflict'] .lane-status{border-color:var(--danger);color:var(--danger)}
    [data-comparison-state='partial'] .lane-status,[data-comparison-state*='incomplete'] .lane-status,[data-comparison-state*='redacted'] .lane-status{border-color:var(--amber);color:var(--amber)}
    [data-comparison-state$='_only'] .lane-status{border-color:var(--accent);color:var(--accent)}
    [data-comparison-state*='unavailable'] .lane-status,[data-comparison-state*='not_collected'] .lane-status,[data-comparison-state='unknown'] .lane-status,[data-comparison-state='unsupported'] .lane-status{border-color:var(--muted);border-style:dotted;color:var(--muted)}
    .matrix-legend .state-not_collected span,.matrix-legend .state-unavailable span{border-style:dotted;border-width:2px}
    .lane-card-body{display:grid;gap:8px;padding:0 10px 10px;border-top:1px solid var(--border)}
    .publication-side{display:grid;gap:4px;min-width:0;margin-top:10px;padding:9px;border-left:3px solid var(--accent);background:var(--panel-raised)}
    .publication-side:nth-child(2){margin-top:0;border-left-color:var(--accent2)}
    .publication-side small{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
    .publication-side strong,.publication-side span,.publication-side em{min-width:0;overflow-wrap:anywhere}
    .publication-side strong{font:700 var(--text-xs) var(--mono)}
    .publication-side span{font-size:var(--text-xs);line-height:1.45}
    .publication-side em{color:var(--muted);font:normal var(--text-2xs) var(--mono)}
    .lane-assessment{display:grid;gap:4px;margin:0;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-xs)}
    .lane-assessment strong{font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
    .lane-assessment span{color:var(--muted);line-height:1.45;overflow-wrap:anywhere}
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
