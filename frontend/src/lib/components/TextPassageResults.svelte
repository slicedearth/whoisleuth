<script lang="ts">
  import type { CaseAttachment } from '../../../../packages/cases/case-attachment-model.mts';
  import type { TextPassageComparison } from '../../../../packages/comparison/text-passages.mts';
  import ComparisonFrame from './ComparisonFrame.svelte';
  let { result, reference, candidate, referenceScope = '', candidateScope = '', heading = $bindable() }: {
    result: TextPassageComparison; reference: CaseAttachment; candidate: CaseAttachment;
    referenceScope?: string; candidateScope?: string; heading?: HTMLHeadingElement | undefined;
  } = $props();
  let page = $state(0);
  $effect(() => { result; page = 0; });
  const visible = (text: string) => text.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    value => `[U+${value.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
</script>

<div class="passage-results">
  <h4 bind:this={heading} tabindex="-1">{result.totalPassages} shared {result.totalPassages === 1 ? 'passage' : 'passages'}</h4>
  <p role="status">{result.matchedCandidateWords} of {result.candidate.words} candidate words and {result.matchedReferenceWords} of {result.reference.words} reference words participate in these matches. {result.exactBytes ? 'The complete file bytes are identical.' : 'The complete file bytes differ.'}</p>
  <details><summary>Sources and comparison method</summary>
    <ComparisonFrame>
      {#snippet header()}<h5>Verified text sources</h5>{/snippet}
      {#snippet left()}<section aria-label="Reference retained text source"><dl><dt>Reference: {reference.fileName}</dt><dd>{#if referenceScope}{referenceScope}<br />{/if}{reference.source ?? 'Source not declared'} · {reference.observedAt ?? 'Observation time unknown'}<br /><code>{result.reference.digestSha256}</code></dd></dl></section>{/snippet}
      {#snippet right()}<section aria-label="Candidate retained text source"><dl><dt>Candidate: {candidate.fileName}</dt><dd>{#if candidateScope}{candidateScope}<br />{/if}{candidate.source ?? 'Source not declared'} · {candidate.observedAt ?? 'Observation time unknown'}<br /><code>{result.candidate.digestSha256}</code></dd></dl></section>{/snippet}
      {#snippet children()}<ul>{#each result.limitations as limitation}<li>{limitation}</li>{/each}<li>Directional controls are shown as Unicode code points in the excerpts.</li></ul>{/snippet}
    </ComparisonFrame>
  </details>
  <ol start={page * 8 + 1}>
    {#each result.passages.slice(page * 8, (page + 1) * 8) as passage}
      <li><p>{passage.words} matching words</p><div class="passage">
        {#each [{ label: 'Reference', excerpt: passage.reference }, { label: 'Candidate', excerpt: passage.candidate }] as part}
          <div><h5>{part.label} · characters {part.excerpt.start}–{part.excerpt.end}</h5><blockquote>{visible(part.excerpt.text)}</blockquote>
            {#if part.excerpt.clipped}<p>Showing the first {part.excerpt.text.length.toLocaleString()} characters of this passage. The full range above refers to the unchanged retained file.</p>{/if}
          </div>
        {/each}
      </div></li>
    {/each}
  </ol>
  {#if result.passages.length > 8}<nav aria-label="Text passages"><button class="btn" disabled={page === 0} onclick={() => page--}>Previous passages</button><span>{page + 1} of {Math.ceil(result.passages.length / 8)}</span><button class="btn" disabled={(page + 1) * 8 >= result.passages.length} onclick={() => page++}>Next passages</button></nav>{/if}
  {#if result.omittedPassages}<p>{result.omittedPassages} further passages are counted but not listed. The list includes the first {result.passages.length} in candidate order.</p>{/if}
</div>

<style>
  .passage-results{display:grid;gap:12px;min-width:0}p,li,dd{font-size:var(--text-xs);line-height:1.6;margin:0;overflow-wrap:anywhere;color:var(--muted)}
  h4,h5{margin:0;font-size:var(--text-sm)}h4:focus{outline:2px solid var(--focus);outline-offset:4px}
  summary{cursor:pointer;padding-block:10px;font-weight:650;min-height:44px;align-content:center}
  .passage{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0}nav{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
  button{max-width:100%;white-space:normal}dl{display:grid;gap:12px}dt{font-weight:650;overflow-wrap:anywhere}code{overflow-wrap:anywhere}
  ol,ul{padding-left:20px;display:grid;gap:16px}blockquote{margin:8px 0;padding:10px;background:var(--panel-raised);white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}
  @media(max-width:640px){.passage{grid-template-columns:minmax(0,1fr)}}
</style>
