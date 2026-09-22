<script lang="ts">
  import type { buildCaseReport } from '../../../../packages/cases/case-report.mts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import { snapshotFieldGroups, formatSnapshotValue } from '$lib/analysis/evidence-display.ts';
  let { report, timeLabel = 'report time' }: { report: ReturnType<typeof buildCaseReport>['json']; timeLabel?: string } = $props();
</script>

<article class="case-report-reading" aria-label="Case report contents">
  <header><h3>{report.case.title || report.case.domain}</h3><p><code>{report.case.domain}</code> · {report.case.status} · Analyst disposition: {report.case.disposition.replaceAll('_', ' ')}</p><p>Case reference: <code>{report.case.id}</code></p><EvidenceTimestamp value={report.generatedAt} label={timeLabel} /></header>
  {#if report.evidenceTimeline.length}
    <section aria-label="Retained observations">
      <h3>Retained observations · {report.evidenceTimeline.length}</h3>
      <p>Snapshot hostnames are not included in this report. Supporting observations may concern a different hostname.</p>
      {#each report.evidenceTimeline as entry}
        <details class="snapshot">
          <summary><EvidenceTimestamp value={entry.snapshot.capturedAt} copyable={false} /> · {entry.snapshot.source} · {entry.snapshot.scanDepth}</summary>
          {#if entry.hasIncomparableChange}<p>Some fields cannot be compared reliably: {entry.incomparableReasons.join(', ')}.</p>{/if}
          {#each snapshotFieldGroups(entry.snapshot) as group}
            <h4>{group.name}</h4>
            <dl>{#each group.rows as row}<dt>{row.label}</dt><dd>{formatSnapshotValue(row.field, row.value)}</dd>{/each}</dl>
          {/each}
        </details>
      {/each}
    </section>
  {/if}
  {#if report.analystResponse.evidencePins.length}
  <section><h3>Selected evidence · {report.analystResponse.evidencePins.length}</h3><ol>{#each report.analystResponse.evidencePins as pin}<li><CaseEvidenceFact {pin} copyable /></li>{/each}</ol></section>
  {/if}
  {#if report.analystResponse.decisions.length}
  <section><h3>Analyst decisions · {report.analystResponse.decisions.length}</h3><ol>{#each report.analystResponse.decisions as decision}<li><h4>{decision.summary}</h4><p>{decision.rationale}</p><p>Confidence: {decision.confidence}{decision.confidenceBasis ? ` · ${decision.confidenceBasis}` : ''}</p><EvidenceTimestamp value={decision.createdAt} label="decision time" /></li>{/each}</ol></section>
  {/if}
  {#if report.analystResponse.assertions.length}
  <section><h3>Assertions · {report.analystResponse.assertions.length}</h3><ol>{#each report.analystResponse.assertions as assertion}<li><h4>{assertion.statement}</h4><p>{assertion.kind.replaceAll('_', ' ')} · {assertion.state}</p>{#if assertion.rationale}<p>{assertion.rationale}</p>{/if}{#if assertion.provenance}<p>Imported from {assertion.provenance.sourceName}{assertion.provenance.publisher ? ` · ${assertion.provenance.publisher}` : ''}</p>{/if}</li>{/each}</ol></section>
  {/if}
  {#if report.analystResponse.actions.length}
  <section><h3>Response history · {report.analystResponse.actions.length}</h3><ol>{#each report.analystResponse.actions as action}<li><h4>{action.recipient}</h4><p>{action.type.replaceAll('_', ' ')} · {action.state.replaceAll('_', ' ')}</p>{#if action.providerOutcome}<p>Provider-reported: {action.providerOutcome.replaceAll('_', ' ')}</p>{/if}{#if action.reference}<p>Reference: {action.reference}</p>{/if}{#if action.outcome}<p>{action.outcome}</p>{/if}</li>{/each}</ol></section>
  {/if}
  {#if report.analystResponse.observedEffects.reviews.length}
  <section><h3>Independent rechecks · {report.analystResponse.observedEffects.reviews.length}</h3><ol>{#each report.analystResponse.observedEffects.reviews as review}<li><h4>{review.state.replaceAll('_', ' ')}</h4><p>{review.source} · {review.completeness}</p><EvidenceTimestamp value={review.observedAt} label="observation time" />{#each review.limitations as limitation}<p>{limitation}</p>{/each}</li>{/each}</ol></section>
  {/if}
  {#if report.case.notesIncluded}<section><h3>Analyst notes · {report.case.notes?.length ?? 0}</h3><ol>{#each report.case.notes ?? [] as note}<li><EvidenceTimestamp value={note.createdAt} label="note time" /><p class="prose">{note.body}</p></li>{/each}</ol></section>{/if}
  <details><summary>Coverage and interpretation</summary><p>{report.limitations}</p><p>{report.evidenceTimeline.length} retained evidence snapshots. The JSON and Markdown contain the full projected timeline, relationships and recorded lifecycle details.</p></details>
</article>

<style>
  .snapshot{padding-block:8px}.snapshot h4{margin-top:16px}dl{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(0,2fr);gap:8px;margin:0 0 16px}dt{color:var(--muted)}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:8px}}
  .case-report-reading{min-width:0;font:var(--text-sm)/1.65 var(--font-sans);overflow-wrap:anywhere}header,section{padding-block:16px;border-bottom:1px solid var(--border)}h3,h4{font-family:var(--font-sans);margin:0 0 8px}h4{font-size:var(--text-sm)}p{margin-block:6px}ol{padding-left:24px}li{margin-block:18px}code{overflow-wrap:anywhere}.prose{white-space:pre-wrap}details{margin-top:16px}summary{min-height:44px}
</style>
