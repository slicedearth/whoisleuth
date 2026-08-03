<script lang="ts">
  import PublicSeo from '$lib/components/PublicSeo.svelte';
</script>

<PublicSeo
  title="Terms and acceptable use | WHOISleuth"
  description="The defensive-use, authorization, data-handling, registry-policy, and human-review conditions for using WHOISleuth."
  path="/terms"
/>

<article class="terms-page">
  <header>
    <p class="eyebrow">Use conditions</p>
    <h1>Terms and acceptable use</h1>
    <p>WHOISleuth is provided for lawful, defensive domain research, administration, brand protection, incident response, and education. These conditions apply to the public deployment; self-hosted operators must establish and enforce their own lawful-use controls.</p>
    <small>Effective 4 August 2026</small>
  </header>

  <section><h2>Use only with authority and a lawful purpose</h2><p>You are responsible for ensuring that your investigation is lawful, proportionate, and permitted by every relevant registry, registrar, network, provider, and data-source policy. Access to the Console does not grant authority to assess a system or obtain nonpublic information.</p></section>

  <section><h2>Prohibited use</h2><p>Do not use WHOISleuth to:</p><ul>
    <li>access or assess systems that you are not authorized to assess;</li>
    <li>bypass authentication, CAPTCHAs, technical blocks, quotas, or registry restrictions;</li>
    <li>conduct prohibited automated or Bulk registration-data queries;</li>
    <li>harvest personal contact details, send unsolicited communications, or resell or redistribute raw registration data;</li>
    <li>harass, stalk, dox, intimidate, discriminate against, or unlawfully profile a person;</li>
    <li>evade limits by rotating accounts, sessions, addresses, or deployment instances;</li>
    <li>automatically accuse, report, block, suspend, or seek enforcement against a domain without human review and sufficient evidence; or</li>
    <li>develop, facilitate, or conceal phishing, credential theft, malware delivery, unauthorized access, or other harmful activity.</li>
  </ul></section>

  <section><h2>Evidence and decisions</h2><p>WHOISleuth provides bounded observations and explainable review aids, not legal conclusions, attribution, or a guarantee of ownership, control, availability, safety, or maliciousness. Keep unavailable and contradictory sources visible. Review every export, disclosure request, abuse report, and defensive control before using it.</p></section>

  <section><h2>Data and upstream policies</h2><p>Do not retain, disclose, or export more personal or sensitive data than is necessary. Respect source-specific storage, caching, commercial-use, attribution, and redistribution terms. The <a href="/privacy">privacy policy</a> explains what the public deployment processes, while the <a href="/request-policy">automated request policy</a> explains bounded outbound behavior.</p></section>

  <section><h2>Availability and responsibility</h2><p>The service may be changed, limited, suspended, or withdrawn. Data sources can be delayed, incomplete, unavailable, or wrong. You remain responsible for validating evidence and for the consequences of your investigation, retention, disclosure, reporting, or defensive action.</p></section>

  <section><h2>Questions or concerns</h2><p>Use the <a href="/contact">protected contact form</a> for privacy requests, request-policy concerns, or service questions. Do not send credentials, secrets, raw personal registration data, or unnecessary investigation evidence.</p></section>
</article>

<style>
  .terms-page{max-width:900px;margin:0 auto;padding:8px 0 58px}
  header{padding-bottom:34px;border-bottom:1px solid var(--border)}
  h1{margin:.35rem 0 1rem;font:750 clamp(2.25rem,5vw,3.65rem)/1.02 var(--mono);letter-spacing:-.06em}
  header>p:not(.eyebrow),section p,li,small{color:var(--muted);line-height:1.7}
  section{padding:30px 0;border-bottom:1px solid var(--border)}
  h2{margin:0 0 12px;font:700 clamp(1.35rem,3vw,1.9rem) var(--mono);letter-spacing:-.035em}
  li+li{margin-top:7px}
</style>
