<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import { MAX_MESSAGE_INTAKE_BYTES, MESSAGE_INTAKE_KINDS, MESSAGE_INTAKE_INPUTS, type MessageIntakeKind, type MessageIntakeResult } from '../../../../packages/contracts/message-intake.mts';
  import { runMessageIntakeWorker } from '$lib/message-intake-worker.ts';
  import { downloadLocalFile } from '$lib/download-local-file.ts';
  import Pagination from './Pagination.svelte';
  import LocalFileInput from './LocalFileInput.svelte';
  import CopyButton from './CopyButton.svelte';
  import EvidenceTimestamp from './EvidenceTimestamp.svelte';
  import { defangedIndicator } from '$lib/analysis/evidence-copy.ts';
  import MailAuthenticationReview from './MailAuthenticationReview.svelte';
  import SelectedInputEvidence from './SelectedInputEvidence.svelte';
  import IdentityEventEvidence from './IdentityEventEvidence.svelte';
  import IntakeContextEvidence from './IntakeContextEvidence.svelte';
  import { withIntakeDistributionContext } from '../../../../packages/investigation/intake-context.mts';

  let { onselect, onsave, reviewContent, disabled = false, headingLevel = 3 }: {
    onselect: (target: string) => void | Promise<void>;
    onsave?: (result: MessageIntakeResult, original: File, retainOriginal: boolean) => Promise<boolean>;
    reviewContent?: Snippet<[MessageIntakeResult]>;
    disabled?: boolean;
    headingLevel?: 2 | 3;
  } = $props();
  let kind = $state<MessageIntakeKind>('text'), pasted = $state('');
  let file = $state.raw<File | null>(null), reviewedFile = $state.raw<File | null>(null);
  let result = $state.raw<MessageIntakeResult | null>(null);
  let busy = $state(false), saving = $state(false), error = $state(''), message = $state(''), retainOriginal = $state(false), page = $state(1);
  let heading = $state<HTMLElement>();
  let contextPending = $state(false);
  const subheadingTag = $derived(headingLevel === 2 ? 'h3' : 'h4');
  let controller: AbortController | null = null;
  const PAGE_SIZE = 10;
  const links = $derived(result?.report.links.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []);
  function clearReview() { controller?.abort(); controller = null; busy = false; result = null; reviewedFile = null; error = ''; message = ''; retainOriginal = false; page = 1; contextPending = false; }
  function changeKind() { clearReview(); file = null; }
  onDestroy(() => controller?.abort());
  async function review() {
    if (busy || saving || disabled) return;
    clearReview();
    const selected = file ?? (kind === 'text' && pasted.trim() ? new File([pasted], 'selected-text.txt', { type: 'text/plain' }) : null);
    if (!selected || selected.size > MAX_MESSAGE_INTAKE_BYTES) { error = 'Choose an input file or paste text, up to 16 MiB.'; return; }
    const current = new AbortController(); controller = current; busy = true;
    try {
      const reviewed = await runMessageIntakeWorker({ kind, file: selected, reviewedAt: new Date().toISOString() }, current.signal);
      if (current.signal.aborted) return;
      result = reviewed; reviewedFile = selected;
      message = `${reviewed.report.identityEventReview ? `Identity events: ${reviewed.report.identityEventReview.events.length}` : `Extracted links: ${reviewed.report.links.length}`}. Nothing was opened or saved.`;
      await tick(); if (!current.signal.aborted) heading?.focus();
    } catch (cause) { if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'The selected input could not be reviewed.'; }
    finally { if (controller === current) { controller = null; busy = false; } }
  }
  async function save() {
    if (!onsave || !result || !reviewedFile || saving || disabled || contextPending) return;
    saving = true;
    try { if (await onsave(result, reviewedFile, retainOriginal)) message = `Saved the review${retainOriginal ? ' and private original' : ''} in this Case.`; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'The review could not be saved.'; }
    finally { saving = false; }
  }
</script>

<details class="intake">
  <summary>Review a message, link or selected file</summary>
  <div class="body">
    <p>Review destinations, literal IPs and labelled hashes locally before choosing what to investigate. Add supplied distribution context only when needed. Links and attachments are not opened.</p>
    <fieldset disabled={busy || saving || disabled}>
      <legend class="sr-only">Selected input</legend>
      <label>Input type<select bind:value={kind} onchange={changeKind}>{#each MESSAGE_INTAKE_KINDS as value}<option value={value}>{MESSAGE_INTAKE_INPUTS[value].label}</option>{/each}</select></label>
      {#if kind === 'text'}<label>Text to review<textarea bind:value={pasted} oninput={() => { clearReview(); file = null; }} rows="4" maxlength={MAX_MESSAGE_INTAKE_BYTES} spellcheck="false" placeholder="Paste the message or suspicious link"></textarea></label>{/if}
      <LocalFileInput label={kind === 'text' ? 'Or select a text file' : 'Select a file'} bind:file maximumBytes={MAX_MESSAGE_INTAKE_BYTES} disabled={busy || saving || disabled}
        accept={MESSAGE_INTAKE_INPUTS[kind].accept} onselect={clearReview} />
      <button type="button" class="btn" onclick={() => void review()}>Review locally</button>
    </fieldset>
    {#if busy}<div class="actions"><span role="status">Reviewing selected input…</span><button type="button" class="btn" onclick={() => { clearReview(); message = 'Review cancelled. Nothing was saved.'; }}>Cancel review</button></div>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
    {#if result}
      {@const report = result.report}
      {@render reviewContent?.(result)}
      <svelte:element this={headingLevel === 2 ? 'h2' : 'h3'} class="heading" bind:this={heading} tabindex="-1">{report.identityEventReview ? 'Identity event review' : 'Extracted destinations'}</svelte:element>
      <p>Links: {report.links.length} · Reviewed {kind === 'qr' ? 'QR symbols' : 'parts'}: {report.coverage.reviewedParts}{report.coverage.state === 'partial' ? ' · Partial analysis' : ''}</p>
      {#if !report.links.length && !report.identityEventReview}<p>{kind === 'qr' ? 'No HTTP(S) destination was decoded. This does not establish that the image has no QR code.' : 'No supported HTTP(S) destination was extracted.'}</p>{/if}
      {#if report.coverage.unreviewedAttachments || report.coverage.boundsReached.length || report.coverage.rejectedLinks}
        <p class="notice">Unreviewed attachments: {report.coverage.unreviewedAttachments} · Unsupported links: {report.coverage.rejectedLinks}{report.coverage.boundsReached.length ? ` · ${report.coverage.boundsReached.join('; ')}` : ''}</p>
      {/if}
      <ol class="links" start={(page - 1) * PAGE_SIZE + 1}>
        {#each links as link (link.id)}
          <li>
            <strong>{link.origin}</strong>
            <p class="meta">{link.source.replaceAll('_', ' ')}{link.parentId ? ` · supplied inside ${link.parentId}` : ''}{link.location ? ` · ${link.location.partId}${link.location.page ? ` · page ${link.location.page}` : ''}` : ''}</p>
            {#if link.displayedHostname}<p>Displayed: <code>{link.displayedHostname}</code>{link.displayedDestination === 'different_host' ? ' — different from the link destination' : ''}</p>{/if}
            {#if link.authorisation}
              <div class="auth"><svelte:element this={subheadingTag} class="subheading">{link.authorisation.kind === 'device_code_reference' ? 'Device-code page reference' : 'Authorisation request parameters'}</svelte:element>
                <dl><div><dt>Client ID</dt><dd>{link.authorisation.clientId ?? 'Not retained or ambiguous'}</dd></div><div><dt>Requested scopes</dt><dd>{link.authorisation.scopes.join(', ') || 'Not declared'}</dd></div><div><dt>Return origin</dt><dd>{link.authorisation.redirectOrigin ?? 'Not retained or ambiguous'}</dd></div></dl>
                {#if link.authorisation.duplicateParameters.length}<p class="notice">Conflicting parameters: {link.authorisation.duplicateParameters.join(', ')}</p>{/if}
                {#if link.authorisation.omittedParameters}<p class="meta">Some supplied parameter values were unsupported or too long to retain.</p>{/if}
              </div>
            {/if}
            <button class="btn small" type="button" disabled={disabled || saving} onclick={() => void onselect(link.hostname)}>Use {link.hostname} in Lookup</button>
            <CopyButton value={link.hostname} label="Copy domain" description={`Copy domain ${link.hostname}`} /><CopyButton value={defangedIndicator(link.hostname)} label="Copy defanged" description={`Copy defanged indicator for ${link.hostname}`} />
            <details><summary>Review exact URL privately</summary><p>Paths, queries and fragments may contain tokens or personal information. They are excluded from the review download.</p><code class="exact">{result.targets.find(target => target.id === link.id)?.exactUrl}</code><button class="btn small" type="button" disabled={disabled || saving} onclick={() => { const target = result?.targets.find(value => value.id === link.id); if (target) void onselect(target.exactUrl); }}>Use exact URL in Lookup</button></details>
          </li>
        {/each}
      </ol>
      {#if report.links.length > PAGE_SIZE}<Pagination currentPage={page} pageCount={Math.ceil(report.links.length / PAGE_SIZE)} setPage={next => page = next} ariaLabel="Extracted destination pages" />{/if}
      {#key report.source.digestSha256}<IntakeContextEvidence {report} disabled={disabled || saving} onpending={pending => contextPending = pending} onchange={context => { if (result && !saving && !disabled) result = { ...result, report: withIntakeDistributionContext(result.report, context) }; }} />{/key}
      {#key report.source.digestSha256}<SelectedInputEvidence {report} headingTag={subheadingTag} />{/key}
      {#if report.identityEventReview}{#key report.source.digestSha256}<IdentityEventEvidence review={report.identityEventReview} headingTag={subheadingTag} disabled={disabled || saving} onchange={identityEventReview => { if (result && !saving && !disabled) result = { ...result, report: { ...result.report, identityEventReview } }; }} />{/key}{/if}
      {#if report.identities.length || report.authenticationClaims.length || report.actionHints.length}
        <details><summary>Message identity and requested actions</summary>
          <p>Header results and request parameters are supplied claims. They do not verify sender identity or show that an account was compromised.</p>
          <ul>{#each report.identities as identity}<li>Part {identity.part}: {identity.role.replaceAll('_', ' ')} — {identity.domain}</li>{/each}{#each report.actionHints as hint}<li>Wording to review: {hint.replaceAll('_', ' ')}</li>{/each}</ul>
        </details>
      {/if}
      {#if kind === 'email'}
        <details><summary>Review reported authentication sources</summary>
          {#key report.source.digestSha256}<MailAuthenticationReview headingTag={subheadingTag} review={report.authenticationReview} disabled={disabled || saving} onchange={authenticationReview => { if (result && !saving && !disabled) result = { ...result, report: { ...result.report, authenticationReview } }; }} />{/key}
        </details>
      {/if}
      <div class="actions">{#if onsave}<button type="button" class="btn primary" disabled={saving || disabled || contextPending} onclick={() => void save()}>{saving ? 'Saving…' : 'Save review in Case'}</button>{/if}
        <button type="button" class="btn" disabled={contextPending} onclick={() => downloadLocalFile(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'message-review.json')}>Download review</button>
      </div>
      {#if onsave}<label class="retain"><input type="checkbox" bind:checked={retainOriginal} disabled={saving || disabled}>Also retain the private original, which may contain message bodies, documents, credentials, addresses and exact links</label>{/if}
      <details><summary>Review coverage and source identity</summary><EvidenceTimestamp value={report.reviewedAt} label="review time" /><p>The original’s hash identifies the selected bytes, not its publisher or authenticity.</p><code>{report.source.digestSha256}</code><p>Selected content is reviewed locally. Links, external resources and HAR requests are not opened or replayed. Document review identifies the pages or parts used; encrypted and unsupported content remains explicit.</p>
        {#if report.messageParts.length}<ul>{#each report.messageParts as part}<li>Message part {part.part}{part.parentPart ? ` inside part ${part.parentPart}` : ' (outer message)'} · {part.byteLength} bytes · <code>{part.digestSha256}</code></li>{/each}</ul>{/if}
      </details>
    {/if}
    <p class="status" role="status" aria-live="polite">{message}</p>
  </div>
</details>

<style>
  .intake{min-width:0;border-block:1px solid var(--border);padding-block:12px}.body,fieldset,.links>li,.auth{display:grid;gap:12px;min-width:0}.body{padding-block:14px}fieldset{border:0;padding:0;margin:0}label{display:grid;gap:6px;min-width:0;font-size:var(--text-sm)}input,select,textarea{min-width:0;max-width:100%}textarea{width:100%;resize:vertical}summary{cursor:pointer;min-height:32px;padding-block:4px;line-height:1.5}summary:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}p,.heading,.subheading{margin:0;overflow-wrap:anywhere}p,li,dt,dd{font-size:var(--text-xs);line-height:1.6}.heading{font-size:var(--text-md)}.subheading{font-size:var(--text-sm)}p{max-width:85ch}code,strong,dd{overflow-wrap:anywhere}.meta{color:var(--muted)}.links{display:grid;gap:20px;margin:0;padding-left:24px}.links>li{display:list-item;border-top:1px solid var(--border);padding-top:12px}.links>li>*+*{margin-top:8px}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}button{justify-self:start;max-width:100%;white-space:normal;text-align:center}.auth{padding:12px;background:var(--panel);border-radius:var(--radius-sm)}dl{display:grid;gap:6px;margin:0}dl>div{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:12px}dd{margin:0}.exact{display:block;white-space:pre-wrap;font-size:var(--text-xs);padding-block:8px}.notice,[role=alert]{color:var(--amber)}.retain{display:flex;align-items:start;gap:8px;font-size:var(--text-xs)}.retain input{flex:none;margin-top:4px}.status:empty{display:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:480px){dl>div{grid-template-columns:1fr;gap:2px}.actions>*{flex:1 1 160px}}
</style>
