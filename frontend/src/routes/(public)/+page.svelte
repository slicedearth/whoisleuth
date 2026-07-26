<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import HomepageProductPreview from '$lib/components/HomepageProductPreview.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicGoalPaths from '$lib/components/PublicGoalPaths.svelte';
  import SyntheticTopologyBackdrop from '$lib/components/SyntheticTopologyBackdrop.svelte';
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
  <SyntheticTopologyBackdrop />
  <div class="hero-copy">
    <p class="eyebrow hero-kicker">Domain intelligence console</p>
    <h1>Inspect domains.<span>Verify sources.</span></h1>
    <p class="lede">Review registration, DNS, certificate, website and network evidence without hiding conflicting or unavailable sources.</p>
    <div class="hero-actions"><a class="primary" href="/demo">Try the synthetic demo</a><PublicConsoleCta /></div>
  </div>
  <div class="hero-preview">
    <HomepageProductPreview />
  </div>
</section>

<section class="workflow" id="features" aria-labelledby="workflow-title">
  <div class="section-intro"><h2 id="workflow-title">Choose the path that matches your task.</h2><p>Start with one domain, a brand search, or saved evidence that needs another review.</p></div>
  <PublicGoalPaths goals={publicGuideGoals} />
</section>

<section class="evidence" aria-labelledby="evidence-title">
  <div class="section-intro"><h2 id="evidence-title">See why the result says what it says.</h2><p>Registration status comes from authoritative registry evidence. Other sources add context, and their limits remain visible.</p></div>
  <div class="evidence-grid">{#each evidenceSources as source}<article><h3>{source[0]}</h3><p>{source[1]}</p></article>{/each}</div>
</section>

<section class="principles card" aria-labelledby="principles-title">
  <div><p class="eyebrow">Privacy and storage</p><h2 id="principles-title">Keep core investigation work in your browser.</h2><p>Profiles, cases, watchlists, campaigns, selected relationship pivots and search baselines stay in the current browser by default. Optional hosted monitoring stores only compact encrypted evidence for scheduled checks.</p></div>
  <ul><li>No advertising profiles or cross-site tracking</li><li>The public demo uses fixed fictional data</li><li>Compact stores exclude raw registry responses</li><li>A failed check is not treated as a negative finding</li></ul>
</section>

<section class="build" aria-labelledby="build-title">
  <div class="section-intro"><h2 id="build-title">Designed to stay predictable.</h2><p>The technical controls support the investigation workflow instead of hiding uncertainty behind a single answer.</p></div>
  <div class="build-grid">{#each engineeringChoices as choice}<div><strong>{choice[0]}</strong><span>{choice[1]}</span></div>{/each}</div>
</section>

<style>
  .hero{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(320px,.78fr) minmax(520px,1.22fr);gap:clamp(30px,5vw,64px);align-items:center;padding:18px 0 78px;overflow:hidden}
  .hero-copy,.hero-preview{position:relative;z-index:1}
  .hero-kicker{margin:0 0 18px}
  .hero h1{max-width:620px;margin:.35rem 0 1rem;font:750 clamp(2.45rem,4vw,3rem)/1 var(--mono);letter-spacing:-.065em}
  .hero h1 span{display:block;color:var(--accent)}
  .lede{max-width:56ch;color:var(--muted);font-size:clamp(1rem,1.5vw,1.1rem);line-height:1.7}
  .hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
  .hero-actions a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 16px;border-radius:var(--radius-sm);font:750 var(--text-xs) var(--mono)}
  .hero-actions .primary{color:var(--primary-text);background:linear-gradient(135deg,var(--primary-start),var(--primary-end))}
  .hero-preview{min-width:0}
  .hero-preview :global(.preview-panel){box-shadow:0 18px 48px rgb(var(--shadow-rgb) / .16)}
  .workflow,.evidence,.build{padding:72px 0;border-top:1px solid var(--border)}
  .section-intro{max-width:780px;margin-bottom:30px}.section-intro h2,.principles h2{margin:.3rem 0 .7rem;font:700 clamp(1.65rem,3.5vw,2.55rem) var(--mono);letter-spacing:-.045em}.section-intro>p:not(.eyebrow),.principles p{color:var(--muted);line-height:1.65}
  .evidence{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:clamp(34px,7vw,82px);align-items:start}.evidence .section-intro{margin:0}.evidence-grid{display:grid}.evidence-grid article{display:grid;grid-template-columns:minmax(130px,.42fr) minmax(0,1fr);gap:24px;padding:18px 0;border-top:1px solid var(--border)}.evidence-grid article:last-child{border-bottom:1px solid var(--border)}.evidence-grid h3{margin:0;font:700 1rem var(--mono)}.evidence-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.65}
  .principles{display:grid;grid-template-columns:1.15fr .85fr;gap:50px;margin:35px 0;padding:clamp(24px,5vw,46px);box-shadow:none}.principles ul{display:grid;gap:10px;margin:0;padding:0;list-style:none}.principles li{padding:11px 12px;border-left:2px solid var(--accent2);background:rgb(var(--accent2-rgb) / .035);color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .build-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border)}.build-grid div{display:grid;gap:7px;padding:18px;background:var(--bg)}.build-grid strong{font:700 var(--text-xs) var(--mono)}.build-grid span{color:var(--muted);font-size:var(--text-2xs);line-height:1.55}
  @media(max-width:980px){.hero{grid-template-columns:1fr}.hero-preview{max-width:760px}.build-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:680px){.hero{padding-bottom:62px}.hero h1{font-size:clamp(2.25rem,10vw,2.7rem)}.evidence,.principles,.build-grid{grid-template-columns:1fr}.evidence-grid article{grid-template-columns:1fr;gap:7px}.hero-preview :global(.preview-note){text-align:left}}
</style>
