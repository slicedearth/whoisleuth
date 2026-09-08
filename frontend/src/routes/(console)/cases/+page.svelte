<script lang="ts">
  import PageHeading from '$lib/components/PageHeading.svelte';
  import CaseWorkspace from '$lib/components/CaseWorkspace.svelte';
</script>

<svelte:head><title>Cases · WHOISleuth</title></svelte:head>
<PageHeading eyebrow="Respond" title="Cases" description="Review evidence, record decisions and prepare responses." />
<CaseWorkspace />
