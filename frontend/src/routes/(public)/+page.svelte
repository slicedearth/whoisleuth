<script lang="ts">
  import { workspaces } from '$lib/workspaces';

  const evidenceSources = [
    ['Registry intelligence','RDAP and WHOIS remain separately attributed, with authority-aware availability decisions.'],
    ['Infrastructure signals','DNS, certificates, mail posture, HTTP behavior, and page identity add bounded context.'],
    ['Analyst workflow','Shortlists, watchlists, cases, timelines, relationships, and evidence exports support review.'],
  ];
</script>

<svelte:head>
  <title>WHOISleuth · Domain intelligence and brand investigation</title>
  <meta name="description" content="Investigate domains with separately attributed RDAP, WHOIS, DNS, certificate, website, and analyst evidence.">
</svelte:head>

<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Domain intelligence workbench</p>
    <h1>Investigate domains.<br><span>Preserve the evidence trail.</span></h1>
    <p class="lede">WHOISleuth brings registration, infrastructure, certificate, website, and brand context into one explainable investigation workflow—without turning an unavailable source into a claim of safety or absence.</p>
    <div class="hero-actions"><a class="primary" href="/login">Open protected console</a><a class="btn" href="/demo">Explore synthetic demo</a></div>
    <p class="access-note"><span aria-hidden="true">●</span> Public overview · Password-protected investigation tools</p>
  </div>
  <div class="terminal-preview card" aria-label="Example WHOISleuth evidence summary">
    <div class="terminal-bar"><span></span><span></span><span></span><code>lookup --deep example.test</code></div>
    <div class="terminal-body">
      <p><span class="prompt">❯</span> evidence_sources <strong>6</strong></p>
      <dl>
        <div><dt>Registration</dt><dd><span class="state observed">observed</span> Registry RDAP</dd></div>
        <div><dt>Registrar</dt><dd><span class="state separate">separate</span> Related RDAP</dd></div>
        <div><dt>Website</dt><dd><span class="state review">review</span> Redirect observed</dd></div>
        <div><dt>Interpretation</dt><dd><span class="state neutral">bounded</span> Analyst review required</dd></div>
      </dl>
      <p class="terminal-note">// provenance retained; missing data remains inconclusive</p>
    </div>
  </div>
</section>

<section class="workflow" id="features" aria-labelledby="workflow-title">
  <div class="section-intro"><p class="eyebrow">Investigation workflow</p><h2 id="workflow-title">From a single lookup to monitored evidence.</h2><p>Five focused workspaces share bounded evidence without collapsing distinct sources into one unexplained answer.</p></div>
  <div class="workspace-grid">{#each workspaces as item,index}<article class="card"><span>0{index+1}</span><h3>{item.label}</h3><p>{item.detail}.</p><a href="/login?next={encodeURIComponent(item.href)}">Open after sign-in <span aria-hidden="true">→</span></a></article>{/each}</div>
</section>

<section class="evidence" aria-labelledby="evidence-title">
  <div class="section-intro"><p class="eyebrow">Designed for defensible analysis</p><h2 id="evidence-title">Evidence stays attributed and explainable.</h2></div>
  <div class="evidence-grid">{#each evidenceSources as source}<article><span aria-hidden="true">+</span><div><h3>{source[0]}</h3><p>{source[1]}</p></div></article>{/each}</div>
</section>

<section class="principles card" aria-labelledby="principles-title">
  <div><p class="eyebrow">Privacy-conscious by default</p><h2 id="principles-title">Local investigation state. Deliberate hosted features.</h2><p>Ordinary profiles, cases, watchlists, campaigns, and search baselines stay in the browser. Optional hosted monitoring is separately enabled and stores only bounded application-encrypted compact evidence.</p></div>
  <ul><li>No advertising profiles or cross-site tracking</li><li>Synthetic public demo makes no live lookup request</li><li>Raw registry payloads stay out of compact stores</li><li>Failures remain explicit instead of becoming negative findings</li></ul>
</section>

<section class="build" aria-labelledby="build-title">
  <div class="section-intro"><p class="eyebrow">Engineering</p><h2 id="build-title">Built as an investigation system, not a lookup form.</h2></div>
  <div class="build-grid"><div><strong>TypeScript + SvelteKit</strong><span>Accessible multi-workspace frontend</span></div><div><strong>Bounded network processing</strong><span>Timeouts, caps, SSRF and rebinding defenses</span></div><div><strong>Fixture-driven verification</strong><span>Registry behavior tested without live network calls</span></div><div><strong>Portable deployment</strong><span>Express and optional Netlify execution paths</span></div></div>
</section>

<style>
  .hero{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(390px,.92fr);gap:clamp(34px,7vw,82px);align-items:center;padding:18px 0 90px}
  .hero h1{max-width:760px;margin:.35rem 0 1rem;font:750 clamp(2.6rem,6.5vw,5.4rem)/.97 var(--mono);letter-spacing:-.075em}
  .hero h1 span{color:var(--accent)}
  .lede{max-width:68ch;color:var(--muted);font-size:clamp(1rem,1.7vw,1.16rem);line-height:1.7}
  .hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
  .hero-actions a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 16px;border-radius:var(--radius-sm);font:750 var(--text-xs) var(--mono)}
  .hero-actions .primary{color:#07101c;background:linear-gradient(135deg,#75c2ff,#4a9ff3)}
  .access-note{display:flex;align-items:center;gap:8px;margin:16px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .access-note span{color:var(--accent2);text-shadow:0 0 8px rgba(126,224,168,.65)}
  .terminal-preview{overflow:hidden;background:#11141a;box-shadow:0 28px 80px rgba(0,0,0,.3)}
  .terminal-bar{display:flex;align-items:center;gap:7px;padding:11px 13px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.025)}
  .terminal-bar>span{width:8px;height:8px;border-radius:50%;background:var(--border)}
  .terminal-bar>span:first-child{background:var(--danger)}.terminal-bar>span:nth-child(2){background:var(--amber)}.terminal-bar>span:nth-child(3){background:var(--accent2)}
  .terminal-bar code{min-width:0;margin-left:6px;overflow:hidden;color:var(--muted);font-size:var(--text-2xs);text-overflow:ellipsis;white-space:nowrap}
  .terminal-body{padding:20px}.terminal-body>p{margin:0;color:var(--muted);font:var(--text-xs) var(--mono)}.terminal-body .prompt{margin-right:8px;color:var(--accent2)}.terminal-body strong{color:var(--text)}
  .terminal-body dl{display:grid;gap:1px;margin:17px 0;background:var(--border)}.terminal-body dl div{display:grid;grid-template-columns:105px 1fr;gap:12px;padding:11px;background:#11141a}.terminal-body dt{color:var(--muted);font:var(--text-2xs) var(--mono)}.terminal-body dd{min-width:0;margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .state{display:inline-block;width:68px;margin-right:7px;font:700 var(--text-2xs) var(--mono)}.state.observed{color:var(--accent2)}.state.separate{color:var(--accent)}.state.review{color:var(--amber)}.state.neutral{color:var(--muted)}
  .terminal-body .terminal-note{color:#68707f;line-height:1.55}
  .workflow,.evidence,.build{padding:72px 0;border-top:1px solid var(--border)}
  .section-intro{max-width:780px;margin-bottom:30px}.section-intro h2,.principles h2{margin:.3rem 0 .7rem;font:700 clamp(1.65rem,3.5vw,2.55rem) var(--mono);letter-spacing:-.045em}.section-intro>p:not(.eyebrow),.principles p{color:var(--muted);line-height:1.65}
  .workspace-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.workspace-grid article{display:flex;min-width:0;min-height:220px;flex-direction:column;padding:20px}.workspace-grid article>span{color:var(--accent2);font:700 var(--text-2xs) var(--mono)}.workspace-grid h3{margin:18px 0 8px;font:700 1.05rem var(--mono)}.workspace-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.workspace-grid a{margin-top:auto;padding-top:22px;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}.evidence-grid article{display:flex;gap:13px}.evidence-grid article>span{color:var(--accent2);font:700 1.1rem var(--mono)}.evidence-grid h3{margin:0 0 8px;font:700 1rem var(--mono)}.evidence-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.65}
  .principles{display:grid;grid-template-columns:1.15fr .85fr;gap:50px;margin:35px 0;padding:clamp(24px,5vw,46px)}.principles ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.principles li{padding:11px 12px;border-left:2px solid var(--accent2);background:rgba(126,224,168,.035);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .build-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border)}.build-grid div{display:grid;gap:7px;padding:18px;background:var(--bg)}.build-grid strong{font:700 var(--text-xs) var(--mono)}.build-grid span{color:var(--muted);font-size:var(--text-2xs);line-height:1.55}
  @media(max-width:980px){.hero{grid-template-columns:1fr}.terminal-preview{max-width:650px}.workspace-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace-grid article:last-child{grid-column:span 2}.build-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:680px){.hero{padding-bottom:62px}.hero h1{font-size:clamp(2.3rem,13vw,3.5rem)}.terminal-body dl div{grid-template-columns:1fr}.workspace-grid,.evidence-grid,.principles,.build-grid{grid-template-columns:1fr}.workspace-grid article:last-child{grid-column:auto}.workspace-grid article{min-height:0}}
</style>
