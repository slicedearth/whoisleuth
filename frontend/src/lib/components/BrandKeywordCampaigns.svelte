<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { saveBrandKeywordCampaign, type BrandProfile } from '#lib/brand-profiles.ts';
  import {
    keywordCampaignDraft,
    previewKeywordCampaignDraft,
    previewKeywordCampaignHosts,
    type KeywordCampaignDraft,
  } from '#lib/controllers/brand-keyword-campaign.ts';
  import {
    brandKeywordCampaignState,
    type BrandKeywordCampaign,
  } from '../../../../packages/workspace/brand-keyword-campaign.mts';
  import { WATCH_PRIORITIES } from '../../../../packages/workspace/brand-candidate-workflow.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import { failedLocalMutationOutcome } from '#lib/local-mutation-outcome.ts';

  let {
    active,
    disabled = false,
    onrefresh,
  }: { active: BrandProfile; disabled?: boolean; onrefresh: () => Promise<unknown> } = $props();
  let now = $state(new Date().toISOString()),
    openedProfile = $state('');
  let draft = $state<KeywordCampaignDraft | null>(null),
    busy = $state(false),
    unavailable = $state(false),
    message = $state('');
  let preview = $state<ReturnType<typeof previewKeywordCampaignDraft> | null>(null),
    previewKey = $state('');
  let examples = $state(''),
    exampleRows = $state<ReturnType<typeof previewKeywordCampaignHosts>>([]);
  let status = $state<HTMLParagraphElement>(),
    heading = $state<HTMLHeadingElement>();
  const campaigns = $derived(active.keywordCampaigns ?? []);
  const current = $derived(
    draft ? (campaigns.find((value) => value.id === draft?.id) ?? null) : null,
  );
  $effect(() => {
    if (openedProfile !== active.id) {
      openedProfile = active.id;
      draft = null;
      preview = null;
      unavailable = false;
      message = '';
    }
  });
  $effect(() => {
    if (
      preview &&
      (JSON.stringify([draft, examples]) !== previewKey ||
        (current?.revision ?? null) !== preview.expectedRevision)
    )
      preview = null;
  });
  onMount(() => {
    const timer = setInterval(() => {
      now = new Date().toISOString();
    }, 60_000);
    return () => clearInterval(timer);
  });
  async function edit(value: BrandKeywordCampaign | null) {
    draft = keywordCampaignDraft(value, value?.id ?? crypto.randomUUID(), new Date().toISOString());
    preview = null;
    examples = '';
    exampleRows = [];
    message = '';
    await tick();
    heading?.focus();
  }
  function review() {
    preview = null;
    try {
      if (draft) {
        const reviewed = previewKeywordCampaignDraft(draft, current, new Date().toISOString());
        exampleRows = previewKeywordCampaignHosts(
          examples,
          reviewed.campaign,
          active,
          reviewed.now,
        );
        preview = reviewed;
        previewKey = JSON.stringify([draft, examples]);
        message = '';
      }
    } catch (cause) {
      message =
        cause instanceof Error ? cause.message : 'The campaign draft could not be reviewed.';
    }
  }
  async function save() {
    if (!preview || !draft || busy || disabled || unavailable) return;
    const submitted = preview,
      profileId = active.id;
    if (
      JSON.stringify([draft, examples]) !== previewKey ||
      (current?.revision ?? null) !== submitted.expectedRevision
    ) {
      preview = null;
      message = 'The campaign draft or saved revision changed. Preview it again.';
      return;
    }
    busy = true;
    let committed = false;
    try {
      const saved = await saveBrandKeywordCampaign(
        profileId,
        submitted.input,
        submitted.expectedRevision,
        new Date().toISOString(),
      );
      committed = true;
      if (active.id !== profileId) return;
      draft = keywordCampaignDraft(saved, saved.id, saved.changedAt);
      preview = null;
      message = `Keyword campaign revision ${saved.revision} saved locally. No feed query, candidate retention or monitoring was started.`;
      await onrefresh();
    } catch (cause) {
      if (active.id === profileId) {
        unavailable = committed || failedLocalMutationOutcome(cause) === 'unknown';
        message = committed
          ? 'The campaign revision was saved, but the visible Brand could not be refreshed. The draft remains available; reload before another edit.'
          : unavailable
            ? 'The save outcome could not be confirmed. The draft remains available; reload the saved Brand before retrying.'
            : cause instanceof Error
              ? cause.message
              : 'The campaign was not saved.';
      }
    } finally {
      busy = false;
      if (active.id === profileId) {
        await tick();
        status?.focus();
      }
    }
  }
</script>

<details class="keyword-campaigns">
  <summary>Time-bounded keyword campaigns ({campaigns.length})</summary>
  <p
    >Save local matching intent for launches or other review windows. Campaigns never query a feed,
    run a scan, retain candidates or enable monitoring by themselves.</p
  >
  <p
    >Any positive literal can nominate an exact hostname; any negative literal vetoes only this
    campaign. Matching uses lowercased ASCII/punycode hostname text, without regular expressions or
    parent-domain expansion.</p
  >
  <p
    >Literal matching has no token boundaries: “launch” matches “prelaunch.example”, but not the
    typo “launc-h.example”. Unicode lookalikes and IDNs are not expanded from a term. Discover’s
    separate typo and confusable generators are unchanged.</p
  >
  {#if message}<p
      bind:this={status}
      tabindex="-1"
      role="status"
      aria-label="Keyword campaign action status">{message}</p
    >{/if}
  {#if unavailable}<p>Saved Brand context is unavailable. Mutations remain disabled until reload.</p
    >{/if}
  {#each campaigns as campaign (campaign.id)}
    <section aria-label={`Keyword campaign ${campaign.name}`}>
      <h3>{campaign.name}</h3>
      <p
        >{brandKeywordCampaignState(campaign, now).replaceAll('_', ' ')} · revision {campaign.revision}
        · {formatEvidenceDate(campaign.startsAt)} to {formatEvidenceDate(campaign.endsAt)} (end exclusive)</p
      >
      <p
        >Positive: {campaign.positiveTerms.join(', ')}. Negative: {campaign.negativeTerms.join(
          ', ',
        ) || 'None'}. Default review priority: {campaign.defaultPriority}.</p
      >
      <button
        class="btn"
        disabled={disabled || busy || unavailable}
        onclick={() => void edit(campaign)}>Edit campaign {campaign.name}</button
      >
      <details
        ><summary>Retained campaign revisions ({campaign.history.length})</summary>
        <ul
          >{#each campaign.history as revision}<li
              >Revision {revision.revision}: {revision.name}; positive {revision.positiveTerms.join(
                ', ',
              )}; negative {revision.negativeTerms.join(', ') || 'none'}; {formatEvidenceDate(
                revision.startsAt,
              )} to {formatEvidenceDate(revision.endsAt)}; {revision.paused
                ? 'paused'
                : 'not paused'}; default {revision.defaultPriority}; changed {formatEvidenceDate(
                revision.changedAt,
              )}.</li
            >{/each}</ul
        >
        <p
          >{campaign.historyOmitted} older revisions omitted by the eight-revision bound. Existing candidate
          attribution is not rewritten.</p
        >
      </details>
    </section>
  {/each}
  <button
    class="btn"
    onclick={() => void edit(null)}
    disabled={disabled || busy || unavailable || campaigns.length >= 20}
    >New keyword campaign</button
  >
  {#if draft}
    <h3 bind:this={heading} tabindex="-1"
      >{draft.expectedRevision === null
        ? 'New keyword campaign'
        : `Edit campaign revision ${draft.expectedRevision}`}</h3
    >
    <fieldset disabled={disabled || busy || unavailable}
      ><legend>Campaign intent</legend>
      <label>Campaign name<input bind:value={draft.name} maxlength="100" /></label>
      <label
        >Positive literal terms<textarea bind:value={draft.positive} maxlength="1620" rows="3"
        ></textarea></label
      >
      <label
        >Negative literal terms<textarea bind:value={draft.negative} maxlength="1620" rows="3"
        ></textarea></label
      >
      <p
        >One literal per line; at most 20 positive and 20 negative terms, 3–80 characters each. At
        least one positive term is required.</p
      >
      <label
        >Campaign start (explicit timezone)<input
          bind:value={draft.startsAt}
          maxlength="40"
          placeholder="2026-10-04T00:00:00Z"
        /></label
      >
      <label
        >Campaign end (explicit timezone)<input
          bind:value={draft.endsAt}
          maxlength="40"
          placeholder="2026-10-11T00:00:00Z"
        /></label
      >
      <label
        ><input type="checkbox" bind:checked={draft.paused} /> Pause new campaign nominations</label
      >
      <label
        >Default Watchlist review priority<select bind:value={draft.defaultPriority}
          >{#each WATCH_PRIORITIES as option}<option value={option.value}>{option.label}</option
            >{/each}</select
        ></label
      >
      <p
        >Dates control this review window, not a domain’s registration date. Pause and expiry
        preserve existing nominations and manual Watchlist priorities. Priority is analyst urgency,
        not Risk or a collection schedule.</p
      >
      <label
        >Example hostnames to preview (optional)<textarea
          bind:value={examples}
          maxlength="5120"
          rows="3"
          placeholder="launch.example&#10;prelaunch.example&#10;launc-h.example"></textarea></label
      >
      <p
        >Up to 20 exact hostnames, one per line. This local preview shows canonical hostname text
        and existing exact Brand declarations; it does not generate variants or save these examples.</p
      >
      <button class="btn" onclick={review}>Preview keyword campaign</button>
      {#if preview}<section aria-label="Keyword campaign preview"
          ><h4>Revision {preview.campaign.revision}: {preview.campaign.name}</h4>
          <p
            >{brandKeywordCampaignState(preview.campaign, preview.now).replaceAll('_', ' ')}.
            Positive: {preview.campaign.positiveTerms.join(', ')}. Negative: {preview.campaign.negativeTerms.join(
              ', ',
            ) || 'None'}. Default priority: {preview.campaign.defaultPriority}.</p
          >
          <p
            >{formatEvidenceDate(preview.campaign.startsAt)} to {formatEvidenceDate(
              preview.campaign.endsAt,
            )}. Zero requests; no candidate or Watchlist changes.</p
          >
          {#if exampleRows.length}<ul
              >{#each exampleRows as row}<li
                  >{row.domain}: {row.excludedTerms.length
                    ? `vetoed by ${row.excludedTerms.join(', ')}`
                    : row.matched
                      ? `literal match: ${row.terms.join(', ')}`
                      : 'no literal match'}; {row.active
                    ? 'review window active'
                    : 'new nominations disabled by the review window or pause'}. {row.declaration
                    ? `${row.declaration.reason}; declaration remains separate, not a safety verdict.`
                    : 'No exact Brand declaration.'}</li
                >{/each}</ul
            >
          {:else}<p
              >No example hostnames evaluated. Enter examples to inspect literal, token-boundary and
              canonical IDN effects before saving.</p
            >{/if}
          <button class="btn" onclick={() => void save()}>Save reviewed campaign revision</button
          ></section
        >{/if}
      <button
        class="btn"
        onclick={() => {
          draft = null;
          preview = null;
        }}>Close campaign draft</button
      >
    </fieldset>
  {/if}
</details>

<style>
  .keyword-campaigns {
    min-width: 0;
    margin-block: 16px;
  }
  summary {
    cursor: pointer;
  }
  p,
  li,
  h3,
  h4,
  label {
    overflow-wrap: anywhere;
  }
  section {
    min-width: 0;
    border-top: 1px solid var(--border);
    margin-block: 12px;
    padding-block: 10px;
  }
  fieldset {
    min-width: 0;
    display: grid;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 6px;
  }
  label:has(input[type='checkbox']) {
    display: flex;
    align-items: flex-start;
  }
  input:not([type='checkbox']),
  textarea,
  select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  .btn {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
