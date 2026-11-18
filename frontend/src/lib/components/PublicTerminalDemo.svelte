<script lang="ts">
  import { PUBLIC_TERMINAL_DEMO } from '#lib/generated/public-terminal-demo.ts';
  import CopyableCommand from './CopyableCommand.svelte';
  let activeIndex = $state(0);
  const active = $derived(PUBLIC_TERMINAL_DEMO.panels[activeIndex]!);
</script>

<div class="terminal-demo" role="group" aria-label="Offline terminal preview">
  <header><span class="terminal-lights" aria-hidden="true">● ● ●</span><span>{PUBLIC_TERMINAL_DEMO.notice}</span></header>
  <div class="panel-controls" role="group" aria-label="Preview terminal panels">
    {#each PUBLIC_TERMINAL_DEMO.panels as panel, index (panel.id)}<button type="button" aria-pressed={activeIndex === index} onclick={() => { activeIndex = index; }}>{panel.label}</button>{/each}
  </div>
  <div class="frame" aria-live="polite" aria-atomic="true">
    <textarea class="wide" readonly aria-label={`${active.label} terminal frame`} value={active.wide}></textarea>
    <textarea class="narrow" readonly aria-label={`${active.label} terminal frame`} value={active.narrow}></textarea>
  </div>
  <p>Browse saved evidence with numbered panels, search and keyboard navigation. This preview uses the CLI’s renderer; it runs no command.</p>
  <CopyableCommand command={PUBLIC_TERMINAL_DEMO.command} label="browse a saved Lookup command" compact />
  <CopyableCommand command={PUBLIC_TERMINAL_DEMO.comparisonCommand} label="browse a retained comparison command" compact />
</div>

<style>
  .terminal-demo{min-width:0;border:1px solid var(--border-strong);border-radius:var(--radius-md);padding:16px;background:var(--panel)}header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;color:var(--muted);font:var(--text-xs) var(--mono)}.terminal-lights{color:var(--interface-accent);letter-spacing:3px}.panel-controls{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 12px}.panel-controls button{padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised);font:650 var(--text-xs) var(--mono)}.panel-controls button[aria-pressed="true"]{color:var(--accent);border-color:var(--accent)}.frame{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}textarea{display:block;width:100%;margin:0;padding:14px;overflow:auto;resize:vertical;border:0;border-radius:0;background:transparent;white-space:pre;font:.75rem/1.6 var(--mono);color:var(--text);height:29em;min-height:18em}textarea:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}.narrow{display:none}p{margin:14px 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}.terminal-demo :global(.copyable-command)+:global(.copyable-command){margin-top:8px}
  @media(max-width:650px){.terminal-demo{padding:12px}.wide{display:none}.narrow{display:block;font-size:.7rem;padding:10px}.panel-controls button{min-height:38px}}
</style>
