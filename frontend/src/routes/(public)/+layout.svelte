<script lang="ts">
  import { page } from '$app/state';

  let { children } = $props();
</script>

<div class="public-shell">
  <header class="public-header">
    <a class="public-brand" href="/" aria-label="WHOISleuth home"><span class="mark"><img src="/favicon.svg" alt=""></span><span><strong>WHOISleuth</strong><small>Domain intelligence</small></span></a>
    <nav aria-label="Public navigation">
      <a class:active={page.url.pathname==='/' } aria-current={page.url.pathname==='/'?'page':undefined} href="/">Overview</a>
      <a class:active={page.url.pathname==='/demo'} aria-current={page.url.pathname==='/demo'?'page':undefined} href="/demo">Demo</a>
      <a class:active={page.url.pathname==='/privacy'} aria-current={page.url.pathname==='/privacy'?'page':undefined} href="/privacy">Privacy</a>
      <a class="console-link" class:active={page.url.pathname==='/login'} aria-current={page.url.pathname==='/login'?'page':undefined} href="/login">Open console</a>
    </nav>
  </header>

  <main class="public-content" id="main-content">{@render children()}</main>

  <footer class="public-footer">
    <p>WHOISleuth separates registry, registrar, DNS, certificate, website, and analyst-derived evidence so missing or inconclusive data is not presented as proof.</p>
    <p>© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a> · <a href="/privacy">Privacy</a></p>
  </footer>
</div>

<style>
  .public-shell{width:min(1180px,100%);min-height:100vh;margin:auto;padding:0 clamp(20px,4vw,48px)}
  .public-header{display:flex;position:static;inset:auto;z-index:auto;height:auto;align-items:center;justify-content:space-between;gap:24px;padding:18px 0;border-bottom:1px solid var(--border);background:transparent}
  .public-brand{display:flex;align-items:center;gap:10px;font-family:var(--mono)}
  .public-brand .mark{width:38px;height:38px}
  .public-brand strong,.public-brand small{display:block}
  .public-brand strong{font-size:1rem;letter-spacing:-.02em}
  .public-brand strong::after{content:"";display:inline-block;width:.46em;height:.9em;margin-left:.18em;background:var(--accent2);box-shadow:0 0 8px rgba(126,224,168,.5);vertical-align:-.12em;animation:public-cursor 1.1s steps(1,end) infinite}
  .public-brand small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  nav{display:flex;align-items:center;gap:5px;margin:0}
  nav a{position:static;margin:0;padding:9px 11px;border:1px solid transparent;color:var(--muted);font:700 var(--text-xs) var(--mono);white-space:nowrap}
  nav a::before{content:none}
  nav a:hover,nav a.active{border-color:var(--border);color:var(--text);background:rgba(94,179,255,.07)}
  nav a.console-link{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));color:var(--accent)}
  .public-content{width:100%;margin:0;padding:clamp(44px,7vw,82px) 0 72px}
  .public-footer{display:flex;justify-content:space-between;gap:30px;padding:22px 0 30px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-2xs) var(--mono);line-height:1.6}
  .public-footer p{max-width:72ch;margin:0}
  .public-footer p:last-child{flex:none;text-align:right}
  .public-footer a{color:var(--accent)}
  @keyframes public-cursor{0%,55%{opacity:1}55.01%,99.99%{opacity:0}100%{opacity:1}}
  @media(prefers-reduced-motion:reduce){.public-brand strong::after{animation:none}}
  @media(max-width:720px){
    .public-header{align-items:flex-start;flex-direction:column;gap:14px}
    nav{width:100%;padding-bottom:2px;overflow-x:auto}
    nav a{flex:0 0 auto}
    .public-content{padding-top:38px}
    .public-footer{align-items:flex-start;flex-direction:column}
    .public-footer p:last-child{text-align:left}
  }
</style>
