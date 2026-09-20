<script lang="ts">
  import { CASE_VIEW_SORTS, MAX_CASE_VIEW_SEARCH_LENGTH, type CaseViewFilters } from '../../../../packages/contracts/case-views-contract.mts';
  type Option = { value: string; label: string };
  type Sort = CaseViewFilters['sort'];

  let {
    status,
    setStatus,
    disposition,
    setDisposition,
    search,
    setSearch,
    sort,
    setSort,
    statusOptions,
    dispositionOptions,
    clear,
    matchedCount,
    totalCount,
  }: {
    status: CaseViewFilters['status'];
    setStatus: (value: CaseViewFilters['status']) => void;
    disposition: CaseViewFilters['disposition'];
    setDisposition: (value: CaseViewFilters['disposition']) => void;
    search: string;
    setSearch: (value: string) => void;
    sort: Sort;
    setSort: (value: Sort) => void;
    statusOptions: readonly Option[];
    dispositionOptions: readonly Option[];
    clear: () => void;
    matchedCount: number;
    totalCount: number;
  } = $props();
</script>

<section class="case-filters card">
  <label class="field">Status<select value={status} onchange={(event) => setStatus(event.currentTarget.value as CaseViewFilters['status'])}><option value="">All statuses</option>{#each statusOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  <label class="field">Disposition<select value={disposition} onchange={(event) => setDisposition(event.currentTarget.value as CaseViewFilters['disposition'])}><option value="">All dispositions</option>{#each dispositionOptions as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  <label class="field search">Search<input value={search} oninput={(event) => setSearch(event.currentTarget.value)} maxlength={MAX_CASE_VIEW_SEARCH_LENGTH} placeholder="Title, domain, Case ID, type or tag" autocomplete="off"></label>
  <label class="field">Sort<select value={sort} onchange={(event) => setSort(event.currentTarget.value as Sort)}>{#each CASE_VIEW_SORTS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
  <button class="btn" onclick={clear} disabled={!status && !disposition && !search}>Clear</button>
</section>
<p class="count">{matchedCount} of {totalCount} case{totalCount === 1 ? '' : 's'} shown</p>

<style>
  .case-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:14px;padding:16px}
  .case-filters .search{flex:1;min-width:170px}
  .case-filters input{min-height:var(--control-h)}
  .count{margin:12px 2px;color:var(--muted);font-size:var(--text-xs)}
</style>
