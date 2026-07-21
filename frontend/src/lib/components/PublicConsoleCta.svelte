<script lang="ts">
  import { getContext } from 'svelte';
  import {
    PUBLIC_SESSION_CONTEXT,
    type PublicSessionGetter,
  } from '$lib/public-session';

  const getSession = getContext<PublicSessionGetter | undefined>(PUBLIC_SESSION_CONTEXT);
  const session = $derived(getSession?.() ?? 'anonymous');
  const destination = $derived(session === 'authenticated' ? '/dashboard' : '/login');
  const label = $derived(
    session === 'anonymous' ? 'Sign in to investigate' : 'Open console',
  );
</script>

<a class="btn" href={destination}>{label}</a>
