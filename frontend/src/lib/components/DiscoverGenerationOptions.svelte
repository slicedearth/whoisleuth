<script lang="ts">
  type Preset = { id: string; label: string; description: string };
  type KeyboardLayout = { id: string; label: string };
  type MutationFamily = { id: string; label: string; advanced?: boolean };

  let {
    presets,
    selectedPreset,
    selectPreset,
    mutationFamilies,
    selectedMutationFamilies,
    toggleMutationFamily,
    keyboardLayouts,
    selectedKeyboardLayout,
    keyboardLayoutRelevant,
    selectKeyboardLayout,
    dictionaryRelevant,
    dictionaryText,
    setCustomDictionaryText,
    dictionarySummary,
    maxDictionaryTerms,
    maxDictionaryTermLength,
    maxDictionaryTextLength,
    estimate,
    maxTlds,
    maxNameVariants,
    maxCandidates,
  }: {
    presets: Preset[];
    selectedPreset: string;
    selectPreset: (id: string) => void;
    mutationFamilies: MutationFamily[];
    selectedMutationFamilies: string[];
    toggleMutationFamily: (id: string) => void;
    keyboardLayouts: KeyboardLayout[];
    selectedKeyboardLayout: string;
    keyboardLayoutRelevant: boolean;
    selectKeyboardLayout: (id: string) => void;
    dictionaryRelevant: boolean;
    dictionaryText: string;
    setCustomDictionaryText: (value: string) => void;
    dictionarySummary: { values: string[]; truncated: boolean; rejectedCount: number };
    maxDictionaryTerms: number;
    maxDictionaryTermLength: number;
    maxDictionaryTextLength: number;
    estimate: { inputValid: boolean; tldCount: number; estimatedMaximum: number; mayReachLimit: boolean } | null;
    maxTlds: number;
    maxNameVariants: number;
    maxCandidates: number;
  } = $props();

  let dictionaryFileStatus = $state('');

  async function importDictionary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > maxDictionaryTextLength) {
      dictionaryFileStatus = `Dictionary files are limited to ${maxDictionaryTextLength.toLocaleString()} bytes.`;
      return;
    }
    try {
      setCustomDictionaryText(await file.text());
      const filename = file.name.slice(0, 80);
      dictionaryFileStatus = `Loaded ${filename}${file.name.length > filename.length ? '…' : ''}. Review the accepted terms before generating.`;
    } catch {
      dictionaryFileStatus = 'The dictionary file could not be read.';
    }
  }
</script>

<div class="generation-presets" role="group" aria-label="Generation preset">
  {#each presets as preset}
    <button
      type="button"
      class:active={selectedPreset === preset.id}
      aria-pressed={selectedPreset === preset.id}
      onclick={() => selectPreset(preset.id)}
    >
      <strong>{preset.label}</strong>
      <small>{preset.description}</small>
    </button>
  {/each}
</div>
{#if selectedPreset === 'custom'}
  <fieldset class="family-selection">
    <legend>Mutation families · {selectedMutationFamilies.length} selected</legend>
    <div class="family-grid">
      {#each mutationFamilies as family}
        <label>
          <input
            type="checkbox"
            checked={selectedMutationFamilies.includes(family.id)}
            onchange={() => toggleMutationFamily(family.id)}
          >
          <span>
            {family.label}
            {#if family.advanced}<small>Opt-in only · exactly two same-script substitutions</small>{/if}
          </span>
        </label>
      {/each}
    </div>
    <p class="advanced-family-note">Advanced generation is excluded from every preset and from the initial Custom selection. Enable it deliberately for a focused run.</p>
    {#if selectedMutationFamilies.length === 0}
      <p role="status">Select at least one family before generating candidates.</p>
    {/if}
  </fieldset>
{/if}
<div class="generation-options">
  <label class="field">
    Keyboard layout
    <select
      value={selectedKeyboardLayout}
      disabled={!keyboardLayoutRelevant}
      onchange={(event) => selectKeyboardLayout(event.currentTarget.value)}
    >
      {#each keyboardLayouts as layout}<option value={layout.id}>{layout.label}</option>{/each}
    </select>
  </label>
  <span>{keyboardLayoutRelevant ? 'Used for adjacent-key substitutions and insertions.' : 'Not used by the selected preset.'}</span>
</div>
<details class="custom-dictionary">
  <summary>Custom dictionary · {dictionarySummary.values.length} accepted term{dictionarySummary.values.length === 1 ? '' : 's'}</summary>
  <p>Add campaign, product, regional, or organization-specific words. Terms stay in this browser tab and are used only when you select Generate candidates.</p>
  <label class="field">
    Dictionary terms
    <textarea
      value={dictionaryText}
      maxlength={maxDictionaryTextLength}
      disabled={!dictionaryRelevant}
      oninput={(event) => {
        dictionaryFileStatus = '';
        setCustomDictionaryText(event.currentTarget.value);
      }}
      placeholder="invoice&#10;customer-care&#10;regional-name"
      aria-describedby="custom-dictionary-guidance"
    ></textarea>
  </label>
  <div class="dictionary-file">
    <label class="btn" class:disabled={!dictionaryRelevant}>
      Import text file
      <input type="file" accept=".txt,text/plain" disabled={!dictionaryRelevant} onchange={importDictionary}>
    </label>
    <span id="custom-dictionary-guidance">
      Up to {maxDictionaryTerms} unique terms, {maxDictionaryTermLength} characters each, and {maxDictionaryTextLength.toLocaleString()} input characters.
    </span>
  </div>
  {#if !dictionaryRelevant}<p class="dictionary-note">Select a dictionary family, or choose Impersonation or All families, to use custom terms.</p>{/if}
  {#if dictionarySummary.rejectedCount}<p class="dictionary-note">{dictionarySummary.rejectedCount} invalid term{dictionarySummary.rejectedCount === 1 ? '' : 's'} will be ignored.</p>{/if}
  {#if dictionarySummary.truncated}<p class="dictionary-note">The dictionary limit was reached. Narrow the list for complete coverage.</p>{/if}
  {#if dictionaryFileStatus}<p class="dictionary-note" role="status">{dictionaryFileStatus}</p>{/if}
</details>
{#if estimate?.inputValid && estimate.tldCount > 0}
  <p class="generation-estimate">
    Estimated maximum before validation and deduplication: up to {estimate.estimatedMaximum.toLocaleString()} candidates across {estimate.tldCount} TLD{estimate.tldCount === 1 ? '' : 's'}.
    {#if estimate.mayReachLimit} The {maxCandidates.toLocaleString()}-candidate hard cap may apply.{/if}
  </p>
{/if}
<p class="generation-limits" id="generation-limits">Generation is bounded to {maxTlds} TLDs, {maxNameVariants.toLocaleString()} label variants, and {maxCandidates.toLocaleString()} candidates per run.</p>

<style>
  .generation-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
  .generation-presets button{min-width:0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel);color:var(--muted);text-align:left}
  .generation-presets button:hover{border-color:rgb(var(--accent2-rgb) / .55)}
  .generation-presets button.active{border-color:var(--accent2);background:rgb(var(--accent2-rgb) / .08);box-shadow:inset 3px 0 0 var(--accent2)}
  .generation-presets strong,.generation-presets small{display:block}
  .generation-presets strong{color:var(--text);font:700 var(--text-xs) var(--mono)}
  .generation-presets button.active strong{color:var(--accent2)}
  .generation-presets small{margin-top:4px;font-size:var(--text-2xs);line-height:1.5}
  .generation-options{display:flex;align-items:end;gap:12px;margin-top:10px}
  .generation-options label{min-width:170px}
  .generation-options span{padding-bottom:10px;color:var(--muted);font-size:var(--text-xs)}
  .family-selection{margin:12px 0 0;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .family-selection legend{padding:0 5px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .family-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px 12px}
  .family-grid label{display:flex;align-items:flex-start;gap:7px;min-width:0;color:var(--muted);font-size:var(--text-xs);line-height:1.4}
  .family-grid input{flex:0 0 auto;margin-top:2px}
  .family-grid span{min-width:0;overflow-wrap:anywhere}
  .family-grid small{display:block;margin-top:2px;color:var(--muted);font-size:var(--text-2xs);line-height:1.4}
  .family-selection p{margin:8px 0 0;color:var(--amber);font-size:var(--text-xs)}
  .family-selection .advanced-family-note{color:var(--muted)}
  .custom-dictionary{margin-top:12px;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .35)}
  .custom-dictionary summary{color:var(--text);cursor:pointer;font:700 var(--text-xs) var(--mono)}
  .custom-dictionary>p,.dictionary-file span{color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .custom-dictionary textarea{min-height:96px}
  .dictionary-file{display:flex;align-items:center;gap:10px;margin-top:8px}
  .dictionary-file label{position:relative;overflow:hidden;cursor:pointer}
  .dictionary-file label.disabled{cursor:not-allowed;opacity:.55}
  .dictionary-file input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
  .dictionary-note{margin:8px 0 0;color:var(--amber)!important}
  .generation-estimate,.generation-limits{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .generation-estimate{color:var(--text)}
  @media(max-width:700px){
    .generation-presets{grid-template-columns:1fr}
    .family-grid{grid-template-columns:1fr 1fr}
    .generation-options{align-items:stretch;flex-direction:column;gap:4px}
    .generation-options label{width:100%;min-width:0}
    .generation-options span{padding-bottom:0}
    .dictionary-file{align-items:stretch;flex-direction:column}
    .dictionary-file label{width:100%}
  }
  @media(max-width:420px){.family-grid{grid-template-columns:1fr}}
</style>
