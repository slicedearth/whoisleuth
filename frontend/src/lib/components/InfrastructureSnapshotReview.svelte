<script lang="ts">
  import { goto } from '$app/navigation';
  import type { InvestigationSearchSession } from '$lib/investigation-search-session';
  import type { RetainedInfrastructureSnapshotReview } from '../../../../packages/investigation/retained-infrastructure-snapshots.mts';
  import { serialiseInfrastructureObservation } from '../../../../packages/investigation/infrastructure-observation.mts';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { downloadLocalFile } from '$lib/download-local-file';
  import { formatEvidenceDate } from '$lib/analysis/evidence-time.ts';
  import Pagination from './Pagination.svelte';
  let { session }: { session: InvestigationSearchSession } = $props();
  let response = $state.raw<RetainedInfrastructureSnapshotReview | null>(null);
  let selectedIds = $state<string[]>([]), page = $state(1), pending = $state(false), error = $state('');
  let hosts = $state<string[]>([]), message = $state('');
  let lastSession: InvestigationSearchSession | undefined;
  $effect(() => {
    if (lastSession !== session) { lastSession = session; response = null; selectedIds = []; hosts = []; page = 1; message = ''; }
    const current = session, selection = selectedIds, requestedPage = page;
    let active = true; pending = true; error = '';
    void current.infrastructureSnapshots(selection, requestedPage).then(result => { if (active) { response = result; pending = false; hosts = []; } }).catch(() => { if (active) { error = 'Snapshots could not be read. Change the selection or reopen this view to retry.'; pending = false; } });
    return () => { active = false; };
  });
  function toggle(identity: string, checked: boolean) {
    selectedIds = checked ? [...selectedIds.filter(id => id !== identity), identity].slice(-2) : selectedIds.filter(id => id !== identity);
  }
  async function prepareBulk() {
    const saved = saveCandidateHandoff('manual', hosts.map(domain => ({ domain, source: 'Selected retained infrastructure hostname', mutationTypes: [] })));
    if (!saved.saved) { message = 'Selected hosts could not be prepared in this workspace. Nothing was collected or enrolled.'; return; }
    await goto(`/bulk?source=manual&handoff=${saved.token}`);
  }
</script>
<section class="snapshots" aria-label="Source-qualified infrastructure snapshots" aria-busy={pending}>
  <h4>Multi-host snapshots and historical comparison</h4>
  <p>Select one snapshot to review its exact scoped evidence or two in chronological order to compare. Wildcard patterns are not selectable hosts. No selection starts collection or monitoring.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if response}
    <p role="status">{response.total} admitted source-qualified snapshots. Legacy evidence without this format remains available in the inventory; its complete scope is unknown.</p>
    {#if response.partial}<p>Snapshot coverage is incomplete or unavailable. Withheld, unsupported or unreadable evidence cannot establish absence; only admitted exact snapshots can be selected.</p>{/if}
    <ol aria-label="Retained infrastructure snapshots">
      {#each response.summaries as row (row.identity)}
        <li><label><input type="checkbox" checked={selectedIds.includes(row.identity)} onchange={event => toggle(row.identity, event.currentTarget.checked)} />{row.id} · {row.target} · {formatEvidenceDate(row.observedAt)} · {row.mode.replaceAll('_', ' ')} · {row.coverage.state} · {row.hostCount} selected hosts</label><a href={`/monitor?case=${encodeURIComponent(row.caseId)}`}>Inspect supporting Case for {row.id}</a></li>
      {/each}
    </ol>
    <Pagination currentPage={response.page} pageCount={response.pageCount} setPage={value => page = value} ariaLabel="Infrastructure snapshot pages" />
    {#each response.selected as retained (retained.identity)}
      {@const snapshot = retained.observation}
      <section aria-label={`Exact snapshot ${snapshot.id}`}>
        <h5>{snapshot.id} · {snapshot.target}</h5>
        <p>{snapshot.coverage.state} · {snapshot.coverage.detail} · {snapshot.scope.selection.replaceAll('_', ' ')}. These counts describe selected evidence, not all infrastructure belonging to an organisation.</p>
        <button class="btn small" type="button" onclick={() => downloadLocalFile(new Blob([serialiseInfrastructureObservation(snapshot)], { type: 'application/json' }), 'infrastructure-observation.json')}>Export exact snapshot {snapshot.id}</button>
        <details open><summary>{snapshot.scope.hostnames.length} exact selected hostnames</summary><ul>
          {#each snapshot.scope.hostnames as hostname}<li><label><input type="checkbox" checked={hosts.includes(hostname)} onchange={event => { hosts = event.currentTarget.checked ? [...new Set([...hosts, hostname])] : hosts.filter(value => value !== hostname); }} />{hostname}</label> <a href={`/lookup?q=${encodeURIComponent(hostname)}#query`}>Prepare Lookup for {hostname}</a></li>{/each}
        </ul></details>
        <details><summary>{snapshot.dns.length} source-qualified DNS observations and outcomes</summary><ul>{#each snapshot.dns as row}<li>Queried {row.queriedName} {row.type} · owner {row.ownerName} · {row.outcome.replaceAll('_', ' ')} · {row.values.join(', ') || 'No answer retained'} · source {row.sourceId} · {formatEvidenceDate(row.observedAt)} · {row.complete && !row.truncated ? 'Complete selected response' : 'Incomplete response'}</li>{/each}</ul></details>
        <details><summary>{snapshot.certificates.length} certificate observations, exact names and wildcard patterns</summary><ul>{#each snapshot.certificates as row}<li>{row.fingerprintSha256} · source {row.sourceId} · {formatEvidenceDate(row.observedAt)} · {row.namesComplete ? 'Complete retained name list' : 'Incomplete name list'}<ul>{#each row.names as name}<li>{name} · {name.startsWith('*.') ? 'Wildcard pattern, not an enumerated host' : 'Discovered certificate name, resolution not established'}</li>{/each}</ul></li>{/each}</ul></details>
        <details><summary>{snapshot.roles.length} independent provider-role observations</summary><ul>{#each snapshot.roles as row}<li>{row.subject} · {row.role.replaceAll('_', ' ')} · {row.providerLabel}: {row.value} · source {row.sourceId} · {formatEvidenceDate(row.observedAt)} · {row.complete ? 'Complete selected evidence' : 'Incomplete evidence'}</li>{/each}</ul><p>An edge/CDN, platform, registered address holder and independently sourced routing origin are different roles. Unknown origin remains unknown.</p></details>
        <details><summary>Sources and limitations for {snapshot.id}</summary><ul>{#each snapshot.sources as source}<li>{source.id}: {source.name} · {source.family.replaceAll('_', ' ')} · {source.evidenceClass.replaceAll('_', ' ')} · {source.reference ?? 'No reference retained'}</li>{/each}{#each snapshot.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
      </section>
    {/each}
    {#if hosts.length}<p>{hosts.length} explicitly selected hostnames. Bulk opens with these targets for review; it does not run a scan, change a watchlist or schedule.</p><button class="btn small" type="button" onclick={() => void prepareBulk()}>Prepare selected hosts in Bulk</button>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if response.comparison}<section aria-label="Infrastructure snapshot comparison"><h5>Comparison · {response.comparison.state}</h5><ol>{#each response.comparison.rows as row}<li>{row.hostname} · {row.family.replaceAll('_', ' ')} · {row.source.name} ({row.source.evidenceClass.replaceAll('_', ' ')}) · {row.state.replaceAll('_', ' ')}<p>{row.before.join(', ') || 'No earlier values retained'} → {row.after.join(', ') || 'No later values retained'}</p><p>{row.detail}</p></li>{/each}</ol><ul>{#each response.comparison.limitations as limitation}<li>{limitation}</li>{/each}</ul></section>{/if}
  {/if}
</section>
<style>
  .snapshots{min-width:0;margin-top:20px;border-top:1px solid var(--border);padding-top:16px}h4,h5,p,li{overflow-wrap:anywhere}h4,h5{margin:10px 0}ol,ul{padding-left:22px}li{margin-block:8px;min-width:0}label{display:flex;align-items:flex-start;gap:8px}input{flex:none;min-width:20px;min-height:20px}button,a{max-width:100%;white-space:normal;overflow-wrap:anywhere}details{margin-top:12px}section>section{border-top:1px solid var(--border);margin-top:16px;padding-top:12px}summary{cursor:pointer}
</style>
