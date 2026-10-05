<script lang="ts">
  import type { RecoveryFile } from '../../../../packages/workspace/workspace-recovery.mts';
  import CopyButton from './CopyButton.svelte';
  let { files }: { files: readonly RecoveryFile[] } = $props();
  const PAGE_SIZE = 20,
    REFERENCES_PER_PAGE = 10;
  let page = $state(1),
    referencePages = $state<Record<string, number>>({});
  $effect(() => {
    files;
    page = 1;
    referencePages = {};
  });
  const pages = $derived(Math.max(1, Math.ceil(files.length / PAGE_SIZE)));
  const visible = $derived(files.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
</script>

<section aria-label="Original-file recovery checklist">
  <h5>Original-file recovery checklist</h5>
  <p
    >Each SHA-256 and exact byte length identifies one unique original. Filenames are locating hints
    only; matching names do not establish matching bytes. Unverified means storage could not be
    read, not that the file is absent. This checklist stays in this rehearsal only.</p
  >
  <p aria-live="polite"
    >{files.length} unique original{files.length === 1 ? '' : 's'} still need verification. Page {page}
    of {pages}.</p
  >
  <ol start={(page - 1) * PAGE_SIZE + 1}>
    {#each visible as file (file.digestSha256)}
      {@const referencePage = referencePages[file.digestSha256] ?? 1}
      {@const referencePageCount = Math.max(
        1,
        Math.ceil(file.references.length / REFERENCES_PER_PAGE),
      )}
      <li>
        <strong>{file.state === 'missing' ? 'Missing' : 'Unverified — retry verification'}</strong>
        <p><code>{file.digestSha256}</code> · {file.byteLength.toLocaleString()} bytes</p>
        <CopyButton
          value={file.digestSha256}
          label="Copy SHA-256"
          description={`Copy SHA-256 for recovery original ${file.digestSha256}`}
        />
        <details
          ><summary
            >{file.references.length} provenance reference{file.references.length === 1
              ? ''
              : 's'}</summary
          >
          <ul
            >{#each file.references.slice((referencePage - 1) * REFERENCES_PER_PAGE, referencePage * REFERENCES_PER_PAGE) as reference}
              <li
                >Case <code>{reference.caseId}</code> · attachment
                <code>{reference.attachment.id}</code>
                · filename hint <strong>{reference.attachment.fileName}</strong> · source {reference
                  .attachment.source ?? 'unknown'} · observed {reference.attachment.observedAt ??
                  'unknown'} · retained {reference.attachment.retainedAt}</li
              >
            {/each}</ul
          >
          {#if referencePageCount > 1}<nav aria-label={`Provenance pages for ${file.digestSha256}`}>
              <button
                type="button"
                class="btn"
                disabled={referencePage === 1}
                onclick={() => (referencePages[file.digestSha256] = referencePage - 1)}
                >Previous references</button
              >
              <span>Page {referencePage} of {referencePageCount}</span>
              <button
                type="button"
                class="btn"
                disabled={referencePage === referencePageCount}
                onclick={() => (referencePages[file.digestSha256] = referencePage + 1)}
                >Next references</button
              >
            </nav>{/if}
        </details>
      </li>
    {/each}
  </ol>
  {#if pages > 1}<nav aria-label="Recovery checklist pages">
      <button class="btn" type="button" disabled={page === 1} onclick={() => page--}
        >Previous originals</button
      >
      <span>Page {page} of {pages}</span>
      <button class="btn" type="button" disabled={page === pages} onclick={() => page++}
        >Next originals</button
      >
    </nav>{/if}
</section>

<style>
  section,
  li {
    min-width: 0;
  }
  p,
  li {
    overflow-wrap: anywhere;
    font-size: var(--text-xs);
    line-height: 1.6;
  }
  code {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  ol {
    padding-left: 24px;
  }
  ol > li {
    padding-block: 10px;
    border-bottom: 1px solid var(--border);
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-block: 12px;
  }
  button {
    white-space: normal;
    max-width: 100%;
  }
  summary {
    min-height: 44px;
    cursor: pointer;
  }
  @media (max-width: 520px) {
    nav {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
