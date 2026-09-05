<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import CopyableCommand from '$lib/components/CopyableCommand.svelte';
  import { PUBLIC_CLI_INDEX } from '$lib/generated/public-cli-index';
  import { preloadOnIdle } from '$lib/idle-preload';
  import {
    DEFERRED_MODULE_RECOVERY_DETAIL,
    loadDeferredModule,
    reloadDeferredModulePage,
  } from '$lib/deferred-module';

  type FullCatalogue = typeof import('$lib/generated/public-cli-catalogue')['PUBLIC_CLI_CATALOGUE'];
  type CommandDetail = FullCatalogue['commands'][number];

  let query = $state('');
  let group = $state('all');
  let mode = $state('all');
  let commonOnly = $state(false);
  let expandedId = $state('');
  let loadingId = $state('');
  let loadError = $state('');
  let catalogue = $state<FullCatalogue | null>(null);
  let cataloguePromise: Promise<FullCatalogue> | null = null;
  let loadGeneration = 0;
  let active = true;
  let urlSyncReady = $state(false);
  const moduleController = new AbortController();
  const runnableWorkflows = PUBLIC_CLI_INDEX.workflows.filter((recipe) => recipe.runnableByWorkflowRun);
  const planningWorkflows = PUBLIC_CLI_INDEX.workflows.filter((recipe) => !recipe.runnableByWorkflowRun);

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return PUBLIC_CLI_INDEX.commands.filter((command) => (
      (group === 'all' || command.group === group)
      && (mode === 'all' || command.mode === mode)
      && (!commonOnly || command.common)
      && (!needle || `${command.id} ${command.summary} ${command.group} ${command.mode}`.toLowerCase().includes(needle))
    ));
  });

  function detailFor(id: string): CommandDetail | null {
    return catalogue?.commands.find((command) => command.id === id) ?? null;
  }

  async function ensureCatalogue(): Promise<FullCatalogue> {
    if (catalogue) return catalogue;
    cataloguePromise ??= loadDeferredModule(
      () => import('$lib/generated/public-cli-catalogue'),
      { signal: moduleController.signal },
    )
      .then((module) => module.PUBLIC_CLI_CATALOGUE)
      .catch((error) => {
        cataloguePromise = null;
        throw error;
      });
    catalogue = await cataloguePromise;
    return catalogue;
  }

  function preloadCatalogue() {
    if (loadError) return;
    void ensureCatalogue().catch(() => undefined);
  }

  async function openCommand(id: string) {
    if (expandedId === id || loadError) return;
    const request = ++loadGeneration;
    loadError = '';
    loadingId = id;
    try {
      await ensureCatalogue();
      if (!active || request !== loadGeneration) return;
      expandedId = id;
    } catch {
      if (!active || request !== loadGeneration) return;
      loadError = 'Command details are unavailable.';
    } finally {
      if (active && request === loadGeneration) loadingId = '';
    }
  }

  async function revealCommand(id: string): Promise<void> {
    if (!filtered.some((command) => command.id === id)) {
      resetFilters();
      await tick();
    }
    await openCommand(id);
    if (expandedId !== id) return;
    await tick();
    requestAnimationFrame(() => {
      const target = document.getElementById(`command-${id}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => {
        if (!target) return;
        const filterBottom = document.querySelector('.filters')?.getBoundingClientRect().bottom ?? 0;
        const targetTop = target.getBoundingClientRect().top;
        if (targetTop < filterBottom + 12) window.scrollBy(0, targetTop - filterBottom - 12);
      });
    });
  }

  function navigateToCommand(event: MouseEvent, id: string): void {
    event.preventDefault();
    pushState(`#command-${id}`, page.state);
    void revealCommand(id);
  }

  async function returnToResults(event: MouseEvent): Promise<void> {
    event.preventDefault();
    const returnId = expandedId;
    pushState('#commands', page.state);
    expandedId = '';
    await tick();
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLButtonElement>(`article[data-command="${CSS.escape(returnId)}"] .command-open`);
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
    });
  }

  function labelToken(value: string): string {
    const label = value.replaceAll('_', ' ');
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }

  function inputCardinality(input: CommandDetail['inputs'][number]): string {
    if (input.minimum === input.maximum) return input.minimum === 1 ? 'Required' : `${input.minimum} required`;
    if (input.minimum === 0 && input.maximum === 1) return 'Optional';
    return `${input.minimum}–${input.maximum}`;
  }

  function exitBehaviour(detail: CommandDetail): string {
    const canReportPartial = detail.failurePolicySupport || (detail.capability.outcomes as readonly string[]).includes('partial');
    return canReportPartial
      ? '0 reports command completion. Invalid invocation uses 2, an operational failure uses 3, and a declared partial or failure-policy outcome can use 4. Bootstrap failure and process signals use 70, 130, or 143.'
      : '0 reports command completion. Invalid invocation uses 2 and an operational failure uses 3. Bootstrap failure and process signals use 70, 130, or 143.';
  }

  function relatedCommands(id: string): CommandDetail[] {
    if (!catalogue) return [];
    const relatedIds = new Set<string>();
    for (const recipe of catalogue.workflows.recipes) {
      if (!recipe.steps.some((step) => step.command === id)) continue;
      for (const step of recipe.steps) if (step.command !== id) relatedIds.add(step.command);
    }
    return catalogue.commands.filter((command) => relatedIds.has(command.id));
  }

  function resetFilters() {
    query = '';
    group = 'all';
    mode = 'all';
    commonOnly = false;
  }

  function readFiltersFromLocation() {
    const url = new URL(location.href);
    const nextGroup = url.searchParams.get('group') ?? 'all';
    const nextMode = url.searchParams.get('mode') ?? 'all';
    query = url.searchParams.get('q') ?? '';
    group = nextGroup === 'all' || PUBLIC_CLI_INDEX.groups.includes(nextGroup as (typeof PUBLIC_CLI_INDEX.groups)[number]) ? nextGroup : 'all';
    mode = nextMode === 'all' || PUBLIC_CLI_INDEX.modes.includes(nextMode as (typeof PUBLIC_CLI_INDEX.modes)[number]) ? nextMode : 'all';
    commonOnly = url.searchParams.get('common') === '1';
  }

  function syncFiltersToLocation() {
    const url = new URL(location.href);
    const values = [
      ['q', query.trim()],
      ['group', group === 'all' ? '' : group],
      ['mode', mode === 'all' ? '' : mode],
      ['common', commonOnly ? '1' : ''],
    ] as const;
    for (const [key, value] of values) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (href === `${location.pathname}${location.search}${location.hash}`) return;
    replaceState(href, page.state);
  }

  function adjacentCommand(direction: -1 | 1) {
    const index = filtered.findIndex((command) => command.id === expandedId);
    return index < 0 ? null : filtered[index + direction] ?? null;
  }

  onMount(() => {
    function openHashCommand() {
      const id = location.hash.match(/^#command-(.+)$/u)?.[1] ?? '';
      if (PUBLIC_CLI_INDEX.commands.some((command) => command.id === id)) void revealCommand(id);
      else expandedId = '';
    }

    readFiltersFromLocation();
    urlSyncReady = true;
    openHashCommand();
    addEventListener('hashchange', openHashCommand);
    addEventListener('popstate', readFiltersFromLocation);
    const cancelPreload = preloadOnIdle(preloadCatalogue);
    return () => {
      active = false;
      loadGeneration += 1;
      moduleController.abort();
      removeEventListener('hashchange', openHashCommand);
      removeEventListener('popstate', readFiltersFromLocation);
      cancelPreload();
    };
  });

  $effect(() => {
    query;
    group;
    mode;
    commonOnly;
    if (urlSyncReady && typeof location !== 'undefined') syncFiltersToLocation();
  });
</script>

<section class="catalogue" aria-labelledby="cli-catalogue-title" data-testid="public-cli-catalogue">
  <div class="catalogue-heading">
    <div><p class="eyebrow">Command reference</p><h2 id="cli-catalogue-title">All commands</h2><p>Search {PUBLIC_CLI_INDEX.commandCount} commands generated from the installed registry.</p></div>
    <span>{filtered.length} shown</span>
  </div>

  <form class="filters" onsubmit={(event) => event.preventDefault()} aria-label="Filter CLI commands">
    <label class="search"><span>Search commands</span><input type="search" bind:value={query} placeholder="Command or purpose" autocomplete="off"></label>
    <label><span>Group</span><select bind:value={group}><option value="all">All groups</option>{#each PUBLIC_CLI_INDEX.groups as item}<option value={item}>{labelToken(item)}</option>{/each}</select></label>
    <label><span>Mode</span><select bind:value={mode}><option value="all">All modes</option>{#each PUBLIC_CLI_INDEX.modes as item}<option value={item}>{labelToken(item)}</option>{/each}</select></label>
    <label class="check"><input type="checkbox" bind:checked={commonOnly}><span>Common commands only</span></label>
  </form>
  <p class="filter-status" role="status" aria-live="polite">Showing {filtered.length} of {PUBLIC_CLI_INDEX.commandCount} commands.</p>
  {#if loadError}<div class="load-error" role="alert"><p>{loadError}</p><small>{DEFERRED_MODULE_RECOVERY_DETAIL}</small><button type="button" onclick={reloadDeferredModulePage}>Reload page</button></div>{/if}

  {#if expandedId && detailFor(expandedId)}
    {@const command = PUBLIC_CLI_INDEX.commands.find((item) => item.id === expandedId)!}
    {@const detail = detailFor(expandedId)!}
    {@const related = relatedCommands(expandedId)}
    {@const previousCommand = adjacentCommand(-1)}
    {@const nextCommand = adjacentCommand(1)}
    <article class="command-workspace" id={`command-${command.id}`} data-command-detail={command.id} tabindex="-1">
      <header class="command-detail-heading">
        <a class="back-to-results" href="#commands" onclick={returnToResults}>← Back to {filtered.length} filtered command{filtered.length === 1 ? '' : 's'}</a>
        <p>{labelToken(command.group)} · {labelToken(command.mode)}{command.common ? ' · Common' : ''}</p>
        <h3><code>{command.id}</code></h3>
        <p class="command-purpose">{command.summary}</p>
      </header>
      <div class="command-detail" id={`command-detail-${command.id}`}>
        <div class="command-examples">
          <section><h4>Usage</h4><CopyableCommand command={detail.usage} label={`${command.id} usage`} compact /></section>
          <section><h4>Example</h4><CopyableCommand command={detail.example} label={`${command.id} example`} compact /></section>
        </div>
        <dl class="command-facts">
          <div><dt>Network behaviour</dt><dd><strong>{labelToken(detail.networkEffect)} · {labelToken(detail.capability.networkMode)}</strong>{detail.collection.scope}</dd></div>
          <div><dt>Authorisation</dt><dd>{labelToken(detail.capability.authorisation)}{detail.explicitAuthorisationRequired ? ' · dedicated acknowledgement required' : ''}</dd></div>
          <div><dt>Output</dt><dd><strong>{detail.outputFormats.join(', ')}</strong>{detail.primaryEvidenceArtefacts.length ? detail.primaryEvidenceArtefacts.join(', ') : 'No evidence artefact is declared.'}</dd></div>
          <div><dt>Exit behaviour</dt><dd>{exitBehaviour(detail)}</dd></div>
        </dl>
        <div class="command-inputs">
          <section>
            <h4>Inputs</h4>
            {#if detail.inputs.length}
              <dl>{#each detail.inputs as input}<div><dt><code>{input.name}</code></dt><dd>{inputCardinality(input)} {labelToken(input.valueKind)}{input.inputSource === 'argv_or_stdin' ? ' · argument or standard input' : ''}{input.values.length ? ` · ${input.values.join(', ')}` : ''}</dd></div>{/each}</dl>
            {:else}<p>No positional input.</p>{/if}
          </section>
          <section>
            <h4>Command options</h4>
            {#if detail.importantOptions.length}<ul class="option-list">{#each detail.importantOptions as option}<li><code>{option}</code></li>{/each}</ul>{:else}<p>No command-specific options.</p>{/if}
            <p>Run <code>whoisleuth {command.id} --help</code> for option descriptions and common file or presentation controls.</p>
          </section>
        </div>
        {#if related.length}
          <nav class="related-commands" aria-label={`Commands related to ${command.id}`}><strong>Related commands</strong><div>{#each related as item}<a href={`#command-${item.id}`} onclick={(event) => navigateToCommand(event, item.id)}><code>{item.id}</code><span>{item.summary}</span></a>{/each}</div></nav>
        {/if}
        <details class="boundary compact-disclosure" open={detail.explicitAuthorisationRequired}>
          <summary>Operational boundary</summary>
          <p>{detail.boundary}</p>
        </details>
        <details class="contract-details compact-disclosure">
          <summary>Limits and contracts</summary>
          <dl>
            <div><dt>Input limits</dt><dd><ul>{#each detail.inputLimits as item}<li>{item}</li>{/each}</ul></dd></div>
            <div><dt>Output limits</dt><dd><ul>{#each detail.outputLimits as item}<li>{item}</li>{/each}</ul></dd></div>
            <div><dt>Policies</dt><dd>Plan: {detail.planSupport ? 'supported' : 'not declared'} · Failure policy: {detail.failurePolicySupport ? 'supported' : 'not declared'}</dd></div>
            <div><dt>Evidence artefacts</dt><dd>{detail.primaryEvidenceArtefacts.length ? detail.primaryEvidenceArtefacts.join(', ') : 'None declared.'}</dd></div>
            <div><dt>Schemas</dt><dd>{detail.supportedSchemaIdentifiers.length ? detail.supportedSchemaIdentifiers.join(', ') : 'None declared.'}</dd></div>
            <div><dt>Privacy limits</dt><dd>{detail.capability.privacyLimitations.join(' ')}</dd></div>
          </dl>
        </details>
      </div>
      <nav class="command-pagination" aria-label="Filtered commands">
        {#if previousCommand}<a href={`#command-${previousCommand.id}`} onclick={(event) => navigateToCommand(event, previousCommand.id)}><span>Previous command</span><strong>{previousCommand.id}</strong></a>{:else}<span></span>{/if}
        {#if nextCommand}<a class="next" href={`#command-${nextCommand.id}`} onclick={(event) => navigateToCommand(event, nextCommand.id)}><span>Next command</span><strong>{nextCommand.id}</strong></a>{/if}
      </nav>
    </article>
  {:else}
    <div class="command-list">
      {#each filtered as command (command.id)}
        <article id={`command-${command.id}`} data-command={command.id}>
          <div class="command-row">
            <button
              class="command-open"
              type="button"
              disabled={Boolean(loadError)}
              onfocus={preloadCatalogue}
              onpointerenter={preloadCatalogue}
              onclick={(event) => navigateToCommand(event, command.id)}
            >
              <span><code>{command.id}</code><small>{labelToken(command.group)} · {labelToken(command.mode)}{command.common ? ' · Common' : ''}</small></span>
              <span class="command-summary">{command.summary}</span>
              <span aria-hidden="true">{loadingId === command.id ? '…' : '→'}</span>
            </button>
            <a class="command-anchor" href={`#command-${command.id}`} aria-label={`Link to ${command.id} command`} onclick={(event) => navigateToCommand(event, command.id)}>#</a>
          </div>
        </article>
      {:else}
        <div class="empty" role="status"><p>No commands match all selected filters.</p><button type="button" onclick={resetFilters}>Clear filters</button></div>
      {/each}
    </div>
  {/if}

  {#if !expandedId}<section class="recipes" aria-labelledby="command-recipes-title">
    <div><p class="eyebrow">Command recipes</p><h3 id="command-recipes-title">Multi-step tasks</h3><p>Runnable recipes have an installed execution contract. Planning templates explain a sequence but do not run it.</p></div>
    <div class="recipe-groups">
      <section aria-labelledby="runnable-recipes-title"><header><h4 id="runnable-recipes-title">Runnable workflows</h4><span>{runnableWorkflows.length}</span></header><p>Inspect with <code>workflow-plan --explain &lt;recipe&gt;</code>, then run deliberately with <code>workflow-run</code>.</p><ul>{#each runnableWorkflows as recipe}<li><code>{recipe.id}</code><strong>{recipe.label}</strong><span>{recipe.objective}</span><small>Runnable · {labelToken(recipe.subjectRequirement)}</small></li>{/each}</ul></section>
      <section aria-labelledby="planning-recipes-title"><header><h4 id="planning-recipes-title">Planning templates</h4><span>{planningWorkflows.length}</span></header><p>Use these to inspect a fixed sequence. Their steps remain manual and are not executed by <code>workflow-run</code>.</p><ul>{#each planningWorkflows as recipe}<li><code>{recipe.id}</code><strong>{recipe.label}</strong><span>{recipe.objective}</span><small>Plan only · {labelToken(recipe.subjectRequirement)}</small></li>{/each}</ul></section>
    </div>
  </section>{/if}
</section>

<style>
  .catalogue-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}.catalogue-heading>div{max-width:720px}.catalogue-heading h2,.recipes h3{margin:.3rem 0 .55rem;font:700 clamp(1.45rem,3vw,2rem) var(--mono);letter-spacing:-.04em}.catalogue-heading p:not(.eyebrow),.recipes p{margin:0;color:var(--muted);line-height:1.6}.catalogue-heading>span{flex:0 0 auto;color:var(--interface-accent);font:700 var(--text-xs) var(--mono)}
  .filters{display:grid;position:sticky;z-index:6;top:8px;grid-template-columns:minmax(200px,1fr) 145px 130px auto;gap:8px;align-items:end;margin-top:22px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:rgb(var(--panel-rgb) / .96);box-shadow:0 8px 22px rgb(var(--shadow-rgb) / .12);backdrop-filter:blur(8px)}.filters label{display:grid;gap:6px;min-width:0}.filters label>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.filters input[type='search'],.filters select{width:100%;min-width:0;padding:9px 10px}.filters .check{display:flex;min-height:40px;align-items:center;gap:8px;padding:0 5px}.filters .check input{width:18px;height:18px;margin:0}.filters .check span{color:var(--text)}
  .filter-status{margin:10px 0;color:var(--muted);font-size:var(--text-2xs)}.load-error{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-left:2px dotted var(--muted);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs)}.load-error p,.load-error small{margin:0;overflow-wrap:anywhere}.load-error p{color:var(--danger)}.load-error small{flex:1}.load-error button{flex:0 0 auto}
  .command-list{display:grid;gap:5px}.command-list article{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);overflow:hidden}.command-row{display:grid;grid-template-columns:minmax(0,1fr) 40px}.command-list button{display:grid;width:100%;grid-template-columns:minmax(160px,.4fr) minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 13px;border:0;background:transparent;color:var(--text);text-align:left}.command-list button:hover,.command-list button:focus-visible{background:rgb(var(--accent-rgb) / .06)}.command-list button>span:first-child{display:grid;min-width:0;gap:3px}.command-list button code{color:var(--accent);font-weight:750}.command-list button small{color:var(--muted);font:650 .56rem var(--mono);text-transform:uppercase}.command-summary{min-width:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}.command-anchor{display:grid;place-items:center;border-left:1px solid var(--border);color:var(--muted);font:700 var(--text-xs) var(--mono)}.command-anchor:hover,.command-anchor:focus-visible{color:var(--accent);background:rgb(var(--accent-rgb) / .06)}
  .command-workspace{min-width:0;scroll-margin-top:104px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);overflow:hidden;outline:none}.command-workspace:focus-visible{box-shadow:0 0 0 2px var(--accent)}.command-detail-heading{padding:20px;border-bottom:1px solid var(--border);background:var(--panel-raised)}.back-to-results{display:inline-flex;margin-bottom:18px;color:var(--accent);font:700 var(--text-xs) var(--mono)}.command-detail-heading>p{margin:0;color:var(--muted);font:650 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}.command-detail-heading h3{margin:6px 0 7px;font:750 clamp(1.55rem,4vw,2.25rem) var(--mono);letter-spacing:-.04em}.command-detail-heading h3 code{color:var(--accent)}.command-detail-heading .command-purpose{max-width:75ch;color:var(--text);font:400 var(--text-sm)/1.6 var(--font-sans);letter-spacing:normal;text-transform:none}
  .command-detail{padding:20px;background:color-mix(in srgb,var(--panel-raised) 72%,var(--panel))}.command-examples h4,.command-inputs h4,.related-commands>strong{color:var(--interface-accent);font:700 var(--text-2xs) var(--mono);letter-spacing:.04em;text-transform:uppercase}.command-examples{display:grid;gap:9px}.command-examples section{display:grid;gap:6px}.command-examples h4{margin:0}.command-facts,.contract-details dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:14px 0 0;padding:1px;background:var(--border)}.command-facts>div,.contract-details dl>div{min-width:0;padding:11px;background:var(--panel)}dt{color:var(--interface-accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5;overflow-wrap:anywhere}.command-facts dd>strong{display:block;margin-bottom:4px;color:var(--text);font:700 var(--text-xs) var(--mono)}dd ul{margin:6px 0 0;padding-left:18px}.command-inputs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}.command-inputs>section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.command-inputs h4{margin:0 0 8px}.command-inputs dl{display:grid;gap:7px;margin:0}.command-inputs dl>div{display:grid;grid-template-columns:minmax(90px,.35fr) minmax(0,.65fr);gap:8px}.command-inputs dt{text-transform:none}.command-inputs dd,.command-inputs p{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.command-inputs>section>p:last-child{margin-top:9px}.option-list{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}.option-list li{padding:3px 6px;border:1px solid var(--border);border-radius:5px;background:var(--panel-raised);font-size:var(--text-2xs)}.related-commands{display:grid;gap:8px;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.related-commands>div{display:flex;flex-wrap:wrap;gap:6px}.related-commands a{display:grid;gap:2px;min-width:145px;flex:1 1 180px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}.related-commands a:hover,.related-commands a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.related-commands a code{color:var(--accent);font-size:var(--text-xs)}.related-commands a span{color:var(--muted);font-size:var(--text-2xs);line-height:1.4}.boundary,.contract-details{margin-top:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.boundary summary,.contract-details summary{padding:12px 13px;font:700 var(--text-xs) var(--mono)}.boundary p{margin:0;padding:0 13px 13px;color:var(--muted);font-size:var(--text-xs);line-height:1.6}.contract-details dl{margin:0;border-top:1px solid var(--border)}.command-pagination{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;border-top:1px solid var(--border);background:var(--border)}.command-pagination a{display:grid;gap:3px;padding:14px 20px;background:var(--panel)}.command-pagination a:hover,.command-pagination a:focus-visible{background:rgb(var(--accent-rgb) / .07)}.command-pagination a.next{text-align:right}.command-pagination span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.command-pagination strong{color:var(--accent);font:700 var(--text-xs) var(--mono);overflow-wrap:anywhere}.empty{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px;border:1px dashed var(--border);color:var(--muted)}.empty p{margin:0}.empty button{padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);font:700 var(--text-xs) var(--mono)}
  .recipes{display:grid;grid-template-columns:minmax(210px,.45fr) minmax(0,1.55fr);gap:24px;margin-top:40px;padding-top:32px;border-top:1px solid var(--border)}.recipe-groups{display:grid;gap:10px}.recipe-groups>section{display:grid;gap:9px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.recipe-groups header{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.recipe-groups h4{margin:0;font:700 var(--text-sm) var(--mono)}.recipe-groups header span{color:var(--interface-accent);font:700 var(--text-xs) var(--mono)}.recipe-groups>section>p{font-size:var(--text-xs)}.recipes ul{display:grid;gap:6px;margin:0;padding:0;list-style:none}.recipes li{display:grid;grid-template-columns:minmax(135px,.35fr) minmax(0,.65fr);gap:4px 11px;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.recipes li code{color:var(--accent);font-size:var(--text-xs)}.recipes li strong{font:700 var(--text-xs) var(--mono)}.recipes li span,.recipes li small{grid-column:1/-1;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}.recipes li small{color:var(--interface-accent);text-transform:uppercase}
  @media(max-width:560px){.load-error{align-items:stretch;flex-direction:column}.load-error button{width:100%}}
  @media(max-width:800px){.filters{position:static;grid-template-columns:repeat(2,minmax(0,1fr));box-shadow:none;backdrop-filter:none}.recipes{grid-template-columns:1fr}.command-list button{grid-template-columns:minmax(130px,.42fr) minmax(0,1fr) auto}.command-facts,.contract-details dl,.command-inputs{grid-template-columns:1fr}}
  @media(max-width:520px){.catalogue-heading{align-items:flex-start;flex-direction:column}.filters{grid-template-columns:1fr}.command-row{grid-template-columns:minmax(0,1fr) 36px}.command-list button{grid-template-columns:minmax(0,1fr) auto}.command-summary{grid-column:1/-1;grid-row:2}.command-detail-heading,.command-detail{padding:15px}.command-pagination{grid-template-columns:1fr}.command-pagination>span{display:none}.command-pagination a.next{text-align:left}.recipes li{grid-template-columns:1fr}.recipes li strong,.recipes li span,.recipes li small{grid-column:1}}
</style>
