<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    applyThemePreference,
    observeThemePreference,
    readThemePreference,
    setThemePreference,
    type ThemePreference,
  } from '$lib/theme';

  let preference = $state<ThemePreference>('dark');
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
    return options.find((option) => option.value === value)?.label ?? 'Dark';
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

<div class="theme-selector" onfocusout={handleFocusOut}>
  <span>Theme</span>
  <div class="theme-control" bind:this={control}>
    <button
      class="theme-trigger"
      type="button"
      aria-label="Colour theme"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls="colour-theme-options"
      bind:this={trigger}
      onclick={() => { open = !open; }}
      onkeydown={handleTriggerKeydown}
    ><span>{labelFor(preference)}</span><span class="chevron" aria-hidden="true"></span></button>
    {#if open}
      <div class="theme-options" id="colour-theme-options" role="listbox" aria-label="Colour theme options">
        {#each options as option, index}
          <button
            class="theme-option"
            class:selected={preference === option.value}
            type="button"
            role="option"
            aria-selected={preference === option.value}
            onclick={() => chooseTheme(option.value)}
            onkeydown={(event) => handleOptionKeydown(event, index)}
          >{option.label}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>
{#if storageWarning}<span class="sr-only" role="status">{storageWarning}</span>{/if}

<style>
  .theme-selector{display:flex;min-width:0;align-items:center;gap:8px;color:var(--muted);font:700 var(--text-2xs) var(--mono);white-space:nowrap}
  .theme-control{position:relative;min-width:0}
  .theme-trigger{display:inline-flex;width:auto;min-width:82px;height:30px;align-items:center;justify-content:space-between;gap:10px;padding:0 9px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:700 var(--text-2xs) var(--mono);line-height:1}
  .theme-trigger:hover,.theme-trigger:focus-visible{border-color:var(--accent);background:var(--panel)}
  .chevron{width:6px;height:6px;flex:0 0 auto;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
  .theme-options{display:grid;position:absolute;top:var(--theme-options-top,calc(100% + 6px));bottom:var(--theme-options-bottom,auto);left:0;z-index:100;width:100%;min-width:96px;gap:2px;padding:4px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--panel-solid);box-shadow:var(--shadow-float)}
  .theme-option{width:100%;min-height:30px;justify-content:flex-start;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--text);font:700 var(--text-2xs) var(--mono);text-align:left}
  .theme-option:hover,.theme-option:focus-visible,.theme-option.selected{background:rgb(var(--accent-rgb) / .11);color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>
