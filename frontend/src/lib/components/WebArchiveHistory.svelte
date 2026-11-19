<script lang="ts">
  import { getContext, onDestroy, untrack } from 'svelte';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '#lib/capabilities.ts';
  import { requestJsonCapped } from '#lib/bounded-json-response.ts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import {
    WEB_ARCHIVE_HISTORY_BYTES, WEB_ARCHIVE_LIMITATIONS, WEB_ARCHIVE_PROVIDER,
    readWebArchiveHistory, webArchiveCaptureUrl, type WebArchiveHistory,
  } from '../../../../packages/evidence/web-archive-history.mts';
  import { PRIOR_REGISTRATION_STATE_LABELS, reviewPriorRegistration } from '../../../../packages/evidence/prior-registration.mts';

  let { domain, registrationCreatedAt }: { domain: string; registrationCreatedAt: string | null } = $props();
  const capabilities = getContext<CapabilityGetter | undefined>(CAPABILITY_CONTEXT);
  const disabled = $derived(disabledCapability(capabilities?.() ?? null, 'web_archive_history'));
  let busy = $state(false);
  let message = $state('');
  let report = $state<WebArchiveHistory | null>(null);
  let generation = 0;
  let controller: AbortController | null = null;
  const earliest = $derived(report?.queries.find((query) => query.kind === 'earliest') ?? null);
  const prior = $derived(report && earliest?.capturedAt ? reviewPriorRegistration({
    registrationCreatedAt, observations: [{ source: 'web_archive', observedAt: earliest.capturedAt }],
  }) : null);
  const summary = $derived(report ? `Web archive history finished: ${report.queries.map((query) =>
    `${query.kind} ${query.capturedAt ? formatEvidenceDate(query.capturedAt) : query.outcome.replaceAll('_', ' ')}`).join(', ')}.` : '');

  function cancel() { generation++; controller?.abort(); controller = null; busy = false; }
  $effect(() => { domain; untrack(() => { cancel(); report = null; message = ''; }); });
  onDestroy(cancel);

  async function collect() {
    if (busy || disabled) return;
    cancel();
    const current = generation, target = domain;
    const abort = new AbortController(); controller = abort;
    busy = true; message = ''; report = null;
    try {
      const { response, body } = await requestJsonCapped(`/api/web-archive-history?${new URLSearchParams({ q: target })}`, {
        signal: abort.signal, cache: 'no-store',
      }, { maximumBytes: WEB_ARCHIVE_HISTORY_BYTES, timeoutMs: 20_000 });
      if (current !== generation || abort.signal.aborted) return;
      if (!response.ok) throw new Error('Archive history unavailable');
      report = readWebArchiveHistory(body, target);
    } catch {
      if (current === generation && !abort.signal.aborted) message = 'Web archive history could not be read. Your existing Lookup evidence is unchanged.';
    } finally { if (current === generation) { busy = false; controller = null; } }
  }
</script>

<details class="web-archive-history card">
  <summary>Web archive history</summary>
  <div class="archive-body">
    <p>Check when the {WEB_ARCHIVE_PROVIDER.label} first and last recorded the homepage of <strong>{domain}</strong>. The archive receives the domain in two requests; nothing is saved unless you add it to a Case.</p>
    <div class="actions">
      <button type="button" class="btn" disabled={busy || Boolean(disabled)} onclick={() => void collect()}>{busy ? 'Reading archive…' : 'Read archive history'}</button>
      {#if busy}<button type="button" class="btn" onclick={() => { cancel(); message = 'Archive request cancelled.'; }}>Cancel</button>{/if}
      <a href={WEB_ARCHIVE_PROVIDER.termsUrl} target="_blank" rel="noreferrer">Archive terms and privacy policy</a>
    </div>
    {#if disabled}<p class="note">{disabled.reason}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <p class="sr-only" role="status">{summary}</p>
    {#if report}
      <div class="results" role="region" aria-label="Web archive captures">
        <dl>
          {#each report.queries as query (query.kind)}
            <div data-query={query.kind}>
              <dt>{query.kind === 'earliest' ? 'Earliest capture' : 'Latest capture'}</dt>
              <dd>
                {#if query.capturedAt}
                  <time datetime={query.capturedAt}>{formatEvidenceDate(query.capturedAt)}</time>
                  <small>{query.capturedStatus ? `Archive recorded HTTP ${query.capturedStatus}` : 'No HTTP status recorded'} · <a href={webArchiveCaptureUrl(report.domain, query.capturedAt)} target="_blank" rel="noreferrer">Open capture</a></small>
                {:else}
                  {query.outcome === 'no_capture' ? 'No capture found' : query.outcome === 'timeout' ? 'Timed out' : query.outcome === 'skipped' ? 'Not requested' : 'Unavailable'}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
        {#if prior}
          <section class="prior" data-state={prior.state} aria-label="Registration comparison">
            <strong>{PRIOR_REGISTRATION_STATE_LABELS[prior.state]}</strong>
            {#each prior.observations as observation (observation.source)}
              {#if observation.daysBeforeRegistration !== null}<p>The earliest capture is {observation.daysBeforeRegistration} days before the current registration was created ({formatEvidenceDate(prior.registrationCreatedAt)}).</p>{/if}
            {/each}
            {#each prior.limitations as limitation}<p class="note">{limitation}</p>{/each}
          </section>
        {/if}
      </div>
      {#each WEB_ARCHIVE_LIMITATIONS as limitation}<p class="note">{limitation}</p>{/each}
    {/if}
  </div>
</details>

<style>
  .web-archive-history { min-width: 0; margin-top: 12px; padding: 0; overflow: clip; }
  summary { cursor: pointer; padding: 13px var(--card-pad); font: 700 var(--text-sm) var(--mono); }
  .archive-body { display: grid; gap: 12px; padding: 0 var(--card-pad) var(--card-pad); border-top: 1px solid var(--border); padding-top: 12px; }
  p { margin: 0; font-size: var(--text-sm); line-height: 1.55; overflow-wrap: anywhere; }
  .note { color: var(--muted); font-size: var(--text-xs); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .actions a, small a { color: var(--accent); }
  .results { display: grid; gap: 12px; min-width: 0; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 10px; margin: 0; }
  dl > div { min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { display: grid; gap: 3px; margin: 3px 0 0; font-weight: 600; overflow-wrap: anywhere; }
  small { color: var(--muted); font-size: var(--text-2xs); font-weight: 400; }
  .prior { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-raised); }
  .prior[data-state='earlier_observation'] { border-color: color-mix(in srgb, var(--amber) 55%, var(--border)); }
</style>
