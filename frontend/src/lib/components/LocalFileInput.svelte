<script lang="ts">
  let { label, accept, maximumBytes, disabled = false, file = $bindable<File | null>(null), onselect }: {
    label: string; accept: string; maximumBytes: number; disabled?: boolean; file?: File | null;
    onselect: (file: File | null) => void | Promise<void>;
  } = $props();
  const id = $props.id();
  let input: HTMLInputElement;
  let error = $state(''), dragging = $state(false);
  const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  $effect(() => { if (!file && input) input.value = ''; });
  function select(files: FileList | null) {
    if (disabled) return;
    error = '';
    if (!files?.length) return;
    if (files.length !== 1) { error = 'Choose one file at a time. The previous selection is unchanged.'; return; }
    const selected = files[0]!;
    if (!selected.size || selected.size > maximumBytes) { error = `Choose a non-empty file of at most ${size(maximumBytes)}. The previous selection is unchanged.`; return; }
    file = selected;
    void onselect(selected);
  }
  function clear() { if (disabled) return; file = null; error = ''; input.value = ''; void onselect(null); input.focus(); }
</script>

<div class="local-file" class:dragging role="group" aria-describedby={`${id}-help`}
  ondragover={event => { if ([...event.dataTransfer?.types ?? []].includes('Files')) { event.preventDefault(); dragging = !disabled; } }}
  ondragleave={() => dragging = false}
  ondrop={event => { event.preventDefault(); dragging = false; select(event.dataTransfer?.files ?? null); }}>
  <label id={`${id}-label`} for={id}>{label}</label>
  <input {id} bind:this={input} type="file" {accept} {disabled} aria-describedby={`${id}-help`} onchange={event => select(event.currentTarget.files)}>
  <p id={`${id}-help`} class="file-help">Choose or drop one file · up to {size(maximumBytes)}<span>Accepted: {accept.split(',').filter(value => value.startsWith('.')).join(', ') || accept}</span></p>
  {#if file}<div class="file-selection"><span><strong>{file.name}</strong> · {size(file.size)}</span><button class="btn" type="button" {disabled} onclick={clear} aria-label={`Remove ${label.toLowerCase()}`}>Remove file</button></div>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .local-file{display:grid;gap:8px;min-width:0;padding:14px;border:1px dashed var(--border-strong);border-radius:var(--radius-sm);background:var(--panel)}
  .local-file.dragging{border-style:solid;outline:2px solid var(--focus);outline-offset:2px}
  label{font:600 var(--text-sm)/1.4 var(--font-sans)}input{width:100%;min-width:0;max-width:100%;font:inherit}
  .file-help{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.file-help span{display:block}
  .file-selection{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;font-size:var(--text-xs)}
  .file-selection span{min-width:0;overflow-wrap:anywhere}.file-selection button{min-height:44px;font:600 var(--text-xs) var(--font-sans)}
  [role=alert]{margin:0;color:var(--danger);font-size:var(--text-xs);overflow-wrap:anywhere}
  @media print{.local-file{display:none}}
</style>
