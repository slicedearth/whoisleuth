<script lang="ts">
  import type { MailAuthenticationReview } from '../../../../packages/contracts/mail-authentication.mts';
  import { authenticationHeaderLabel, selectReceiverTrust } from '../../../../packages/investigation/mail-authentication-review.mts';
  import Pagination from './Pagination.svelte';
  let { review, onchange, disabled = false, headingTag = 'h4' }: { review: MailAuthenticationReview; onchange: (review: MailAuthenticationReview) => void; disabled?: boolean; headingTag?: 'h3' | 'h4' } = $props();
  let page = $state(1);
  const PAGE_SIZE = 10;
  const headers = $derived(review.headers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  function select(part: number, index: number, checked: boolean) {
    const key = `${part}:${index}`;
    const selected = review.headers.filter(header => header.receiverTrust === 'analyst_selected').map(header => `${header.part}:${header.headerIndex}`).filter(value => value !== key);
    if (checked) selected.push(key);
    onchange(selectReceiverTrust(review, selected));
  }
</script>

<section aria-label="Authentication by header" class="authentication-review">
  <svelte:element this={headingTag} class="heading">Authentication by header</svelte:element>
  <p>Each row reports what that source claimed. Only select receiver trust when you recognise the exact header as added inside your receiving system; a matching service name is not proof. Nested messages have separate selections.</p>
  {#if !review.headers.length}<p>No Authentication-Results or Received-SPF header was found in the reviewed message parts.</p>{/if}
  {#if review.omittedHeaders}<p class="notice">{review.omittedHeaders} further headers were not analysed within the review bound.</p>{/if}
  <ol start={(page - 1) * PAGE_SIZE + 1}>
    {#each headers as header (`${header.part}:${header.headerIndex}`)}
      <li>
        <strong>{authenticationHeaderLabel(header)}</strong>
        <p class="meta">Parsing: {header.state}{header.duplicateOf ? ` · Duplicate of header ${header.duplicateOf} in this part` : ''}</p>
        {#if header.state === 'none'}<p>This header reports that no authentication was performed.</p>{/if}
        {#each header.claims as claim}
          <p><strong>{claim.method.toUpperCase()}/{claim.methodVersion}: {claim.result}</strong>{claim.state === 'unsupported' ? ' · unsupported result or method version' : ''}</p>
          {#if claim.domains.length}<ul>{#each claim.domains as value}<li><code>{value.property}</code>: {value.domain}</li>{/each}</ul>{/if}
          {#if claim.duplicateProperties.length}<p class="notice">Repeated identity properties: {claim.duplicateProperties.join(', ')}. No value was selected.</p>{/if}
        {/each}
        {#if header.issues.length}<ul class="notice">{#each header.issues as issue}<li>{issue}</li>{/each}</ul>{/if}
        <label><input type="checkbox" checked={header.receiverTrust === 'analyst_selected'} disabled={disabled || !header.authservId || !['parsed', 'partial', 'none'].includes(header.state)} onchange={event => select(header.part, header.headerIndex, event.currentTarget.checked)}>I recognise part {header.part}, header {header.headerIndex} as a receiver-added header</label>
        <p class="meta">Receiver trust: {header.receiverTrust === 'analyst_selected' ? 'selected by analyst' : 'not established'}</p>
      </li>
    {/each}
  </ol>
  {#if review.headers.length > PAGE_SIZE}<Pagination currentPage={page} pageCount={Math.ceil(review.headers.length / PAGE_SIZE)} setPage={next => page = next} ariaLabel="Authentication header pages" />{/if}
</section>

<style>
  .authentication-review{display:grid;gap:12px;min-width:0}.heading,p{margin:0}.heading{font-size:var(--text-sm)}p,li,label{font-size:var(--text-xs);line-height:1.6;overflow-wrap:anywhere}ol{display:grid;gap:18px;margin:0;padding-left:24px}ol>li{border-top:1px solid var(--border);padding-top:12px}ol>li>*+*{margin-top:8px}ul{padding-left:20px}code{font-size:inherit;overflow-wrap:anywhere}.meta{color:var(--muted)}.notice{color:var(--amber)}label{display:flex;align-items:flex-start;gap:8px;min-height:44px}input{flex:none;margin-top:5px}
</style>
