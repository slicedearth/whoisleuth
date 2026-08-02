<script lang="ts">
  import { compareSavedBulkSessions, type BulkSession } from '$lib/bulk-sessions';

  let {
    sessions,
    currentSessionId,
    saveName,
    setSaveName,
    saveCurrent,
    loadSession,
    resumeSession,
    deleteSession,
    exportSessions,
    status,
    canSave,
  }: {
    sessions: BulkSession[];
    currentSessionId: string;
    saveName: string;
    setSaveName: (value: string) => void;
    saveCurrent: () => void | Promise<void>;
    loadSession: (session: BulkSession) => void | Promise<void>;
    resumeSession: (session: BulkSession) => void | Promise<void>;
    deleteSession: (session: BulkSession) => void | Promise<void>;
    exportSessions: () => void | Promise<void>;
    status: string;
    canSave: boolean;
  } = $props();

  let baselineId = $state('');
  let currentId = $state('');
  const baseline = $derived(sessions.find((session) => session.id === baselineId) || null);
  const current = $derived(sessions.find((session) => session.id === currentId) || null);
  const comparison = $derived(baseline && current ? compareSavedBulkSessions(baseline, current) : null);

  function completedCount(session: BulkSession): number {
    return session.results.filter((result) => result.status === 'complete').length;
  }

  function failedCount(session: BulkSession): number {
    return session.results.filter((result) => result.status === 'error').length;
  }

  function unstartedCount(session: BulkSession): number {
    return Math.max(0, session.domains.length - session.results.length);
  }

  function sourceSummary(session: BulkSession): string {
    const states = session.results.flatMap((result) => result.sourceCoverage.map((source) => source.state));
    if (!states.length) return 'Source coverage was not retained';
    const partial = states.filter((state) => state !== 'complete' && state !== 'skipped').length;
    return partial ? `${partial} incomplete source observation${partial === 1 ? '' : 's'}` : 'Recorded sources complete or explicitly skipped';
  }
</script>

<section class="bulk-sessions card" aria-labelledby="bulk-sessions-title">
  <div class="section-heading">
    <div>
      <p class="eyebrow">Browser-local workspace</p>
      <h2 id="bulk-sessions-title">Saved Bulk sessions</h2>
      <p>Save compact results and source states so an incomplete investigation can be resumed or compared later. Raw source payloads and contact records are excluded.</p>
    </div>
    {#if sessions.length}<button type="button" class="secondary" onclick={exportSessions}>Export sessions</button>{/if}
  </div>

  <div class="save-row">
    <label>
      Session name
      <input
        value={saveName}
        maxlength="100"
        placeholder="July priority review"
        oninput={(event) => setSaveName(event.currentTarget.value)}
      />
    </label>
    <button type="button" class="primary" disabled={!canSave || !saveName.trim()} onclick={saveCurrent}>
      {currentSessionId ? 'Update saved session' : 'Save current session'}
    </button>
  </div>
  {#if status}<p class="session-status" role="status">{status}</p>{/if}

  {#if sessions.length}
    <div class="session-list">
      {#each sessions as session (session.id)}
        <article class:current={session.id === currentSessionId}>
          <div>
            <h3>{session.name}</h3>
            <p>{session.mode === 'deep' ? 'Deep' : 'Fast'} · {session.results.length}/{session.domains.length} settled · {sourceSummary(session)}</p>
            <dl>
              <div><dt>Complete</dt><dd>{completedCount(session)}</dd></div>
              <div><dt>Failed</dt><dd>{failedCount(session)}</dd></div>
              <div><dt>Unstarted</dt><dd>{unstartedCount(session)}</dd></div>
              <div><dt>Saved</dt><dd>{new Date(session.updatedAt).toLocaleString()}</dd></div>
            </dl>
          </div>
          <div class="session-actions">
            <button type="button" onclick={() => loadSession(session)}>Load</button>
            {#if unstartedCount(session) > 0}
              <button type="button" class="secondary" onclick={() => resumeSession(session)}>Resume unstarted</button>
            {/if}
            <button type="button" class="danger-text" onclick={() => deleteSession(session)}>Delete</button>
          </div>
        </article>
      {/each}
    </div>

    {#if sessions.length > 1}
      <details class="comparison">
        <summary>Compare two saved sessions</summary>
        <div class="compare-controls">
          <label>Baseline
            <select bind:value={baselineId} aria-label="Baseline">
              <option value="">Choose a session</option>
              {#each sessions as session}<option value={session.id}>{session.name}</option>{/each}
            </select>
          </label>
          <label>Later session
            <select bind:value={currentId} aria-label="Later session">
              <option value="">Choose a session</option>
              {#each sessions as session}<option value={session.id}>{session.name}</option>{/each}
            </select>
          </label>
        </div>
        {#if baselineId && currentId && baselineId === currentId}
          <p class="session-status">Choose two different sessions.</p>
        {:else if comparison}
          <p><strong>{comparison.changed}</strong> changed, <strong>{comparison.added}</strong> added, <strong>{comparison.removed}</strong> absent from the later settled set, and <strong>{comparison.unchanged}</strong> unchanged.</p>
          {#if comparison.rows.length}
            <div class="table-wrap">
              <table>
                <thead><tr><th>Domain</th><th>Observed change</th></tr></thead>
                <tbody>
                  {#each comparison.rows as row}
                    <tr><th scope="row" data-label="Domain">{row.domain}</th><td data-label="Observed change">{row.changes.join(' ')}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          <ul class="limitations">{#each comparison.limitations as limitation}<li>{limitation}</li>{/each}</ul>
        {/if}
      </details>
    {/if}
  {:else}
    <p class="empty">No Bulk sessions have been saved in this browser.</p>
  {/if}
</section>

<style>
  .bulk-sessions{margin-top:16px;padding:var(--card-pad)}
  .section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .section-heading h2,.section-heading p{margin:0}
  .section-heading>div>p:last-child{margin-top:6px;color:var(--muted);max-width:75ch}
  .eyebrow{font:var(--label-font);color:var(--accent);text-transform:uppercase;letter-spacing:.1em}
  .save-row{display:grid;grid-template-columns:minmax(220px,1fr) auto;align-items:end;gap:12px;margin-top:18px}
  label{display:grid;gap:6px;font-size:var(--text-sm);font-weight:650}
  input,select{width:100%}
  .session-status{color:var(--warning);margin:10px 0 0}
  .session-list{display:grid;gap:10px;margin-top:18px}
  article{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;background:var(--panel-raised)}
  article.current{border-color:var(--accent)}
  article h3,article p{margin:0}
  article p{color:var(--muted);font-size:var(--text-sm);margin-top:4px}
  dl{display:flex;flex-wrap:wrap;gap:8px 16px;margin:12px 0 0}
  dl div{display:flex;gap:6px}
  dt{color:var(--muted);font-size:var(--text-xs)}
  dd{margin:0;font-weight:700;font-size:var(--text-xs)}
  .session-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
  .danger-text{color:var(--danger)}
  .comparison{margin-top:18px;border-top:1px solid var(--border);padding-top:14px}
  .comparison summary{cursor:pointer;font-weight:700}
  .compare-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}
  .table-wrap{max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm)}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
  tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
  .limitations,.empty{color:var(--muted);font-size:var(--text-sm)}
  .empty{margin:18px 0 0}
  @media(max-width:700px){
    .section-heading,article{display:grid}
    .save-row,.compare-controls{grid-template-columns:1fr}
    .session-actions{justify-content:flex-start}
    .table-wrap{max-height:none;overflow:visible;border:0}
    table,tbody{display:block}
    thead{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    tbody{display:grid;gap:8px}
    tr{display:block;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
    th,td{display:block;min-width:0;padding:7px 0;border:0;overflow-wrap:anywhere}
    th{padding-top:0;padding-bottom:9px;border-bottom:1px solid var(--border)}
    td::before{content:attr(data-label);display:block;margin-bottom:4px;color:var(--muted);font:600 .62rem var(--mono);letter-spacing:.06em;text-transform:uppercase}
  }
</style>
