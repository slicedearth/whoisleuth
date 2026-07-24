<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext, tick, type Component } from 'svelte';
  import { consoleNavigation, protectedDestinations, referenceNavigation } from '$lib/workspaces';
  import { CAPABILITY_CONTEXT, fetchCapabilities, type CapabilityReport } from '$lib/capabilities';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import ConsoleLoading from '$lib/components/ConsoleLoading.svelte';
  import IntelligenceIcon from '$lib/components/IntelligenceIcon.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';
  import { initializeBrowserLocalData, type BrowserLocalDataServiceState } from '$lib/browser-local-data-service';
  import { clearConsoleWorkflowState } from '$lib/console-workflow-state';
  import {
    hasStoredInvestigationGuide,
    INVESTIGATION_GUIDE_EVENT,
  } from '$lib/investigation-guide-storage';

  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'unavailable'>('checking');
  let navOpen = $state(false);
  let commandOpen = $state(false);
  let signingOut = $state(false);
  let capabilities = $state<CapabilityReport|null>(null);
  let capabilitiesChecked = $state(false);
  let localData = $state<BrowserLocalDataServiceState>({ state: 'idle' });
  let consoleHeader = $state<HTMLElement>();
  let navigationPanel = $state<HTMLElement>();
  let navigationToggle = $state<HTMLButtonElement>();
  let commandTrigger = $state<HTMLButtonElement>();
  let InvestigationGuideView = $state<Component | null>(null);
  let revealInvestigationGuideOnMount = $state(false);
  let investigationGuideLoad: Promise<void> | null = null;
  type ConsoleCommand = {
    href: string;
    label: string;
    detail: string;
    group: string;
    icon: 'analysis' | 'lookup' | 'discover' | 'bulk' | 'watchlist' | 'brand' | 'registry' | 'page';
  };
  const commandIcons: Record<string, ConsoleCommand['icon']> = {
    '/dashboard': 'analysis',
    '/lookup': 'lookup',
    '/discover': 'discover',
    '/bulk': 'bulk',
    '/monitor': 'watchlist',
    '/brands': 'brand',
    '/registry-support': 'registry',
    '/guide': 'page',
    '/': 'page',
  };
  const consoleCommands: ConsoleCommand[] = [
    ...consoleNavigation.map((item) => ({ ...item, group: 'Console', icon: commandIcons[item.href] })),
    ...referenceNavigation.map((item) => ({ ...item, group: 'Reference', icon: commandIcons[item.href] })),
    {
      href: '/',
      label: 'Public homepage',
      detail: 'Return to the public WHOISleuth overview',
      group: 'Public',
      icon: commandIcons['/'],
    },
  ];

  setContext(CAPABILITY_CONTEXT, () => capabilities);
  onMount(() => {
    void checkSession();
    if (hasStoredInvestigationGuide()) void loadInvestigationGuideView();
    const showInvestigationGuide = () => {
      if (!InvestigationGuideView) revealInvestigationGuideOnMount = true;
      void loadInvestigationGuideView();
    };
    window.addEventListener(INVESTIGATION_GUIDE_EVENT, showInvestigationGuide);
    const mobileNavigation = window.matchMedia('(max-width: 900px)');
    const closeAtDesktopWidth = (event: MediaQueryListEvent) => {
      if (!event.matches) navOpen = false;
    };
    mobileNavigation.addEventListener('change', closeAtDesktopWidth);
    return () => {
      mobileNavigation.removeEventListener('change', closeAtDesktopWidth);
      window.removeEventListener(INVESTIGATION_GUIDE_EVENT, showInvestigationGuide);
    };
  });

  function loadInvestigationGuideView(): Promise<void> {
    if (InvestigationGuideView) return Promise.resolve();
    if (!investigationGuideLoad) {
      investigationGuideLoad = import('$lib/components/InvestigationGuide.svelte')
        .then((module) => {
          InvestigationGuideView = module.default;
        })
        .catch(() => {
          InvestigationGuideView = null;
        })
        .finally(() => {
          investigationGuideLoad = null;
        });
    }
    return investigationGuideLoad;
  }

  function signInTarget(){
    const path = protectedDestinations.some((item) => item.href === page.url.pathname) ? page.url.pathname : '/dashboard';
    return `/login?next=${encodeURIComponent(path)}`;
  }

  async function loadCapabilityReport(){
    capabilitiesChecked=false;
    capabilities=await fetchCapabilities();
    capabilitiesChecked=true;
  }

  async function checkSession(){
    session='checking';
    try{
      const response=await fetch('/api/session',{cache:'no-store'});
      if(!response.ok)throw new Error();
      const authenticated=(await response.json()).authenticated===true;
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
    try{await fetch('/api/logout',{method:'POST'});}
    finally{
      clearConsoleWorkflowState();
      try{await goto('/login',{replaceState:true});}
      finally{clearConsoleWorkflowState();}
    }
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
    if(navOpen)await closeNavigation(false);
    commandOpen=true;
  }

  async function closeCommandPalette(){
    commandOpen=false;
    await tick();
    commandTrigger?.focus();
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
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
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
  <div class="center"><section class="login card"><h1>Browser-local data unavailable</h1><p class="muted">{localData.detail}</p><button class="primary" onclick={retryLocalData}>Retry</button><p class="login-links"><a href="/privacy">Review storage and privacy details</a></p></section></div>
{:else}
  <div class="shell" class:open={navOpen}>
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header bind:this={consoleHeader} inert={commandOpen} aria-hidden={commandOpen?'true':undefined}>
      <a href="/dashboard" aria-label="WHOISleuth Dashboard"><span class="mark small"><BrandMark /></span><strong>WHOISleuth</strong></a>
      <div class="console-header-actions">
        <button class="command-trigger" type="button" aria-label="Open command palette" bind:this={commandTrigger} onclick={()=>void openCommandPalette()}><span class="shortcut-wide" aria-hidden="true">Ctrl/⌘ K</span><span class="command-icon" aria-hidden="true"><IntelligenceIcon name="command" size={18} /></span><strong>Commands</strong></button>
        <button class="console-sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>
        <button class="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} aria-controls="console-navigation" bind:this={navigationToggle} onclick={toggleNavigation}>☰</button>
      </div>
    </header>
    <aside id="console-navigation" bind:this={navigationPanel} inert={commandOpen} aria-hidden={commandOpen?'true':undefined}>
      <div class="terminal-strip" aria-hidden="true"><span class="prompt-sigil">❯</span><span>guest@whoisleuth / console</span></div>
      <button class="navigation-drawer-close" type="button" aria-label="Close navigation" onclick={()=>void closeNavigation()}>×</button>
      <a class="brand" href="/dashboard"><span class="mark"><BrandMark /></span><span><strong>WHOISleuth</strong><small>Domain intelligence console</small></span></a>
      <nav aria-label="Console"><p class="eyebrow">Console</p>{#each consoleNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <nav class="reference-nav" aria-label="Reference"><p class="eyebrow">Reference</p>{#each referenceNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <div class="session"><ThemeSelector /><div class="session-row"><span title={capabilityStatusDetail()} aria-label={capabilityStatusDetail()}>{capabilityStatus()}</span></div></div>
    </aside>
    {#if navOpen}<button class="scrim" tabindex="-1" aria-hidden="true" onclick={()=>void closeNavigation()}></button>{/if}
    <main id="main-content" tabindex="-1" inert={navOpen||commandOpen} aria-hidden={navOpen||commandOpen?'true':undefined}>{#if InvestigationGuideView}<InvestigationGuideView revealOnMount={revealInvestigationGuideOnMount} />{/if}{@render children()}<footer class="site-footer"><p>WHOISleuth uses <a href="https://www.iana.org/help/nro-rdap" target="_blank" rel="noopener">IANA's RDAP bootstrap data</a> to query relevant registry services and can also check public DNS, Certificate Transparency, and website endpoints. Missing registrant fields often reflect registry redaction rather than a lookup failure.</p><p class="credit">© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a> · <a href="https://github.com/slicedearth/whoisleuth" target="_blank" rel="noopener">Source and licence</a> · <a href="/privacy">Privacy</a></p></footer></main>
    {#if commandOpen}<CommandPalette commands={consoleCommands} onclose={()=>void closeCommandPalette()} />{/if}
  </div>
{/if}

<style>
  .login-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .login-links a{color:var(--accent)}
  .reference-nav{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
  .command-trigger{display:flex;min-height:34px;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--muted);font:650 var(--text-2xs) var(--mono);white-space:nowrap}
  .command-trigger:hover,.command-trigger:focus-visible{border-color:var(--accent);color:var(--accent);background:rgb(var(--accent-rgb) / .07)}
  .command-trigger span{padding:2px 4px;border:1px solid var(--border);border-radius:4px;color:var(--text);font:inherit}
  .command-trigger .command-icon{display:none;padding:0;border:0;color:currentColor}
  .command-trigger strong{font:inherit}
  @media(max-width:900px){.command-trigger{width:36px;padding:0;justify-content:center}.command-trigger span{padding:0;border:0}.command-trigger .shortcut-wide,.command-trigger strong{display:none}.command-trigger .command-icon{display:grid;place-items:center}}
</style>
