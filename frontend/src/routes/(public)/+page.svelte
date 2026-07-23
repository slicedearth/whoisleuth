<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import HomepageProductPreview from '$lib/components/HomepageProductPreview.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import { publicGuideGoals } from '$lib/public-guide';

  const evidenceSources = [
    ['Registration first','WHOIS and RDAP stay separate, and only authoritative registry evidence decides registration status.'],
    ['Supporting context','DNS, certificates, mail and website checks help explain a domain without overriding registration evidence.'],
    ['A reviewable record','Cases, timelines, relationships and exports keep useful findings together for later review.'],
  ];

  const engineeringChoices = [
    ['Safe request limits','Network checks have time, size, redirect and concurrency limits.'],
    ['Tested registry handling','Known WHOIS and RDAP formats are checked against local fixtures.'],
    ['Browser-local saved work','Core saved work stays in the current browser by default.'],
    ['Portable operation','The same application can run through Express or optional Netlify functions.'],
  ];
</script>

<PublicSeo
  title="WHOISleuth | WHOIS, RDAP and domain intelligence"
  description="Check domain registration, DNS, certificates, website platform indicators and network context in one place, with clear source attribution and honest handling of missing evidence."
  path="/"
  website
/>

<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow hero-kicker">Domain intelligence console</p>
    <h1>Understand a domain.<br><span>Before you act.</span></h1>
    <p class="lede">Check registration, DNS, certificates, website platform clues and network context in one place. WHOISleuth shows where each result came from, explains missing or conflicting evidence, and lets you save useful findings for later review.</p>
    <div class="hero-actions"><a class="primary" href="/demo">Try the synthetic demo</a><PublicConsoleCta /></div>
    <p class="access-note"><span aria-hidden="true">●</span> The overview and demo are public. Live checks require sign-in.</p>
  </div>
  <div class="terminal-preview card" aria-label="Example WHOISleuth evidence summary">
    <div class="terminal-bar"><span class="terminal-window-red"></span><span class="terminal-window-yellow"></span><span class="terminal-window-green"></span><code>lookup --deep example.test</code></div>
    <div class="terminal-body">
      <p><span class="prompt">❯</span> review_sources <strong>--summary</strong></p>
      <dl>
        <div><dt>Registration</dt><dd><span class="state observed">observed</span> Registry RDAP</dd></div>
        <div><dt>Platform</dt><dd><span class="state clue">clue</span> Static markup</dd></div>
        <div><dt>Network</dt><dd><span class="state context">context</span> IP RDAP</dd></div>
        <div><dt>Conclusion</dt><dd><span class="state neutral">review</span> Analyst judgement required</dd></div>
      </dl>
      <p class="terminal-note">// each source stays visible; missing data is not treated as absence</p>
    </div>
  </div>
</section>

<section class="workflow" id="features" aria-labelledby="workflow-title">
  <div class="section-intro"><p class="eyebrow">Choose a starting point</p><h2 id="workflow-title">Use the path that matches your task.</h2><p>WHOISleuth does not force every investigation through the same sequence. Start with one domain, a brand search, or saved evidence that needs another review.</p></div>
  <div class="goal-grid">{#each publicGuideGoals as goal,index}<article class="card"><span>0{index+1}</span><h3>{goal.title}</h3><p>{goal.summary}</p><ol>{#each goal.steps as step}<li>{step}</li>{/each}</ol><a href={`/guide#${goal.id}`}>Follow this path <span aria-hidden="true">→</span></a></article>{/each}</div>
</section>

<section class="product-tour" aria-labelledby="product-tour-title">
  <div class="section-intro"><p class="eyebrow">Inside the console</p><h2 id="product-tour-title">Move from candidates to evidence and change history.</h2><p>These compact previews use the same fictional fixtures as the public demo, so you can see the workflow without sending a lookup.</p></div>
  <HomepageProductPreview />
  <p class="tour-action"><a class="btn" href="/demo">Explore the interactive demo <span aria-hidden="true">→</span></a></p>
</section>

<section class="evidence" aria-labelledby="evidence-title">
  <div class="section-intro"><p class="eyebrow">Understand the result</p><h2 id="evidence-title">See why the result says what it says.</h2><p>Registration status comes from authoritative registry evidence. Other sources add context, and their limits remain visible.</p></div>
  <div class="evidence-grid">{#each evidenceSources as source}<article><span aria-hidden="true">+</span><div><h3>{source[0]}</h3><p>{source[1]}</p></div></article>{/each}</div>
</section>

<section class="principles card" aria-labelledby="principles-title">
  <div><p class="eyebrow">Privacy and storage</p><h2 id="principles-title">Keep core investigation work in your browser.</h2><p>Profiles, cases, watchlists, campaigns and search baselines stay in the current browser by default. Optional hosted monitoring stores only compact encrypted evidence for scheduled checks.</p></div>
  <ul><li>No advertising profiles or cross-site tracking</li><li>The public demo uses fixed fictional data</li><li>Compact stores exclude raw registry responses</li><li>A failed check is not treated as a negative finding</li></ul>
</section>

<section class="build" aria-labelledby="build-title">
  <div class="section-intro"><p class="eyebrow">How it is built</p><h2 id="build-title">Designed to stay predictable.</h2><p>The technical controls support the investigation workflow instead of hiding uncertainty behind a single answer.</p></div>
  <div class="build-grid">{#each engineeringChoices as choice}<div><strong>{choice[0]}</strong><span>{choice[1]}</span></div>{/each}</div>
</section>

<style>
  .hero{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(390px,.92fr);gap:clamp(34px,7vw,82px);align-items:center;padding:18px 0 90px}
  .hero-kicker{margin:0 0 18px}
  .hero h1{max-width:760px;margin:.35rem 0 1rem;font:750 clamp(2.6rem,6.5vw,5.4rem)/.97 var(--mono);letter-spacing:-.075em}
  .hero h1 span{color:var(--accent)}
  .lede{max-width:68ch;color:var(--muted);font-size:clamp(1rem,1.7vw,1.16rem);line-height:1.7}
  .hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
  .hero-actions a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 16px;border-radius:var(--radius-sm);font:750 var(--text-xs) var(--mono)}
  .hero-actions .primary{color:var(--primary-text);background:linear-gradient(135deg,var(--primary-start),var(--primary-end))}
  .access-note{display:flex;align-items:center;gap:8px;margin:16px 0 0;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .access-note span{color:var(--accent2);text-shadow:0 0 8px rgb(var(--accent2-rgb) / .65)}
  .terminal-preview{--text:var(--terminal-text);--muted:var(--terminal-muted);--border:var(--terminal-border);--overlay-rgb:var(--terminal-overlay-rgb);--shadow-rgb:var(--terminal-shadow-rgb);overflow:hidden;color:var(--terminal-text);background:var(--terminal-bg);box-shadow:0 28px 80px rgb(var(--shadow-rgb) / var(--terminal-shadow-alpha))}
  .terminal-bar{display:flex;align-items:center;gap:7px;padding:11px 13px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .035)}
  .terminal-bar>span{width:8px;height:8px;border-radius:50%;background:var(--border)}
  .terminal-bar>span.terminal-window-red{background:var(--terminal-window-red)}.terminal-bar>span.terminal-window-yellow{background:var(--terminal-window-yellow)}.terminal-bar>span.terminal-window-green{background:var(--terminal-window-green)}
  .terminal-bar code{min-width:0;margin-left:6px;overflow:hidden;color:var(--muted);font-size:var(--text-2xs);text-overflow:ellipsis;white-space:nowrap}
  .terminal-body{padding:20px}.terminal-body>p{margin:0;color:var(--muted);font:var(--text-xs) var(--mono)}.terminal-body .prompt{margin-right:8px;color:var(--accent2)}.terminal-body strong{color:var(--text)}
  .terminal-body dl{display:grid;gap:1px;margin:17px 0;background:var(--border)}.terminal-body dl div{display:grid;grid-template-columns:105px 1fr;gap:12px;padding:11px;background:var(--terminal-panel)}.terminal-body dt{color:var(--muted);font:var(--text-2xs) var(--mono)}.terminal-body dd{min-width:0;margin:0;font-size:var(--text-xs);overflow-wrap:anywhere}
  .state{display:inline-block;width:68px;margin-right:7px;font:700 var(--text-2xs) var(--mono)}.state.observed,.state.context{color:var(--accent2)}.state.clue{color:var(--accent)}.state.neutral{color:var(--muted)}
  .terminal-body .terminal-note{color:var(--muted);line-height:1.55}
  .workflow,.product-tour,.evidence,.build{padding:72px 0;border-top:1px solid var(--border)}
  .section-intro{max-width:780px;margin-bottom:30px}.section-intro h2,.principles h2{margin:.3rem 0 .7rem;font:700 clamp(1.65rem,3.5vw,2.55rem) var(--mono);letter-spacing:-.045em}.section-intro>p:not(.eyebrow),.principles p{color:var(--muted);line-height:1.65}
  .goal-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.goal-grid article{display:flex;min-width:0;min-height:255px;flex-direction:column;padding:20px}.goal-grid article>span{color:var(--accent2);font:700 var(--text-2xs) var(--mono)}.goal-grid h3{margin:18px 0 8px;font:700 1.05rem var(--mono)}.goal-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.goal-grid ol{display:flex;flex-wrap:wrap;gap:5px;margin:18px 0 0;padding:0;list-style:none;counter-reset:steps}.goal-grid li{counter-increment:steps;padding:5px 7px;border:1px solid var(--border);border-radius:999px;font:650 .62rem var(--mono)}.goal-grid li::before{content:counter(steps) ". ";color:var(--accent2)}.goal-grid a{margin-top:auto;padding-top:22px;color:var(--accent);font:700 var(--text-2xs) var(--mono)}
  .tour-action{margin:20px 0 0;text-align:center}
  .evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}.evidence-grid article{display:flex;gap:13px}.evidence-grid article>span{color:var(--accent2);font:700 1.1rem var(--mono)}.evidence-grid h3{margin:0 0 8px;font:700 1rem var(--mono)}.evidence-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.65}
  .principles{display:grid;grid-template-columns:1.15fr .85fr;gap:50px;margin:35px 0;padding:clamp(24px,5vw,46px)}.principles ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.principles li{padding:11px 12px;border-left:2px solid var(--accent2);background:rgb(var(--accent2-rgb) / .035);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .build-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border)}.build-grid div{display:grid;gap:7px;padding:18px;background:var(--bg)}.build-grid strong{font:700 var(--text-xs) var(--mono)}.build-grid span{color:var(--muted);font-size:var(--text-2xs);line-height:1.55}
  @media(max-width:980px){.hero{grid-template-columns:1fr}.terminal-preview{max-width:650px}.build-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:680px){.hero{padding-bottom:62px}.hero h1{font-size:clamp(2.3rem,13vw,3.5rem)}.terminal-body dl div{grid-template-columns:1fr}.goal-grid,.evidence-grid,.principles,.build-grid{grid-template-columns:1fr}.goal-grid article{min-height:0}}
</style>
