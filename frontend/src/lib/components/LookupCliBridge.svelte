<script lang="ts">
  import { lookupCliBridge } from '$lib/analysis/lookup-cli-bridge.ts';
  import CliCommandBuilder from './CliCommandBuilder.svelte';
  let { query, mode, selectedUrl, selectedSources }: { query: string; mode: 'fast' | 'deep'; selectedUrl: boolean; selectedSources: number } = $props();
  const seed = $derived.by(() => {
    try { return { value: lookupCliBridge({ query, mode, selectedUrl }), error: '' }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : 'Enter one valid target.' }; }
  });
</script>

<p>The initial command previews requests offline. Remove <code>--plan</code> only when you are ready to collect in the CLI.</p>
{#if selectedSources}<p>Optional browser source selections are not transferred. The installed CLI uses its own configuration; inspect its plan before collection.</p>{/if}
{#if selectedUrl}<p>The command includes your explicitly selected path and query. Review them before copying or sharing.</p>{/if}
{#if seed.value}{#key JSON.stringify(seed.value)}<CliCommandBuilder command="lookup" {...seed.value} />{/key}{:else}<p role="status">{seed.error}</p>{/if}

<style>p{font-size:var(--text-sm);line-height:1.6;overflow-wrap:anywhere}</style>
