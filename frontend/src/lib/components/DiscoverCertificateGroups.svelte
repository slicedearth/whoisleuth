<script lang="ts">
  import type { CtCertificateGroup } from '$lib/analysis/ct-results.ts';
  let { groups, truncated = false }: { groups: readonly CtCertificateGroup[]; truncated?: boolean } = $props();

  const shared = $derived(groups.filter((group) => group.domains.length > 1));
  const wildcard = $derived(groups.filter((group) => group.wildcardObserved));
</script>

{#if groups.length}
  <section class="certificate-groups card" aria-labelledby="certificate-groups-title">
    <header>
      <div><p class="eyebrow">Certificate relationships</p><h2 id="certificate-groups-title">Issuance groups</h2></div>
      <div class="counts"><span><strong>{groups.length}</strong> retained</span><span><strong>{shared.length}</strong> cross-domain</span><span><strong>{wildcard.length}</strong> wildcard</span></div>
    </header>
    <p class="intro">Each group contains names observed together in one public certificate record. Verify shared issuance independently.</p>
    <div class="group-grid">
      {#each groups.slice(0, 12) as group, index (group.certificateKey)}
        <article>
          <div class="group-head"><strong>Certificate group {index + 1}</strong>{#if group.wildcardObserved}<span>Wildcard</span>{/if}</div>
          {#if group.observedAt}<small>Logged <time datetime={group.observedAt}>{group.observedAt.slice(0, 10)}</time></small>{/if}
          <div class="domains">{#each group.domains as domain}<code>{domain}</code>{/each}</div>
          {#if group.hostnames.length > group.domains.length}<details><summary>{group.hostnames.length} observed names</summary><div class="hosts">{#each group.hostnames as hostname}<code>{hostname}</code>{/each}</div></details>{/if}
        </article>
      {/each}
    </div>
    {#if groups.length > 12 || truncated}<p class="limit">Showing the 12 highest-commonality groups from {groups.length} retained groups.{truncated ? ' The group projection reached its independent cap; the domain result set retains its own completeness state.' : ''}</p>{/if}
  </section>
{/if}

<style>
  .certificate-groups{margin-top:16px;padding:var(--card-pad)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  h2{margin:2px 0 0}
  .counts{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}
  .counts span{padding:7px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:var(--text-2xs) var(--mono)}
  .counts strong{color:var(--text);font-size:var(--text-sm)}
  .intro,.limit{margin:10px 0 0;max-width:920px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .group-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
  article{min-width:0;padding:11px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .group-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .group-head strong{font-size:var(--text-xs)}
  .group-head span{padding:2px 5px;border:1px solid rgb(var(--accent2-rgb) / .4);border-radius:999px;color:var(--accent2);font:600 var(--text-2xs) var(--mono)}
  article>small{display:block;margin-top:5px;color:var(--muted);font-size:var(--text-2xs)}
  .domains,.hosts{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
  code{max-width:100%;padding:3px 5px;overflow-wrap:anywhere;white-space:normal;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:var(--text-2xs)}
  details{margin-top:8px}
  summary{cursor:pointer;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  @media(max-width:900px){.group-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:640px){header{display:grid}.counts{justify-content:flex-start}.group-grid{grid-template-columns:minmax(0,1fr)}}
</style>
