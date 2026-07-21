<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext, tick } from 'svelte';
  import { consoleNavigation, protectedDestinations, referenceNavigation } from '$lib/workspaces';
  import { CAPABILITY_CONTEXT, fetchCapabilities, type CapabilityReport } from '$lib/capabilities';
  import InvestigationGuide from '$lib/components/InvestigationGuide.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';

  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'unavailable'>('checking');
  let navOpen = $state(false);
  let signingOut = $state(false);
  let capabilities = $state<CapabilityReport|null>(null);
  let capabilitiesChecked = $state(false);
  let consoleHeader = $state<HTMLElement>();
  let navigationPanel = $state<HTMLElement>();
  let navigationToggle = $state<HTMLButtonElement>();

  setContext(CAPABILITY_CONTEXT, () => capabilities);
  onMount(() => {
    void checkSession();
    const mobileNavigation = window.matchMedia('(max-width: 900px)');
    const closeAtDesktopWidth = (event: MediaQueryListEvent) => {
      if (!event.matches) navOpen = false;
    };
    mobileNavigation.addEventListener('change', closeAtDesktopWidth);
    return () => mobileNavigation.removeEventListener('change', closeAtDesktopWidth);
  });

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
      if(!authenticated){await goto(signInTarget(),{replaceState:true});return;}
      session='authenticated';
      await loadCapabilityReport();
    }catch{
      session='unavailable';
    }
  }

  async function logout(){
    if(signingOut)return;
    signingOut=true;
    try{await fetch('/api/logout',{method:'POST'});}
    finally{await goto('/login',{replaceState:true});}
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

  function toggleNavigation(event:MouseEvent){
    event.preventDefault();
    event.stopPropagation();
    if(navOpen)void closeNavigation();
    else void openNavigation();
  }

  function handleKeydown(event:KeyboardEvent){
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
  <div class="center"><div class="mark"><img src="/favicon.svg" alt=""></div><p>Opening console…</p></div>
{:else if session==='unavailable'}
  <div class="center"><section class="login card"><h1>Session service unavailable</h1><p class="muted">The protected console could not confirm your session.</p><button class="primary" onclick={checkSession}>Retry</button><p class="login-links"><a href="/">Return home</a></p></section></div>
{:else}
  <div class="shell" class:open={navOpen}>
    <header bind:this={consoleHeader}>
      <a href="/dashboard" aria-label="WHOISleuth Dashboard"><span class="mark small"><img src="/favicon.svg" alt=""></span><strong>WHOISleuth</strong></a>
      <div class="console-header-actions">
        <button class="console-sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>
        <button class="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} aria-controls="console-navigation" bind:this={navigationToggle} onclick={toggleNavigation}>☰</button>
      </div>
    </header>
    <aside id="console-navigation" bind:this={navigationPanel}>
      <div class="terminal-strip" aria-hidden="true"><span class="prompt-sigil">❯</span><span>guest@whoisleuth / console</span></div>
      <button class="navigation-drawer-close" type="button" aria-label="Close navigation" onclick={()=>void closeNavigation()}>×</button>
      <a class="brand" href="/dashboard" aria-label="WHOISleuth Dashboard"><span class="mark"><img src="/favicon.svg" alt=""></span><span><strong>WHOISleuth</strong><small>Domain intelligence console</small></span></a>
      <nav aria-label="Console"><p class="eyebrow">Console</p>{#each consoleNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <nav class="reference-nav" aria-label="Reference"><p class="eyebrow">Reference</p>{#each referenceNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <div class="session"><ThemeSelector /><div class="session-row"><span title={capabilityStatusDetail()} aria-label={capabilityStatusDetail()}>{capabilityStatus()}</span></div></div>
    </aside>
    {#if navOpen}<button class="scrim" tabindex="-1" aria-hidden="true" onclick={()=>void closeNavigation()}></button>{/if}
    <main id="main-content" tabindex="-1" inert={navOpen} aria-hidden={navOpen?'true':undefined}><InvestigationGuide />{@render children()}<footer class="site-footer"><p>WHOISleuth uses <a href="https://www.iana.org/help/nro-rdap" target="_blank" rel="noopener">IANA's RDAP bootstrap data</a> to query relevant registry services and can also check public DNS, Certificate Transparency, and website endpoints. Missing registrant fields often reflect registry redaction rather than a lookup failure.</p><p class="credit">© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a> · <a href="/privacy">Privacy</a></p></footer></main>
  </div>
{/if}

<style>
  .login-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .login-links a{color:var(--accent)}
  .reference-nav{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
</style>
