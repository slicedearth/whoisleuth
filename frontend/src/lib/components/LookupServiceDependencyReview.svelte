<script lang="ts">
  import type { ServiceDependencyReview } from '$lib/analysis/service-dependency-review.ts';
  import BoundedRelationshipMap from '$lib/components/BoundedRelationshipMap.svelte';
  import type {
    ForceGraphLinkInput,
    ForceGraphNodeInput,
  } from '$lib/analysis/visualization-models.ts';

  type TechnologyFinding = { id: string; name: string; category: string; confidence: string };
  type LibraryFinding = { id: string; name: string; version: string };

  let {
    review,
    target = 'Lookup target',
    technologies = [],
    libraries = [],
    authorizedScope = $bindable(''),
    falsePositiveTargets = $bindable(''),
  }: {
    review: ServiceDependencyReview;
    target?: string;
    technologies?: TechnologyFinding[];
    libraries?: LibraryFinding[];
    authorizedScope?: string;
    falsePositiveTargets?: string;
  } = $props();

  const dependencyMap = $derived.by(() => {
    const rootId = 'lookup-target';
    const nodes = new Map<string, ForceGraphNodeInput>([[
      rootId,
      { id: rootId, label: target || 'Lookup target', kind: 'target' },
    ]]);
    const links: ForceGraphLinkInput[] = [];
    for (const [index, dependency] of review.dependencies.entries()) {
      const id = `dependency-${index}`;
      nodes.set(id, {
        id,
        label: dependency.target,
        kind: 'dependency',
        detail: [
          dependency.recordType,
          dependency.relation,
          dependency.serviceFamily,
          dependency.scope === 'authorized' ? 'within reviewed scope' : dependency.scope === 'outside' ? 'outside reviewed scope' : '',
        ].filter(Boolean).join(' · '),
      });
      links.push({
        id: `dependency-link-${index}`,
        source: rootId,
        target: id,
        kind: 'observed',
        detail: dependency.provenance,
      });
    }
    for (const [index, technology] of technologies.entries()) {
      const id = `technology-${technology.id || index}`;
      nodes.set(id, {
        id,
        label: technology.name,
        kind: 'technology',
        detail: `${technology.category} · ${technology.confidence} confidence`,
      });
      links.push({
        id: `technology-link-${index}`,
        source: rootId,
        target: id,
        kind: 'derived',
        detail: 'Derived from already-collected static page and response evidence.',
      });
    }
    for (const [index, library] of libraries.entries()) {
      const id = `library-${library.id || index}`;
      nodes.set(id, {
        id,
        label: `${library.name} ${library.version}`.trim(),
        kind: 'technology',
        detail: 'Passive component catalogue match',
      });
      links.push({
        id: `library-link-${index}`,
        source: rootId,
        target: id,
        kind: 'derived',
        detail: 'Derived from already-captured bounded script evidence.',
      });
    }
    return { nodes: [...nodes.values()], links };
  });
</script>

<details class="dependency-review card">
  <summary>
    <span>Service dependency review</span>
    <span class:attention={review.state === 'review'} class:unavailable={review.state === 'unavailable'}>{review.label}</span>
  </summary>
  <div class="body">
    <p class="intro">Surface observed DNS aliases for a conservative manual dangling-service check. WHOISleuth does not follow targets or test whether a service can be claimed.</p>
    <label class="scope-control">
      <span>Reviewed service scope <small>Optional, local to this Lookup view</small></span>
      <textarea
        bind:value={authorizedScope}
        rows="2"
        maxlength="1200"
        placeholder="Expected service target or namespace, one per line"
        aria-describedby="dependency-scope-help"
      ></textarea>
      <small id="dependency-scope-help">Enter only targets or parent namespaces you have independently confirmed as expected. A match organises review; it does not verify an account or service assignment.</small>
    </label>
    <label class="scope-control">
      <span>Reviewed false positives <small>Optional, local to this Lookup view</small></span>
      <textarea
        bind:value={falsePositiveTargets}
        rows="2"
        maxlength="1200"
        placeholder="Exact observed target, one per line"
        aria-describedby="dependency-false-positive-help"
      ></textarea>
      <small id="dependency-false-positive-help">Exclude only a target you have reviewed. This changes the local review label without deleting or rewriting the observed DNS or HTTP evidence.</small>
    </label>
    <BoundedRelationshipMap
      title="Observed services and technology"
      description="The target is connected to observed DNS dependencies and separately derived static technology indicators. Dashed lines identify derived indicators."
      nodes={dependencyMap.nodes}
      links={dependencyMap.links}
    />
    {#if review.dependencies.length}
      <div class="dependency-grid">
        {#each review.dependencies as dependency}
          <article class:attention={dependency.state === 'candidate' || dependency.state === 'unresolved'}>
            <header><span>{dependency.recordType}</span><strong>{dependency.state.replaceAll('_', ' ')}</strong></header>
            <code>{dependency.target}</code>
            {#if dependency.serviceFamily}<p class="classification">{dependency.serviceFamily}</p>{/if}
            {#if dependency.scope !== 'unspecified'}
              <p class:scope-match={dependency.scope === 'authorized'} class="scope-state">
                {dependency.scope === 'authorized' ? 'Within reviewed scope' : 'Outside reviewed scope'}
              </p>
            {/if}
            <p>{dependency.detail}</p>
            <small>{dependency.provenance}</small>
          </article>
        {/each}
      </div>
    {/if}
    <section class="next-steps" aria-labelledby="dependency-next-steps-title">
      <h5 id="dependency-next-steps-title">Manual verification</h5>
      <ol>{#each review.nextSteps as step}<li>{step}</li>{/each}</ol>
    </section>
    <details class="limits">
      <summary>Interpretation limits</summary>
      <ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    </details>
  </div>
</details>

<style>
  .dependency-review{min-width:0;padding:0}
  .dependency-review>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .dependency-review>summary:focus-visible,.limits>summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
  .dependency-review>summary span:last-child{color:var(--muted);font-size:var(--text-2xs);text-align:right}
  .dependency-review>summary span.attention{color:var(--amber)}
  .dependency-review>summary span.unavailable{color:var(--muted)}
  .body{display:grid;gap:11px;padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .intro{max-width:820px;margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .scope-control{display:grid;gap:6px;max-width:760px;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .scope-control>span{font:700 var(--text-xs) var(--mono)}
  .scope-control>span small{margin-left:6px;color:var(--muted);font:var(--text-2xs) var(--sans)}
  .scope-control textarea{min-width:0;width:100%;resize:vertical;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--text);font:var(--text-xs) var(--mono);line-height:1.5;padding:8px}
  .scope-control textarea:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  .scope-control>small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .dependency-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  article{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  article.attention{border-color:color-mix(in srgb,var(--amber) 38%,var(--border))}
  article header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  article header span{font:700 var(--text-2xs) var(--mono)}
  article header strong{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}
  article.attention header strong{color:var(--amber)}
  article code{display:block;margin-top:7px;color:var(--text);font-size:var(--text-xs);overflow-wrap:anywhere}
  article p{margin:6px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  article p.classification{color:var(--accent-soft);font-weight:700}
  article p.scope-state{color:var(--amber);font-family:var(--mono);text-transform:uppercase}
  article p.scope-state.scope-match{color:var(--cyan)}
  article small{display:block;margin-top:7px;color:var(--muted);font:var(--text-2xs) var(--mono)}
  .next-steps{padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}
  .next-steps h5{margin:0;font:700 var(--text-xs) var(--mono)}
  .next-steps ol,.limits ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .limits>summary{color:var(--muted);font:650 var(--text-2xs) var(--mono);cursor:pointer}
  @media(max-width:760px){
    .dependency-review>summary{align-items:flex-start}
    .dependency-review>summary span:last-child{max-width:48%}
    .dependency-grid{grid-template-columns:minmax(0,1fr)}
  }
</style>
