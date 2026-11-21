<script lang="ts">
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import {
    lookupKeyFactProvenance,
    lookupKeyFactValueText,
    type LookupKeyFact,
    type LookupKeyFactSection,
  } from '../../../../lib/lookup-key-facts.mts';

  let { facts }: { facts: readonly LookupKeyFact[] } = $props();

  const DATE_FACTS = new Set(['registration.created', 'registration.expires', 'tls.valid_to']);
  const GROUPS: readonly Readonly<{ section: LookupKeyFactSection; label: string; link: string }>[] = [
    { section: 'registry', label: 'Registration facts', link: 'Registration sources' },
    { section: 'web-evidence', label: 'Web and DNS facts', link: 'Web and DNS evidence' },
  ];
  const groups = $derived(GROUPS
    .map((group) => ({ ...group, facts: facts.filter((item) => item.section === group.section) }))
    .filter((group) => group.facts.length));

  function displayed(item: LookupKeyFact): string {
    return item.value !== null && DATE_FACTS.has(item.id)
      ? formatEvidenceDate(item.value, item.value)
      : lookupKeyFactValueText(item);
  }
</script>

{#if groups.length}
  <section class="key-facts card" aria-labelledby="lookup-key-facts-title">
    <h4 id="lookup-key-facts-title">Key facts</h4>
    <div class="groups">
      {#each groups as group (group.section)}
        <div class="group">
          <div class="group-heading"><h5>{group.label}</h5><a href={`#${group.section}`}>{group.link}</a></div>
          <dl>
            {#each group.facts as item (item.id)}
              <div data-fact-id={item.id} class:missing={item.value === null}>
                <dt>{item.label}</dt>
                <dd>
                  <span class="value">{displayed(item)}</span>
                  <small>{lookupKeyFactProvenance(item)}{item.observedAt ? ' · ' : ''}{#if item.observedAt}<time datetime={item.observedAt}>{formatEvidenceDate(item.observedAt)}</time>{/if}</small>
                </dd>
              </div>
            {/each}
          </dl>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .key-facts{container-type:inline-size;display:grid;gap:12px;min-width:0;padding:var(--card-pad)}
  h4{margin:0;font:700 var(--text-md)/1.3 var(--mono)}
  .groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;align-items:start}
  .group{min-width:0}
  .group-heading{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;padding-bottom:6px;border-bottom:1px solid var(--border)}
  h5{margin:0;color:var(--muted);font:650 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .group-heading a{color:var(--accent);font-size:var(--text-xs)}
  dl{display:grid;margin:0}
  dl>div{display:grid;grid-template-columns:minmax(7.5rem,.42fr) minmax(0,1fr);gap:2px 12px;padding:7px 0;border-bottom:1px solid var(--border)}
  dl>div:last-child{border-bottom:0}
  dt{color:var(--muted);font-size:var(--text-xs);line-height:1.45}
  dd{display:grid;gap:2px;min-width:0;margin:0}
  .value{color:var(--text);font:600 var(--text-sm)/1.45 var(--font-sans);overflow-wrap:anywhere}
  .missing .value{color:var(--muted);font-weight:500}
  small{color:var(--muted);font-size:var(--text-2xs);line-height:1.4;overflow-wrap:anywhere}
  @container (max-width:760px){.groups{grid-template-columns:minmax(0,1fr)}}
  @media(max-width:520px){dl>div{grid-template-columns:minmax(0,1fr)}}
</style>
