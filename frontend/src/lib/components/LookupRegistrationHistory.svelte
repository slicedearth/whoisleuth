<script lang="ts">
  import { getContext, onDestroy, untrack } from 'svelte';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { CAPABILITY_CONTEXT, disabledCapability, type CapabilityGetter } from '#lib/capabilities.ts';
  import { LARGE_JSON_RESPONSE_BYTES, requestJsonCapped } from '#lib/bounded-json-response.ts';
  import { normalizeCtResponse, type CtProvenance } from '#lib/analysis/ct-results.ts';
  import { normalizeCtQuery } from '#lib/analysis/ct-query.ts';
  import WebArchiveHistory from './WebArchiveHistory.svelte';
  import type { LookupKeyFact } from '../../../../lib/lookup-key-facts.mts';
  import {
    certificateChronologyEligibility, EVIDENCE_INELIGIBLE_LABELS, sourceEligibility,
  } from '../../../../packages/evidence/evidence-eligibility.mts';
  import {
    certificatePriorRegistrationObservations, PRIOR_REGISTRATION_STATE_LABELS, reviewPriorRegistration, type PriorRegistrationSource,
  } from '../../../../packages/evidence/prior-registration.mts';
  import { registryDateIso } from '../../../../packages/evidence/registry-dates.mts';

  // Brings the dates that bear on an earlier registration together: the
  // creation date used for comparison, every source date that was not used and
  // why, certificate log and web archive observations read only on request,
  // and one comparison over the eligible observations.
  let { domain, creation, observations }: {
    domain: string;
    creation: Readonly<{ createdAt: string; source: string }> | null;
    observations: readonly LookupKeyFact[];
  } = $props();

  // The registration decision repeats a source's value, so identical source dates appear once.
  const unused = $derived([...new Map(observations.flatMap((item) => {
    if (item.value === null) return [];
    const eligibility = sourceEligibility({ state: item.sourceState, complete: item.complete });
    const date = registryDateIso(item.value);
    if (eligibility.eligible && creation && item.source === creation.source && date === creation.createdAt) return [];
    // Another eligible source reporting the same instant agrees with the
    // comparison date; it is not a conflicting, unused value.
    const agrees = eligibility.eligible && Boolean(creation) && date !== null && date === creation?.createdAt;
    const reason = !eligibility.eligible ? EVIDENCE_INELIGIBLE_LABELS[eligibility.reason]
      : !date ? EVIDENCE_INELIGIBLE_LABELS.value_unusable : 'another observation was selected for comparison';
    return [[`${item.source}\n${item.value}`, { key: `${item.source}\n${item.value}`, source: item.source, value: item.value,
      reason, agrees }] as const];
  })).values()]);

  const capabilities = getContext<CapabilityGetter | undefined>(CAPABILITY_CONTEXT);
  const certificateDisabled = $derived(disabledCapability(capabilities?.() ?? null, 'certificate_transparency'));
  type CertificateResult = Readonly<{ provenance: CtProvenance | null; truncated: boolean }>;
  let certificateBusy = $state(false);
  let certificateMessage = $state('');
  let certificate = $state<CertificateResult | null>(null);
  let archiveEarliest = $state<string | null>(null);
  let certificateGeneration = 0;
  let certificateController: AbortController | null = null;

  function cancelCertificate() {
    certificateGeneration += 1;
    certificateController?.abort();
    certificateController = null;
    certificateBusy = false;
  }
  $effect(() => { domain; untrack(() => { cancelCertificate(); certificate = null; certificateMessage = ''; archiveEarliest = null; }); });
  onDestroy(cancelCertificate);

  /** Explicit action only: one certificate search for this registrable domain through the existing bounded endpoint. */
  async function readCertificateHistory() {
    if (certificateBusy || certificateDisabled) return;
    cancelCertificate();
    const generation = certificateGeneration, target = domain;
    const controller = new AbortController();
    certificateController = controller;
    certificateBusy = true;
    certificateMessage = '';
    certificate = null;
    try {
      const query = normalizeCtQuery(target);
      const { response, body } = await requestJsonCapped(`/api/ct-search?${new URLSearchParams({ q: query })}`, {
        signal: controller.signal, cache: 'no-store',
      }, { maximumBytes: LARGE_JSON_RESPONSE_BYTES, timeoutMs: 40_000 });
      if (generation !== certificateGeneration || controller.signal.aborted) return;
      if (!response.ok) throw new Error('Certificate search unavailable');
      const result = normalizeCtResponse(body, query);
      certificate = {
        provenance: result.candidates.find((candidate) => candidate.domain === target)?.certificateTransparency ?? null,
        truncated: result.truncated,
      };
    } catch {
      if (generation === certificateGeneration && !controller.signal.aborted) {
        certificateMessage = 'Certificate history could not be read. Your existing Lookup evidence is unchanged.';
      }
    } finally {
      if (generation === certificateGeneration) { certificateBusy = false; certificateController = null; }
    }
  }

  const certificateEligibility = $derived(certificate?.provenance ? certificateChronologyEligibility(certificate.provenance) : null);
  const comparisonObservations = $derived([
    ...certificatePriorRegistrationObservations(certificate?.provenance),
    ...(archiveEarliest ? [{ source: 'web_archive' as PriorRegistrationSource, observedAt: archiveEarliest }] : []),
  ]);
  const prior = $derived(comparisonObservations.length
    ? reviewPriorRegistration({ registrationCreatedAt: creation?.createdAt ?? null, observations: comparisonObservations })
    : null);
</script>

<section class="registration-history" aria-labelledby="registration-history-title">
  <h3 id="registration-history-title">Registration history</h3>
  <dl>
    <div data-fact="created">
      <dt>Current registration created</dt>
      <dd>
        {#if creation}
          <span><time datetime={creation.createdAt}>{formatEvidenceDate(creation.createdAt)}</time> · {creation.source}</span>
        {:else}
          <span>Not established from a successful, complete registration source</span>
        {/if}
        {#each unused as item (item.key)}<small>{#if item.agrees}{item.source} reports the same date.{:else}{item.source} reported {item.value}; not used because {item.reason}.{/if}</small>{/each}
      </dd>
    </div>
    <div data-fact="certificate-logs">
      <dt>Certificate logs</dt>
      <dd>
        {#if certificate?.provenance}
          {@const logged = certificate.provenance}
          <span>{#if logged.firstObservedAt}Earliest logged <time datetime={logged.firstObservedAt}>{formatEvidenceDate(logged.firstObservedAt)}</time>{:else}Logged; log times not reported{/if}</span>
          <small>{logged.certificateCount} distinct certificate{logged.certificateCount === 1 ? '' : 's'}{logged.lastObservedAt ? ` · latest logged ${formatEvidenceDate(logged.lastObservedAt)}` : ''}</small>
          {#if logged.firstValidFrom && logged.lastValidFrom}<small>Certificates without a published log time became valid from <time datetime={logged.firstValidFrom}>{formatEvidenceDate(logged.firstValidFrom)}</time>{logged.lastValidFrom !== logged.firstValidFrom ? ` to ${formatEvidenceDate(logged.lastValidFrom)}` : ''}. Validity starts are context, not log observations.</small>{/if}
          {#if logged.firstObservedAt && certificateEligibility && !certificateEligibility.eligible && certificateEligibility.reason}<small>Not compared: {EVIDENCE_INELIGIBLE_LABELS[certificateEligibility.reason]}.</small>{/if}
          {#if certificate.truncated}<small>The search result was capped, so an earlier certificate may not be included.</small>{/if}
        {:else if certificate}
          <span>No logged certificate found for {domain}</span>
          <small>{certificate.truncated ? 'The search result was capped, so this is not evidence that none exists.' : 'Certificate logs are incomplete; this does not show that no certificate was issued.'}</small>
        {:else}
          <span>Not read yet</span>
          <small>Sends {domain} to the certificate-search service in one request, only when you choose to read it.</small>
        {/if}
        <div class="actions">
          <button type="button" class="btn" disabled={certificateBusy || Boolean(certificateDisabled)} onclick={() => void readCertificateHistory()}>{certificateBusy ? 'Reading certificate logs…' : 'Read certificate history'}</button>
          {#if certificateBusy}<button type="button" class="btn" onclick={() => { cancelCertificate(); certificateMessage = 'Certificate search cancelled.'; }}>Cancel</button>{/if}
        </div>
        {#if certificateDisabled}<small>{certificateDisabled.reason}</small>{/if}
        {#if certificateMessage}<small role="status">{certificateMessage}</small>{/if}
      </dd>
    </div>
  </dl>
  {#if prior}
    <section class="prior" data-state={prior.state} aria-label="Registration comparison">
      <strong>{PRIOR_REGISTRATION_STATE_LABELS[prior.state]}</strong>
      {#each prior.observations as observation (observation.source)}
        {#if observation.daysBeforeRegistration !== null}<p>{observation.label} is {observation.daysBeforeRegistration} days before the current registration was created ({formatEvidenceDate(prior.registrationCreatedAt ?? '')}){observation.context ? '; context only' : ''}.</p>{/if}
      {/each}
      {#each prior.limitations as limitation}<p class="note">{limitation}</p>{/each}
    </section>
  {/if}
  <WebArchiveHistory {domain} onearliestcapture={(capturedAt) => archiveEarliest = capturedAt} />
</section>

<style>
  .registration-history { display: grid; gap: 10px; min-width: 0; margin-top: 12px; }
  h3 { margin: 0; font-size: var(--text-sm); }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 10px; margin: 0; }
  dl > div { min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  dt { color: var(--muted); font-size: var(--text-xs); }
  dd { display: grid; gap: 4px; min-width: 0; margin: 3px 0 0; font-size: var(--text-sm); overflow-wrap: anywhere; }
  dd > span { font-weight: 600; }
  small { color: var(--muted); font-size: var(--text-2xs); line-height: 1.5; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .prior { display: grid; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel-raised); }
  .prior[data-state='earlier_observation'] { border-color: color-mix(in srgb, var(--amber) 55%, var(--border)); }
  .prior p { margin: 0; font-size: var(--text-sm); line-height: 1.55; }
  .prior .note { color: var(--muted); font-size: var(--text-xs); }
  .registration-history :global(.web-archive-history) { margin-top: 0; }
</style>
