<script lang="ts">
  import { tick } from 'svelte';
  import type { CaseEvidencePin } from '#lib/cases.ts';
  import CaseEvidenceFact from './CaseEvidenceFact.svelte';

  let { evidence, visible = true }: { evidence: readonly CaseEvidencePin[]; visible?: boolean } = $props();
  let open = $state(false);
  let selected = $state<string[]>([]);
  let presenting = $state(false);
  let current = $state(0);
  let question = $state<HTMLLegendElement>();
  let heading = $state<HTMLHeadingElement>();
  const sequence = $derived(selected.map(id => ({ id, pin: evidence.find(pin => pin.id === id) })));
  const entry = $derived(sequence[current]);

  $effect(() => {
    if (!visible) open = false;
    if (!open) { selected = []; presenting = false; current = 0; }
  });

  function choose(id: string, included: boolean) {
    if (presenting || !evidence.some(pin => pin.id === id)) return;
    selected = included
      ? selected.includes(id) ? selected : [...selected, id]
      : selected.filter(value => value !== id);
  }

  async function move(id: string, offset: number, button: HTMLButtonElement) {
    const index = selected.indexOf(id), target = index + offset;
    if (presenting || index < 0 || target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target]!, next[index]!];
    selected = next;
    await tick();
    if (button.isConnected && button.disabled) button.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  async function show(index: number) {
    if (!open || !visible || index < 0 || index >= selected.length) return;
    current = index; presenting = true;
    await tick();
    if (open && visible && presenting && heading?.isConnected) heading.focus();
  }

  async function edit(clear = false) {
    presenting = false;
    if (clear) { selected = []; current = 0; }
    await tick();
    if (open && visible && question?.isConnected) question.focus();
  }
</script>

<details class="practice-walkthrough" bind:open>
  <summary>Present selected fictional evidence</summary>
  {#if open}
    <div class="walkthrough-content">
      <p>Choose and order the supplied observations for an on-screen walkthrough. Values are shown unmasked.</p>
      {#if !presenting}
        <fieldset>
          <legend bind:this={question} tabindex="-1">Choose the original supplied evidence</legend>
          {#each evidence as pin (pin.id)}
            <label><input type="checkbox" checked={selected.includes(pin.id)} onchange={event => choose(pin.id, event.currentTarget.checked)} />Include {pin.label}</label>
          {:else}<p>No supplied evidence is available for this walkthrough.</p>{/each}
        </fieldset>
        {#if sequence.length}
          <ol aria-label="Selected fictional evidence order">
            {#each sequence as item, index (item.id)}
              <li><span>{item.pin?.label ?? 'Selected evidence unavailable'}</span>
                <div class="actions">
                  <button class="btn" type="button" disabled={index === 0} aria-label={`Move step ${index + 1} earlier`} onclick={event => move(item.id, -1, event.currentTarget)}>Earlier</button>
                  <button class="btn" type="button" disabled={index === sequence.length - 1} aria-label={`Move step ${index + 1} later`} onclick={event => move(item.id, 1, event.currentTarget)}>Later</button>
                </div>
              </li>
            {/each}
          </ol>
        {:else}<p role="status">No evidence selected. Choose what to include; nothing is selected automatically.</p>{/if}
        <div class="actions">
          <button class="btn" type="button" disabled={!sequence.length} onclick={() => show(0)}>Start walkthrough</button>
          <button class="btn" type="button" disabled={!sequence.length} onclick={() => edit(true)}>Clear selection</button>
        </div>
      {:else}
        <section aria-labelledby="practice-walkthrough-heading">
          <h3 id="practice-walkthrough-heading" bind:this={heading} tabindex="-1">Fictional evidence {current + 1} of {sequence.length}</h3>
          {#if entry?.pin}<CaseEvidenceFact pin={entry.pin} />{:else}<p>Selected evidence unavailable. No other observation has been substituted.</p>{/if}
        </section>
        <nav class="actions" aria-label="Fictional evidence walkthrough">
          <button class="btn" type="button" disabled={current === 0} onclick={() => show(current - 1)}>Previous evidence</button>
          <button class="btn" type="button" disabled={current === sequence.length - 1} onclick={() => show(current + 1)}>Next evidence</button>
        </nav>
        <ol aria-label="Fictional walkthrough sequence">
          {#each sequence as item, index (item.id)}
            <li><button class="btn" type="button" aria-current={index === current ? 'step' : undefined} onclick={() => show(index)}>{item.pin?.label ?? 'Selected evidence unavailable'}</button></li>
          {/each}
        </ol>
        <button class="btn edit" type="button" onclick={() => edit()}>Edit walkthrough selection</button>
      {/if}
      <p>Only selected supplied observations appear here, in your chosen order—not a chronology or a complete evidence account. Closing this walkthrough or leaving practice clears the selection.</p>
    </div>
  {/if}
</details>

<style>
  .practice-walkthrough, .walkthrough-content { min-width: 0; }
  summary { min-height: 44px; align-content: center; cursor: pointer; }
  .walkthrough-content { display: grid; gap: 16px; padding-block: 12px; }
  p, h3 { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
  fieldset { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
  legend { max-width: 100%; padding-bottom: 10px; font-weight: 650; overflow-wrap: anywhere; }
  label { display: flex; gap: 10px; align-items: start; min-height: 44px; padding-block: 8px; overflow-wrap: anywhere; }
  input { flex: none; margin-top: 4px; }
  ol { display: grid; gap: 12px; padding-inline-start: 24px; margin: 0; min-width: 0; }
  li { min-width: 0; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  button { max-width: 100%; min-height: 44px; white-space: normal; overflow-wrap: anywhere; }
  button[aria-current] { border-color: var(--interface-accent); }
  section { display: grid; gap: 12px; min-width: 0; }
  .edit { justify-self: start; }
  @media print { .practice-walkthrough { display: none; } }
</style>
