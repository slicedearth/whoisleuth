<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';

  let {
    stage,
    title,
    detail,
  }: {
    stage: 'session' | 'workspace';
    title: string;
    detail: string;
  } = $props();

  const command = $derived(stage === 'session' ? 'session --verify' : 'workspace --prepare');
</script>

<div class="console-loading">
  <section
    class="loading-terminal card"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-label="Console loading status"
  >
    <header aria-hidden="true">
      <span>guest@whoisleuth</span>
      <span>protected console</span>
    </header>

    <div class="loading-content">
      <div class="loading-identity">
        <span class="loading-mark"><BrandMark /></span>
        <div>
          <p class="eyebrow">Protected console</p>
          <h1>{title}</h1>
        </div>
      </div>

      <p class="loading-detail">{detail}</p>

      <ol class="loading-stages" aria-label="Console opening stages">
        <li class:active={stage === 'session'} class:complete={stage === 'workspace'}>
          <span>01</span>
          <strong>Confirm session</strong>
          <small>{stage === 'workspace' ? 'Confirmed' : 'In progress'}</small>
        </li>
        <li class:active={stage === 'workspace'}>
          <span>02</span>
          <strong>Prepare workspace</strong>
          <small>{stage === 'workspace' ? 'In progress' : 'Waiting'}</small>
        </li>
        <li>
          <span>03</span>
          <strong>Open destination</strong>
          <small>Waiting</small>
        </li>
      </ol>

      <div class="loading-scan" aria-hidden="true"><span></span></div>
      <p class="loading-command" aria-hidden="true"><span>❯</span> {command}<i></i></p>
    </div>
  </section>
</div>

<style>
  .console-loading{position:relative;isolation:isolate;display:grid;min-height:100svh;padding:clamp(18px,5vw,52px);overflow:hidden;place-items:center}
  .console-loading::before{content:"";position:absolute;inset:8%;z-index:-1;opacity:.28;background:radial-gradient(circle at 14% 28%,var(--accent2) 0 2px,transparent 3px),radial-gradient(circle at 82% 18%,var(--accent) 0 2px,transparent 3px),radial-gradient(circle at 76% 78%,var(--violet) 0 2px,transparent 3px),linear-gradient(28deg,transparent 0 34%,color-mix(in srgb,var(--accent) 25%,transparent) 34.2% 34.45%,transparent 34.7%),linear-gradient(151deg,transparent 0 53%,color-mix(in srgb,var(--accent2) 25%,transparent) 53.2% 53.45%,transparent 53.7%);mask-image:radial-gradient(ellipse at center,#000,transparent 72%);pointer-events:none}
  .loading-terminal{width:min(620px,100%);padding:0;overflow:hidden;border-color:var(--border-strong);box-shadow:0 26px 80px rgb(var(--shadow-rgb) / .3)}
  header{display:flex;justify-content:space-between;gap:14px;padding:10px 14px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .03);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .loading-content{padding:clamp(22px,5vw,38px)}
  .loading-identity{display:flex;align-items:center;gap:15px}
  .loading-mark{display:grid;width:54px;height:54px;flex:0 0 auto;place-items:center}
  .loading-mark :global(.brand-mark){display:block;width:100%;height:100%}
  .eyebrow{margin:0}
  h1{margin:4px 0 0;font:700 clamp(1.45rem,4vw,2rem)/1.1 var(--mono);letter-spacing:-.04em}
  .loading-detail{max-width:58ch;margin:18px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}
  .loading-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:24px 0 0;padding:0;list-style:none}
  .loading-stages li{position:relative;min-width:0;padding:11px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .loading-stages li>span{display:block;color:var(--muted);font:650 .56rem var(--mono)}
  .loading-stages strong,.loading-stages small{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .loading-stages strong{font:650 var(--text-2xs) var(--mono)}
  .loading-stages small{color:var(--muted);font-size:.58rem}
  .loading-stages li.active{border-color:var(--accent);background:rgb(var(--accent-rgb) / .07);box-shadow:inset 2px 0 var(--accent)}
  .loading-stages li.active>span,.loading-stages li.active small{color:var(--accent)}
  .loading-stages li.complete{border-color:color-mix(in srgb,var(--accent2) 60%,var(--border));box-shadow:inset 2px 0 var(--accent2)}
  .loading-stages li.complete>span,.loading-stages li.complete small{color:var(--accent2)}
  .loading-scan{height:2px;margin-top:22px;overflow:hidden;border-radius:999px;background:var(--border)}
  .loading-scan span{display:block;width:36%;height:100%;background:linear-gradient(90deg,transparent,var(--accent2),var(--accent),transparent);animation:console-scan 1.45s ease-in-out infinite}
  .loading-command{display:flex;align-items:center;gap:7px;margin:12px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .loading-command>span{color:var(--accent2);font-weight:800}
  .loading-command i{display:inline-block;width:6px;height:12px;background:var(--accent2);box-shadow:0 0 7px rgb(var(--accent2-rgb) / .4);animation:console-cursor 1s steps(1,end) infinite}
  @keyframes console-scan{from{transform:translateX(-105%)}to{transform:translateX(280%)}}
  @keyframes console-cursor{0%,55%,100%{opacity:1}55.01%,99.99%{opacity:0}}
  @media(max-width:560px){
    .console-loading{place-items:start center;padding:clamp(76px,14vh,108px) 14px 24px}
    header{font-size:.55rem}
    .loading-content{padding:22px 18px}
    .loading-mark{width:46px;height:46px}
    .loading-stages{grid-template-columns:1fr}
    .loading-stages li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:6px;padding:9px 10px}
    .loading-stages strong,.loading-stages small{margin:0}
  }
  @media(prefers-reduced-motion:reduce){.loading-scan span,.loading-command i{animation:none}.loading-scan span{width:100%}}
</style>
