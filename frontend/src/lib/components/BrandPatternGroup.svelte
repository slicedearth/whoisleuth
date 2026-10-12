<script lang="ts">
  import type { projectBrandCandidateReview } from '../../../../packages/monitoring/brand-candidate-review.mts';
  import { formatEvidenceDate } from '#lib/analysis/evidence-time.ts';
  import Pagination from './Pagination.svelte';
  type Row = ReturnType<typeof projectBrandCandidateReview>[number];
  let { members, ruleKey, reason, inspected, oninspect }: {
    members: readonly Row[];
    ruleKey: string;
    reason: string;
    inspected: string | null;
    oninspect: (domain: string) => void;
  } = $props();
  let expanded = $state(false), page = $state(1);
  const pageCount = $derived(Math.max(1, Math.ceil(members.length / 25)));
  const currentPage = $derived(Math.min(page, pageCount));
  const pageMembers = $derived(members.slice((currentPage - 1) * 25, currentPage * 25));
</script>

<details ontoggle={event => expanded = event.currentTarget.open}>
  <summary>{members.length} contributing {members.length === 1 ? 'domain' : 'domains'} · {reason}</summary>
  {#if expanded}
    <section aria-label={`Pattern group contributors for ${ruleKey}`}>
      <p>Group rule: <code>{ruleKey}</code></p>
      <p>Showing {(currentPage - 1) * 25 + 1}–{Math.min(currentPage * 25, members.length)} of {members.length} domains in this filtered retained group.</p>
      <ul>
        {#each pageMembers as row (row.candidate.domain)}
          <li>
            <div>
              <code>{row.candidate.domain}</code>
              <p>Review status: {row.status.replaceAll('_', ' ')} · {row.lifecycle.reason}</p>
              {#if row.declaration}<p>Scoped declaration: {row.declaration}; not a safety verdict.</p>{/if}
              {#each row.exceptionStates as exception}
                <p>Exact rule exception for <code>{exception.exception.ruleKey}</code> · {exception.state}: {exception.exception.reason} · expires {formatEvidenceDate(exception.exception.expiresAt)}.</p>
              {/each}
            </div>
            <button class="btn small" type="button" aria-label={`Inspect grouped ${row.candidate.domain}`} aria-pressed={inspected === row.candidate.domain} onclick={() => oninspect(row.candidate.domain)}>Inspect</button>
          </li>
        {/each}
      </ul>
      <Pagination {currentPage} {pageCount} setPage={value => page = value} ariaLabel="Pattern contributor pages" pageInputLabel="Pattern contributor page" />
      <p>Inspection opens retained evidence only. It does not check a domain, change its disposition or authorise a group action.</p>
    </section>
  {/if}
</details>

<style>
  details{margin-top:10px;min-width:0}
  summary{min-height:44px;cursor:pointer;overflow-wrap:anywhere}
  p{margin:6px 0;font-size:var(--text-xs);line-height:1.55;color:var(--muted)}
  ul{list-style:none;padding:0;margin:10px 0}
  li{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--border);min-width:0}
  li>div{min-width:0;overflow-wrap:anywhere}
  code{white-space:normal;overflow-wrap:anywhere}
  button{flex:none}
</style>
