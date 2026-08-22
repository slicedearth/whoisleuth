<script lang="ts">
  import { untrack } from 'svelte';
  import {
    buildParentDomainCampaignReviewExport,
    serializeParentDomainCampaignReviewExport,
    type ParentDomainCampaignReview,
    type ParentDomainHostnameObservation,
  } from '$lib/analysis/parent-domain-campaign-review.ts';
  import type { CampaignRecord } from '$lib/campaigns';
  import type { CaseRecord } from '$lib/cases';

  let { campaign, review, records, onselect, onmessage }: {
    campaign: CampaignRecord;
    review: ParentDomainCampaignReview;
    records: CaseRecord[];
    onselect: ((record: CaseRecord) => void) | undefined;
    onmessage?: (message: string) => void;
  } = $props();

  let selected = $state(new Set<string>());
  let selectionCampaignId = $state('');
  let filter = $state('');
  const selectableHostnames = $derived(review.parents.flatMap((parent) => parent.hostnames.map((item) => item.hostname)));
  const normalizedFilter = $derived(filter.trim().toLowerCase());
  const filteredParents = $derived(review.parents.map((parent) => ({
    ...parent,
    hostnames: parent.hostnames.filter((hostname) => {
      if (!normalizedFilter) return true;
      return hostname.hostname.includes(normalizedFilter)
        || parent.registrableParent.includes(normalizedFilter)
        || hostname.observations.some((observation) => (
          observation.caseDomain.includes(normalizedFilter)
          || observation.caseId.toLowerCase().includes(normalizedFilter)
        ));
    }),
  })).filter((parent) => parent.hostnames.length > 0));
  const filteredHostnameCount = $derived(filteredParents.reduce((total, parent) => total + parent.hostnames.length, 0));
  const caseById = $derived(new Map(records.map((record) => [record.id, record])));

  $effect(() => {
    const campaignId = campaign.id;
    const valid = new Set(selectableHostnames);
    untrack(() => {
      if (selectionCampaignId !== campaignId) {
        selectionCampaignId = campaignId;
        selected = new Set();
        filter = '';
        return;
      }
      const reconciled = new Set([...selected].filter((hostname) => valid.has(hostname)));
      if (reconciled.size !== selected.size) selected = reconciled;
    });
  });

  function toggle(hostname: string, checked: boolean): void {
    const next = new Set(selected);
    if (checked) next.add(hostname);
    else next.delete(hostname);
    selected = next;
  }

  function clearSelection(): void {
    selected = new Set();
  }

  function formatDate(value: string | null): string {
    if (!value) return 'No global observation time retained';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }

  function provenanceLabel(observation: ParentDomainHostnameObservation): string {
    return observation.store === 'browser_case_evidence_snapshot'
      ? `${observation.source} Case snapshot ${observation.snapshotId ?? 'without retained identifier'}`
      : `${observation.source} directly retained Case target`;
  }

  function openCase(caseId: string): void {
    const record = caseById.get(caseId);
    if (record) onselect?.(record);
  }

  function omissionSummary(): string[] {
    const omitted = review.omissions;
    return [
      `${omitted.hostnames} hostname group${omitted.hostnames === 1 ? '' : 's'} omitted`,
      `${omitted.sourceRecords + omitted.caseRecords} Case source record${omitted.sourceRecords + omitted.caseRecords === 1 ? '' : 's'} omitted`,
      `${omitted.observations + omitted.snapshotRecords + omitted.provenance} observation record${omitted.observations + omitted.snapshotRecords + omitted.provenance === 1 ? '' : 's'} omitted`,
      `${omitted.parents} parent group${omitted.parents === 1 ? '' : 's'} omitted`,
    ];
  }

  function download(): void {
    try {
      const payload = buildParentDomainCampaignReviewExport(campaign, review);
      const serialized = serializeParentDomainCampaignReviewExport(payload);
      const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json;charset=utf-8' }));
      const anchor = documentCreateAnchor();
      anchor.href = url;
      anchor.download = `whoisleuth-parent-domain-review-${campaign.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onmessage?.('Exported the bounded parent-domain review. Transient response-scope selection was not included.');
    } catch (cause) {
      onmessage?.(cause instanceof Error ? cause.message : 'Could not export the parent-domain review.');
    }
  }

  function documentCreateAnchor(): HTMLAnchorElement {
    return document.createElement('a');
  }
</script>

<section class="parent-scope" aria-labelledby={`parent-domain-scope-${campaign.id}`}>
  <header>
    <div>
      <p class="eyebrow">Retained hostname context</p>
      <h3 id={`parent-domain-scope-${campaign.id}`}>Parent-domain scope</h3>
    </div>
    <button class="btn small" type="button" onclick={download} disabled={['loading', 'unavailable', 'unsupported', 'future_schema'].includes(review.state)}>Export hostname review</button>
  </header>

  <p class="qualification">Namespace hierarchy is a lead, not an attribution.</p>
  <p class="sharing-note">This deliberate review export contains exact investigated hostnames. Review it before sharing.</p>

  {#if review.state === 'loading'}
    <p class="source-state" role="status">Case evidence is loading. No hostname or parent count is inferred yet.</p>
  {:else if review.state === 'unavailable'}
    <p class="source-state" role="alert">Case evidence is unavailable. Retained campaign membership remains unchanged, and no absent hostname state is inferred.</p>
  {:else if review.state === 'unsupported'}
    <p class="source-state" role="alert">This Case source does not support exact retained-hostname review. No absent hostname state is inferred.</p>
  {:else if review.state === 'future_schema'}
    <p class="source-state" role="alert">The Case source uses a future schema and remains untouched. Its hostname evidence was not interpreted.</p>
  {:else if review.state === 'insufficient_evidence'}
    <p class="source-state">The retained evidence does not contain two distinct hostnames with a child under one registrable parent.</p>
  {:else}
    {#if review.state === 'partial'}
      <p class="source-state">The review is partial. Visible rows remain attributable; omitted or unavailable evidence is not treated as absence.</p>
    {/if}

    <div class="scope-controls">
      <label for={`parent-domain-filter-${campaign.id}`}>Filter exact hostnames<input id={`parent-domain-filter-${campaign.id}`} type="search" bind:value={filter} autocomplete="off" placeholder="Hostname, parent, or Case"></label>
      <p role="status" aria-live="polite">{selected.size} of {selectableHostnames.length} exact hostnames selected; {filteredHostnameCount} currently shown.</p>
      <button class="btn small" type="button" onclick={clearSelection} disabled={!selected.size} aria-label={`Clear selected hostnames for ${campaign.name}`}>Clear selection</button>
    </div>
    <p class="selection-limit">Filtering and selection are held only in this component’s memory. They do not change routing, Case state, campaign membership, scores, monitoring, evidence, actions, assertions, exports, or browser storage.</p>

    {#if filteredParents.length}<div class="table-wrap">
      <table>
        <caption>Exact retained hostnames grouped by canonical registrable parent</caption>
        <thead><tr><th scope="col">Review</th><th scope="col">Parent and hostname</th><th scope="col">Affected Cases</th><th scope="col">Provenance and time</th><th scope="col">Completeness and limits</th></tr></thead>
        <tbody>
          {#each filteredParents as parent}
            {#each parent.hostnames as hostname, index}
              <tr>
                <td>
                  <input
                    id={`parent-scope-${campaign.id}-${parent.registrableParent}-${index}`}
                    type="checkbox"
                    checked={selected.has(hostname.hostname)}
                    onchange={(event) => toggle(hostname.hostname, event.currentTarget.checked)}
                    aria-label={`Select exact hostname ${hostname.hostname} under ${parent.registrableParent} for transient response-scope review`}
                  >
                </td>
                <th scope="row">
                  <span class="parent">{parent.registrableParent}</span>
                  <strong class="hostname">{hostname.hostname}</strong>
                  <span class={`kind kind-${hostname.kind}`}>{hostname.kind === 'apex' ? 'Parent apex' : 'Child hostname'}</span>
                  <small class="coverage">{parent.affectedCaseIds.length} affected Case{parent.affectedCaseIds.length === 1 ? '' : 's'} · {parent.campaignMemberDomains.length} campaign member{parent.campaignMemberDomains.length === 1 ? '' : 's'}</small>
                </th>
                <td>
                  <div class="case-pivots">
                    {#each hostname.affectedCaseIds as caseId}
                      {@const record = caseById.get(caseId)}
                      {#if record}<button class="case-pivot" type="button" onclick={() => openCase(caseId)} aria-label={`Open Case ${record.domain} for retained hostname ${hostname.hostname}`}>{record.domain}</button>{/if}
                    {/each}
                  </div>
                </td>
                <td>
                  <ul class="provenance">
                    {#each hostname.observations as observation}
                      <li>
                        <strong>{provenanceLabel(observation)}</strong>
                        <span>Observation: {formatDate(observation.observationTime)}</span>
                        {#if observation.localRetentionTime}<small>Local retention: {formatDate(observation.localRetentionTime)}</small>{/if}
                        <small>Scan depth: {observation.scanDepth} · completeness: {observation.completeness}{observation.truncated ? ' · truncated' : ''}</small>
                        <small>Case schema {observation.schemaVersion} · campaign member {observation.campaignMemberDomain}</small>
                      </li>
                    {/each}
                  </ul>
                </td>
                <td>
                  <strong class="completeness">{hostname.completeness}{hostname.truncated ? ' · truncated' : ''}</strong>
                  <ul class="limits">{#each hostname.limitations as limitation}<li>{limitation}</li>{/each}</ul>
                </td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>{:else}<p class="source-state" role="status">No retained hostname row matches this transient filter. The review and campaign membership are unchanged.</p>{/if}

  {/if}

  {#if ['ready', 'partial', 'insufficient_evidence'].includes(review.state)}
    <dl class="omissions" aria-label="Omitted parent-domain review records">
      {#each omissionSummary() as item}<div><dt>{item.split(' omitted')[0]}</dt><dd>omitted</dd></div>{/each}
    </dl>
    <details><summary>Review limitations and omitted-source context</summary><ul>{#each review.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
  {/if}
</section>

<style>
  .parent-scope{min-width:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}h3{margin:0;font-size:var(--text-md)}
  .qualification,.sharing-note,.selection-limit,.source-state{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.sharing-note{color:var(--amber)}
  .source-state{padding:10px 12px;border:1px dotted var(--muted);border-radius:var(--radius-sm)}
  .scope-controls{display:grid;grid-template-columns:minmax(180px,1fr) minmax(240px,auto) auto;gap:8px;align-items:end;margin-top:12px}.scope-controls label{display:grid;gap:4px;color:var(--muted);font:650 var(--text-2xs) var(--mono)}.scope-controls input{min-width:0;min-height:var(--control-h)}.scope-controls p{align-self:center;margin:0;font:650 var(--text-xs) var(--mono)}
  .table-wrap{max-width:100%;margin-top:12px;overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-sm)}
  table{width:100%;min-width:920px;border-collapse:collapse;background:var(--panel-raised);font-size:var(--text-xs)}caption{padding:9px 10px;color:var(--muted);text-align:left;font-weight:650}
  th,td{min-width:0;padding:9px 10px;border-top:1px solid var(--border);vertical-align:top;text-align:left}thead th{color:var(--muted);font:650 var(--text-2xs) var(--mono)}tbody th{width:21%}tbody td:first-child{width:56px;text-align:center}
  input[type='checkbox']{width:18px;height:18px}input[type='checkbox']:focus-visible,.case-pivot:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .parent,.hostname,.kind,.coverage,.provenance span,.provenance small,.completeness{display:block;overflow-wrap:anywhere;word-break:break-word}.parent{margin-bottom:7px;color:var(--accent);font:700 var(--text-xs) var(--mono)}.hostname{font:650 var(--text-xs) var(--mono)}.kind,.coverage{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}.kind-child{color:var(--interface-accent)}
  .case-pivots{display:flex;flex-wrap:wrap;gap:5px}.case-pivot{max-width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--accent);font:600 var(--text-2xs) var(--mono);overflow-wrap:anywhere;cursor:pointer}
  .provenance,.limits,details ul{margin:0;padding-left:17px;color:var(--muted);line-height:1.45}.provenance{display:grid;gap:7px}.provenance strong{display:block;color:var(--text);font-size:var(--text-2xs);overflow-wrap:anywhere}.provenance span,.provenance small{font-size:var(--text-2xs)}.completeness{text-transform:capitalize}.limits{margin-top:6px;font-size:var(--text-2xs)}
  .omissions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}.omissions div{display:flex;gap:4px;padding:4px 7px;border:1px solid var(--border);border-radius:99px;color:var(--muted);font-size:var(--text-2xs)}.omissions dt,.omissions dd{margin:0}
  details{margin-top:10px}summary{color:var(--muted);cursor:pointer;font-size:var(--text-xs)}details ul{margin-top:7px;font-size:var(--text-xs)}
  @media(max-width:700px){header{align-items:stretch;flex-direction:column}header button{width:100%}.scope-controls{grid-template-columns:minmax(0,1fr)}.scope-controls button{width:100%}.table-wrap{margin-inline:-4px}.omissions{display:grid}.omissions div{border-radius:var(--radius-sm)}}
</style>
