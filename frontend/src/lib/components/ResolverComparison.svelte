<script lang="ts">
  import { getContext, onDestroy, untrack } from 'svelte';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '#lib/capabilities.ts';
  import { requestJsonCapped } from '#lib/bounded-json-response.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { tokenLabel } from '../../../../packages/analysis/display-label.mts';
  import { DNS_QUERY_OUTCOMES } from '../../../../packages/evidence/dns-query-outcome.mts';
  import { RESOLVER_PROVIDERS, RESOLVER_RECORD_TYPES, RESOLVER_COMPARISON_BYTES,
    readResolverComparison, type ResolverComparison as Comparison } from '../../../../packages/evidence/resolver-comparison.mts';

  let { hostname }: { hostname: string } = $props();
  const capabilities = getContext<CapabilityGetter | undefined>(CAPABILITY_CONTEXT);
  const disabled = $derived(disabledCapability(capabilities?.() ?? null, 'resolver_comparison'));
  let selected = $state<string[]>([]);
  let busy = $state(false);
  let message = $state('');
  let report = $state<Comparison | null>(null);
  let generation = 0;
  let controller: AbortController | null = null;
  function cancel() { generation++; controller?.abort(); controller = null; busy = false; }
  $effect(() => { hostname; untrack(() => { cancel(); selected = []; report = null; message = ''; }); });
  onDestroy(cancel);

  async function compare() {
    if (busy || disabled || selected.length !== 2) return;
    cancel();
    const current = generation;
    const target = hostname;
    const abort = new AbortController(); controller = abort;
    busy = true; message = ''; report = null;
    try {
      const parameters = new URLSearchParams({ q: target, resolvers: selected.join(',') });
      const { response, body } = await requestJsonCapped(`/api/resolver-compare?${parameters}`, {
        signal: abort.signal, cache: 'no-store',
      }, { maximumBytes: RESOLVER_COMPARISON_BYTES, timeoutMs: 15_000 });
      if (current !== generation || abort.signal.aborted) return;
      if (!response.ok) throw new Error('Comparison unavailable');
      report = readResolverComparison(body, target);
    } catch {
      if (current === generation && !abort.signal.aborted) message = 'Resolver comparison could not be completed. Your existing Lookup evidence is unchanged.';
    } finally { if (current === generation) { busy = false; controller = null; } }
  }
</script>

<details class="resolver-comparison">
  <summary>Compare selected resolvers</summary>
  <div class="comparison-body">
    <p>Compare A and AAAA answers for <strong>{hostname}</strong> using two public HTTPS resolvers. Each receives the hostname, with four requests maximum. Your original Lookup stays unchanged.</p>
    <fieldset disabled={busy || Boolean(disabled)}>
      <legend>Select both resolvers</legend>
      {#each RESOLVER_PROVIDERS as provider}
        <div class="provider"><label><input type="checkbox" bind:group={selected} value={provider.id} /> {provider.label}</label><a href={provider.privacyUrl} target="_blank" rel="noreferrer">Privacy policy</a></div>
      {/each}
    </fieldset>
    <div class="actions"><button type="button" class="btn" disabled={busy || Boolean(disabled) || selected.length !== 2} onclick={() => void compare()}>{busy ? 'Comparing…' : 'Compare resolvers'}</button>
      {#if busy}<button type="button" class="btn" onclick={() => { cancel(); message = 'Comparison cancelled.'; }}>Cancel comparison</button>{/if}</div>
    {#if disabled}<p class="note">{disabled.reason}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if report}
      <div class="results" role="status" aria-label="Resolver comparison results">
        {#each RESOLVER_RECORD_TYPES as type}
          <section><h5>{type} <span>{tokenLabel(report.rows.find(row => row.type === type)?.state ?? 'unknown')}</span></h5>
            <dl>{#each report.queries.filter(query => query.type === type) as query}
              <div><dt>{RESOLVER_PROVIDERS.find(provider => provider.id === query.provider)?.label}</dt><dd>{DNS_QUERY_OUTCOMES[query.outcome].label}
                {#each query.values as value}<code>{value.value} · TTL {value.ttl}s</code>{/each}
                {#if query.aliasChain.length}<small>Answered through alias: {query.aliasChain.join(' → ')}</small>{/if}
                {#if query.aliasObserved}<small>Unfollowed alias or other-name answer: not an exact-host comparison.</small>{/if}
                {#if query.truncated}<small>Incomplete DNS response.</small>{/if}
                <small>Provider DNSSEC flag (AD): {query.authenticatedData === null ? 'unavailable' : query.authenticatedData ? 'set' : 'not set'}<time datetime={query.observedAt}>{formatEvidenceDate(query.observedAt)}</time></small>
              </dd></div>
            {/each}</dl>
          </section>
        {/each}
      </div>
      <p class="note">Agreement is resolver context, not authoritative truth or a safety verdict. Alias chains are followed only within each resolver’s own answer. The provider’s AD flag is reported, not locally verified.</p>
    {/if}
  </div>
</details>

<style>
  .resolver-comparison { border-top: 1px solid var(--border); margin-top: 1rem; padding-top: 1rem; min-width: 0; }
  summary { cursor: pointer; font-weight: 600; }
  .comparison-body { display: grid; gap: 1rem; padding-top: 1rem; }
  p { margin: 0; overflow-wrap: anywhere; }
  fieldset { margin: 0; padding: .8rem; border: 1px solid var(--border); border-radius: .6rem; min-width: 0; }
  legend { padding-inline: .3rem; }
  .provider, .actions { display: flex; gap: .6rem 1rem; flex-wrap: wrap; align-items: center; }
  .provider { justify-content: space-between; padding-block: .35rem; }
  label { display: inline-flex; align-items: center; gap: .4rem; }
  .provider a, small { font-size: .8rem; }
  .results { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); min-width: 0; }
  section { border: 1px solid var(--border); border-radius: .6rem; padding: .8rem; min-width: 0; }
  h5 { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .5rem; margin: 0 0 .7rem; }
  h5 span, small { color: var(--muted); }
  dl { margin: 0; display: grid; gap: 1rem; }
  dt { font-weight: 600; }
  dd { margin: .2rem 0 0; overflow-wrap: anywhere; }
  code, small { display: block; margin-top: .3rem; overflow-wrap: anywhere; }
  time { display: block; margin-top: .15rem; }
</style>
