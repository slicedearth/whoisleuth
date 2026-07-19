<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    applyThemePreference,
    observeThemePreference,
    readThemePreference,
    setThemePreference,
    type ThemePreference,
  } from '$lib/theme';

  let preference = $state<ThemePreference>('system');
  let storageWarning = $state('');
  let open = $state(false);
  let trigger: HTMLButtonElement;
  let control: HTMLDivElement;

  const options: ReadonlyArray<{ value: ThemePreference; label: string }> = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  onMount(() => {
    preference = readThemePreference();
    applyThemePreference(preference);
    return observeThemePreference((next) => { preference = next; });
  });

  function labelFor(value: ThemePreference) {
    return options.find((option) => option.value === value)?.label ?? 'System';
  }

  function chooseTheme(next: ThemePreference) {
    preference = next;
    storageWarning = setThemePreference(preference)
      ? ''
      : 'Theme applies to this tab only because browser storage is unavailable.';
    open = false;
    trigger.focus();
  }

  function optionElements() {
    return [...control.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  async function openAndFocus(index: number) {
    open = true;
    await tick();
    optionElements()[index]?.focus();
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'Home') {
      event.preventDefault();
      void openAndFocus(0);
    } else if (event.key === 'ArrowUp' || event.key === 'End') {
      event.preventDefault();
      void openAndFocus(options.length - 1);
    } else if (event.key === 'Escape') {
      open = false;
    }
  }

  function handleOptionKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      optionElements()[(index + 1) % options.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      optionElements()[(index - 1 + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      optionElements()[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      trigger.focus();
    }
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    const selector = event.currentTarget as HTMLElement;
    if (!(next instanceof Node) || !selector.contains(next)) open = false;
  }
</script>

{#snippet themeSymbol(value: ThemePreference)}
  <svg
    class="theme-symbol"
    data-theme-symbol={value}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    {#if value === 'light'}
      <circle cx="12" cy="12" r="3.5"></circle>
      <path d="M12 2.25v2.1M12 19.65v2.1M2.25 12h2.1M19.65 12h2.1M5.1 5.1l1.5 1.5M17.4 17.4l1.5 1.5M18.9 5.1l-1.5 1.5M6.6 17.4l-1.5 1.5"></path>
    {:else if value === 'dark'}
      <path d="M20.2 15.1A8.3 8.3 0 0 1 8.9 3.8 8.45 8.45 0 1 0 20.2 15.1Z"></path>
      <circle class="moon-star" cx="17.5" cy="6.5" r="1"></circle>
    {:else}
      <rect x="3" y="4" width="18" height="13" rx="2"></rect>
      <path d="M8.5 21h7M12 17v4M7.5 10.5a4.5 4.5 0 0 1 4.5-4.5v9a4.5 4.5 0 0 1-4.5-4.5Z"></path>
    {/if}
  </svg>
{/snippet}

<div class="theme-selector" onfocusout={handleFocusOut}>
  <div class="theme-control" bind:this={control}>
    <button
      class="theme-trigger"
      type="button"
      aria-label={`Colour theme, ${labelFor(preference)} selected`}
      title={`${labelFor(preference)} theme`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls="colour-theme-options"
      bind:this={trigger}
      onclick={() => { open = !open; }}
      onkeydown={handleTriggerKeydown}
    ><span class="theme-trigger-label">Theme</span>{@render themeSymbol(preference)}<span class="chevron" aria-hidden="true"></span></button>
    {#if open}
      <div class="theme-options" id="colour-theme-options" role="listbox" aria-label="Colour theme options">
        {#each options as option, index}
          <button
            class="theme-option"
            class:selected={preference === option.value}
            type="button"
            role="option"
            aria-label={`${option.label} theme`}
            aria-selected={preference === option.value}
            title={`${option.label} theme`}
            onclick={() => chooseTheme(option.value)}
            onkeydown={(event) => handleOptionKeydown(event, index)}
          >{@render themeSymbol(option.value)}<span class="sr-only">{option.label}</span></button>
        {/each}
      </div>
    {/if}
  </div>
</div>
{#if storageWarning}<span class="sr-only" role="status">{storageWarning}</span>{/if}

<style>
  .theme-selector{--theme-trigger-width:104px;display:flex;width:var(--theme-trigger-width);min-width:0;align-items:center;color:var(--muted);font:700 var(--text-2xs) var(--mono);white-space:nowrap}
  .theme-control{position:relative;width:100%;min-width:0}
  .theme-selector .theme-trigger{display:inline-flex;width:100%;min-width:0;height:30px;align-items:center;justify-content:space-between;gap:8px;padding:0 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font-family:var(--mono);font-size:inherit;font-weight:700;line-height:1}
  .theme-trigger:hover,.theme-trigger:focus-visible{border-color:var(--accent);background:var(--panel)}
  .theme-trigger-label{color:var(--muted)}
  .theme-symbol{width:18px;height:18px;flex:0 0 auto;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .theme-symbol .moon-star{fill:currentColor;stroke:none}
  .chevron{width:6px;height:6px;flex:0 0 auto;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
  .theme-options{display:grid;position:absolute;top:var(--theme-options-top,calc(100% + 6px));bottom:var(--theme-options-bottom,auto);left:0;z-index:100;box-sizing:border-box;width:100%;min-width:0;gap:2px;padding:4px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--panel);box-shadow:var(--shadow-float)}
  .theme-option{display:inline-flex;width:100%;min-height:34px;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--text);font:700 var(--text-2xs) var(--mono)}
  .theme-option:hover,.theme-option:focus-visible,.theme-option.selected{background:rgb(var(--accent-rgb) / .11);color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:720px){
    .theme-selector{--theme-trigger-width:88px}
    .theme-selector .theme-trigger{gap:5px;padding-inline:6px}
  }
  @media(max-width:360px){
    .theme-selector{--theme-trigger-width:72px}
    .theme-selector .theme-trigger{gap:3px;padding-inline:3px}
    .theme-symbol{width:16px;height:16px}
  }
</style>
