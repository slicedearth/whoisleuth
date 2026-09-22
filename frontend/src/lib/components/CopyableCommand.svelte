<script lang="ts">
  import CopyButton from './CopyButton.svelte';

  let {
    command,
    label = 'command',
    compact = false,
  }: {
    command: string;
    label?: string;
    compact?: boolean;
  } = $props();

</script>

<div class="copyable-command" class:compact>
  <code>{command}</code>
  <CopyButton value={command} description={`Copy ${label}`} />
</div>

<style>
  .copyable-command{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg)}
  code{display:block;min-width:0;padding:13px 14px;color:var(--accent);font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}
  .copyable-command :global(.copy-control){min-width:72px;border-left:1px solid var(--border)}
  .copyable-command :global(.copy-control button){height:100%;border:0;border-radius:0;background:var(--panel-raised)}
  .compact code{padding:10px 11px;font-size:var(--text-2xs)}
  @media(max-width:460px){.copyable-command{grid-template-columns:1fr}.copyable-command :global(.copy-control){border-top:1px solid var(--border);border-left:0}}
</style>
