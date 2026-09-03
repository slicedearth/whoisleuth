<script lang="ts">
  import { tick } from 'svelte';
  import {
    CASE_TYPES,
    MAX_CASE_INCIDENT_TARGETS,
    caseIncidentTargetAssertion,
    caseIncidentTargets,
    caseNumber,
    caseTagsWithTypes,
    caseTypeIds,
    formattedCaseNumber,
    editCase,
    type CaseRecord,
  } from '$lib/cases';
  import {
    resolvePlatformReportingRoutes,
    type PlatformReportingResolution,
    type PlatformReportingRoute,
  } from '$lib/analysis/platform-reporting-routes.ts';

  let {
    record,
    onsaved,
    oncommitted,
    onmessage,
  }: {
    record: CaseRecord;
    onsaved: () => void | Promise<void>;
    oncommitted: (cases: CaseRecord[]) => void;
    onmessage: (message: string) => void;
  } = $props();

  type RouteGroup = {
    key: string;
    label: string;
    targets: string[];
    resolution: PlatformReportingResolution;
  };

  let selectedTypes = $state<string[]>([]);
  let typesDirty = $state(false);
  let typesOpen = $state(false);
  let typesOpenRecordId = $state('');
  let targetUrl = $state('');
  let busy = $state(false);
  const completeCaseNumber = $derived(caseNumber(record.id));
  const incidentTargets = $derived(caseIncidentTargets(record));
  const allIncidentTargets = $derived(caseIncidentTargets(record, { includeResolved: true }));
  const resolvedTargetCount = $derived(allIncidentTargets.filter((target) => target.state === 'resolved').length);
  const selectedTypeSummary = $derived.by(() => {
    const labels = CASE_TYPES.filter((item) => selectedTypes.includes(item.id)).map((item) => item.label);
    if (!labels.length) return 'Not classified';
    if (labels.length <= 2) return labels.join(' and ');
    return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
  });
  const routeGroups = $derived.by<RouteGroup[]>(() => {
    const groups = new Map<string, RouteGroup>();
    for (const target of incidentTargets) {
      const resolution = resolvePlatformReportingRoutes(target.url, selectedTypes);
      let hostname = 'other host';
      try { hostname = new URL(target.url).hostname; } catch { /* already validated */ }
      const key = resolution.platform?.id ?? `unsupported:${hostname}`;
      const existing = groups.get(key);
      if (existing) {
        existing.targets.push(target.url);
      } else {
        groups.set(key, {
          key,
          label: resolution.platform?.label ?? hostname,
          targets: [target.url],
          resolution,
        });
      }
    }
    return [...groups.values()];
  });

  $effect(() => {
    record.updatedAt;
    if (typesOpenRecordId !== record.id) {
      typesOpen = caseTypeIds(record.tags).length === 0;
      typesOpenRecordId = record.id;
    }
    if (!typesDirty && !busy) selectedTypes = caseTypeIds(record.tags);
  });

  function setType(id: string, checked: boolean) {
    typesDirty = true;
    selectedTypes = checked
      ? [...selectedTypes, id]
      : selectedTypes.filter((value) => value !== id);
  }

  function prunedNote(pruned: number): string {
    return pruned ? ` Pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage.` : '';
  }

  async function persist(
    patch: Parameters<typeof editCase>[1],
    success: string,
    focusId = '',
  ): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      let committed: Awaited<ReturnType<typeof editCase>>;
      try {
        committed = await editCase(record.id, patch);
      } catch (cause) {
        onmessage(cause instanceof Error ? cause.message : 'Could not update the Case.');
        return false;
      }
      try {
        await onsaved();
        onmessage(`${success}${prunedNote(committed.pruned)}`);
      } catch {
        try {
          oncommitted(committed.cases);
          onmessage(`${success} The change was saved, but Cases could not be reread. The committed Case snapshot is shown locally; reload to retry.${prunedNote(committed.pruned)}`);
        } catch {
          onmessage(`${success} The change was saved, but this view could not be reconciled. Reload before recording another change.${prunedNote(committed.pruned)}`);
        }
      }
      return true;
    } finally {
      busy = false;
      await tick();
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    }
  }

  async function saveTypes() {
    let tags: string[];
    try {
      tags = caseTagsWithTypes(record.tags, selectedTypes);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Could not prepare the selected Case types.');
      return;
    }
    if (!await persist({ tags }, `Saved Case types for ${record.domain}.`)) return;
    typesDirty = false;
    typesOpen = false;
  }

  async function addIncidentTarget() {
    if (incidentTargets.length >= MAX_CASE_INCIDENT_TARGETS) {
      onmessage(`A Case can retain at most ${MAX_CASE_INCIDENT_TARGETS} active incident links. Resolve one before adding another.`);
      return;
    }
    let assertion: ReturnType<typeof caseIncidentTargetAssertion>;
    try {
      assertion = caseIncidentTargetAssertion(targetUrl);
    } catch (cause) {
      onmessage(cause instanceof Error ? cause.message : 'Enter a valid exact incident URL.');
      return;
    }
    if (incidentTargets.some((target) => target.url === assertion.statement.slice('Incident target URL: '.length))) {
      onmessage('That exact incident URL is already active in this Case.');
      return;
    }
    if (!await persist({ assertion }, `Added an exact incident target to ${record.domain}.`)) return;
    targetUrl = '';
  }

  async function resolveIncidentTarget(assertionId: string) {
    await persist(
      { assertionUpdate: { id: assertionId, state: 'resolved' } },
      `Removed the incident target from the active reporting scope for ${record.domain}; its Case history remains retained.`,
      `incident-targets-${record.id}`,
    );
  }

  function reportingActionExists(route: PlatformReportingRoute): boolean {
    return record.actions.some((action) => (
      action.recipient === route.contact
      && action.contactSource === `Official ${route.platformLabel} ${route.label}, reviewed ${route.reviewedAt}`
      && action.state !== 'terminal'
    ));
  }

  async function createReportingAction(route: PlatformReportingRoute) {
    if (reportingActionExists(route)) {
      onmessage(`An active action already uses the ${route.platformLabel} route ${route.contact}.`);
      return;
    }
    await persist({
      action: {
        type: 'security_contact_report',
        recipient: route.contact,
        contactSource: `Official ${route.platformLabel} ${route.label}, reviewed ${route.reviewedAt}`,
        routeObservedAt: new Date().toISOString(),
        contactLimitations: [
          `Official guidance: ${route.guidanceUrl}`,
          route.privacyNote,
          'The analyst must verify the current route, authority, evidence and recipient scope before authorisation or submission.',
        ],
        dueAt: null,
        followUpAt: null,
      },
    }, `Created a drafting ${route.platformLabel} reporting action. Nothing was submitted.`);
  }

  async function copyCaseNumber() {
    try {
      await navigator.clipboard.writeText(completeCaseNumber);
      onmessage('Copied the complete Case number.');
    } catch {
      onmessage('Clipboard access was unavailable. Select and copy the Case number manually.');
    }
  }

  function routeHref(route: PlatformReportingRoute): string {
    return route.channel === 'email' ? `mailto:${route.contact}` : route.contact;
  }
</script>

<section class="workflow-details" aria-labelledby={`case-details-title-${record.id}`}>
  <header>
    <div><p class="eyebrow">Case details</p><h4 id={`case-details-title-${record.id}`}>Classification and incident scope</h4></div>
    <div class="case-number"><span>Case number</span><code>{formattedCaseNumber(record.id)}</code><button class="btn small" type="button" onclick={() => void copyCaseNumber()}>Copy</button></div>
  </header>

  <details class="case-types" bind:open={typesOpen}>
    <summary><span>Case types</span><small>{selectedTypeSummary}{typesDirty ? ' · unsaved' : ''}</small></summary>
    <form onsubmit={(event) => { event.preventDefault(); void saveTypes(); }}>
      <fieldset disabled={busy}>
        <legend class="sr-only">Select Case types</legend>
        <p>Select every type supported by the current analyst assessment. Types organise the workflow; they do not prove a violation.</p>
        <div class="type-grid">
          {#each CASE_TYPES as type}
            <label title={type.description}><input type="checkbox" checked={selectedTypes.includes(type.id)} onchange={(event) => setType(type.id, event.currentTarget.checked)}><span><strong>{type.label}</strong><small>{type.description}</small></span></label>
          {/each}
        </div>
      </fieldset>
      <button class="btn" type="submit" disabled={busy || !typesDirty}>Save Case types</button>
    </form>
  </details>

  <section id={`incident-targets-${record.id}`} class="incident-targets" tabindex="-1" aria-labelledby={`incident-targets-title-${record.id}`}>
    <div class="section-heading"><div><h5 id={`incident-targets-title-${record.id}`}>Incident links</h5><p>Retain exact social, platform or web content links that belong in this Case.</p></div><span>{incidentTargets.length} active{resolvedTargetCount ? ` · ${resolvedTargetCount} resolved` : ''}</span></div>
    <form class="target-form" onsubmit={(event) => { event.preventDefault(); void addIncidentTarget(); }}>
      <label class="field">Exact HTTP(S) URL <small>Do not include credentials or private access tokens</small><input type="url" bind:value={targetUrl} maxlength="1979" placeholder="https://social.example/post/123" required></label>
      <button class="btn" type="submit" disabled={busy || !targetUrl.trim() || incidentTargets.length >= MAX_CASE_INCIDENT_TARGETS}>Add incident link</button>
    </form>
    {#if incidentTargets.length}
      <ol class="target-list">
        {#each incidentTargets as target}
          <li><a href={target.url} target="_blank" rel="noopener noreferrer">{target.url}<span class="sr-only"> (opens in a new tab)</span></a><button class="btn small" type="button" disabled={busy} onclick={() => void resolveIncidentTarget(target.assertionId)}>Resolve</button></li>
        {/each}
      </ol>
    {:else}
      <p class="empty">No exact incident link is active. The Case domain remains available for domain-level investigation.</p>
    {/if}
  </section>

  {#if routeGroups.length}
    <section class="reporting-routes" aria-labelledby={`reporting-routes-title-${record.id}`}>
      <div class="section-heading"><div><h5 id={`reporting-routes-title-${record.id}`}>Official platform routes</h5><p>Matched from exact incident-link hostnames and the selected Case types.</p></div></div>
      <div class="route-groups">
        {#each routeGroups as group (group.key)}
          <article>
            <header><strong>{group.label}</strong><span class:stale={group.resolution.state === 'stale'}>{group.resolution.state}</span></header>
            <ul class="matched-targets">{#each group.targets as target}<li>{target}</li>{/each}</ul>
            <p>{group.resolution.limitation}</p>
            {#each group.resolution.routes as route}
              <section class="route">
                <div><strong>{route.label}</strong><span>Reviewed {route.reviewedAt} · recheck before {route.reviewAfter}</span></div>
                <p>Prepare: {route.preparation.join('; ')}.</p>
                <p>{route.privacyNote}</p>
                <div class="route-actions"><a class="btn" href={routeHref(route)} target={route.channel === 'url' ? '_blank' : undefined} rel={route.channel === 'url' ? 'noopener noreferrer' : undefined}>{route.channel === 'email' ? `Prepare email to ${route.contact}` : 'Open official route'}<span class="sr-only"> ({route.channel === 'email' ? 'opens the mail application' : 'opens in a new tab'})</span></a><a href={route.guidanceUrl} target="_blank" rel="noopener noreferrer">Official guidance<span class="sr-only"> (opens in a new tab)</span></a><button class="btn" type="button" disabled={busy || typesDirty || reportingActionExists(route)} title={typesDirty ? 'Save the selected Case types before creating a reporting action.' : undefined} onclick={() => void createReportingAction(route)}>{reportingActionExists(route) ? 'Action already active' : typesDirty ? 'Save Case types first' : 'Create drafting action'}</button></div>
              </section>
            {/each}
          </article>
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .workflow-details{display:grid;gap:13px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .workflow-details>header,.section-heading,.route-groups article>header,.route>div:first-child{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}.workflow-details h4,.workflow-details h5{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  .case-number{display:grid;grid-template-columns:auto auto;align-items:center;gap:3px 8px;max-width:100%}.case-number>span{grid-column:1/-1;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.case-number code{max-width:min(100%,430px);padding:5px 7px;background:var(--panel-raised);font-size:var(--text-2xs);overflow-wrap:anywhere;white-space:normal}.case-number button{grid-column:2;grid-row:2}
  .case-types{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.case-types>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}.case-types>summary small{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-align:right}.case-types>form{display:grid;gap:8px;padding:0 10px 10px}.case-types fieldset{display:grid;gap:10px;min-width:0;margin:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.case-types fieldset>p,.section-heading p,.route p,.empty{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.case-types>form>button{justify-self:start}
  .type-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.type-grid label{display:flex;min-width:0;align-items:flex-start;gap:7px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer}.type-grid label:has(input:checked){border-color:rgb(var(--accent-rgb) / .55);background:rgb(var(--accent-rgb) / .06)}.type-grid input{flex:none;width:16px;height:16px;margin-top:1px}.type-grid span,.type-grid strong,.type-grid small{display:block;min-width:0}.type-grid strong{font:700 var(--text-xs) var(--mono)}.type-grid small{margin-top:3px;color:var(--muted);font-size:.62rem;line-height:1.35}
  .incident-targets,.reporting-routes{display:grid;gap:9px;padding-top:12px;border-top:1px solid var(--border)}.section-heading>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.target-form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}.target-form input{width:100%;margin-top:5px}.field small{color:var(--muted)}
  .target-list{display:grid;gap:5px;margin:0;padding:0;list-style:none}.target-list li{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.target-list a{min-width:0;color:var(--accent);font:600 var(--text-2xs) var(--mono);overflow-wrap:anywhere}.target-list button{flex:none}
  .route-groups{display:grid;gap:8px}.route-groups>article{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.route-groups article>header strong{font:700 var(--text-xs) var(--mono)}.route-groups article>header span{padding:3px 6px;border:1px solid var(--border);border-radius:999px;color:var(--success);font:650 var(--text-2xs) var(--mono);text-transform:capitalize}.route-groups article>header span.stale{color:var(--amber)}.matched-targets{display:grid;gap:3px;margin:0;padding-left:18px;color:var(--muted);font:var(--text-2xs) var(--mono);overflow-wrap:anywhere}.route{display:grid;gap:7px;padding:9px;border-left:3px solid var(--accent);background:var(--panel)}.route>div:first-child strong{font:700 var(--text-xs) var(--mono)}.route>div:first-child span{color:var(--muted);font-size:var(--text-2xs)}.route-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px}.route-actions>a:not(.btn){color:var(--accent);font:650 var(--text-2xs) var(--mono)}
  @media(max-width:900px){.type-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:620px){.workflow-details>header{display:grid}.case-number{width:100%;grid-template-columns:minmax(0,1fr) auto}.case-types>summary{align-items:flex-start;flex-direction:column}.case-types>summary small{text-align:left}.type-grid{grid-template-columns:1fr}.target-form{grid-template-columns:1fr}.target-form button,.case-types>form>button{width:100%}.target-list li{align-items:stretch;flex-direction:column}.target-list button{align-self:flex-start}.route-actions>*{flex:1 1 150px;text-align:center}}
  @media(max-width:480px){.workflow-details{padding:0;border:0;background:transparent}.case-types>form{padding:0 8px 8px}.case-types fieldset{padding:0;border:0;background:transparent}.type-grid label{padding:10px}}
</style>
