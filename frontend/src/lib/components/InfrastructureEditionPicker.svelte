<script lang="ts">
  import { MAX_RETAINED_SOURCE_EDITION_BYTES } from '../../../../packages/contracts/retained-source-edition.mts';
  import { SOURCE_EDITION_DIGEST } from '../../../../packages/evidence/retained-source-edition.mts';
  import type { CommonInfrastructureSnapshot } from '#lib/analysis/common-infrastructure.ts';

  let { edition, onchange }: {
    edition: CommonInfrastructureSnapshot | undefined;
    onchange: (edition: CommonInfrastructureSnapshot | undefined) => void;
  } = $props();
  let file = $state<File | null>(null);
  let digest = $state('');
  let busy = $state(false);
  let error = $state('');
  let generation = 0;

  $effect(() => () => { generation += 1; });

  async function apply(event: SubmitEvent) {
    event.preventDefault();
    if (!file || busy) return;
    const selected = file;
    const expected = digest.trim();
    if (selected.size < 1 || selected.size > MAX_RETAINED_SOURCE_EDITION_BYTES || !SOURCE_EDITION_DIGEST.test(expected)) {
      error = 'Choose a bounded edition file and enter its full SHA-256 digest.';
      return;
    }
    const id = ++generation;
    busy = true;
    error = '';
    try {
      const { readCurrentInfrastructureEdition } = await import('../../../../packages/relationships/infrastructure-edition.mts');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await selected.arrayBuffer());
      const next = await readCurrentInfrastructureEdition(text, expected);
      if (id === generation) onchange(next);
    } catch {
      if (id === generation) error = 'That file did not verify as a current infrastructure edition. The active edition has not changed.';
    } finally {
      if (id === generation) busy = false;
    }
  }
</script>

<details>
  <summary>Use a reviewed infrastructure edition</summary>
  <p>Applies to this campaign review only. Use the digest from the source maintainer, not a digest supplied by the file itself. Nothing is uploaded or saved.</p>
  <form onsubmit={apply}>
    <label>Edition file
      <input type="file" accept=".json,application/json" disabled={busy}
        onchange={(event) => { file = event.currentTarget.files?.[0] ?? null; }} />
    </label>
    <label>Expected SHA-256 digest
      <input type="text" bind:value={digest} maxlength="71" spellcheck="false" autocomplete="off" disabled={busy} />
    </label>
    <div class="edition-actions">
      <button class="btn" type="submit" disabled={!file || !digest.trim() || busy}>{busy ? 'Verifying…' : 'Apply edition'}</button>
      {#if edition}
        <button class="btn" type="button" disabled={busy} onclick={() => { error = ''; onchange(undefined); }}>Use bundled ranges</button>
      {/if}
    </div>
  </form>
  <p role="status">{error || (edition ? `Using the reviewed edition dated ${edition.generatedAt.slice(0, 10)}.` : 'Using the bundled ranges.')}</p>
</details>

<style>
  details { margin-block: var(--space-3, .75rem); }
  summary { cursor: pointer; }
  form, label { display: grid; gap: .4rem; }
  form { max-width: 35rem; margin-block: .75rem; gap: .75rem; }
  input { max-width: 100%; min-width: 0; }
  .edition-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
</style>
