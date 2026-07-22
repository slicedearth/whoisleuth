<script lang="ts">
  let {
    domains,
    existingDomains,
    truncated,
    openDomain,
  }: {
    domains: string[];
    existingDomains: Set<string>;
    truncated: boolean;
    openDomain: (domain: string) => void | Promise<void>;
  } = $props();
</script>

<section id="case-review-queue" class="guided-case-queue card" aria-labelledby="guided-case-queue-title" tabindex="-1">
  <div>
    <p class="eyebrow">Guided review queue</p>
    <h2 id="guided-case-queue-title">{domains.length} domain{domains.length === 1 ? '' : 's'} carried from Bulk</h2>
    <p>Open only the cases you intend to retain. Nothing is created automatically.</p>
  </div>
  <ul>
    {#each domains as domain}
      <li>
        <div><strong>{domain}</strong><small>{existingDomains.has(domain) ? 'Case already exists' : 'Not yet retained'}</small></div>
        <button class="btn compact" type="button" aria-label={`${existingDomains.has(domain) ? 'Open existing case' : 'Open case'} for ${domain}`} onclick={() => openDomain(domain)}>{existingDomains.has(domain) ? 'Open existing' : 'Open case'}</button>
      </li>
    {/each}
  </ul>
  {#if truncated}<p class="limit-note" role="note">The guide retained the first 25 canonical domains. The Bulk results remain available in this tab for reviewing the rest.</p>{/if}
</section>

<style>
  .guided-case-queue{margin-bottom:16px;padding:16px;scroll-margin-top:76px}
  .guided-case-queue h2{margin:3px 0 5px;font-size:var(--text-lg)}
  .guided-case-queue>div>p:last-child,.limit-note{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  ul{display:grid;gap:8px;margin:14px 0 0;padding:0;list-style:none}
  li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  li div{min-width:0;display:grid;gap:2px}
  li strong{overflow-wrap:anywhere;font-family:var(--mono);font-size:var(--text-sm)}
  li small{color:var(--muted);font-size:var(--text-2xs)}
  .limit-note{margin-top:10px}
  @media(max-width:560px){li{align-items:stretch;flex-direction:column}.btn{width:100%}}
</style>
