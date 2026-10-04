<script lang="ts">
  import { tick } from 'svelte';
  import { INTAKE_PHONE_ROLES, INTAKE_TEXT_BASES, type MessageIntakeReport, type CurrentMessageIntakeReport, type IntakePhoneReview, type IntakePhoneDeclaration, type IntakeEvidenceDeclaration, type IntakeDestinationDeclaration } from '../../../../packages/contracts/message-intake.mts';
  import { withIntakeSelectedEvidence } from '../../../../packages/investigation/intake-context.mts';
  import { MAX_SELECTED_INTAKE_PHONES } from '../../../../packages/investigation/intake-phones.mts';
  import Pagination from './Pagination.svelte';
  let { report, phoneReview, disabled = false, onchange, onpending }: {
    report: MessageIntakeReport; phoneReview?: IntakePhoneReview | undefined; disabled?: boolean;
    onchange: (report: CurrentMessageIntakeReport) => void; onpending: (pending: boolean) => void;
  } = $props();
  let selected = $state<string[]>([]), page = $state(1), sourceLabel = $state(''), observedAt = $state(''), countryCallingCode = $state('');
  let basis = $state<IntakeEvidenceDeclaration['basis']>('unknown'), role = $state<IntakePhoneDeclaration['role']>('unknown');
  let pairEnabled = $state(false), displayed = $state(''), destination = $state('');
  let displayedSource = $state(''), destinationSource = $state(''), displayedAt = $state(''), destinationAt = $state('');
  let displayedBasis = $state<IntakeEvidenceDeclaration['basis']>('unknown'), destinationBasis = $state<IntakeEvidenceDeclaration['basis']>('unknown');
  let destinationRole = $state<IntakeDestinationDeclaration['role']>('claimed_landing');
  let pending = $state(false), error = $state(''), appliedHeading = $state<HTMLElement>();
  const retained = $derived(report.schemaVersion === 2 ? report.selectedEvidence : undefined);
  const candidates = $derived(phoneReview?.candidates ?? []);
  function changed() { pending = true; error = ''; onpending(true); }
  function toggle(id: string, checked: boolean) {
    selected = checked ? [...selected, id] : selected.filter(value => value !== id);
    changed();
  }
  function visibleOriginal(value: string) {
    return value.replace(/[\p{Cf}\u0000-\u001f\u007f]/gu, character => `\\u{${character.codePointAt(0)!.toString(16)}}`);
  }
  async function apply(event: SubmitEvent) {
    event.preventDefault();
    if (disabled) return;
    try {
      const next = withIntakeSelectedEvidence({ report, targets: [], ...(phoneReview ? { phoneReview } : {}) }, !selected.length && !pairEnabled ? null : {
        sourceDigestSha256: report.source.digestSha256,
        phones: candidates.filter(candidate => selected.includes(candidate.id)).map(candidate => ({
          start: candidate.start, end: candidate.end,
          declaration: { sourceLabel: sourceLabel.trim(), observedAt: observedAt.trim() || null, basis, role, countryCallingCode: countryCallingCode.trim() || null },
        })),
        destinationPair: pairEnabled ? {
          displayed, destination,
          displayedDeclaration: { sourceLabel: displayedSource.trim(), observedAt: displayedAt.trim() || null, basis: displayedBasis, role: 'displayed_claim' },
          destinationDeclaration: { sourceLabel: destinationSource.trim(), observedAt: destinationAt.trim() || null, basis: destinationBasis, role: destinationRole },
        } : null,
      });
      onchange(next); pending = false; onpending(false); error = '';
      await tick(); appliedHeading?.focus();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'The selected evidence could not be applied.'; }
  }
  function clear() {
    if (disabled) return;
    onchange(withIntakeSelectedEvidence({ report, targets: [] }, null));
    selected = []; pairEnabled = false; displayed = ''; destination = '';
    pending = false; onpending(false); error = '';
  }
</script>

<details class="selected-evidence">
  <summary>Select phone candidates or compare supplied destinations</summary>
  <p>Phone review covers only this explicitly selected plaintext input. Email, HTML attributes, QR, documents, HAR, identity fields and URL contents are not scanned. Candidates are private and transient until you select and apply them.</p>
  <form onsubmit={apply}>
    <fieldset disabled={disabled || report.schemaVersion !== 2}>
      <legend>Selected contact evidence</legend>
      {#if phoneReview}
        <p>Phone candidates: {candidates.length} · Coverage: {phoneReview.state}. Supported syntax is seven to fifteen ASCII digits; an explicit + prefix permits formatting-only normalisation. This does not validate a numbering plan or authenticate a contact.</p>
        {#if phoneReview.state === 'partial'}<p role="status">The text, work or candidate limit was reached. This review is incomplete.</p>{/if}
        <ol start={(page - 1) * 10 + 1}>
          {#each candidates.slice((page - 1) * 10, page * 10) as candidate (candidate.id)}
            <li>
              <code dir="ltr">{visibleOriginal(candidate.original)}</code>
              <p>{candidate.state.replaceAll('_', ' ')}{candidate.extension ? ` · separate extension ${candidate.extension}` : ''}</p>
              <p>Source span [{candidate.start}, {candidate.end}) · UTF-16 code units; controls are shown as escapes.</p>
              {#each candidate.issues as issue}<p>{issue}</p>{/each}
              <label class="check"><input type="checkbox" checked={selected.includes(candidate.id)} disabled={candidate.state === 'unsupported' || (!selected.includes(candidate.id) && selected.length >= MAX_SELECTED_INTAKE_PHONES)} onchange={event => toggle(candidate.id, event.currentTarget.checked)} />Select phone candidate {candidate.id.replace('phone-', '')}</label>
            </li>
          {/each}
        </ol>
        {#if candidates.length > 10}<Pagination currentPage={page} pageCount={Math.ceil(candidates.length / 10)} setPage={next => page = next} ariaLabel="Phone candidate pages" />{/if}
        {#if selected.length}
          <p>Selected occurrences: {selected.length}. Declarations below apply to these occurrences. Equivalent international formatting may share a group, but every source span is preserved.</p>
          <label>Phone source label<input required maxlength="160" bind:value={sourceLabel} oninput={changed} placeholder="Supplied support snippet" /></label>
          <label>Phone text basis<select bind:value={basis} onchange={changed}>{#each INTAKE_TEXT_BASES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label>Declared phone role<select bind:value={role} onchange={changed}>{#each INTAKE_PHONE_ROLES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label>Phone observation time (ISO with timezone)<input maxlength="40" bind:value={observedAt} oninput={changed} placeholder="Unknown unless supplied" /></label>
          <label>Declared country calling prefix<input maxlength="4" bind:value={countryCallingCode} oninput={changed} placeholder="Unknown, or an explicit + prefix" /></label>
          <p>No country is inferred from a brand or browser locale. National formats remain ambiguous; country context never guesses trunk-prefix rules.</p>
        {/if}
      {:else}<p>Phone review is unavailable for this input kind. Select plaintext explicitly to review contact candidates.</p>{/if}
      <label class="check"><input type="checkbox" bind:checked={pairEnabled} onchange={changed} />Include a manually supplied destination pair</label>
      {#if pairEnabled}
        <label>Displayed or claimed destination<input maxlength="8192" bind:value={displayed} oninput={changed} spellcheck="false" placeholder="store.example.test" /></label>
        <label>Displayed evidence source label<input required maxlength="160" bind:value={displayedSource} oninput={changed} /></label>
        <label>Displayed evidence basis<select bind:value={displayedBasis} onchange={changed}>{#each INTAKE_TEXT_BASES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label>Displayed observation time (ISO with timezone)<input maxlength="40" bind:value={displayedAt} oninput={changed} /></label>
        <label>Separately supplied destination<input maxlength="8192" bind:value={destination} oninput={changed} spellcheck="false" placeholder="https://store.example.test.attacker.invalid/" /></label>
        <label>Destination evidence source label<input required maxlength="160" bind:value={destinationSource} oninput={changed} /></label>
        <label>Destination evidence role<select bind:value={destinationRole} onchange={changed}><option value="claimed_landing">Claimed landing destination</option><option value="supplied_redirect">Supplied redirect evidence</option></select></label>
        <label>Destination evidence basis<select bind:value={destinationBasis} onchange={changed}>{#each INTAKE_TEXT_BASES as item}<option value={item}>{item.replaceAll('_', ' ')}</option>{/each}</select></label>
        <label>Destination observation time (ISO with timezone)<input maxlength="40" bind:value={destinationAt} oninput={changed} /></label>
        <p>Exact entries stay in this transient form. The report retains only host/origin projections and declarations. URLs are not opened; supplied redirect evidence is not an independently observed chain. Missing or unparseable destinations remain insufficient evidence.</p>
      {/if}
      <button class="btn" type="submit">Apply selected contact and destination evidence</button>
      <button class="btn" type="button" onclick={clear}>Clear selected evidence</button>
    </fieldset>
  </form>
  {#if pending}<p role="status">Apply or clear these selections before saving or downloading this review.</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if retained}
    <section aria-label="Applied selected evidence">
      <h5 tabindex="-1" bind:this={appliedHeading}>Applied selected evidence</h5>
      <p>Selected phone groups: {retained.phones.length} · source <code>{retained.sourceDigestSha256}</code></p>
      <p>Phone extraction coverage: {retained.phoneCoverage.state.replaceAll('_', ' ')} · {retained.phoneCoverage.candidatesShown} candidates shown; unselected values are not included.</p>
      {#each retained.phones as phone}<p>{phone.canonical ?? 'No canonical number'} · {phone.state.replaceAll('_', ' ')} · {phone.occurrences.length} source occurrence(s) · declared {phone.declaration.role.replaceAll('_', ' ')}</p>{/each}
      {#if retained.destinationPair}
        {@const pair = retained.destinationPair}
        <p>Destination comparison: {pair.state.replaceAll('_', ' ')}</p>
        <p>Displayed host: <code>{pair.displayed.hostname ?? pair.displayed.state}</code> · registration boundary: {pair.displayed.registrationDomain ?? 'unavailable'}</p>
        <p>Supplied destination host: <code>{pair.destination.hostname ?? pair.destination.state}</code> · registration boundary: {pair.destination.registrationDomain ?? 'unavailable'}</p>
        <p>Hostnames use URL-parser ASCII/IDNA and case normalisation; bare hostnames are parsed with an assumed HTTPS scheme, not fetched. A mismatch, including a legitimate tracking destination, is a review lead only.</p>
        {#if pair.displayed.normalisation.length || pair.destination.normalisation.length}<p>Parsing qualifications: {[...new Set([...pair.displayed.normalisation, ...pair.destination.normalisation])].map(value => value.replaceAll('_', ' ')).join('; ')}</p>{/if}
      {/if}
      {#each retained.limitations as limitation}<p>{limitation}</p>{/each}
    </section>
  {/if}
</details>

<style>
  .selected-evidence, form, fieldset, section, li { min-width: 0; }
  form, fieldset, section, li { display: grid; gap: 10px; }
  fieldset { border: 0; padding: 0; margin-block: 12px; }
  legend { font-weight: 600; }
  summary { cursor: pointer; padding-block: 6px; min-height: 32px; }
  p, h5 { margin: 0; }
  p, label, li, code { font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
  label { display: grid; gap: 4px; }
  .check { display: flex; align-items: start; gap: 8px; }
  .check input { flex: none; margin-top: 5px; }
  input, select { min-width: 0; max-width: 100%; }
  button { justify-self: start; white-space: normal; max-width: 100%; }
  ol { display: grid; gap: 14px; padding-left: 24px; }
  li { display: list-item; }
  [role=alert] { color: var(--amber); }
  code { unicode-bidi: isolate; }
</style>
