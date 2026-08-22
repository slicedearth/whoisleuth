<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext } from 'svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import PublicReferenceSidebar from '$lib/components/PublicReferenceSidebar.svelte';
  import SiteFooter from '$lib/components/SiteFooter.svelte';
  import ThemeSelector from '$lib/components/ThemeSelector.svelte';
  import {
    publicHeaderNavigation,
    publicReferenceNavigation,
    publicReferenceSectionNavigation,
  } from '$lib/workspaces';
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
  let siteMenu = $state<HTMLDetailsElement>();
  const resourceDestinationPaths = new Set(publicReferenceNavigation.map((item) => item.href));
  const referenceSectionActive = $derived(
    page.url.pathname === '/resources'
      || page.url.pathname.startsWith('/resources/')
      || publicReferenceSectionNavigation.some((item) => item.href === page.url.pathname),
  );

  setContext(PUBLIC_SESSION_CONTEXT, () => session);
  onMount(() => { void checkSession(); });

  function publicItemActive(href: string): boolean {
    if (href !== '/resources') return page.url.pathname === href;
    return page.url.pathname === href
      || page.url.pathname.startsWith('/resources/')
      || resourceDestinationPaths.has(page.url.pathname);
  }

  function publicItemCurrent(href: string): 'page' | 'location' | undefined {
    if (page.url.pathname === href) return 'page';
    if (href === '/resources' && publicItemActive(href)) return 'location';
    return undefined;
  }

  function closeSiteMenu() {
    if (siteMenu) siteMenu.open = false;
  }

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
    <nav class="public-navigation-desktop" aria-label="Public navigation">
      {#each publicHeaderNavigation as item}
        <a data-public-route={item.href} class:active={publicItemActive(item.href)} aria-current={publicItemCurrent(item.href)} href={item.href}>{item.label}</a>
      {/each}
      <a class="console-link" class:active={page.url.pathname==='/login'} aria-current={page.url.pathname==='/login'?'page':undefined} aria-label="Open console" href={session==='anonymous'?'/login':'/dashboard'}><span class="console-label-full" aria-hidden="true">Open console</span><span class="console-label-short" aria-hidden="true">Console</span></a>
      <ThemeSelector />
      {#if session==='authenticated'}<button class="sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>{/if}
    </nav>
    <div class="public-navigation-mobile">
      <details class="site-menu" bind:this={siteMenu}>
        <summary>Menu</summary>
        <nav aria-label="Public navigation">
          {#each publicHeaderNavigation as item}
            <a class:active={publicItemActive(item.href)} aria-current={publicItemCurrent(item.href)} href={item.href} onclick={closeSiteMenu}>{item.label}</a>
          {/each}
          {#if session==='authenticated'}<button class="sign-out" type="button" disabled={signingOut} onclick={logout}>{signingOut?'Signing out…':'Sign out'}</button>{/if}
        </nav>
      </details>
      <a class="console-link" class:active={page.url.pathname==='/login'} aria-current={page.url.pathname==='/login'?'page':undefined} aria-label="Open console" href={session==='anonymous'?'/login':'/dashboard'}>Console</a>
      <ThemeSelector />
    </div>
    {#if logoutError}<p class="session-error" role="alert">{logoutError}</p>{/if}
  </header>

  <main class="public-content" class:reference-page={referenceSectionActive} id="main-content" tabindex="-1">
    {#if referenceSectionActive}
      <div class="reference-shell">
        <PublicReferenceSidebar currentPath={page.url.pathname} />
        <div class="reference-document-slot">{@render children()}</div>
      </div>
    {:else}
      {@render children()}
    {/if}
  </main>

  <SiteFooter />
</div>

<style>
  .public-shell{width:min(1280px,100%);min-height:100vh;margin:auto;padding:0 clamp(20px,4vw,48px)}
  .public-header{display:flex;position:static;inset:auto;z-index:auto;height:auto;align-items:center;justify-content:space-between;gap:12px 24px;padding:18px 0;border-bottom:1px solid var(--border);background:transparent;flex-wrap:wrap}
  .public-brand{display:flex;align-items:center;gap:10px;font-family:var(--mono)}
  .public-brand .mark{width:38px;height:38px}
  .public-brand strong,.public-brand small{display:block}
  .public-brand strong{font-size:1rem;letter-spacing:-.02em}
  .public-brand small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .public-navigation-desktop{--public-nav-control-h:38px;display:flex;align-items:center;gap:5px;margin:0}
  .public-navigation-desktop a,.public-navigation-desktop button,.public-navigation-mobile>a,.site-menu>summary{display:inline-flex;position:static;width:auto;height:var(--public-nav-control-h,36px);min-height:var(--public-nav-control-h,36px);align-items:center;justify-content:center;margin:0;padding:0 11px;border:1px solid transparent;border-radius:var(--radius-sm);color:var(--muted);background:transparent;font:700 var(--text-xs) var(--mono);white-space:nowrap}
  .public-navigation-desktop :global(.theme-selector){--theme-selector-surface:var(--bg);height:var(--public-nav-control-h);margin:0 5px;font-size:var(--text-xs)}
  .public-navigation-desktop :global(.theme-control),.public-navigation-desktop :global(.theme-trigger){height:100%}
  .public-navigation-desktop :global(.theme-trigger){min-height:100%;font-size:inherit}
  .public-navigation-desktop a::before{content:none}
  .public-navigation-desktop a:hover,.public-navigation-desktop a.active,.public-navigation-desktop button:hover,.public-navigation-mobile>a:hover,.site-menu>summary:hover{border-color:var(--border);color:var(--text);background:rgb(var(--accent-rgb) / .07)}
  .public-navigation-desktop a.console-link,.public-navigation-mobile>a.console-link{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .console-label-short{display:none}
  .public-navigation-desktop button.sign-out{color:var(--muted)}
  .public-navigation-mobile{display:none}
  .session-error{flex:1 0 100%;max-width:100%;margin:0;padding:8px 10px;border:1px dotted var(--danger);border-radius:var(--radius-sm);color:var(--danger);font:700 var(--text-2xs) var(--mono);line-height:1.45;overflow-wrap:anywhere}
  .public-content{width:100%;margin:0;padding:clamp(44px,7vw,82px) 0 72px}
  .public-content.reference-page{padding-top:30px}
  .reference-shell{display:grid;grid-template-columns:210px minmax(0,1fr);gap:clamp(28px,4vw,52px);align-items:start}
  .reference-document-slot{min-width:0}
  @media(max-width:720px){
    .public-shell{padding-inline:12px}
    .public-header{align-items:center;flex-direction:row;gap:6px;padding:12px 0}
    .public-brand{flex:0 0 auto}
    .public-brand{gap:6px}
    .public-brand .mark{width:28px;height:28px}
    .public-brand .brand-copy{display:block}
    .public-brand strong{font-size:.78rem}
    .public-brand small{display:none}
    .public-navigation-desktop{display:none}
    .public-navigation-mobile{display:flex;position:relative;flex:1 1 auto;align-items:center;justify-content:flex-end;gap:5px;--public-nav-control-h:32px}
    .public-navigation-mobile>a,.site-menu>summary{padding-inline:7px;font-size:.68rem}
    .public-navigation-mobile :global(.theme-selector){--theme-selector-surface:var(--bg);height:32px;margin:0;font-size:.68rem}
    .site-menu{position:static}
    .site-menu>summary{list-style:none}
    .site-menu>summary::-webkit-details-marker{display:none}
    .site-menu[open]>summary{border-color:var(--accent);color:var(--accent);background:rgb(var(--accent-rgb) / .08)}
    .site-menu nav{position:absolute;z-index:30;top:calc(100% + 8px);right:0;display:grid;width:min(250px,calc(100vw - 24px));gap:4px;padding:8px;border:1px solid var(--border-strong);border-radius:var(--radius-md);background:var(--panel);box-shadow:0 16px 42px rgb(var(--shadow-rgb) / .32)}
    .site-menu nav a,.site-menu nav button{display:flex;min-height:40px;align-items:center;padding:8px 10px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);font:700 var(--text-xs) var(--mono);text-align:left}
    .site-menu nav a:hover,.site-menu nav a:focus-visible,.site-menu nav a.active,.site-menu nav button:hover,.site-menu nav button:focus-visible{border-color:var(--border);color:var(--text);background:rgb(var(--accent-rgb) / .07)}
    .site-menu nav button{width:100%}
    .public-content{padding-top:38px}
    .public-content.reference-page{padding-top:20px}
  }
  @media(max-width:1080px){.reference-shell{grid-template-columns:1fr;gap:0}}
  @media(max-width:440px){
    .public-shell{padding-inline:8px}
    .public-header{gap:4px}
    .public-brand{gap:4px}
    .public-brand .mark{width:24px;height:24px}
    .public-brand .brand-copy{display:block}
    .public-brand strong{font-size:.68rem}
    .public-navigation-mobile{gap:3px}
    .public-navigation-mobile>a,.site-menu>summary{padding-inline:5px;font-size:.625rem;line-height:1}
    .public-navigation-mobile :global(.theme-selector){font-size:.625rem;line-height:1}
  }
  @media(max-width:360px){
    .public-navigation-mobile>a,.site-menu>summary{padding-inline:3px}
  }
</style>
