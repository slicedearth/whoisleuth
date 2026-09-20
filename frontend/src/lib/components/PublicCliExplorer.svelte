<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import CopyableCommand from '$lib/components/CopyableCommand.svelte';
  import { PUBLIC_CLI_INDEX } from '$lib/generated/public-cli-index';
  import { preloadOnIdle } from '$lib/idle-preload';
  import { handlesLocalLink } from '$lib/link-activation';
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
  let clientReady = $state(false);
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

  function currentSelection(request: number): boolean {
    return active && request === loadGeneration;
  }

  function clearCommandSelection(): number {
    loadGeneration += 1;
    expandedId = '';
    loadingId = '';
    return loadGeneration;
  }

  async function openCommand(id: string, request: number) {
    if (expandedId === id || loadError) return;
    loadError = '';
    loadingId = id;
    try {
      await ensureCatalogue();
      if (!currentSelection(request)) return;
      expandedId = id;
    } catch {
      if (!currentSelection(request)) return;
      loadError = 'Command details are unavailable.';
    } finally {
      if (currentSelection(request)) loadingId = '';
    }
  }

  async function revealCommand(id: string): Promise<void> {
    const request = ++loadGeneration;
    if (!filtered.some((command) => command.id === id)) {
      resetFilters();
      await tick();
    }
    if (!currentSelection(request)) return;
    await openCommand(id, request);
    if (!currentSelection(request) || expandedId !== id) return;
    await tick();
    requestAnimationFrame(() => {
      if (!currentSelection(request)) return;
      const target = document.getElementById(`command-${id}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
      requestAnimationFrame(() => {
        if (!currentSelection(request) || !target?.isConnected) return;
        const filterBottom = document.querySelector('.filters')?.getBoundingClientRect().bottom ?? 0;
        const targetTop = target.getBoundingClientRect().top;
        if (targetTop < filterBottom + 12) window.scrollBy(0, targetTop - filterBottom - 12);
      });
    });
  }

  function navigateToCommand(event: MouseEvent, id: string): void {
    if (event.currentTarget instanceof HTMLAnchorElement && !handlesLocalLink(event)) return;
    event.preventDefault();
    pushState(`#command-${id}`, page.state);
    void revealCommand(id);
  }

  function selectCommand(event: Event): void {
    const id = (event.currentTarget as HTMLSelectElement).value;
    if (!id) return;
    pushState(`#command-${id}`, page.state);
    void revealCommand(id);
  }

  async function returnToResults(event: MouseEvent): Promise<void> {
    if (!handlesLocalLink(event)) return;
    event.preventDefault();
    const returnId = expandedId;
    pushState('#commands', page.state);
    const request = clearCommandSelection();
    await tick();
    requestAnimationFrame(() => {
      if (!currentSelection(request)) return;
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
      else clearCommandSelection();
    }

    readFiltersFromLocation();
    urlSyncReady = true;
    openHashCommand();
    addEventListener('hashchange', openHashCommand);
    addEventListener('popstate', readFiltersFromLocation);
    const cancelPreload = preloadOnIdle(preloadCatalogue);
    clientReady = true;
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

<section
  class="catalogue"
  class:reading-command={Boolean(expandedId)}
  aria-labelledby={expandedId ? 'selected-command-title' : 'cli-catalogue-title'}
  data-testid="public-cli-catalogue"
  data-client-ready={clientReady ? 'true' : 'false'}
>
  <div class="catalogue-heading" hidden={Boolean(expandedId)}>
    <div><p class="eyebrow">Command reference</p><h2 id="cli-catalogue-title">All commands</h2><p>Find a command by name or task, then open its usage, options and examples.</p></div>
  </div>

  <form class="filters" hidden={Boolean(expandedId)} onsubmit={(event) => event.preventDefault()} aria-label="Filter CLI commands">
    <label class="search"><span>Search commands</span><input type="search" bind:value={query} placeholder="Command or purpose" autocomplete="off"></label>
    <label><span>Group</span><select bind:value={group}><option value="all">All groups</option>{#each PUBLIC_CLI_INDEX.groups as item}<option value={item}>{labelToken(item)}</option>{/each}</select></label>
    <label><span>Mode</span><select bind:value={mode}><option value="all">All modes</option>{#each PUBLIC_CLI_INDEX.modes as item}<option value={item}>{labelToken(item)}</option>{/each}</select></label>
    <label class="check"><input type="checkbox" bind:checked={commonOnly}><span>Common commands only</span></label>
  </form>
  <p class="filter-status" hidden={Boolean(expandedId)} role="status" aria-live="polite">Showing {filtered.length} of {PUBLIC_CLI_INDEX.commandCount} commands.</p>
  {#if loadError}<div class="load-error" role="alert"><p>{loadError}</p><small>{DEFERRED_MODULE_RECOVERY_DETAIL}</small><button type="button" onclick={reloadDeferredModulePage}>Reload page</button></div>{/if}

  {#if expandedId && detailFor(expandedId)}
    {@const command = PUBLIC_CLI_INDEX.commands.find((item) => item.id === expandedId)!}
    {@const detail = detailFor(expandedId)!}
    {@const related = relatedCommands(expandedId)}
    {@const previousCommand = adjacentCommand(-1)}
    {@const nextCommand = adjacentCommand(1)}
    <article class="command-workspace" id={`command-${command.id}`} data-command-detail={command.id} tabindex="-1">
      <header class="command-detail-heading">
        <nav class="command-detail-navigation" aria-label="Command reference navigation">
          <a class="back-to-results" href="#commands" onclick={returnToResults}>Back to {filtered.length} filtered command{filtered.length === 1 ? '' : 's'}</a>
          <a href={`#command-${command.id}`} aria-label={`Direct link to ${command.id} command`} onclick={(event) => navigateToCommand(event, command.id)}>Direct link</a>
        </nav>
        <label class="command-jump"><span>Jump to command</span><select value={command.id} onchange={selectCommand}>{#each PUBLIC_CLI_INDEX.commands as item}<option value={item.id}>{item.id}</option>{/each}</select></label>
        <p>{labelToken(command.group)} · {labelToken(command.mode)}{command.common ? ' · Common' : ''}</p>
        <h2 id="selected-command-title"><code>{command.id}</code></h2>
        <p class="command-purpose">{command.summary}</p>
      </header>
      <div class="command-detail" id={`command-detail-${command.id}`}>
        <p class="command-description">{detail.description}</p>
        <div class="command-examples">
          <section><h3>Usage</h3><CopyableCommand command={detail.usage} label={`${command.id} usage`} compact /></section>
          <section><h3>Example</h3><CopyableCommand command={detail.example} label={`${command.id} example`} compact /></section>
        </div>
        <dl class="command-facts">
          <div><dt>Network behaviour</dt><dd><strong>{labelToken(detail.networkEffect)} · {labelToken(detail.capability.networkMode)}</strong>{detail.collection.scope}</dd></div>
          <div><dt>Authorisation</dt><dd>{labelToken(detail.capability.authorisation)}{detail.explicitAuthorisationRequired ? ' · dedicated acknowledgement required' : ''}</dd></div>
          <div><dt>Produced artefact</dt><dd>{detail.primaryEvidenceArtefacts.length ? detail.primaryEvidenceArtefacts.join(', ') : 'No evidence artefact is declared.'}</dd></div>
          <div><dt>Presentation options</dt><dd>{#if detail.presentationOptions.length}<ul>{#each detail.presentationOptions as format}<li><code>{format.option}</code> · {format.format}</li>{/each}</ul>{:else}No alternate presentation flag; the command writes its native output.{/if}</dd></div>
          <div><dt>Output destination</dt><dd>{#if detail.fileOutput}<code>--output &lt;file&gt;</code> writes a local file atomically. Replacing a file requires <code>--force</code>. The command instructions state when file output is required.{:else}No common <code>--output</code> option. See usage for command-specific files.{/if}</dd></div>
          <div><dt>Exit behaviour</dt><dd>{exitBehaviour(detail)}</dd></div>
        </dl>
        <div class="command-inputs">
          <section>
            <h3>Inputs</h3>
            {#if detail.inputs.length}
              <dl>{#each detail.inputs as input}<div><dt><code>{input.name}</code></dt><dd>{inputCardinality(input)} {labelToken(input.valueKind)}{input.inputSource === 'argv_or_stdin' ? ' · argument or standard input' : ''}{input.values.length ? ` · ${input.values.join(', ')}` : ''}</dd></div>{/each}</dl>
            {:else}<p>No positional input.</p>{/if}
          </section>
          <section>
            <h3>Command options</h3>
            {#if detail.importantOptions.length}<ul class="option-list">{#each detail.importantOptions as option}<li><code>{option}</code></li>{/each}</ul>{:else}<p>No command-specific options.</p>{/if}
            <p>Run <code>whoisleuth {command.id} --help</code> for option descriptions and common file or presentation controls.</p>
          </section>
        </div>
        {#if related.length}
          <nav class="related-commands" aria-label={`Commands related to ${command.id}`}><strong>Related commands</strong><div>{#each related as item}<a href={`#command-${item.id}`} onclick={(event) => navigateToCommand(event, item.id)}><code>{item.id}</code><span>{item.summary}</span></a>{/each}</div></nav>
        {/if}
        <section class="boundary" aria-label="Operational boundary">
          <h3>Operational boundary</h3>
          <p>{detail.boundary}</p>
        </section>
        <details class="contract-details compact-disclosure">
          <summary>Limits and contracts</summary>
          <dl>
            <div><dt>Input limits</dt><dd><ul>{#each detail.inputLimits as item}<li>{item}</li>{/each}</ul></dd></div>
            <div><dt>Output limits</dt><dd><ul>{#each detail.outputLimits as item}<li>{item}</li>{/each}</ul></dd></div>
            <div><dt>Policies</dt><dd>Plan: {detail.planSupport ? 'supported' : 'not declared'} · Failure policy: {detail.failurePolicySupport ? 'supported' : 'not declared'}</dd></div>
            <div><dt>Evidence completeness</dt><dd>{#if detail.capability.documentStates.length}Document states: {detail.capability.documentStates.join(', ')}. {/if}Exit 0 reports command completion; source states and limitations describe the evidence.</dd></div>
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
              aria-label={`View ${command.id} command`}
              aria-describedby={`command-summary-${command.id}`}
              aria-busy={loadingId === command.id}
              disabled={Boolean(loadError)}
              onfocus={preloadCatalogue}
              onpointerenter={preloadCatalogue}
              onclick={(event) => navigateToCommand(event, command.id)}
            >
              <span class="command-copy">
                <span class="command-identity"><code>{command.id}</code><small>{labelToken(command.group)} · {labelToken(command.mode)}{command.common ? ' · Common' : ''}</small></span>
                <span class="command-summary" id={`command-summary-${command.id}`}>{command.summary}</span>
              </span>
              <span class="command-action" aria-hidden="true">{loadingId === command.id ? 'Loading…' : 'View command'}</span>
            </button>
          </div>
        </article>
      {:else}
        <div class="empty" role="status"><p>No commands match all selected filters.</p><button type="button" onclick={resetFilters}>Clear filters</button></div>
      {/each}
    </div>
  {/if}

  {#if !expandedId}<section class="recipes" aria-labelledby="command-recipes-title">
    <div><p class="eyebrow">Command recipes</p><h3 id="command-recipes-title">Multi-step tasks</h3><p>Inspect a fixed sequence offline, then select its inputs and deliberately approve network collection and human-review declarations.</p></div>
    <div class="recipe-groups">
      <section aria-labelledby="runnable-recipes-title"><header><h4 id="runnable-recipes-title">Runnable workflows</h4><span>{runnableWorkflows.length}</span></header><p>Inspect with <code>workflow-plan --explain &lt;recipe&gt;</code>, then run deliberately with <code>workflow-run</code>.</p><ul>{#each runnableWorkflows as recipe}<li><code>{recipe.id}</code><strong>{recipe.label}</strong><span>{recipe.objective}</span><small>Runnable · {labelToken(recipe.subjectRequirement)}</small></li>{/each}</ul></section>
      {#if planningWorkflows.length}<section aria-labelledby="planning-recipes-title"><header><h4 id="planning-recipes-title">Planning templates</h4><span>{planningWorkflows.length}</span></header><p>These sequences require manual execution.</p><ul>{#each planningWorkflows as recipe}<li><code>{recipe.id}</code><strong>{recipe.label}</strong><span>{recipe.objective}</span><small>Plan only · {labelToken(recipe.subjectRequirement)}</small></li>{/each}</ul></section>{/if}
    </div>
  </section>{/if}
</section>

<style>
  .command-description{margin:0 0 20px;max-width:75ch;font-size:var(--text-sm);line-height:1.65;overflow-wrap:anywhere}
  .catalogue-heading>div{max-width:720px}.catalogue-heading h2,.recipes h3{margin:.3rem 0 .55rem;font:700 clamp(1.45rem,3vw,2rem) var(--mono);letter-spacing:-.04em}.catalogue-heading p:not(.eyebrow),.recipes p{margin:0;color:var(--muted);line-height:1.6}
  .filters{display:grid;position:sticky;z-index:6;top:8px;grid-template-columns:minmax(200px,1fr) 145px 130px auto;gap:8px;align-items:end;margin-top:22px;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.filters label{display:grid;gap:6px;min-width:0}.filters label>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.filters input[type='search'],.filters select{width:100%;min-width:0;padding:9px 10px}.filters .check{display:flex;min-height:40px;align-items:center;gap:8px;padding:0 5px}.filters .check input{width:18px;height:18px;margin:0}.filters .check span{color:var(--text)}
  .filter-status{margin:10px 0;color:var(--muted);font-size:var(--text-2xs)}.load-error{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-left:2px dotted var(--muted);background:var(--panel-raised);color:var(--muted);font-size:var(--text-xs)}.load-error p,.load-error small{margin:0;overflow-wrap:anywhere}.load-error p{color:var(--danger)}.load-error small{flex:1}.load-error button{flex:0 0 auto}
  [hidden] { display: none; }
  .command-jump { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 28px; }
  .command-jump span { color: var(--muted); font-size: var(--text-xs); }
  .command-jump select { width: min(100%, 320px); min-height: 44px; padding: 8px 10px; }
  .command-list { border-block: 1px solid var(--border); }
  .command-list article { min-width: 0; }
  .command-list article + article { border-top: 1px solid var(--border); }
  .command-open {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 20px;
    align-items: center;
    padding: 18px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
  }
  .command-open:hover, .command-open:focus-visible { background: var(--control-hover); }
  .command-copy { display: grid; min-width: 0; gap: 7px; }
  .command-identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px 16px; min-width: 0; }
  .command-identity code { color: var(--accent); font: 750 var(--text-sm) var(--mono); overflow-wrap: anywhere; }
  .command-identity small { color: var(--muted); font: 550 var(--text-2xs) var(--mono); }
  .command-summary { color: var(--muted); font: 400 var(--text-sm)/1.5 var(--font-sans); overflow-wrap: anywhere; }
  .command-action { color: var(--accent); font: 650 var(--text-xs) var(--mono); white-space: nowrap; }
  .command-workspace { min-width: 0; scroll-margin-top: var(--reference-anchor-offset, 24px); outline: none; }
  .command-workspace:focus-visible { outline: 2px solid var(--focus); outline-offset: 6px; }
  .command-detail-heading { padding: 0 0 24px; border-bottom: 1px solid var(--border); }
  .command-detail-navigation { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 20px; margin-bottom: 22px; }
  .command-detail-navigation a { display: inline-flex; align-items: center; min-height: 40px; padding-block: 6px; color: var(--accent); font: 650 var(--text-xs) var(--mono); }
  .command-detail-heading>p { margin: 0; color: var(--muted); font: 650 var(--text-2xs) var(--mono); }
  .command-detail-heading h2 { margin: 8px 0 10px; font: 750 clamp(1.55rem,4vw,2.25rem) var(--mono); letter-spacing: -.04em; overflow-wrap: anywhere; }
  .command-detail-heading h2 code { color: var(--accent); }
  .command-detail-heading .command-purpose { max-width: 75ch; color: var(--text); font: 400 var(--text-sm)/1.6 var(--font-sans); }
  .command-detail { padding-block: 24px; }
  .command-examples h3, .command-inputs h3, .boundary h3, .related-commands>strong {
    color: var(--text);
    font: 700 var(--text-md)/1.4 var(--font-sans);
  }
  .command-examples { display: grid; gap: 18px; }
  .command-examples section { display: grid; gap: 8px; min-width: 0; }
  .command-examples h3 { margin: 0; }
  .command-facts, .contract-details dl { display: grid; margin: 28px 0 0; padding: 0; }
  .command-facts>div, .contract-details dl>div {
    display: grid;
    grid-template-columns: minmax(130px, .3fr) minmax(0, 1fr);
    gap: 10px 24px;
    min-width: 0;
    padding-block: 16px;
    border-top: 1px solid var(--border);
  }
  dt { color: var(--interface-accent); font: 700 var(--text-xs)/1.55 var(--mono); }
  dd { min-width: 0; margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.55; overflow-wrap: anywhere; }
  .command-facts dd>strong { display: block; margin-bottom: 4px; color: var(--text); font: 700 var(--text-xs) var(--mono); }
  dd ul { margin: 6px 0 0; padding-left: 18px; }
  .command-inputs { display: grid; gap: 12px; margin-top: 12px; }
  .command-inputs>section { min-width: 0; padding-block: 20px; border-top: 1px solid var(--border); }
  .command-inputs h3 { margin: 0 0 12px; }
  .command-inputs dl { display: grid; gap: 10px; margin: 0; }
  .command-inputs dl>div { display: grid; grid-template-columns: minmax(90px,.35fr) minmax(0,.65fr); gap: 8px; }
  .command-inputs dd, .command-inputs p { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.55; }
  .command-inputs>section>p:last-child { margin-top: 12px; }
  .option-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .option-list li { font-size: var(--text-sm); overflow-wrap: anywhere; }
  .related-commands { display: grid; gap: 12px; margin-top: 12px; padding-block: 20px; border-top: 1px solid var(--border); }
  .related-commands>div { display: flex; flex-wrap: wrap; gap: 8px; }
  .related-commands a { display: grid; gap: 4px; min-width: 145px; flex: 1 1 180px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .related-commands a:hover, .related-commands a:focus-visible { border-color: var(--accent); background: var(--control-hover); }
  .related-commands a code { color: var(--accent); font-size: var(--text-xs); }
  .related-commands a span { color: var(--muted); font-size: var(--text-xs); line-height: 1.5; }
  .boundary, .contract-details { margin-top: 12px; border: 0; border-block: 1px solid var(--border); border-radius: 0; background: transparent; }
  .boundary h3 { margin: 20px 0 12px; }
  .contract-details summary { min-height: 48px; padding: 12px 4px; font: 700 var(--text-xs) var(--mono); }
  .contract-details summary:hover { background: var(--control-hover); }
  .boundary p { margin: 0; padding: 0 0 20px; color: var(--muted); font-size: var(--text-sm); line-height: 1.65; }
  .contract-details dl { margin: 0; padding: 0 4px; }
  .command-pagination { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-top: 12px; }
  .command-pagination a { display: grid; gap: 5px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .command-pagination a:hover, .command-pagination a:focus-visible { background: var(--control-hover); }
  .command-pagination a.next { text-align: right; }
  .command-pagination span { color: var(--muted); font: 650 var(--text-2xs) var(--mono); }
  .command-pagination strong { color: var(--accent); font: 700 var(--text-xs) var(--mono); overflow-wrap: anywhere; }
  .empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px; color: var(--muted); }
  .empty p { margin: 0; }
  .empty button { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel); font: 700 var(--text-xs) var(--mono); }
  .recipes{display:grid;grid-template-columns:minmax(210px,.45fr) minmax(0,1.55fr);gap:24px;margin-top:40px;padding-top:32px;border-top:1px solid var(--border)}.recipe-groups{display:grid;gap:10px}.recipe-groups>section{display:grid;gap:9px;padding:16px 0;border-top:1px solid var(--border)}.recipe-groups header{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.recipe-groups h4{margin:0;font:700 var(--text-sm) var(--mono)}.recipe-groups header span{color:var(--interface-accent);font:700 var(--text-xs) var(--mono)}.recipe-groups>section>p{font-size:var(--text-xs)}.recipes ul{display:grid;gap:6px;margin:0;padding:0;list-style:none}.recipes li{display:grid;grid-template-columns:minmax(135px,.35fr) minmax(0,.65fr);gap:4px 11px;padding:12px 0;border-top:1px solid var(--border)}.recipes li code{color:var(--accent);font-size:var(--text-xs)}.recipes li strong{font:700 var(--text-xs) var(--mono)}.recipes li span,.recipes li small{grid-column:1/-1;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.recipes li small{color:var(--interface-accent);text-transform:uppercase}
  @media(max-width:560px){.load-error{align-items:stretch;flex-direction:column}.load-error button{width:100%}}
  @media(max-width:800px){.filters{position:static;grid-template-columns:repeat(2,minmax(0,1fr));box-shadow:none;backdrop-filter:none}.recipes{grid-template-columns:1fr}.command-facts,.contract-details dl,.command-inputs{grid-template-columns:1fr}}
  @media(max-width:520px){.filters{grid-template-columns:1fr}.command-open{grid-template-columns:minmax(0,1fr);gap:10px;padding:16px 8px}.command-facts>div,.contract-details dl>div{grid-template-columns:1fr;gap:6px}.command-pagination{grid-template-columns:1fr}.command-pagination>span{display:none}.command-pagination a.next{text-align:left}.recipes li{grid-template-columns:1fr}.recipes li strong,.recipes li span,.recipes li small{grid-column:1}}
</style>
