<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import IntelligenceIcon from '$lib/components/IntelligenceIcon.svelte';
  import type { NavigationItem } from '$lib/workspaces';

  type ConsoleCommand = NavigationItem & {
    group: string;
  };

  let {
    commands,
    onclose,
  }: {
    commands: ConsoleCommand[];
    onclose: (restoreFocus?: boolean) => void;
  } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();
  let dialog = $state<HTMLElement>();
  let resultsList = $state<HTMLElement>();
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredCommands = $derived(commands
    .filter((command) => !normalizedQuery
      || `${command.label} ${command.detail} ${command.group} ${command.keywords.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery))
    .slice(0, 12));
  const activeOptionId = $derived(filteredCommands[selectedIndex] ? `command-option-${selectedIndex}` : undefined);
  const selectedAnnouncement = $derived(filteredCommands[selectedIndex]
    ? `${filteredCommands[selectedIndex].label}, ${filteredCommands[selectedIndex].group}${filteredCommands[selectedIndex].href === page.url.pathname ? ', current page' : ''}.`
    : 'No matching destination.');

  onMount(() => {
    selectedIndex = Math.max(0, commands.findIndex((command) => command.href === page.url.pathname));
    void tick().then(() => searchInput?.focus());
  });

  function close() {
    onclose();
  }

  async function activate(command: ConsoleCommand | undefined) {
    if (!command) return;
    onclose(false);
    await goto(command.href);
  }

  function focusables() {
    if (!dialog) return [];
    return [...dialog.querySelectorAll<HTMLElement>('input,a[href],button:not([disabled]):not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
  }

  function keepSelectedVisible() {
    if (!activeOptionId) return;
    resultsList?.querySelector<HTMLElement>(`#${activeOptionId}`)?.scrollIntoView({ block: 'nearest' });
  }

  function selectIndex(index: number) {
    selectedIndex = index;
    void tick().then(keepSelectedVisible);
  }

  function resetSelection() {
    selectIndex(0);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (document.activeElement === searchInput && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      if (!filteredCommands.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      selectIndex((selectedIndex + delta + filteredCommands.length) % filteredCommands.length);
      return;
    }
    if (document.activeElement === searchInput && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      if (!filteredCommands.length) return;
      selectIndex(event.key === 'Home' ? 0 : filteredCommands.length - 1);
      return;
    }
    if (event.key === 'Enter' && document.activeElement === searchInput) {
      event.preventDefault();
      void activate(filteredCommands[selectedIndex] ?? filteredCommands[0]);
      return;
    }
    if (event.key !== 'Tab') return;
    const available = focusables();
    if (!available.length) {
      event.preventDefault();
      return;
    }
    const first = available[0];
    const last = available.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="palette-layer">
  <button class="palette-backdrop" type="button" aria-label="Close command palette" onclick={close}></button>
  <div
    class="command-palette card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="command-palette-title"
    bind:this={dialog}
  >
    <header>
      <div>
        <p class="eyebrow">Console navigation</p>
        <h2 id="command-palette-title">Go to</h2>
      </div>
      <button type="button" class="palette-close" aria-label="Close command palette" onclick={close}>Esc</button>
    </header>
    <label for="command-search">Search pages</label>
    <div class="command-search">
      <span aria-hidden="true">❯</span>
      <input
        id="command-search"
        bind:this={searchInput}
        bind:value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-controls="command-results"
        aria-expanded="true"
        aria-activedescendant={activeOptionId}
        oninput={resetSelection}
        autocomplete="off"
        spellcheck="false"
        placeholder="Lookup, Monitor, Guide…"
      >
    </div>
    <span class="sr-only" role="status" aria-live="polite">{selectedAnnouncement}</span>
    {#if filteredCommands.length}
      <ul id="command-results" role="listbox" aria-label="Console destinations" bind:this={resultsList}>
        {#each filteredCommands as command,index (command.href)}
          <li role="presentation" class:selected={index === selectedIndex}>
            <button
              id={`command-option-${index}`}
              type="button"
              role="option"
              tabindex="-1"
              aria-selected={index === selectedIndex}
              aria-current={command.href === page.url.pathname ? 'page' : undefined}
              onmouseenter={() => selectIndex(index)}
              onclick={() => void activate(command)}
            >
              <span class="command-main">
                <span class="command-glyph" aria-hidden="true"><IntelligenceIcon name={command.icon} size={18} /></span>
                <span class="command-copy"><strong>{command.label}</strong><small>{command.detail}</small></span>
              </span>
              <em class:current={command.href === page.url.pathname}>{command.href === page.url.pathname ? 'Current' : command.group}</em>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="no-results">No console destination matches that search.</p>
    {/if}
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> select</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
  </div>
</div>

<style>
  .palette-layer{position:fixed;inset:0;z-index:100;display:grid;place-items:start center;padding:clamp(72px,12vh,130px) 14px 24px}
  .palette-backdrop{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;background:rgb(var(--shadow-rgb) / .76);backdrop-filter:blur(4px)}
  .command-palette{position:relative;display:flex;flex-direction:column;width:min(650px,100%);max-height:min(620px,calc(100dvh - 100px));padding:0;overflow:hidden;border-color:var(--border-strong);box-shadow:0 32px 100px rgb(var(--shadow-rgb) / .5)}
  header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 17px 12px;border-bottom:1px solid var(--border);background:rgb(var(--overlay-rgb) / .025)}
  header p{margin:0}h2{margin:2px 0 0;font:700 var(--text-lg) var(--mono)}
  .palette-close{min-height:30px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .command-search{display:grid;grid-template-columns:34px minmax(0,1fr);align-items:center;margin:14px;border:1px solid var(--border-strong);border-radius:var(--radius-md);overflow:hidden;background:var(--panel-raised);box-shadow:inset 0 1px rgb(var(--overlay-rgb) / .035);transition:border-color .14s ease,box-shadow .14s ease,background-color .14s ease}
  .command-search:focus-within{border-color:var(--accent2);background:rgb(var(--panel-rgb) / .98);box-shadow:0 0 0 2px rgb(var(--accent2-rgb) / .16),inset 3px 0 var(--accent2)}
  .command-search span{align-self:stretch;display:grid;place-items:center;border-right:1px solid var(--border);background:rgb(var(--accent2-rgb) / .045);color:var(--accent2);font:700 var(--text-sm) var(--mono)}
  .command-search input{width:100%;min-width:0;padding:12px;border:0;background:transparent;font:650 var(--text-sm) var(--mono);outline:0}
  .command-search input:focus{box-shadow:none}
  ul{display:grid;flex:1 1 auto;gap:4px;min-height:0;max-height:360px;margin:0;padding:0 10px 12px;overflow-y:auto;list-style:none}
  li button{display:flex;width:100%;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--text);text-align:left}
  li.selected button,li button:hover,li button:focus-visible{border-color:var(--border);background:rgb(var(--accent-rgb) / .08)}
  li.selected button{box-shadow:inset 2px 0 var(--accent2)}
  .command-main{display:grid;grid-template-columns:28px minmax(0,1fr);min-width:0;align-items:center}
  .command-glyph{display:grid;width:24px;height:24px;place-items:center;border:1px solid var(--border);border-radius:6px;color:var(--muted);background:rgb(var(--overlay-rgb) / .025)}
  li.selected .command-glyph{border-color:rgb(var(--accent2-rgb) / .42);color:var(--accent2);background:rgb(var(--accent2-rgb) / .07)}
  .command-copy{min-width:0}strong,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}strong{font:700 var(--text-sm) var(--mono)}small{margin-top:3px;color:var(--muted);font-size:var(--text-2xs)}
  em{flex:0 0 auto;color:var(--accent);font:650 .55rem var(--mono);font-style:normal;letter-spacing:.07em;text-transform:uppercase}
  em.current{color:var(--accent2)}
  .no-results{margin:0;padding:28px;color:var(--muted);text-align:center}
  footer{display:flex;flex-wrap:wrap;gap:12px;padding:9px 14px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-2xs) var(--mono)}
  kbd{margin-right:3px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--panel-raised);font:inherit}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:600px){
    .palette-layer{place-items:start center;padding:10px}
    .command-palette{width:100%;max-height:calc(100dvh - 20px)}
    header{padding:12px 13px 10px}
    .command-search{margin:10px}
    ul{grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;max-height:none;padding:0 8px 9px;overflow-y:auto}
    li button{min-height:38px;padding:7px 9px}
    small,em:not(.current),footer{display:none}
    em.current{font-size:.5rem}
    strong{text-overflow:ellipsis}
  }
  @media(max-width:399px){ul{grid-template-columns:minmax(0,1fr)}}
  @media(prefers-reduced-motion:no-preference){.command-palette{animation:palette-enter .16s ease-out both}@keyframes palette-enter{from{opacity:0;transform:translateY(-7px) scale(.99)}to{opacity:1;transform:none}}}
</style>
