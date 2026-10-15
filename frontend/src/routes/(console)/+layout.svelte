<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext, tick } from 'svelte';
  import {
    consoleNavigationGroups,
    isNavigationItemActive,
    isProtectedDestination,
    referenceNavigation,
  } from '#lib/workspaces.ts';
  import { preloadBestEffort, preloadOnIdle } from '#lib/idle-preload.ts';
  import { CAPABILITY_CONTEXT, fetchCapabilities, type CapabilityReport } from '#lib/capabilities.ts';
  import { requestJsonCapped, SMALL_JSON_RESPONSE_BYTES } from '#lib/bounded-json-response.ts';
  import BrandMark from '#lib/components/BrandMark.svelte';
  import BrandWordmark from '#lib/components/BrandWordmark.svelte';
  import CommandPalette from '#lib/components/CommandPalette.svelte';
  import ConsoleLoading from '#lib/components/ConsoleLoading.svelte';
  import BrowserWorkspaceIndicator from '#lib/components/BrowserWorkspaceIndicator.svelte';
  import IntelligenceIcon from '#lib/components/IntelligenceIcon.svelte';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import ThemeSelector from '#lib/components/ThemeSelector.svelte';
  import { CONSOLE_PRESENTATION_CONTEXT, type ConsolePresentation, type ConsolePresentationContext } from '#lib/appearance.ts';
  import AnalystUndo from '#lib/components/AnalystUndo.svelte';
  import { keepFocusBelow } from '#lib/visible-focus.ts';
  import DeferredSurface from '#lib/components/DeferredSurface.svelte';
  import { reloadDeferredModulePage } from '#lib/deferred-module.ts';
  import { initializeBrowserLocalData, type BrowserLocalDataServiceState } from '#lib/browser-local-data-service.ts';
  import { clearConsoleWorkflowState, subscribeSelectedConsoleCase, clearConsoleReferenceView, readConsoleReferenceView, subscribeConsoleReferenceView } from '#lib/console-workflow-state.ts';
  import { hasUnlockedBrowserWorkspace, lockBrowserWorkspace } from '#lib/browser-workspace-unlock.ts';
  import { isLocalApplication } from '#lib/local-application-context.ts';
  import { hasUnprotectedCaseDrafts } from '#lib/controllers/case-draft-state.ts';
  let localApplication = $state(false);
  import {
    hasStoredInvestigationGuide,
    INVESTIGATION_GUIDE_EVENT,
  } from '#lib/investigation-guide-storage.ts';

  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'unavailable'|'ended'>('checking');
  let navOpen = $state(false);
  let commandOpen = $state(false);
  let commandKeyboardHints = $state(false);
  let signingOut = $state(false);
  let logoutError = $state('');
  let capabilities = $state<CapabilityReport|null>(null);
  let capabilitiesChecked = $state(false);
  let localData = $state<BrowserLocalDataServiceState>({ state: 'idle' });
  let storageErrorHeading = $state<HTMLHeadingElement>();
  let consoleHeader = $state<HTMLElement>();
  let navigationPanel = $state<HTMLElement>();
  let navigationToggle = $state<HTMLButtonElement>();
  let commandTrigger = $state<HTMLButtonElement>();
  let commandReturnFocus: HTMLElement | undefined;
  let investigationGuideRequested = $state(false);
  let revealInvestigationGuideOnMount = $state(false);
  let selectedCaseId = $state<string | null>(null);
  let referenceViewPresent = $state(false);
  let tabReferencesOpen = $state(false);
  let favouritesOpen = $state(false);
  let presentation = $state<ConsolePresentation>('desk');
  setContext<ConsolePresentationContext>(CONSOLE_PRESENTATION_CONTEXT, { get current() { return presentation; } });
  const showCaseContext = $derived(Boolean(selectedCaseId)
    && page.url.pathname !== '/cases'
    && !(page.url.pathname === '/monitor' && (page.url.searchParams.get('view') === 'cases' || page.url.searchParams.has('case'))));
  const wideWorkspace = $derived(['/lookup', '/bulk', '/cases', '/monitor', '/brands'].includes(page.url.pathname));
  const currentTask = $derived(consoleNavigationGroups.flatMap(group => group.items)
    .find(item => isNavigationItemActive(item, page.url))?.label ?? 'Console');
  setContext(CAPABILITY_CONTEXT, () => capabilities);
  beforeNavigate(({ to, willUnload, cancel }) => {
    // Leaving an unlocked console replaces the document, including cached
    // results and module state. Returning requires a fresh explicit unlock.
    if (hasUnlockedBrowserWorkspace() && to && !willUnload && !isProtectedDestination(to.url)) {
      cancel();
      window.location.assign(to.url.href);
    }
  });
  onMount(() => {
    localApplication = isLocalApplication();
    const cancelNavigationPreload = preloadOnIdle(() => preloadBestEffort(() => import('#lib/console-command-navigation.ts')));
    const unsubscribeCase = subscribeSelectedConsoleCase((id) => { selectedCaseId = id; });
    const refreshReferenceView = () => {
      const view = readConsoleReferenceView();
      referenceViewPresent = Boolean(view.checkpoints.length || view.visits.length);
    };
    const unsubscribeReferences = subscribeConsoleReferenceView(refreshReferenceView);
    refreshReferenceView();
    window.addEventListener('pagehide', clearConsoleReferenceView);
    void checkSession();
    if (hasStoredInvestigationGuide()) investigationGuideRequested = true;
    const showInvestigationGuide = () => {
      if (!investigationGuideRequested) revealInvestigationGuideOnMount = true;
      investigationGuideRequested = true;
    };
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, showInvestigationGuide);
    const mobileNavigation = window.matchMedia('(max-width: 900px)');
    const closeAtDesktopWidth = (event: MediaQueryListEvent) => {
      if (!event.matches) navOpen = false;
    };
    mobileNavigation.addEventListener('change', closeAtDesktopWidth);
    return () => {
      lockBrowserWorkspace();
      cancelNavigationPreload();
      unsubscribeCase();
      unsubscribeReferences();
      window.removeEventListener('pagehide', clearConsoleReferenceView);
      mobileNavigation.removeEventListener('change', closeAtDesktopWidth);
      window.removeEventListener(INVESTIGATION_GUIDE_EVENT, showInvestigationGuide);
    };
  });

  function signInTarget(){
    const destination = isProtectedDestination(page.url)
      ? `${page.url.pathname}${page.url.search}${page.url.hash}`
      : '/dashboard';
    return `/login?next=${encodeURIComponent(destination)}`;
  }

  async function loadCapabilityReport(){
    capabilitiesChecked=false;
    capabilities=await fetchCapabilities();
    capabilitiesChecked=true;
  }

  async function checkSession(){
    session='checking';
    try{
      const { response, body }=await requestJsonCapped('/api/session',{cache:'no-store'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      if(!response.ok)throw new Error();
      const record=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
      const authenticated=record.authenticated===true;
      if(!authenticated){
        clearConsoleWorkflowState();
        if (localApplication) { window.location.replace('/login'); return; }
        try{await goto(signInTarget(),{replace: true});}
        finally{clearConsoleWorkflowState();}
        return;
      }
      localData={state:'initializing'};
      const [storageState]=await Promise.all([initializeBrowserLocalData(),loadCapabilityReport()]);
      localData=storageState;
      session='authenticated';
    }catch{
      session='unavailable';
    }
  }

  async function retryLocalData(){
    localData={state:'initializing'};
    localData=await initializeBrowserLocalData();
  }

  async function createSavedViewStorage(){
    if (localData.state !== 'error' || localData.code !== 'LOCAL_DATA_MISSING') return;
    if (!window.confirm('Create empty saved Case view storage in this workspace? This does not recover lost views. If views were previously saved here, restore a verified backup instead. Existing records and files will not be replaced.')) return;
    localData={state:'initializing'};
    localData=await initializeBrowserLocalData({createMissingCollections:['case_views']});
    await tick();
    (localData.state === 'ready' ? document.querySelector<HTMLElement>('#main-content') : storageErrorHeading)?.focus();
  }

  async function logout(){
    if(signingOut)return;
    if(hasUnprotectedCaseDrafts()&&!window.confirm('Some Case edits are not saved. Sign out and lose those edits?'))return;
    signingOut=true;
    logoutError='';
    try{
      const {response}=await requestJsonCapped('/api/logout',{method:'POST'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      if(!response.ok)throw new Error('The protected session could not be ended.');
    }
    catch{
      logoutError='Sign out could not be confirmed. Check the session before continuing.';
      signingOut=false;
      return;
    }
    clearConsoleWorkflowState();
    lockBrowserWorkspace();
    session='ended';
    // Unmount drafts and their leave handlers before replacing the document.
    // A committed logout must never leave protected-looking controls usable.
    await tick();
    window.location.replace('/login');
  }

  function visibleFocusables(container: HTMLElement | undefined){
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]')]
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled')
        && !element.closest('[inert]') && element.getClientRects().length > 0);
  }

  function visibleShellFocusables(){
    return [consoleHeader,navigationPanel].flatMap(visibleFocusables);
  }

  async function openNavigation(){
    navOpen=true;
    await tick();
    visibleFocusables(navigationPanel)[0]?.focus();
  }

  async function closeNavigation(returnFocus=true){
    navOpen=false;
    await tick();
    if(returnFocus)navigationToggle?.focus();
  }

  async function openCommandPalette(){
    if(commandOpen)return;
    const focusedElement=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body
      ?document.activeElement
      :undefined;
    commandReturnFocus=navOpen?commandTrigger:(focusedElement??commandTrigger);
    if(navOpen)await closeNavigation(false);
    commandOpen=true;
  }

  async function closeCommandPalette(restoreFocus=true){
    const focusTarget=commandReturnFocus;
    commandReturnFocus=undefined;
    commandOpen=false;
    await tick();
    if(!restoreFocus)return;
    if(focusTarget?.isConnected&&!focusTarget.closest('[inert]'))focusTarget.focus();
    else commandTrigger?.focus();
  }

  function toggleNavigation(event:MouseEvent){
    event.preventDefault();
    event.stopPropagation();
    if(navOpen)void closeNavigation();
    else void openNavigation();
  }

  function handleKeydown(event:KeyboardEvent){
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
      event.preventDefault();
      if(event.repeat)return;
      if(commandOpen)void closeCommandPalette();
      else void openCommandPalette();
      return;
    }
    if(commandOpen)return;
    if(!navOpen)return;
    if(event.key==='Escape'){
      event.preventDefault();
      void closeNavigation();
      return;
    }
    if(event.key!=='Tab')return;
    const focusables=visibleShellFocusables();
    if(focusables.length===0){event.preventDefault();return;}
    const first=focusables[0];
    const last=focusables[focusables.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  function runtimeLabel(){return capabilities?.runtime==='netlify'?'Netlify':capabilities?.runtime==='express'?'Express':'Hosted';}
  function capabilityStatus(){return capabilitiesChecked?(capabilities?`Backend · ${runtimeLabel()}`:'Backend unavailable'):'Checking backend…';}
  function capabilityStatusDetail(){return capabilitiesChecked?(capabilities?`Network capabilities reported by the ${runtimeLabel()} runtime.`:'The backend capability report is unavailable.'):'Checking the backend capability report.';}
</script>

<svelte:head><meta name="robots" content="noindex, nofollow"></svelte:head>

<svelte:window onkeydown={handleKeydown}/>

{#if session==='checking'}
  <ConsoleLoading
    stage="session"
    title="Opening WHOISleuth"
    detail="Confirming the protected session before loading saved investigation data."
  />
{:else if session==='ended'}
  <div class="center"><section class="login card"><h1>Signed out</h1><p>Your protected session has ended.</p><a href="/login">Return to sign in</a></section></div>
{:else if session==='unavailable'}
  <div class="center"><section class="login card"><h1>Session service unavailable</h1><p class="muted">The protected console could not confirm your session.</p><button class="primary" onclick={checkSession}>Retry</button><p class="login-links"><a href="/">Return home</a></p></section></div>
{:else if localData.state==='initializing'||localData.state==='idle'}
  <ConsoleLoading
    stage="workspace"
    title="Preparing your workspace"
    detail="Opening saved collections and checking the available capabilities."
  />
{:else if localData.state==='error'}
  <div class="workspace-error">
    <section class="workspace-access card">
      {#if localData.code === 'LOCAL_DATA_WORKSPACE_LOCKED'}
        <DeferredSurface load={() => import('#lib/components/BrowserWorkspaceUnlock.svelte')} props={{onunlock:retryLocalData}} loadingLabel="Loading workspace unlock." unavailableLabel="Workspace unlock could not be loaded. Reload the page to retry." />
      {:else}
        <h1 tabindex="-1" bind:this={storageErrorHeading}>{localApplication ? 'Filesystem workspace unavailable' : 'Browser-local data unavailable'}</h1>
        <p class="muted">{localData.detail}</p>
        {#if localData.code === 'DEFERRED_MODULE_UNAVAILABLE'}
          <button class="primary" onclick={reloadDeferredModulePage}>Reload page</button>
        {:else}
          <button class="primary" onclick={retryLocalData}>Retry</button>
        {/if}
        {#if localData.code === 'LOCAL_DATA_MISSING'}
          <details class="storage-upgrade">
            <summary>Workspace created before saved Case views?</summary>
            <p>This adds only empty saved-view storage. All other collections must be readable, and no retained records or files may exist without their metadata. Previously saved views require backup recovery instead.</p>
            <button class="btn" type="button" onclick={createSavedViewStorage}>Create saved-view storage</button>
          </details>
        {/if}
      {/if}
      <p class="login-links"><a href="/privacy">Review storage and privacy details</a></p>
    </section>
  </div>
  <section class="workspace-recovery card"><DeferredSurface load={() => import('#lib/components/BrowserWorkspaceManager.svelte')} props={{}} loadingLabel="Reading workspace recovery options." unavailableLabel="Workspace recovery could not be loaded. Reload the page to retry." /></section>
{:else}
  <div class="shell" class:open={navOpen}>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="site-header" bind:this={consoleHeader} inert={commandOpen} aria-hidden={commandOpen?'true':undefined}>
      <a href="/dashboard" aria-label="WHOISleuth Dashboard"><span class="mark small"><BrandMark /></span><span class="console-brand-copy"><strong><BrandWordmark /></strong><small>Domain intelligence console</small></span></a>
      <div class="console-header-actions">
        <button class="command-trigger" type="button" aria-label="Search console navigation" bind:this={commandTrigger} onpointerenter={() => preloadBestEffort(() => import('#lib/console-command-navigation.ts'))} onfocus={() => preloadBestEffort(() => import('#lib/console-command-navigation.ts'))} onclick={()=>void openCommandPalette()}><span class="shortcut-wide" aria-hidden="true">Ctrl/⌘ K</span><span class="command-icon" aria-hidden="true"><IntelligenceIcon name="command" size={18} /></span><strong>Search</strong></button>
        <span class="sign-out-control">
          <button class="console-sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>
          {#if logoutError}<span class="sign-out-error" role="alert">{logoutError}</span>{/if}
        </span>
        <button class="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} aria-controls="console-navigation" bind:this={navigationToggle} onclick={toggleNavigation}>☰</button>
      </div>
    </header>
    <aside id="console-navigation" bind:this={navigationPanel} inert={commandOpen} aria-hidden={commandOpen?'true':undefined}>
      <div class="terminal-strip" aria-hidden="true"><span class="prompt-sigil">❯</span><span>guest@whoisleuth / console</span></div>
      <button class="navigation-drawer-close" type="button" aria-label="Close navigation" onclick={()=>void closeNavigation()}>×</button>
      <a class="brand" href="/dashboard"><span class="mark"><BrandMark /></span><span><strong><BrandWordmark /></strong><small>Domain intelligence console</small></span></a>
      <nav aria-label="Console">
        {#each consoleNavigationGroups as navigationGroup}
          <div class="console-nav-group" role="group" aria-labelledby={`console-group-${navigationGroup.label.toLowerCase().replaceAll(' ', '-').replace('&', 'and')}`}>
            <p class="eyebrow" id={`console-group-${navigationGroup.label.toLowerCase().replaceAll(' ', '-').replace('&', 'and')}`}>{navigationGroup.label}</p>
            {#each navigationGroup.items as item}<a class:active={isNavigationItemActive(item,page.url)} aria-current={isNavigationItemActive(item,page.url)?'page':undefined} href={item.href} title={item.detail} onclick={()=>navOpen=false}><IntelligenceIcon name={item.icon} size={18} /><strong>{item.label}</strong></a>{/each}
          </div>
        {/each}
      </nav>
      <details class="sidebar-favourites" bind:open={favouritesOpen}>
        <summary>Favourites in this tab</summary>
        {#if favouritesOpen}<DeferredSurface load={() => import('#lib/components/ConsoleFavourites.svelte')} props={{ onnavigate: () => navOpen = false }} loadingLabel="Opening tab favourites…" unavailableLabel="Favourites could not be displayed. Saved evidence has not changed." />{/if}
      </details>
      <nav class="reference-nav" aria-label="Reference"><p class="eyebrow">Reference</p>{#each referenceNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} title={item.detail} target={item.opensInNewTab?'_blank':undefined} rel={item.opensInNewTab?'noopener noreferrer':undefined} aria-label={item.opensInNewTab?`${item.label}. Opens in a new tab.`:undefined} onclick={()=>navOpen=false}><IntelligenceIcon name={item.icon} size={18} /><strong>{item.label}</strong></a>{/each}</nav>
      <div class="session"><ThemeSelector /></div>
    </aside>
    {#if navOpen}<button class="scrim" tabindex="-1" aria-hidden="true" onclick={()=>void closeNavigation()}></button>{/if}
    <main id="main-content" data-presentation={presentation} use:keepFocusBelow={() => consoleHeader} class:wide-workspace={wideWorkspace} tabindex="-1" inert={navOpen||commandOpen} aria-hidden={navOpen||commandOpen?'true':undefined}>
      <section class="console-context" aria-label="Current investigation context">
        <BrowserWorkspaceIndicator compact>
        {#snippet layout(identity, markerControls)}
        <div class="context-bar">
          <p class="context-task" role="note" aria-label="Current task"><span>Task</span><strong>{currentTask}</strong></p>
          <span class="context-backend" role="note" title={capabilityStatusDetail()} aria-label={capabilityStatusDetail()}>{capabilityStatus()}</span>
          {@render identity()}
        </div>
        <div class="context-details">
          <details class="context-storage">
            <summary>{localApplication ? 'Filesystem storage · plaintext' : 'Browser-local storage'}</summary>
            {@render markerControls()}
            <p>{localApplication ? 'Saved records and original files remain in the selected filesystem workspace. Encrypted backups are separate.' : 'Saved records remain in this browser’s selected workspace. Opening another workspace replaces this page; other tabs keep their own selection.'}</p>
            <p>{capabilityStatusDetail()} This is the reported configuration, not a live source-health check.</p>
          </details>
          <details class="context-storage presentation-options">
            <summary>Presentation</summary>
            <label class="presentation-choice">Presentation in this tab
              <select bind:value={presentation} onchange={event => { if (event.currentTarget.value === 'bench') tabReferencesOpen = true; }}>
                <option value="desk">Analyst Desk</option>
                <option value="bench">Evidence Bench</option>
                <option value="journal">Field Journal</option>
              </select>
            </label>
          </details>
        </div>
        {/snippet}
        </BrowserWorkspaceIndicator>
        {#if showCaseContext && selectedCaseId}<DeferredSurface load={() => import('#lib/components/SelectedCaseContext.svelte')} props={{caseId:selectedCaseId,compact:true}} loadingLabel="Reading selected Case…" unavailableLabel="Selected Case context could not be loaded." />{/if}
      </section>
      <div class="presentation-workspace" class:references-open={tabReferencesOpen}>
        <aside class="tab-references" aria-label="Tab reference bench">
          <details class="context-storage" bind:open={tabReferencesOpen}>
            <summary>Tab references</summary>
            {#if tabReferencesOpen}
              {#if referenceViewPresent}
                <DeferredSurface load={() => import('#lib/components/ConsoleReferenceView.svelte')} props={{}} loadingLabel="Opening tab reference view…" unavailableLabel="Tab references could not be displayed. Saved evidence has not changed." />
              {:else}<p>No checkpoints or Case visits are retained in this tab. Use <strong>Pin checkpoint</strong> in a Case evidence timeline to keep an exact reference alongside your work.</p>{/if}
            {/if}
          </details>
        </aside>
        <div class="investigation-content">
          {#if investigationGuideRequested}<DeferredSurface load={() => import('#lib/components/InvestigationGuide.svelte')} props={{revealOnMount:revealInvestigationGuideOnMount}} loadingLabel="Loading the investigation guide." unavailableLabel="The investigation guide could not be loaded." placeholder="workspace" />{/if}
          {@render children()}
        </div>
      </div>
      <SiteFooter console />
    </main>
    <div inert={navOpen||commandOpen}><AnalystUndo /></div>
    {#if commandOpen}
      <CommandPalette onclose={closeCommandPalette} bind:keyboardHints={commandKeyboardHints} />
    {/if}
  </div>
{/if}

<style>
  .presentation-choice{display:grid;gap:4px;width:min(100%,24rem);margin-block:4px 12px;font-size:var(--text-xs);color:var(--muted)}
  .presentation-choice select{min-height:44px;width:100%;min-width:0}
  .presentation-workspace{display:grid;gap:16px;min-width:0}
  .investigation-content,.tab-references{min-width:0}
  .tab-references:has(details[open]){padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  @media(min-width:1600px){
    main[data-presentation='bench'].wide-workspace{width:100%}
    [data-presentation='bench'] .presentation-workspace.references-open{grid-template-columns:minmax(0,1fr) minmax(20rem,28rem);align-items:start}
    [data-presentation='bench'] .presentation-workspace.references-open>.investigation-content{grid-column:1;grid-row:1}
    [data-presentation='bench'] .presentation-workspace.references-open>.tab-references{grid-column:2;grid-row:1}
  }
  @media print{.presentation-options,.tab-references{display:none!important}.presentation-workspace{display:block!important}}
  .console-context{min-width:0;margin-bottom:18px;padding-bottom:8px;border-bottom:1px solid var(--border)}
  .context-bar{display:flex;align-items:center;gap:8px 20px;flex-wrap:wrap;min-width:0}
  .context-task{display:flex;align-items:baseline;gap:8px;margin:0;font-size:var(--text-xs)}
  .context-task>span{color:var(--muted)}
  .context-backend{max-width:100%;font:600 var(--text-xs) var(--mono);color:var(--muted);white-space:nowrap;text-overflow:clip}
  .context-storage{margin-top:4px;font-size:var(--text-xs);color:var(--muted)}
  .context-details{display:flex;flex-wrap:wrap;gap:0 16px;align-items:start;min-width:0}
  .context-details>details{min-width:0;max-width:100%;flex:0 1 auto}
  .context-details>details[open]{flex:1 1 100%}
  .context-storage>summary{min-height:44px;display:list-item;align-content:center;cursor:pointer;width:fit-content;max-width:100%;padding-block:8px}
  .context-storage>p{max-width:85ch;line-height:1.6;margin:6px 0 12px}
  .workspace-recovery{width:min(760px,calc(100% - 32px));margin:20px auto;padding:20px}
  .workspace-error{display:flex;justify-content:center;margin:40px 16px 20px}.workspace-access{width:min(480px,100%);padding:clamp(20px,4vw,34px);min-width:0;overflow-wrap:anywhere}
  .storage-upgrade{margin-top:16px}.storage-upgrade>summary{min-height:44px;cursor:pointer}.storage-upgrade button{min-height:44px;max-width:100%;padding:8px 13px;white-space:normal}
  .login-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .login-links a{color:var(--accent)}
  .reference-nav{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
  .sidebar-favourites{margin-top:18px;min-width:0}.sidebar-favourites>summary{min-height:44px;align-content:center;cursor:pointer;overflow-wrap:anywhere;font-size:var(--text-xs)}
  .sign-out-control{position:relative;display:inline-flex}
  .sign-out-error{position:absolute;z-index:20;top:calc(100% + 8px);right:0;width:min(300px,calc(100vw - 32px));padding:9px 11px;border:1px solid var(--danger);border-radius:var(--radius-sm);background:var(--panel);box-shadow:0 8px 24px rgb(var(--shadow-rgb) / .28);color:var(--danger);font-size:var(--text-2xs);line-height:1.4}
  .console-nav-group+.console-nav-group{margin-top:14px;padding-top:0}
  .command-trigger{display:flex;min-height:34px;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .command-trigger:hover,.command-trigger:focus-visible{border-color:var(--accent);color:var(--accent);background:rgb(var(--accent-rgb) / .07)}
  .command-trigger span{padding:2px 4px;border:1px solid var(--border);border-radius:4px;color:var(--text);font:inherit}
  .command-trigger .command-icon{display:none;padding:0;border:0;color:currentColor}
  .command-trigger strong{font:inherit}
  @media(max-width:900px){.command-trigger{width:36px;padding:0;justify-content:center}.command-trigger span{padding:0;border:0}.command-trigger .shortcut-wide,.command-trigger strong{display:none}.command-trigger .command-icon{display:grid;place-items:center}}
</style>
