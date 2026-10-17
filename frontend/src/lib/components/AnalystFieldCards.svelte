<script lang="ts">
  import { WHOISLEUTH_SITE_ORIGIN } from '../../../../packages/analysis/project-metadata.mts';
</script>

<section class="field-cards" aria-label="Printable analyst reference">
  <header>
    <h2>Four checks before the next step</h2>
    <p>WHOISleuth {__WHOISLEUTH_VERSION__} · Analyst field reference</p>
  </header>
  <div class="cards">
    <article>
      <h3>1. Identify the scope</h3>
      <ul>
        <li>Name the exact object: domain, hostname, URL, address, certificate or file.</li>
        <li>Keep the source, observation time and collection method beside the finding.</li>
        <li>Separate a source value from a normalised value or analyst interpretation.</li>
      </ul>
      <p>Not retained means unknown. Do not reconstruct a page path, query or source time.</p>
    </article>
    <article>
      <h3>2. Read the source state</h3>
      <ul>
        <li>Check whether the source answered, and what part of its response was retained.</li>
        <li>Keep a failed or skipped check separate from an observed empty answer.</li>
        <li>Identify the authority for the question; keep supporting context separate.</li>
      </ul>
      <p>Missing DNS or an unreachable page alone does not prove that a domain has been removed.</p>
    </article>
    <article>
      <h3>3. Compare like with like</h3>
      <ul>
        <li>Check the object, source, time and completeness on both sides.</li>
        <li>For captures, review retained viewport, browser, masks and other declared conditions.</li>
        <li>Keep missing observations and unknown conditions visible beside differences.</li>
      </ul>
      <p>A visible change is an observation to explain, not proof of its cause, intent or permanence.</p>
    </article>
    <article>
      <h3>4. Review the handoff</h3>
      <ul>
        <li>Match each conclusion to its exact evidence and unresolved contrary observations.</li>
        <li>Inspect the prepared files, originals or derivatives, recipient and disclosure scope.</li>
        <li>Record preparation, delivery, recipient response and independent recheck separately.</li>
      </ul>
      <p>Matching hashes establish matching bytes, not truth or origin. Preparation is not delivery.</p>
    </article>
  </div>
  <footer>General reference, not a Case report. No saved investigation data is included.<br />{WHOISLEUTH_SITE_ORIGIN}/methodology</footer>
</section>

<style>
  .field-cards{min-width:0;overflow-wrap:anywhere;font:400 var(--text-sm)/1.55 var(--font-sans)}
  header{margin-bottom:18px}h2{margin:0;font:700 var(--text-lg)/1.35 var(--font-sans)}header p{margin:6px 0 0;color:var(--muted)}
  .cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
  article{min-width:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  h3{margin:0;font:700 var(--text-md)/1.4 var(--font-sans)}
  ul{margin:12px 0;padding-left:20px}li+li{margin-top:8px}article p{margin:12px 0 0;color:var(--muted)}
  footer{margin-top:18px;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){.cards{grid-template-columns:1fr}article{padding:14px}}
  @media print{
    .field-cards{padding:1pt;font-size:10pt;line-height:1.4;color:#111}
    header{margin-bottom:12pt}h2{font-size:15pt}header p,footer{font-size:9pt;color:#333}
    .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10pt}
    article{break-inside:avoid;padding:10pt;border:1px solid #aaa;border-radius:0}
    h3{font-size:11pt;break-after:avoid}ul{margin:8pt 0;padding-left:14pt}li+li{margin-top:6pt}article p{margin-top:8pt;color:#333}
    footer{margin-top:12pt}
  }
</style>
