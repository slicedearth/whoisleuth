<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext, tick } from 'svelte';
  import {
    consoleNavigationGroups,
    isNavigationItemActive,
    isProtectedDestination,
    referenceNavigation,
  } from '$lib/workspaces';
  import { preloadBestEffort, preloadOnIdle } from '$lib/idle-preload';
  import { CAPABILITY_CONTEXT, fetchCapabilities, type CapabilityReport } from '$lib/capabilities';
  import { requestJsonCapped, SMALL_JSON_RESPONSE_BYTES } from '$lib/bounded-json-response';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import ConsoleLoading from '$lib/components/ConsoleLoading.svelte';
  import BrowserWorkspaceIndicator from '$lib/components/BrowserWorkspaceIndicator.svelte';
  import IntelligenceIcon from '$lib/components/IntelligenceIcon.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';
  import AnalystUndo from '$lib/components/AnalystUndo.svelte';
  import DeferredSurface from '$lib/components/DeferredSurface.svelte';
  import { reloadDeferredModulePage } from '$lib/deferred-module';
  import { initializeBrowserLocalData, type BrowserLocalDataServiceState } from '$lib/browser-local-data-service';
  import { clearConsoleWorkflowState, subscribeSelectedConsoleCase } from '$lib/console-workflow-state';
  import { hasUnlockedBrowserWorkspace, lockBrowserWorkspace } from '$lib/browser-workspace-unlock';
  import {
    hasStoredInvestigationGuide,
    INVESTIGATION_GUIDE_EVENT,
  } from '$lib/investigation-guide-storage';

  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'unavailable'>('checking');
  let navOpen = $state(false);
  let commandOpen = $state(false);
  let signingOut = $state(false);
  let logoutError = $state('');
  let capabilities = $state<CapabilityReport|null>(null);
  let capabilitiesChecked = $state(false);
  let localData = $state<BrowserLocalDataServiceState>({ state: 'idle' });
  let consoleHeader = $state<HTMLElement>();
  let navigationPanel = $state<HTMLElement>();
  let navigationToggle = $state<HTMLButtonElement>();
  let commandTrigger = $state<HTMLButtonElement>();
  let commandReturnFocus: HTMLElement | undefined;
  let investigationGuideRequested = $state(false);
  let revealInvestigationGuideOnMount = $state(false);
  let selectedCaseId = $state<string | null>(null);
  const showCaseContext = $derived(Boolean(selectedCaseId)
    && page.url.pathname !== '/cases'
    && !(page.url.pathname === '/monitor' && (page.url.searchParams.get('view') === 'cases' || page.url.searchParams.has('case'))));
  const wideWorkspace = $derived(['/lookup', '/bulk', '/cases', '/monitor', '/brands'].includes(page.url.pathname));
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
    const cancelNavigationPreload = preloadOnIdle(() => preloadBestEffort(() => import('$lib/console-command-navigation')));
    const unsubscribeCase = subscribeSelectedConsoleCase((id) => { selectedCaseId = id; });
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
        try{await goto(signInTarget(),{replaceState:true});}
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

  async function logout(){
    if(signingOut)return;
    signingOut=true;
    logoutError='';
    try{
      const {response}=await requestJsonCapped('/api/logout',{method:'POST'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      if(!response.ok)throw new Error('The protected session could not be ended.');
      clearConsoleWorkflowState();
      try{await goto('/login',{replaceState:true});}
      finally{clearConsoleWorkflowState();}
    }
    catch{
      clearConsoleWorkflowState();
      logoutError='Sign out failed. Your session remains active; try again.';
    }
    finally{signingOut=false;}
  }

  function navigationFocusables(){
    if (!navigationPanel) return [];
    return [...navigationPanel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
  }

  function visibleShellFocusables(){
    if(!consoleHeader||!navigationPanel)return [];
    const selector='a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return [
      ...consoleHeader.querySelectorAll<HTMLElement>(selector),
      ...navigationPanel.querySelectorAll<HTMLElement>(selector),
    ].filter((element)=>element.getClientRects().length>0);
  }

  async function openNavigation(){
    navOpen=true;
    await tick();
    navigationFocusables()[0]?.focus();
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
  function capabilityStatusDetail(){return capabilitiesChecked?(capabilities?`Hosted network capabilities reported by the ${runtimeLabel()} runtime.`:'The backend capability report is unavailable.'):'Checking the backend capability report.';}
</script>

<svelte:head><meta name="robots" content="noindex, nofollow"></svelte:head>

<svelte:window onkeydown={handleKeydown}/>

{#if session==='checking'}
  <ConsoleLoading
    stage="session"
    title="Opening WHOISleuth"
    detail="Confirming the protected session before loading any browser-local investigation data."
  />
{:else if session==='unavailable'}
  <div class="center"><section class="login card"><h1>Session service unavailable</h1><p class="muted">The protected console could not confirm your session.</p><button class="primary" onclick={checkSession}>Retry</button><p class="login-links"><a href="/">Return home</a></p></section></div>
{:else if localData.state==='initializing'||localData.state==='idle'}
  <ConsoleLoading
    stage="workspace"
    title="Preparing your workspace"
    detail="Opening bounded browser-local collections and checking the capabilities available to this deployment."
  />
{:else if localData.state==='error'}
  <div class="workspace-error">
    <section class="workspace-access card">
      {#if localData.code === 'LOCAL_DATA_WORKSPACE_LOCKED'}
        <DeferredSurface load={() => import('$lib/components/BrowserWorkspaceUnlock.svelte')} props={{onunlock:retryLocalData}} loadingLabel="Loading workspace unlock." unavailableLabel="Workspace unlock could not be loaded. Reload the page to retry." />
      {:else}
        <h1>Browser-local data unavailable</h1>
        <p class="muted">{localData.detail}</p>
        {#if localData.code === 'DEFERRED_MODULE_UNAVAILABLE'}
          <button class="primary" onclick={reloadDeferredModulePage}>Reload page</button>
        {:else}
          <button class="primary" onclick={retryLocalData}>Retry</button>
        {/if}
      {/if}
      <p class="login-links"><a href="/privacy">Review storage and privacy details</a></p>
    </section>
  </div>
  <section class="workspace-recovery card"><DeferredSurface load={() => import('$lib/components/BrowserWorkspaceManager.svelte')} props={{}} loadingLabel="Reading workspace recovery options." unavailableLabel="Workspace recovery could not be loaded. Reload the page to retry." /></section>
{:else}
  <div class="shell" class:open={navOpen}>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header bind:this={consoleHeader} inert={commandOpen} aria-hidden={commandOpen?'true':undefined}>
      <a href="/dashboard" aria-label="WHOISleuth Dashboard"><span class="mark small"><BrandMark /></span><strong>WHOISleuth</strong></a>
      <div class="console-header-actions">
        <button class="command-trigger" type="button" aria-label="Open console navigation" bind:this={commandTrigger} onpointerenter={() => preloadBestEffort(() => import('$lib/console-command-navigation'))} onfocus={() => preloadBestEffort(() => import('$lib/console-command-navigation'))} onclick={()=>void openCommandPalette()}><span class="shortcut-wide" aria-hidden="true">Ctrl/⌘ K</span><span class="command-icon" aria-hidden="true"><IntelligenceIcon name="command" size={18} /></span><strong>Search</strong></button>
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
      <a class="brand" href="/dashboard"><span class="mark"><BrandMark /></span><span><strong>WHOISleuth</strong><small>Domain intelligence console</small></span></a>
      <nav aria-label="Console">
        {#each consoleNavigationGroups as navigationGroup}
          <div class="console-nav-group" role="group" aria-labelledby={`console-group-${navigationGroup.label.toLowerCase().replaceAll(' ', '-').replace('&', 'and')}`}>
            <p class="eyebrow" id={`console-group-${navigationGroup.label.toLowerCase().replaceAll(' ', '-').replace('&', 'and')}`}>{navigationGroup.label}</p>
            {#each navigationGroup.items as item}<a class:active={isNavigationItemActive(item,page.url)} aria-current={isNavigationItemActive(item,page.url)?'page':undefined} href={item.href} title={item.detail} onclick={()=>navOpen=false}><IntelligenceIcon name={item.icon} size={18} /><strong>{item.label}</strong></a>{/each}
          </div>
        {/each}
      </nav>
      <nav class="reference-nav" aria-label="Reference"><p class="eyebrow">Reference</p>{#each referenceNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} title={item.detail} target={item.opensInNewTab?'_blank':undefined} rel={item.opensInNewTab?'noopener noreferrer':undefined} aria-label={item.opensInNewTab?`${item.label}. Opens in a new tab.`:undefined} onclick={()=>navOpen=false}><IntelligenceIcon name={item.icon} size={18} /><strong>{item.label}</strong></a>{/each}</nav>
      <div class="session"><ThemeSelector /><div class="session-row"><span role="note" title={capabilityStatusDetail()} aria-label={capabilityStatusDetail()}>{capabilityStatus()}</span></div></div>
    </aside>
    {#if navOpen}<button class="scrim" tabindex="-1" aria-hidden="true" onclick={()=>void closeNavigation()}></button>{/if}
    <main id="main-content" class:wide-workspace={wideWorkspace} tabindex="-1" inert={navOpen||commandOpen} aria-hidden={navOpen||commandOpen?'true':undefined}>
      <BrowserWorkspaceIndicator />
      {#if showCaseContext && selectedCaseId}<DeferredSurface load={() => import('$lib/components/SelectedCaseContext.svelte')} props={{caseId:selectedCaseId}} loadingLabel="Reading selected Case…" unavailableLabel="Selected Case context could not be loaded." />{/if}
      {#if investigationGuideRequested}<DeferredSurface load={() => import('$lib/components/InvestigationGuide.svelte')} props={{revealOnMount:revealInvestigationGuideOnMount}} loadingLabel="Loading the investigation guide." unavailableLabel="The investigation guide could not be loaded." placeholder="workspace" />{/if}
      {@render children()}
      <SiteFooter console />
    </main>
    <div inert={navOpen||commandOpen}><AnalystUndo /></div>
    {#if commandOpen}
      <CommandPalette onclose={closeCommandPalette} />
    {/if}
  </div>
{/if}

<style>
  .workspace-recovery{width:min(760px,calc(100% - 32px));margin:20px auto;padding:20px}
  .workspace-error{display:flex;justify-content:center;margin:40px 16px 20px}.workspace-access{width:min(480px,100%);padding:clamp(20px,4vw,34px);min-width:0;overflow-wrap:anywhere}
  .login-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .login-links a{color:var(--accent)}
  .reference-nav{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
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
