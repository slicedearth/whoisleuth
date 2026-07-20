<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext } from 'svelte';
  import { consoleDestinations, consoleNavigation, referenceNavigation } from '$lib/workspaces';
  import { CAPABILITY_CONTEXT, fetchCapabilities, type CapabilityReport } from '$lib/capabilities';
  import InvestigationGuide from '$lib/components/InvestigationGuide.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';

  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'unavailable'>('checking');
  let navOpen = $state(false);
  let signingOut = $state(false);
  let capabilities = $state<CapabilityReport|null>(null);
  let capabilitiesChecked = $state(false);

  setContext(CAPABILITY_CONTEXT, () => capabilities);
  onMount(() => { void checkSession(); });

  function signInTarget(){
    const path = consoleDestinations.some((item) => item.href === page.url.pathname) ? page.url.pathname : '/dashboard';
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

  function toggleNavigation(event:MouseEvent){event.preventDefault();event.stopPropagation();navOpen=!navOpen;}
  function handleKeydown(event:KeyboardEvent){if(event.key==='Escape'&&navOpen)navOpen=false;}
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
    <header>
      <a href="/dashboard" aria-label="WHOISleuth dashboard"><span class="mark small"><img src="/favicon.svg" alt=""></span><strong>WHOISleuth</strong></a>
      <div class="console-header-actions">
        <button class="console-sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>
        <button class="navigation-toggle" type="button" aria-label="Toggle navigation" aria-expanded={navOpen} aria-controls="workspace-navigation" onclick={toggleNavigation}>☰</button>
      </div>
    </header>
    <aside id="workspace-navigation">
      <div class="terminal-strip" aria-hidden="true"><span class="prompt-sigil">❯</span><span>guest@whoisleuth / console</span></div>
      <a class="brand" href="/dashboard" aria-label="WHOISleuth dashboard"><span class="mark"><img src="/favicon.svg" alt=""></span><span><strong>WHOISleuth</strong><small>Domain intelligence console</small></span></a>
      <nav aria-label="Console"><p class="eyebrow">Console</p>{#each consoleNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <nav class="reference-nav" aria-label="Reference"><p class="eyebrow">Reference</p>{#each referenceNavigation as item}<a class:active={page.url.pathname===item.href} aria-current={page.url.pathname===item.href?'page':undefined} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav>
      <div class="session"><ThemeSelector /><div class="session-row"><span title={capabilityStatusDetail()} aria-label={capabilityStatusDetail()}>{capabilityStatus()}</span></div></div>
    </aside>
    {#if navOpen}<button class="scrim" aria-label="Close navigation" onclick={()=>navOpen=false}></button>{/if}
    <main id="main-content" tabindex="-1"><InvestigationGuide />{@render children()}<footer class="site-footer"><p>WHOISleuth uses <a href="https://www.iana.org/help/nro-rdap" target="_blank" rel="noopener">IANA's RDAP bootstrap data</a> to query relevant registry services and can also check public DNS, Certificate Transparency, and website endpoints. Missing registrant fields often reflect registry redaction rather than a lookup failure.</p><p class="credit">© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a> · <a href="/privacy">Privacy</a></p></footer></main>
  </div>
{/if}

<style>
  .login-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .login-links a{color:var(--accent)}
  .reference-nav{margin-top:18px;padding-top:14px;border-top:1px solid var(--border)}
</style>
