<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { inspectPublicLinks, MAX_PUBLIC_LINK_TEXT_BYTES, MAX_PUBLIC_LINK_URL_BYTES, PUBLIC_LINK_EXAMPLE,
    type PublicLinkInputKind, type PublicLinkInspection } from '#lib/analysis/public-link-inspector.ts';

  let kind = $state<PublicLinkInputKind>('link');
  let input = $state('');
  let displayed = $state('');
  let inspection = $state<PublicLinkInspection | null>(null);
  let copyStatus = $state('');
  let ready = $state(false);
  let generation = 0;
  const inputByteLimit = $derived(kind === 'link' ? MAX_PUBLIC_LINK_URL_BYTES : MAX_PUBLIC_LINK_TEXT_BYTES);
  const targets = $derived(new Map(inspection?.state === 'reviewed'
    ? inspection.intake.targets.map(target => [target.id, target.exactUrl]) : []));

  function clearResult() { generation += 1; inspection = null; copyStatus = ''; }
  function reset() { clearResult(); input = ''; displayed = ''; }
  function setKind(value: PublicLinkInputKind) { reset(); kind = value; }
  function setInput(value: string) { clearResult(); input = value; }
  function setDisplayed(value: string) { clearResult(); displayed = value; }
  function useExample() { reset(); kind = 'link'; input = PUBLIC_LINK_EXAMPLE.input; displayed = PUBLIC_LINK_EXAMPLE.displayedText; }
  function review() { clearResult(); inspection = inspectPublicLinks(kind, input, displayed); }
  async function copy(value: string) {
    const owner = ++generation;
    copyStatus = '';
    try {
      await navigator.clipboard.writeText(value);
      if (ready && owner === generation) copyStatus = 'Copied the selected value.';
    } catch {
      if (ready && owner === generation) copyStatus = 'Copy was unavailable. Select the displayed value and copy it manually.';
    }
  }
  beforeNavigate(({ from, to, willUnload }) => {
    if (willUnload || from?.url.pathname !== to?.url.pathname) reset();
  });
  onMount(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    ready = true;
    addEventListener('pagehide', reset);
    addEventListener('pageshow', restore);
    return () => { ready = false; removeEventListener('pagehide', reset); removeEventListener('pageshow', restore); reset(); };
  });
</script>

<section class="inspector" aria-label="Offline Link Inspector" aria-busy={!ready}>
  <noscript><p>Enable JavaScript to process input locally. No link is opened by this tool.</p></noscript>
  <form onsubmit={(event) => { event.preventDefault(); review(); }}>
    <fieldset disabled={!ready}>
      <legend>Input type</legend>
      <label class="choice"><input type="radio" name="link-input-kind" checked={kind === 'link'} onchange={() => setKind('link')} />One link</label>
      <label class="choice"><input type="radio" name="link-input-kind" checked={kind === 'text'} onchange={() => setKind('text')} />Pasted text</label>
    </fieldset>
    <label for="public-link-input">{kind === 'link' ? 'Link to inspect' : 'Text containing links'}</label>
    <textarea id="public-link-input" value={input} oninput={(event) => setInput(event.currentTarget.value)}
      disabled={!ready} maxlength={inputByteLimit}
      rows={kind === 'link' ? 3 : 6} spellcheck="false" autocapitalize="off" autocomplete="off"
      aria-describedby="public-link-size"></textarea>
    <p id="public-link-size" class="input-help">Up to {inputByteLimit.toLocaleString('en-AU')} UTF-8 bytes. Supplied spelling stays in this input; parsed URLs are labelled separately.</p>
    {#if kind === 'link'}
      <label for="public-link-displayed">Displayed link text (optional)</label>
      <input id="public-link-displayed" value={displayed} oninput={(event) => setDisplayed(event.currentTarget.value)}
        disabled={!ready} maxlength={MAX_PUBLIC_LINK_URL_BYTES} spellcheck="false" autocomplete="off" />
    {/if}
    <div class="actions">
      <button class="primary" type="submit" disabled={!ready || !input.trim()}>Review links</button>
      <button class="btn" type="button" disabled={!ready} onclick={useExample}>Use a fictional example</button>
      <button class="btn" type="button" disabled={!ready} onclick={reset}>Clear input and results</button>
    </div>
  </form>

  {#if inspection?.state === 'unavailable'}<p role="alert">{inspection.message}</p>{/if}
  {#if inspection?.state === 'reviewed'}
    {#key inspection}
    <section class="results" aria-label="Parsed links">
      <p role="status">{inspection.intake.links.length ? `${inspection.intake.links.length} parsed link${inspection.intake.links.length === 1 ? '' : 's'}. No destination was contacted.` : 'No supported HTTP(S) links were found in this input.'}</p>
      {#if inspection.intake.bounded}<p role="status">The parser reached its link or embedded-link work bound. This review is partial.</p>{/if}
      {#if inspection.intake.limitations.length}<ul>{#each inspection.intake.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
      {#each inspection.intake.links as link, index (link.id)}
        {@const exactUrl = targets.get(link.id)}
        <article aria-labelledby={`public-parsed-${link.id}`}>
          <h3 id={`public-parsed-${link.id}`}>Link {index + 1}{link.parentId ? ' · embedded parameter' : ''}</h3>
          <dl>
            <div><dt>Hostname</dt><dd><code>{link.hostname}</code><button type="button" class="btn small" aria-label={`Copy hostname for link ${index + 1}`} onclick={() => void copy(link.hostname)}>Copy hostname</button></dd></div>
            <div><dt>Registrable domain</dt><dd><code>{link.registrationDomain}</code></dd></div>
            {#if link.displayedHostname}<div><dt>Displayed hostname</dt><dd><code>{link.displayedHostname}</code> · {link.displayedDestination === 'same_host' ? 'Same hostname' : 'Different hostname'}</dd></div>{/if}
            {#if kind === 'link' && displayed.trim() && !link.parentId && !link.displayedHostname}<div><dt>Displayed text</dt><dd>Does not identify a supported hostname.</dd></div>{/if}
            {#if link.parentId}<div><dt>Parent link</dt><dd>{link.parentId}</dd></div>{/if}
          </dl>
          {#if exactUrl}<details>
            <summary>Reveal parsed URL for link {index + 1}</summary>
            <p>This is the normalised parsed URL, not a record of redirects or the exact spelling you supplied. It can contain private path, query or fragment values.</p>
            <pre>{exactUrl}</pre>
            <button type="button" class="btn small" onclick={() => void copy(exactUrl)} aria-label={`Copy parsed URL for link ${index + 1}`}>Copy parsed URL</button>
          </details>{:else}<p>Parsed URL unavailable.</p>{/if}
          {#if link.authorisation}<details><summary>Supplied authorisation parameters</summary><p>These parameters are supplied text, not a verified application or permission grant.</p><dl><div><dt>Type</dt><dd>{link.authorisation.kind === 'device_code_reference' ? 'Device-code reference' : 'Authorisation parameters'}</dd></div><div><dt>Scopes</dt><dd>{link.authorisation.scopes.join(', ') || 'Not recorded'}</dd></div></dl>{#if link.authorisation.duplicateParameters.length}<p>Repeated parameters: {link.authorisation.duplicateParameters.join(', ')}. Ambiguous values remain unrecorded.</p>{/if}{#if link.authorisation.omittedParameters}<p>Unsupported or ambiguous parameter values were omitted.</p>{/if}</details>{/if}
        </article>
      {/each}
    </section>
    {/key}
  {/if}
  {#if copyStatus}<p role="status">{copyStatus}</p>{/if}
</section>

<style>
  .inspector{min-width:0;padding-block:20px;overflow-wrap:anywhere}
  form{display:grid;gap:10px;max-width:76ch}
  fieldset{display:flex;flex-wrap:wrap;gap:12px 20px;border:0;padding:0;margin:0 0 8px}
  legend,label{font-weight:650}.choice{display:flex;align-items:center;gap:8px;min-height:44px}
  textarea,input{max-width:100%;min-width:0}textarea{width:100%;resize:vertical}
  .input-help{margin:0;color:var(--muted);font-size:var(--text-xs)}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-block:10px}
  .results{margin-top:18px}article{border-top:1px solid var(--border);padding-block:18px}
  h3{margin:0 0 12px}dl{display:grid;gap:8px;margin:0}dl>div{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:8px}
  dt{color:var(--muted)}dd{margin:0;min-width:0}dd>button{margin-left:10px}
  details{margin-top:14px}summary{cursor:pointer;min-height:44px;align-content:center}pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}
  @media(max-width:700px){dl>div{grid-template-columns:1fr;gap:3px}dd>button{display:block;margin:8px 0 0}}
  @media print{.inspector{display:none!important}}
</style>
