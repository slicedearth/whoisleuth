<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import {
    FAVICON_FETCH_TIMEOUT_MS,
    HOMEPAGE_FETCH_TIMEOUT_MS,
    MAX_FAVICON_BYTES,
    MAX_FAVICON_CANDIDATES,
    MAX_HOMEPAGE_BYTES,
    MAX_OUTBOUND_REDIRECTS,
  } from '../../../../../lib/outbound-request-bounds.mts';
  import { WHOISLEUTH_REQUEST_POLICY_URL } from '../../../../../lib/project-metadata.mts';

  const seconds = (milliseconds: number) => Math.round(milliseconds / 1_000);
  const bytes = (value: number) => value.toLocaleString('en-US');
</script>

<PublicSeo
  title="Automated request policy | WHOISleuth"
  description="How WHOISleuth identifies and bounds its automated HTTP requests, including homepage, favicon, policy and optional provider lookups."
  path="/request-policy"
/>

<article class="policy-page">
  <header>
    <p class="eyebrow">Outbound transparency</p>
    <h1>Automated request policy</h1>
    <p>WHOISleuth is a defensive domain-investigation tool. Its HTTP collectors identify themselves with a project-specific User-Agent and operate within fixed request, redirect, timeout, and response-size limits.</p>
  </header>

  <section aria-labelledby="identity-title">
    <h2 id="identity-title">Request identity</h2>
    <pre>WHOISleuth/{__WHOISLEUTH_VERSION__} (+{WHOISLEUTH_REQUEST_POLICY_URL})</pre>
    <p>The identifier is used for bounded homepage, favicon, Certificate Transparency, MTA-STS policy, and explicitly enabled optional-provider requests. RDAP, WHOIS, DNS, and TLS connections use their own protocol contracts.</p>
  </section>

  <section aria-labelledby="web-title">
    <h2 id="web-title">Website observation</h2>
    <ul>
      <li>Fetches only the homepage origin submitted for a Deep investigation; it does not crawl site paths, follow ordinary page links, submit forms, log in, or execute page scripts.</li>
      <li>Tries HTTPS first and HTTP only as a fallback. Redirects are revalidated and capped at {MAX_OUTBOUND_REDIRECTS} hops.</li>
      <li>Uses a {seconds(HOMEPAGE_FETCH_TIMEOUT_MS)}-second homepage deadline and caps the retained homepage body at {bytes(MAX_HOMEPAGE_BYTES)} bytes.</li>
      <li>Checks at most {MAX_FAVICON_CANDIDATES} declared or conventional favicon candidates in priority order, one at a time, with a {seconds(FAVICON_FETCH_TIMEOUT_MS)}-second deadline and {bytes(MAX_FAVICON_BYTES)}-byte cap per candidate.</li>
      <li>Blocks private, loopback, link-local, multicast, reserved, and other non-public destinations and revalidates every redirect against DNS-rebinding controls.</li>
      <li>Does not retain cookies, credentials, authorization headers, request bodies, URL fragments, or downloaded files.</li>
    </ul>
  </section>

  <section aria-labelledby="other-title">
    <h2 id="other-title">Other bounded HTTP requests</h2>
    <p>Certificate-log search, the advertised MTA-STS policy file, and optional lookup-only intelligence providers use separately documented limits. Optional providers are disabled unless the deployment operator enables them and the analyst selects them. WHOISleuth never submits a scan, indicator, sample, abuse report, or takedown request through these adapters.</p>
  </section>

  <section aria-labelledby="control-title">
    <h2 id="control-title">Operator controls and concerns</h2>
    <p>The hosted Console is access-controlled and applies request-rate, concurrency, and operation-cost limits. Self-hosted operators are responsible for their own users, deployment configuration, egress, and compliance with upstream terms.</p>
    <p>If WHOISleuth traffic is causing a problem, use the <a href="/contact">protected contact form</a> and include the affected hostname, approximate UTC time, and relevant request details. Do not include passwords, tokens, or unnecessary personal data.</p>
  </section>
</article>

<style>
  .policy-page{max-width:900px;margin:0 auto;padding:8px 0 58px}
  header{padding-bottom:34px;border-bottom:1px solid var(--border)}
  h1{margin:.35rem 0 1rem;font:750 clamp(2.25rem,5vw,3.65rem)/1.02 var(--mono);letter-spacing:-.06em}
  header>p:not(.eyebrow),section p,li{color:var(--muted);line-height:1.7}
  section{padding:30px 0;border-bottom:1px solid var(--border)}
  h2{margin:0 0 12px;font:700 clamp(1.35rem,3vw,1.9rem) var(--mono);letter-spacing:-.035em}
  section a{color:var(--accent);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
  pre{max-width:100%;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow-wrap:anywhere;white-space:pre-wrap;background:var(--panel)}
  li+li{margin-top:7px}
</style>
