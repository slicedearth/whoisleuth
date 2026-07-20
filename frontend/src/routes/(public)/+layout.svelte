<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';

  let { children } = $props();
  let authenticated = $state(false);
  let signingOut = $state(false);
  let logoutError = $state('');

  onMount(() => { void checkSession(); });

  async function checkSession(){
    try{
      const response=await fetch('/api/session',{cache:'no-store'});
      authenticated=response.ok&&(await response.json()).authenticated===true;
    }catch{
      authenticated=false;
    }
  }

  async function logout(){
    if(signingOut)return;
    signingOut=true;
    logoutError='';
    try{
      const response=await fetch('/api/logout',{method:'POST'});
      if(!response.ok)throw new Error();
      authenticated=false;
      await goto('/login',{replaceState:true});
    }catch{
      logoutError='Sign out failed. Try again.';
    }finally{
      signingOut=false;
    }
  }
</script>

<div class="public-shell">
  <header class="public-header">
    <a class="public-brand" href="/" aria-label="WHOISleuth home"><span class="mark"><img src="/favicon.svg" alt=""></span><span class="brand-copy"><strong>WHOISleuth</strong><small>Domain intelligence</small></span></a>
    <nav aria-label="Public navigation">
      <a class="overview-link" class:active={page.url.pathname==='/' } aria-current={page.url.pathname==='/'?'page':undefined} href="/">Overview</a>
      <a class:active={page.url.pathname==='/demo'} aria-current={page.url.pathname==='/demo'?'page':undefined} href="/demo">Demo</a>
      <ThemeSelector />
      <a class="console-link" class:active={page.url.pathname==='/login'} aria-current={page.url.pathname==='/login'?'page':undefined} aria-label="Open console" href={authenticated?'/dashboard':'/login'}><span class="console-label-full" aria-hidden="true">Open console</span><span class="console-label-short" aria-hidden="true">Console</span></a>
      {#if authenticated}<button class="sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>{/if}
      {#if logoutError}<span class="session-error" role="status">{logoutError}</span>{/if}
    </nav>
  </header>

  <main class="public-content" id="main-content">{@render children()}</main>

  <footer class="public-footer">
    <p>WHOISleuth keeps registration and supporting evidence separate, so missing or inconclusive data is not presented as proof.</p>
    <p>© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a> · <a href="/guide">Guide</a> · <a href="/privacy">Privacy</a></p>
  </footer>
</div>

<style>
  .public-shell{width:min(1180px,100%);min-height:100vh;margin:auto;padding:0 clamp(20px,4vw,48px)}
  .public-header{display:flex;position:static;inset:auto;z-index:auto;height:auto;align-items:center;justify-content:space-between;gap:24px;padding:18px 0;border-bottom:1px solid var(--border);background:transparent}
  .public-brand{display:flex;align-items:center;gap:10px;font-family:var(--mono)}
  .public-brand .mark{width:38px;height:38px}
  .public-brand strong,.public-brand small{display:block}
  .public-brand strong{font-size:1rem;letter-spacing:-.02em}
  .public-brand small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  nav{--public-nav-control-h:38px;display:flex;align-items:center;gap:5px;margin:0}
  nav a,nav button{display:inline-flex;position:static;width:auto;height:var(--public-nav-control-h);min-height:var(--public-nav-control-h);align-items:center;justify-content:center;margin:0;padding:0 11px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);background:transparent;font:700 var(--text-xs) var(--mono);white-space:nowrap}
  nav :global(.theme-selector){height:var(--public-nav-control-h);margin:0 5px;font-size:var(--text-xs)}
  nav :global(.theme-control),nav :global(.theme-trigger){height:100%}
  nav :global(.theme-trigger){min-height:100%;font-size:var(--text-xs)}
  nav a::before{content:none}
  nav a:hover,nav a.active,nav button:hover{border-color:var(--border);color:var(--text);background:rgb(var(--accent-rgb) / .07)}
  nav a.console-link{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .console-label-short{display:none}
  nav button.sign-out{color:var(--muted)}
  nav .session-error{color:var(--danger);font:700 var(--text-2xs) var(--mono);white-space:nowrap}
  .public-content{width:100%;margin:0;padding:clamp(44px,7vw,82px) 0 72px}
  .public-footer{display:flex;justify-content:space-between;gap:30px;padding:22px 0 30px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-2xs) var(--mono);line-height:1.6}
  .public-footer p{max-width:72ch;margin:0}
  .public-footer p:last-child{flex:none;text-align:right}
  .public-footer a{color:var(--accent)}
  @media(max-width:720px){
    .public-shell{padding-inline:12px}
    .public-header{align-items:center;flex-direction:row;gap:6px;padding:12px 0}
    .public-brand{flex:0 0 auto}
    .public-brand{gap:6px}
    .public-brand .mark{width:28px;height:28px}
    .public-brand .brand-copy{display:block}
    .public-brand strong{font-size:.78rem}
    .public-brand small{display:none}
    nav{--public-nav-control-h:32px;width:auto;min-width:0;flex:1 1 auto;flex-wrap:nowrap;justify-content:flex-end;gap:2px;padding:0}
    nav a,nav button{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;padding:0 6px;font-size:.68rem}
    nav .overview-link{display:none}
    nav :global(.theme-selector){margin:0;font-size:.68rem}
    .console-label-full{display:none}
    .console-label-short{display:inline}
    .public-content{padding-top:38px}
    .public-footer{align-items:flex-start;flex-direction:column}
    .public-footer p:last-child{text-align:left}
  }
  @media(max-width:360px){
    .public-shell{padding-inline:8px}
    .public-header{gap:4px}
    .public-brand{gap:4px}
    .public-brand .mark{width:24px;height:24px}
    .public-brand strong{font-size:.68rem}
    nav a,nav button{padding-inline:3px;font-size:.6rem}
    nav :global(.theme-selector){font-size:.6rem}
  }
</style>
