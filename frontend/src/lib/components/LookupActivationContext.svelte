<script lang="ts">
  import type { ActivationContext } from '$lib/analysis/activation-context.ts';

  let { context }: { context: ActivationContext } = $props();
</script>

<section class="activation-context card" aria-labelledby="activation-context-title">
  <header>
    <p class="eyebrow">Cross-layer context</p>
    <h4 id="activation-context-title">Observed service relationship</h4>
    <p>Compare current web and mail evidence without treating point-in-time records as activation dates.</p>
  </header>
  <div class="context-grid">
    <article class:attention={context.web.state === 'inconclusive'}>
      <span>Web</span>
      <strong>{context.web.label}</strong>
      <p>{context.web.detail}</p>
    </article>
    <article class:attention={context.mail.state === 'inconclusive' || context.mail.state === 'mail_auth_gap'}>
      <span>Mail</span>
      <strong>{context.mail.label}</strong>
      <p>{context.mail.detail}</p>
    </article>
    <article class:attention={context.relationship.state === 'inconclusive'}>
      <span>Comparison</span>
      <strong>{context.relationship.label}</strong>
      <p>{context.relationship.detail}</p>
    </article>
  </div>
  <details>
    <summary>Interpretation limits</summary>
    <ul>
      {#each context.limitations as limitation}
        <li>{limitation}</li>
      {/each}
    </ul>
  </details>
</section>

<style>
  .activation-context{min-width:0;padding:var(--card-pad)}
  header h4{margin:0;font-size:var(--text-lg)}
  header p:not(.eyebrow){max-width:720px;margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .context-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.attention{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article span,article strong{display:block}
  article span{color:var(--muted);font:var(--text-2xs) var(--mono);text-transform:uppercase}
  article strong{margin-top:3px;font-size:var(--text-xs)}
  article p{margin:5px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  details{margin-top:9px}
  summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  details ul{margin:7px 0 0;padding-left:18px;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:760px){.context-grid{grid-template-columns:minmax(0,1fr)}}
</style>
