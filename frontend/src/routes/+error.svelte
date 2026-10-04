<script lang="ts">
  import { page } from '$app/state';
  import RouteErrorPage from '#lib/components/RouteErrorPage.svelte';
</script>

<RouteErrorPage status={page.status} />
