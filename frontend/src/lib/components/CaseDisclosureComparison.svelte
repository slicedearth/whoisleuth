<script lang="ts">
  import { preparedDisclosureRows } from '../../../../packages/cases/prepared-disclosure-comparison.mts';
  import type { CaseReportPreview } from '../../../../packages/cases/case-report-preview.mts';
  import type { CaseResponsePacket } from '../../../../packages/cases/case-response-packet-types.mts';
  import Pagination from './Pagination.svelte';
  let { internal, recipient }: { internal: CaseReportPreview; recipient: CaseResponsePacket } = $props();
  let differencesOnly = $state(false), page = $state(1);
  const rows = $derived(preparedDisclosureRows(internal.report.json, recipient));
  const visible = $derived(differencesOnly ? rows.filter(row => row.state !== 'same_representation') : rows);
  const pageCount = $derived(Math.max(1, Math.ceil(visible.length / 25)));
  const currentPage = $derived(Math.min(page, pageCount));
  const pageRows = $derived(visible.slice((currentPage - 1) * 25, currentPage * 25));
</script>

<section class="analyst-disclosures" aria-label="Analyst-only prepared disclosures">
  <h5>Actual prepared disclosures</h5>
  <p>Ordinary report compared with the {recipient.profile.label} packet prepared at {recipient.generatedAt}. Different schemas are different representations, not proof of redaction, deletion or equivalent meaning.</p>
  <p>Internal notes: {internal.report.json.case.notesIncluded ? 'included by your selection' : 'not prepared'}. The recipient side is only its actual packet JSON. This comparison is excluded from printing and every recipient export.</p>
  <label><input type="checkbox" bind:checked={differencesOnly} onchange={() => page = 1}> Show differing representations only</label>
  <p>{visible.length} shown of {rows.length} exact fields/references. Expand a row to inspect both full values.</p>
  {#each pageRows as row (JSON.stringify([row.group, row.reference]))}
    <details>
      <summary>{row.group}: <code>{row.reference}</code> · {row.state.replaceAll('_', ' ')}</summary>
      <div class="sides">
        {#each [{ label: 'Prepared ordinary report', side: row.internal }, { label: 'Prepared recipient packet', side: row.recipient }] as column}
          <section aria-label={`${row.group} ${row.reference} ${column.label}`}>
            <strong>{column.label}</strong>
            {#if column.side.present}
              {#if column.side.ambiguous}<p>Multiple matching references are included below; no one record was chosen.</p>{/if}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard access to the complete bounded prepared value -->
              <div class="value" role="region" tabindex="0" aria-label={`${row.group} ${row.reference} ${column.label} exact value`}><pre>{JSON.stringify(column.side.value, null, 2) ?? 'Value unavailable'}</pre></div>
            {:else}<p>Not represented on this side. This does not establish deletion or absence from the Case.</p>{/if}
          </section>
        {/each}
      </div>
    </details>
  {/each}
  <Pagination {currentPage} {pageCount} setPage={value => page = value} ariaLabel="Disclosure comparison pages" pageInputLabel="Disclosure comparison page" />
</section>

<style>
  .analyst-disclosures{min-width:0;overflow-wrap:anywhere}h5{font-size:var(--text-md);margin:1rem 0}.sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;padding:1rem}section,details{min-width:0}summary{cursor:pointer;overflow-wrap:anywhere;min-height:44px;align-content:center}code{white-space:normal;overflow-wrap:anywhere}p{line-height:1.55}label{display:flex;align-items:center;gap:.5rem;min-height:44px}input{width:18px;height:18px;flex:none}.value{max-height:24rem;overflow:auto;margin-top:.5rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:400 var(--text-xs)/1.6 var(--mono);margin:0}@media(max-width:700px){.sides{grid-template-columns:minmax(0,1fr)}}@media print{.analyst-disclosures{display:none!important}}
</style>
