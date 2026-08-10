<script lang="ts">
  import {
    MAX_IDN_POLICY_BYTES,
    digestRegistryIdnPolicySource,
    parseRegistryIdnPolicy,
    reviewRegistryIdnCandidates,
    type RegistryIdnPolicy,
  } from '$lib/analysis/idn-registry-policy.ts';

  let { candidates }: { candidates: readonly { domain: string; unicodeDomain: string }[] } = $props();
  let suffix = $state('');
  let selectedFile = $state<File | null>(null);
  let policy = $state<RegistryIdnPolicy | null>(null);
  let error = $state('');
  let loading = $state(false);
  let reviewGeneration = 0;

  const unicodeCandidates = $derived(candidates.filter((candidate) => candidate.unicodeDomain && candidate.unicodeDomain !== candidate.domain));
  const reviews = $derived(policy ? reviewRegistryIdnCandidates(policy, unicodeCandidates) : []);
  const counts = $derived({
    allowed: reviews.filter((item) => item.state === 'allowed_by_table').length,
    notListed: reviews.filter((item) => item.state === 'not_listed').length,
    outOfScope: reviews.filter((item) => item.state === 'out_of_scope').length,
  });

  function selectFile(event: Event) {
    reviewGeneration += 1;
    loading = false;
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    policy = null;
    error = '';
  }

  function updateSuffix(event: Event) {
    reviewGeneration += 1;
    loading = false;
    suffix = (event.currentTarget as HTMLInputElement).value;
    policy = null;
    error = '';
  }

  async function review() {
    if (!selectedFile) return;
    const sourceFile = selectedFile;
    const sourceSuffix = suffix.trim();
    const sourceName = sourceFile.name;
    const sourceSize = sourceFile.size;
    const generation = ++reviewGeneration;
    loading = true;
    error = '';
    try {
      if (sourceSize < 1 || sourceSize > MAX_IDN_POLICY_BYTES) {
        throw new Error(`Registry table files are limited to ${MAX_IDN_POLICY_BYTES / (1024 * 1024)} MiB.`);
      }
      const xml = await sourceFile.text();
      const next = parseRegistryIdnPolicy({
        suffix: sourceSuffix,
        sourceName,
        sourceDigestSha256: await digestRegistryIdnPolicySource(xml),
        xml,
      });
      if (generation !== reviewGeneration || selectedFile !== sourceFile || suffix.trim() !== sourceSuffix) return;
      policy = next;
    } catch (cause) {
      if (generation !== reviewGeneration) return;
      policy = null;
      error = cause instanceof Error ? cause.message : 'The registry table could not be reviewed.';
    } finally {
      if (generation === reviewGeneration) loading = false;
    }
  }
</script>

{#if unicodeCandidates.length}
  <details class="idn-policy card">
    <summary><span><span class="eyebrow">Optional local policy</span><strong>Registry IDN feasibility</strong></span><span>{unicodeCandidates.length} Unicode candidate{unicodeCandidates.length === 1 ? '' : 's'}</span></summary>
    <p class="intro">Import a reviewed RFC 7940 LGR XML file and name its DNS-safe suffix. The file stays in this browser tab. This checks only individual code-point repertoire membership and never claims that a label is registrable.</p>
    <div class="controls">
      <label>Registry suffix<input value={suffix} maxlength="253" placeholder="test" aria-label="Registry table suffix" disabled={loading} oninput={updateSuffix}></label>
      <label class="file">LGR XML file<input type="file" accept=".xml,application/xml,text/xml" disabled={loading} onchange={selectFile}></label>
      <button class="btn" onclick={review} disabled={!selectedFile || !suffix.trim() || loading}>{loading ? 'Reviewing…' : 'Review local table'}</button>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if policy}
      <div class="summary-grid">
        <div><span>Listed by table</span><strong>{counts.allowed}</strong></div>
        <div><span>Code point not listed</span><strong>{counts.notListed}</strong></div>
        <div><span>Outside .{policy.suffix}</span><strong>{counts.outOfScope}</strong></div>
      </div>
      <p class="source">Source: <strong>{policy.sourceName}</strong> · {policy.codePointCount.toLocaleString()} code points · <code>{policy.sourceDigestSha256}</code></p>
      {#if counts.notListed}
        <div class="exceptions">
          {#each reviews.filter((item) => item.state === 'not_listed').slice(0, 12) as item}
            <div><strong>{item.unicodeDomain}</strong><span>{item.unlistedCodePoints.join(', ')}</span></div>
          {/each}
        </div>
      {/if}
      <ul>{#each policy.limitations as limitation}<li>{limitation}</li>{/each}</ul>
    {/if}
  </details>
{/if}

<style>
  .idn-policy{margin-top:16px;padding:0}
  summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:var(--card-pad);cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary>span:first-child{display:grid;gap:4px}
  summary strong{font-size:var(--text-lg)}
  summary>span:last-child{color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .idn-policy[open]{padding-bottom:var(--card-pad)}
  .idn-policy[open] summary{border-bottom:1px solid var(--border)}
  .intro,.source,.idn-policy ul{margin:14px var(--card-pad) 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .controls{display:grid;grid-template-columns:minmax(150px,.5fr) minmax(220px,1fr) auto;gap:9px;align-items:end;margin:14px var(--card-pad) 0}
  label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  input{min-width:0}
  .file input{padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .error{margin:10px var(--card-pad) 0;color:var(--danger);font-size:var(--text-xs)}
  .summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px var(--card-pad) 0}
  .summary-grid div{display:grid;gap:5px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .summary-grid span{color:var(--muted);font-size:var(--text-2xs)}
  .summary-grid strong{font:700 var(--text-lg) var(--mono)}
  .source code{overflow-wrap:anywhere}
  .exceptions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:12px var(--card-pad) 0}
  .exceptions div{display:flex;justify-content:space-between;gap:8px;min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .exceptions strong{min-width:0;overflow-wrap:anywhere;font-size:var(--text-xs)}
  .exceptions span{color:var(--muted);font:var(--text-2xs) var(--mono)}
  @media(max-width:700px){summary{align-items:flex-start}.controls,.summary-grid,.exceptions{grid-template-columns:1fr}.controls button{width:100%}}
</style>
