<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CaseRecord } from '#lib/cases.ts';
  import { trackTransientCaseDraft } from '#lib/controllers/case-draft.svelte.ts';
  import { restoreSubmittedFocus } from '#lib/controllers/submitted-draft.ts';
  import { changeTemporaryCaseboard, emptyTemporaryCaseboard, resolveBoardReference, TEMPORARY_BOARD_CARD_LIMIT,
    TEMPORARY_BOARD_CARD_TEXT_LIMIT, TEMPORARY_BOARD_BASIS_LIMIT, TEMPORARY_BOARD_LINK_KINDS, TEMPORARY_BOARD_TEXT_KINDS,
    type BoardOperation, type BoardLinkKind, type BoardTextKind } from '#lib/analysis/temporary-caseboard.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';
  import CaseLinkedEvidence from './CaseLinkedEvidence.svelte';
  let { record }: { record: CaseRecord } = $props();
  const instance = $props.id();
  let open = $state(false), board = $state(emptyTemporaryCaseboard());
  let referenceChoice = $state(''), type = $state<BoardTextKind>('question'), text = $state('');
  let editing = $state<string | null>(null), from = $state(''), to = $state(''), relationship = $state<BoardLinkKind>('supports'), basis = $state('');
  let message = $state(''), error = $state(false), root = $state<HTMLElement | null>(null), disclosure = $state<HTMLDetailsElement | null>(null);
  let nextIdentity = 0, revision = 0;
  const dirty = $derived(board.cards.length > 0 || board.links.length > 0 || text.length > 0 || basis.length > 0);
  trackTransientCaseDraft(() => dirty);
  const choices = $derived([
    ...record.evidencePins.map((pin, index) => ({ key: JSON.stringify(['pin',pin.id]), reference: { kind: 'pin' as const, id: pin.id }, label: `Pin ${index + 1}: ${pin.label} · ${pin.id}` })),
    ...record.assertions.map((assertion, index) => ({ key: JSON.stringify(['assertion',assertion.id]), reference: { kind: 'assertion' as const, id: assertion.id }, label: `Assertion ${index + 1}: ${assertion.statement.slice(0, 80)} · ${assertion.id}` })),
    ...record.notes.map((note, index) => ({ key: JSON.stringify(['note',note.id]), reference: { kind: 'note' as const, id: note.id }, label: `Note ${index + 1}: ${note.body.slice(0, 80)} · ${note.id}` })),
  ]);
  const sources = $derived(board.cards.map(card => ({ card, source: card.kind === 'reference' ? resolveBoardReference(record, card.reference) : null })));
  const uniquePins = $derived(record.evidencePins.filter(pin => record.evidencePins.filter(value => value.id === pin.id).length === 1));
  const number = (id: string) => board.cards.findIndex(card => card.id === id) + 1;
  const label = (kind: string) => kind.replaceAll('_', ' ');
  const identity = () => `board-${++nextIdentity}`;
  function clear() {
    revision++; board = emptyTemporaryCaseboard(); referenceChoice = ''; text = ''; editing = null;
    from = ''; to = ''; basis = ''; message = ''; error = false;
  }
  function discard(): boolean {
    if (dirty && !window.confirm('Discard this temporary board and its unfinished text? Nothing has been saved to the Case.')) return false;
    clear(); return true;
  }
  function toggled(event: Event) {
    const element = event.currentTarget as HTMLDetailsElement;
    if (element.open) { open = true; return; }
    if (!discard()) element.open = true;
    else open = false;
  }
  async function apply(operation: BoardOperation, focusId?: string): Promise<boolean> {
    const origin = document.activeElement, owner = record.id, request = ++revision;
    const result = changeTemporaryCaseboard(board, record, operation);
    message = result.message; error = !result.ok;
    if (result.ok) board = result.board;
    await tick();
    if (request === revision && record.id === owner) restoreSubmittedFocus(origin,
      root?.querySelector<HTMLElement>(focusId ? `#${CSS.escape(focusId)}` : '.board-status'), root);
    return result.ok;
  }
  async function addReference() {
    const submittedChoice = referenceChoice;
    const choice = choices.find(value => value.key === referenceChoice);
    if (!choice) { message = 'Choose an available retained reference.'; error = true; return; }
    if (await apply({ kind: 'reference', id: identity(), reference: choice.reference }) && referenceChoice === submittedChoice) referenceChoice = '';
  }
  async function saveText() {
    const submittedText = text, submittedEditing = editing;
    const operation: BoardOperation = editing ? { kind: 'edit', id: editing, text } : { kind: 'text', id: identity(), type, text };
    if (await apply(operation) && text === submittedText && editing === submittedEditing) { text = ''; editing = null; }
  }
  function edit(id: string) {
    const card = board.cards.find(value => value.id === id);
    if (!card || card.kind === 'reference') return;
    if (text && !window.confirm('Replace the unfinished card text with this temporary card?')) return;
    editing = id; type = card.kind; text = card.text;
    root?.querySelector<HTMLTextAreaElement>('.card-text')?.focus();
  }
  async function remove(id: string, index: number) {
    const next = board.cards[index + 1] ?? board.cards[index - 1];
    if (await apply({ kind: 'remove', id }, next ? `${instance}-remove-${next.id}` : `${instance}-board-heading`)) {
      if (editing === id) editing = null;
      if (from === id) from = ''; if (to === id) to = '';
    }
  }
  async function addLink() {
    const submittedBasis = basis;
    if (await apply({ kind: 'link', link: { id: identity(), from, to, kind: relationship, basis } }) && basis === submittedBasis) basis = '';
  }
  function move(id: string, direction: -1 | 1) {
    const next = board.cards.findIndex(card => card.id === id) + direction;
    const control = direction === -1 ? (next === 0 ? 'later' : 'earlier') : (next === board.cards.length - 1 ? 'earlier' : 'later');
    void apply({ kind: 'move', id, direction }, `${instance}-${control}-${id}`);
  }
  async function reset() {
    const origin = document.activeElement;
    if (!discard()) return;
    await tick(); restoreSubmittedFocus(origin, disclosure?.querySelector('summary'), disclosure);
  }
  onMount(() => {
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  });
</script>

<details class="temporary-caseboard" {open} bind:this={disclosure} ontoggle={toggled}>
  <summary>Temporary Caseboard</summary>
  {#if open}
    <section bind:this={root} aria-labelledby={`${instance}-board-heading`}>
      <h3 id={`${instance}-board-heading`} tabindex="-1">Arrange this Case review</h3>
      <p>Arrange current references and your own questions. This board is temporary: closing or leaving discards it. Nothing enters Case records, recovery drafts, exports or reports.</p>
      <p>Reference cards show current retained content, not a copied earlier snapshot. Links are your reasoning—not observed relationships or scheduled collection.</p>
      <form onsubmit={event => { event.preventDefault(); void addReference(); }}>
        <label>Retained reference<select bind:value={referenceChoice}><option value="">Choose a pin, assertion or note</option>{#each choices as choice}<option value={choice.key}>{choice.label}</option>{/each}</select></label>
        <button class="btn" type="submit" disabled={!referenceChoice || board.cards.length >= TEMPORARY_BOARD_CARD_LIMIT}>Add reference card</button>
      </form>
      <form onsubmit={event => { event.preventDefault(); void saveText(); }}>
        <label>Temporary card type<select bind:value={type} disabled={editing !== null}>{#each TEMPORARY_BOARD_TEXT_KINDS as kind}<option value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>{/each}</select></label>
        <label>Temporary card text<textarea class="card-text" bind:value={text} maxlength={TEMPORARY_BOARD_CARD_TEXT_LIMIT}></textarea></label>
        <button class="btn" type="submit" disabled={!text.trim() || (!editing && board.cards.length >= TEMPORARY_BOARD_CARD_LIMIT)}>{editing ? 'Update temporary card' : 'Add temporary card'}</button>
      </form>
      <p class="board-status" role={error ? 'alert' : 'status'} aria-live="polite" tabindex="-1">{message || `${board.cards.length} of ${TEMPORARY_BOARD_CARD_LIMIT} temporary cards.`}</p>
      <ol class="board-cards" aria-label="Temporary ordered cards">
        {#each sources as item, index (item.card.id)}
          <li>
            <h4>Card {index + 1} · {item.card.kind === 'reference' ? `Retained ${item.card.reference.kind} reference` : `Temporary ${item.card.kind}`}</h4>
            {#if item.card.kind === 'reference'}
              <code>{item.card.reference.id}</code>
              {#if item.source?.state === 'ready'}
                {#if item.source.fingerprint !== item.card.fingerprint}<p class="reference-change">Retained content changed since this reference was added. Review the current source before relying on your earlier reasoning.</p>{/if}
                {#if item.source.kind === 'pin'}<CaseEvidenceFact pin={item.source.value} copyable />
                {:else if item.source.kind === 'assertion'}
                  <p>{item.source.value.statement}</p><p>{item.source.value.kind} · {item.source.value.state}{item.source.value.provenance ? ' · imported analyst declaration' : ' · analyst declaration'}</p>
                  {#if item.source.value.rationale}<p>{item.source.value.rationale}</p>{/if}
                  <p>Recorded <time datetime={item.source.value.createdAt}>{item.source.value.createdAt}</time>; updated <time datetime={item.source.value.updatedAt}>{item.source.value.updatedAt}</time>.</p>
                  {#if item.source.value.provenance}<p>Declared source: {item.source.value.provenance.sourceName}{item.source.value.provenance.publisher ? ` · ${item.source.value.provenance.publisher}` : ''}. Source observation time: {item.source.value.provenance.observedAt ?? 'unavailable'}.</p>{/if}
                  <CaseLinkedEvidence pins={uniquePins} ids={item.source.value.evidencePinIds} relations={item.source.value.evidenceRelations ?? []} />
                {:else}<p class="authored-text">{item.source.value.body}</p><time datetime={item.source.value.createdAt}>{item.source.value.createdAt}</time>{/if}
              {:else}<p>Reference {item.source?.state ?? 'unavailable'}. No source was substituted; temporary reasoning remains.</p>{/if}
            {:else}<p class="authored-text">{item.card.text}</p><small>Temporary {item.card.kind}; not recorded as a Case {item.card.kind === 'note' ? 'note' : 'assertion'}.</small>{/if}
            <div class="card-controls">
              <button id={`${instance}-earlier-${item.card.id}`} class="btn" type="button" aria-label={`Move temporary card ${index + 1} earlier`} disabled={index === 0} onclick={() => move(item.card.id, -1)}>Earlier</button>
              <button id={`${instance}-later-${item.card.id}`} class="btn" type="button" aria-label={`Move temporary card ${index + 1} later`} disabled={index === board.cards.length - 1} onclick={() => move(item.card.id, 1)}>Later</button>
              {#if item.card.kind !== 'reference'}<button class="btn" type="button" onclick={() => edit(item.card.id)}>Edit text<span class="sr-only"> for card {index + 1}</span></button>{/if}
              <button id={`${instance}-remove-${item.card.id}`} class="btn" type="button" onclick={() => void remove(item.card.id, index)}>Remove card<span class="sr-only"> {index + 1}</span></button>
            </div>
          </li>
        {/each}
      </ol>
      {#if board.cards.length >= 2}
        <form onsubmit={event => { event.preventDefault(); void addLink(); }}>
          <fieldset><legend>Author a relationship between temporary cards</legend>
            <label>From card<select bind:value={from}><option value="">Choose a card</option>{#each board.cards as card, index}<option value={card.id}>Card {index + 1} · {card.kind}</option>{/each}</select></label>
            <label>To card<select bind:value={to}><option value="">Choose a different card</option>{#each board.cards as card, index}<option value={card.id}>Card {index + 1} · {card.kind}</option>{/each}</select></label>
            <label>Authored relationship<select bind:value={relationship}>{#each TEMPORARY_BOARD_LINK_KINDS as kind}<option value={kind}>{label(kind)}</option>{/each}</select></label>
            <label>Relationship reasoning<textarea bind:value={basis} maxlength={TEMPORARY_BOARD_BASIS_LIMIT}></textarea></label>
          </fieldset>
          <button class="btn" type="submit" disabled={!from || !to || from === to || !basis.trim()}>Add authored relationship</button>
        </form>
      {/if}
      <ul class="board-links" aria-label="Temporary analyst-declared relationships">
        {#each board.links as link (link.id)}<li><strong>Card {number(link.from)} → Card {number(link.to)} · {label(link.kind)}</strong><p class="authored-text">{link.basis}</p><button class="btn" type="button" onclick={() => void apply({ kind: 'unlink', id: link.id })}>Remove relationship<span class="sr-only"> {board.links.indexOf(link) + 1}</span></button></li>{/each}
      </ul>
      <button class="btn" type="button" disabled={!dirty} onclick={() => void reset()}>Clear temporary board</button>
    </section>
  {/if}
</details>

<style>
  .temporary-caseboard { margin-block: 16px; min-width: 0; }
  summary { min-height: 44px; align-content: center; cursor: pointer; }
  section { padding: 16px; border: 1px solid var(--border); border-radius: 12px; min-width: 0; }
  p, small, time { font-size: var(--text-xs); color: var(--muted); }
  form { display: grid; gap: 12px; padding-block: 16px; border-bottom: 1px solid var(--border); }
  label { display: grid; gap: 6px; min-width: 0; font-size: var(--text-xs); }
  select, textarea { max-width: 100%; min-width: 0; min-height: 44px; }
  textarea { min-height: 88px; }
  fieldset { display: grid; gap: 12px; min-width: 0; }
  .board-cards, .board-links { display: grid; gap: 12px; padding-inline-start: 22px; }
  li { min-width: 0; padding: 12px; border: 1px solid var(--border); border-radius: 8px; overflow-wrap: anywhere; }
  h4 { margin: 0 0 12px; font-size: var(--text-sm); }
  code { display: block; margin-bottom: 8px; font-size: var(--text-xs); overflow-wrap: anywhere; }
  .authored-text { white-space: pre-wrap; }
  .card-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button { min-height: 44px; justify-self: start; max-width: 100%; }
  .reference-change { border-inline-start: 2px solid var(--border); padding-inline-start: 8px; }
  @media print { .temporary-caseboard { display: none !important; } }
</style>
