<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext } from 'svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';
  import { clearConsoleWorkflowState } from '$lib/console-workflow-state';
  import { requestJsonCapped, SMALL_JSON_RESPONSE_BYTES } from '$lib/bounded-json-response';
  import {
    PUBLIC_SESSION_CONTEXT,
    classifyPublicSessionResponse,
    type PublicSessionState,
  } from '$lib/public-session';

  let { children } = $props();
  let session = $state<PublicSessionState>('checking');
  let signingOut = $state(false);
  let logoutError = $state('');

  setContext(PUBLIC_SESSION_CONTEXT, () => session);
  onMount(() => { void checkSession(); });

  async function checkSession(){
    try{
      const { response, body }=await requestJsonCapped('/api/session',{cache:'no-store'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      session=classifyPublicSessionResponse(response.ok,body);
      if(session==='anonymous')clearConsoleWorkflowState();
    }catch{
      session='unavailable';
    }
  }

  async function logout(){
    if(signingOut)return;
    signingOut=true;
    logoutError='';
    try{
      const {response}=await requestJsonCapped('/api/logout',{method:'POST'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      if(!response.ok)throw new Error();
      session='anonymous';
      clearConsoleWorkflowState();
      await goto('/login',{replaceState:true});
      clearConsoleWorkflowState();
    }catch{
      logoutError='Sign out failed. Try again.';
    }finally{
      signingOut=false;
    }
  }
</script>

<div class="public-shell">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="public-header">
    <a class="public-brand" href="/" aria-label="WHOISleuth overview"><span class="mark"><BrandMark /></span><span class="brand-copy"><strong>WHOISleuth</strong><small>Domain intelligence</small></span></a>
    <nav aria-label="Public navigation">
      <a class="overview-link" class:active={page.url.pathname==='/' } aria-current={page.url.pathname==='/'?'page':undefined} href="/">Overview</a>
      <a class="demo-link" class:active={page.url.pathname==='/demo'} aria-current={page.url.pathname==='/demo'?'page':undefined} href="/demo">Demo</a>
      <a class:active={page.url.pathname.startsWith('/resources')} aria-current={page.url.pathname==='/resources'?'page':page.url.pathname.startsWith('/resources/')?'location':undefined} href="/resources">Resources</a>
      <a class="console-link" class:active={page.url.pathname==='/login'} aria-current={page.url.pathname==='/login'?'page':undefined} aria-label="Open console" href={session==='anonymous'?'/login':'/dashboard'}><span class="console-label-full" aria-hidden="true">Open console</span><span class="console-label-short" aria-hidden="true">Console</span></a>
      <ThemeSelector />
      {#if session==='authenticated'}<button class="sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>{/if}
    </nav>
    {#if logoutError}<p class="session-error" role="alert">{logoutError}</p>{/if}
  </header>

  <main class="public-content" id="main-content" tabindex="-1">{@render children()}</main>

  <SiteFooter />
</div>

<style>
  .public-shell{width:min(1180px,100%);min-height:100vh;margin:auto;padding:0 clamp(20px,4vw,48px)}
  .public-header{display:flex;position:static;inset:auto;z-index:auto;height:auto;align-items:center;justify-content:space-between;gap:12px 24px;padding:18px 0;border-bottom:1px solid var(--border);background:transparent;flex-wrap:wrap}
  .public-brand{display:flex;align-items:center;gap:10px;font-family:var(--mono)}
  .public-brand .mark{width:38px;height:38px}
  .public-brand strong,.public-brand small{display:block}
  .public-brand strong{font-size:1rem;letter-spacing:-.02em}
  .public-brand small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .public-header nav{--public-nav-control-h:38px;display:flex;align-items:center;gap:5px;margin:0}
  .public-header nav a,.public-header nav button{display:inline-flex;position:static;width:auto;height:var(--public-nav-control-h);min-height:var(--public-nav-control-h);align-items:center;justify-content:center;margin:0;padding:0 11px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);background:transparent;font:700 var(--text-xs) var(--mono);white-space:nowrap}
  .public-header nav :global(.theme-selector){height:var(--public-nav-control-h);margin:0 5px;font-size:var(--text-xs)}
  .public-header nav :global(.theme-control),.public-header nav :global(.theme-trigger){height:100%}
  .public-header nav :global(.theme-trigger){min-height:100%;font-size:inherit}
  .public-header nav a::before{content:none}
  .public-header nav a:hover,.public-header nav a.active,.public-header nav button:hover{border-color:var(--border);color:var(--text);background:rgb(var(--accent-rgb) / .07)}
  .public-header nav a.console-link{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .console-label-short{display:none}
  .public-header nav button.sign-out{color:var(--muted)}
  .session-error{flex:1 0 100%;max-width:100%;margin:0;padding:8px 10px;border:1px dotted var(--danger);border-radius:var(--radius-sm);color:var(--danger);font:700 var(--text-2xs) var(--mono);line-height:1.45;overflow-wrap:anywhere}
  .public-content{width:100%;margin:0;padding:clamp(44px,7vw,82px) 0 72px}
  @media(max-width:720px){
    .public-shell{padding-inline:12px}
    .public-header{align-items:center;flex-direction:row;gap:6px;padding:12px 0}
    .public-brand{flex:0 0 auto}
    .public-brand{gap:6px}
    .public-brand .mark{width:28px;height:28px}
    .public-brand .brand-copy{display:block}
    .public-brand strong{font-size:.78rem}
    .public-brand small{display:none}
    .public-header nav{--public-nav-control-h:32px;width:auto;min-width:0;flex:1 1 auto;flex-wrap:nowrap;justify-content:flex-end;gap:6px;padding:0}
    .public-header nav a,.public-header nav button{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;padding:0 6px;font-size:.68rem}
    .public-header nav .overview-link{display:none}
    .public-header nav :global(.theme-selector){margin:0;font-size:.68rem}
    .console-label-full{display:none}
    .console-label-short{display:inline}
    .public-content{padding-top:38px}
  }
  @media(max-width:440px){
    .public-shell{padding-inline:8px}
    .public-header{gap:4px}
    .public-brand{gap:4px}
    .public-brand .mark{width:24px;height:24px}
    .public-brand .brand-copy{display:block}
    .public-brand strong{font-size:.68rem}
    .public-header nav{gap:8px}
    .public-header nav a,.public-header nav button{padding-inline:3px;font-size:.625rem;line-height:1}
    .public-header nav :global(.theme-selector){font-size:.625rem;line-height:1}
    .public-header nav .demo-link{display:none}
  }
  @media(max-width:360px){
    .public-header nav a,.public-header nav button{padding-inline:2px}
  }
</style>
