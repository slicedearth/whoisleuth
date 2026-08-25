<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import HomepageProductPreview from '$lib/components/HomepageProductPreview.svelte';
  import PublicConsoleCta from '$lib/components/PublicConsoleCta.svelte';
  import PublicGoalPaths from '$lib/components/PublicGoalPaths.svelte';
  import PublicResourceCards from '$lib/components/PublicResourceCards.svelte';
  import SyntheticTopologyBackdrop from '$lib/components/SyntheticTopologyBackdrop.svelte';
  import { publicGuideGoals } from '$lib/public-guide';
  import { PUBLIC_RESOURCES } from '$lib/public-resources';

  const evidenceSources = [
    ['Registration first','WHOIS and RDAP stay separate, and only authoritative registry evidence decides registration status.'],
    ['Supporting context','DNS, certificates, mail and website checks help explain a domain without overriding registration evidence.'],
    ['A reviewable record','Cases, timelines, relationships and exports keep useful findings together for later review.'],
  ];

</script>

<PublicSeo
  title="WHOISleuth | WHOIS, RDAP and domain investigation"
  description="Check domain registration, DNS, certificates, website platform indicators and network context with clear source attribution."
  path="/"
  website
/>

<section class="hero">
  <SyntheticTopologyBackdrop />
  <div class="hero-copy">
    <p class="eyebrow hero-kicker">Domain intelligence console</p>
    <h1>Understand a domain.<br><span>Before you act.</span></h1>
    <p class="lede">Review WHOIS and RDAP registration data, DNS, certificates, websites and network context without losing where each result came from or what could not be collected.</p>
    <div class="hero-actions"><a class="primary" href="/demo">Try the synthetic demo</a><PublicConsoleCta /></div>
  </div>
  <div class="hero-preview">
    <HomepageProductPreview />
  </div>
</section>

<section class="jobs" id="features" aria-labelledby="jobs-title">
  <div class="section-intro"><p class="eyebrow">Investigate · Respond · Assure</p><h2 id="jobs-title">Start with the work in front of you</h2><p>Investigate a target or candidate set, respond to reviewed findings, or assure retained evidence and controls over time.</p></div>
  <PublicGoalPaths goals={publicGuideGoals} />
</section>

<section class="evidence" aria-labelledby="evidence-title">
  <div class="section-intro"><h2 id="evidence-title">See why the result says what it says</h2><p>Registration status comes from authoritative registry evidence. Other sources add context, and their limits remain visible.</p></div>
  <div class="evidence-grid">{#each evidenceSources as source}<article><h3>{source[0]}</h3><p>{source[1]}</p></article>{/each}</div>
</section>

<section class="learn" aria-labelledby="learn-title">
  <div class="section-intro"><h2 id="learn-title">Learn how the evidence fits together</h2><p>Focused guides explain what each source can support, where it can fail, and what to review next.</p></div>
  <PublicResourceCards resources={PUBLIC_RESOURCES.slice(0,4)} compact />
  <a class="all-resources" href="/resources">Browse the topic library <span aria-hidden="true">→</span></a>
</section>

<section class="principles card" aria-labelledby="principles-title">
  <div><p class="eyebrow">Privacy and storage</p><h2 id="principles-title">Browser-local by default</h2><p>Profiles, cases, watchlists, campaigns, selected relationships and search baselines stay in the current browser by default. Optional scheduled monitoring is a separate configured service.</p></div>
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
  .jobs,.evidence,.learn{padding:72px 0;border-top:1px solid var(--border)}
  .section-intro{max-width:780px;margin-bottom:30px}.section-intro h2,.principles h2{margin:.3rem 0 .7rem;font:700 clamp(1.65rem,3.5vw,2.55rem) var(--mono);letter-spacing:-.045em}.section-intro>p:not(.eyebrow),.principles p{color:var(--muted);line-height:1.65}
  .evidence{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:clamp(34px,7vw,82px);align-items:start}.evidence .section-intro{margin:0}.evidence-grid{display:grid}.evidence-grid article{display:grid;grid-template-columns:minmax(130px,.42fr) minmax(0,1fr);gap:24px;padding:18px 0;border-top:1px solid var(--border)}.evidence-grid article:last-child{border-bottom:1px solid var(--border)}.evidence-grid h3{margin:0;font:700 1rem var(--mono)}.evidence-grid p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.65}
  .principles{margin:35px 0;padding:clamp(24px,5vw,46px);box-shadow:none}.principles>div{max-width:780px}
  .all-resources{display:inline-flex;margin-top:18px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  @media(max-width:980px){.hero{grid-template-columns:1fr}.hero-preview{max-width:760px}}
  @media(max-width:680px){.hero{padding-bottom:62px}.hero h1{font-size:clamp(2.25rem,10vw,2.7rem)}.evidence{grid-template-columns:1fr}.evidence-grid article{grid-template-columns:1fr;gap:7px}.hero-preview :global(.preview-note){text-align:left}}
</style>
