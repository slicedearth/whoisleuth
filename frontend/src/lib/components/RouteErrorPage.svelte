<script lang="ts">
  import BrandMark from './BrandMark.svelte';
  import SiteFooter from './SiteFooter.svelte';

  let { status = 404 }: { status?: number } = $props();
  const missing = $derived(status === 404);
</script>

<svelte:head>
  <title>{missing ? 'Page not found' : 'Page unavailable'} — WHOISleuth</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="error-shell">
  <header><a class="brand" href="/" data-sveltekit-reload><span class="mark"><BrandMark /></span><strong>WHOISleuth</strong></a></header>
  <main id="main-content">
    <p class="status">{status}</p>
    <h1>{missing ? 'Page not found' : 'Page unavailable'}</h1>
    <p>{missing ? 'This address does not match a page. Choose where to go next.' : 'This page could not be opened. Try again or return to the homepage.'}</p>
    <nav aria-label="Continue browsing">
      <a href="/" data-sveltekit-reload>Homepage</a>
      <a href="/resources" data-sveltekit-reload>Resources</a>
      <a href="/dashboard" data-sveltekit-reload>Open console</a>
    </nav>
  </main>
  <SiteFooter />
</div>

<style>
  .error-shell{display:flex;flex-direction:column;min-height:100svh;width:min(1100px,100%);margin:auto;padding:0 clamp(20px,4vw,48px)}
  header{padding:20px 0;border-bottom:1px solid var(--border)}
  .brand{display:inline-flex;align-items:center;gap:12px;min-height:44px;color:var(--text);text-decoration:none}
  .mark{width:36px;height:36px;flex:none}
  main{flex:1;padding:clamp(40px,8vh,100px) 0;max-width:720px}
  .status{font:700 var(--text-sm) var(--mono);color:var(--interface-accent);margin:0 0 16px}
  h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:0 0 20px;overflow-wrap:anywhere}
  main>p:not(.status){color:var(--muted);line-height:1.7;max-width:56ch}
  nav{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
  nav a{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;border:1px solid var(--border-strong);border-radius:var(--radius-md);color:var(--accent);font-weight:600;text-decoration:none}
  nav a:hover,nav a:focus-visible{background:var(--panel);border-color:var(--accent)}
</style>
