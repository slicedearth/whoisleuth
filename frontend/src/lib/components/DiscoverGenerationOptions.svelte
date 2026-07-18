<script lang="ts">
  type Preset = { id: string; label: string; description: string };
  type KeyboardLayout = { id: string; label: string };

  let {
    presets,
    selectedPreset,
    selectPreset,
    keyboardLayouts,
    selectedKeyboardLayout,
    keyboardLayoutRelevant,
    selectKeyboardLayout,
    estimate,
    maxTlds,
    maxNameVariants,
    maxCandidates,
  }: {
    presets: Preset[];
    selectedPreset: string;
    selectPreset: (id: string) => void;
    keyboardLayouts: KeyboardLayout[];
    selectedKeyboardLayout: string;
    keyboardLayoutRelevant: boolean;
    selectKeyboardLayout: (id: string) => void;
    estimate: { inputValid: boolean; tldCount: number; estimatedMaximum: number; mayReachLimit: boolean } | null;
    maxTlds: number;
    maxNameVariants: number;
    maxCandidates: number;
  } = $props();
</script>

<div class="generation-presets" role="group" aria-label="Generation preset">
  {#each presets as preset}
    <button
      type="button"
      class:active={selectedPreset === preset.id}
      aria-pressed={selectedPreset === preset.id}
      aria-label={`Use ${preset.label} generation preset`}
      onclick={() => selectPreset(preset.id)}
    >
      <strong>{preset.label}</strong>
      <small>{preset.description}</small>
    </button>
  {/each}
</div>
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
{#if estimate?.inputValid && estimate.tldCount > 0}
  <p class="generation-estimate">
    Estimated maximum before validation and deduplication: up to {estimate.estimatedMaximum.toLocaleString()} candidates across {estimate.tldCount} TLD{estimate.tldCount === 1 ? '' : 's'}.
    {#if estimate.mayReachLimit} The {maxCandidates.toLocaleString()}-candidate hard cap may apply.{/if}
  </p>
{/if}
<p class="generation-limits" id="generation-limits">Generation is bounded to {maxTlds} TLDs, {maxNameVariants.toLocaleString()} label variants, and {maxCandidates.toLocaleString()} candidates per run.</p>

<style>
  .generation-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
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
  .generation-estimate,.generation-limits{margin:10px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .generation-estimate{color:var(--text)}
  @media(max-width:700px){
    .generation-presets{grid-template-columns:1fr}
    .generation-options{align-items:stretch;flex-direction:column;gap:4px}
    .generation-options label{width:100%;min-width:0}
    .generation-options span{padding-bottom:0}
  }
</style>
