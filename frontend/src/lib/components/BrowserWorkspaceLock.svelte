<script lang="ts">
  import { onMount } from 'svelte';
  import { createWorkspaceIdleTimer, readWorkspaceIdleMinutes, saveWorkspaceIdleMinutes, WORKSPACE_IDLE_MINUTES } from '$lib/browser-workspace-lock.ts';
  let { id }: { id: string } = $props();
  let minutes = $state(0), message = $state(''), error = $state('');
  let timer: ReturnType<typeof createWorkspaceIdleTimer> | undefined;
  let mounted = false;
  function lock() {
    message = 'Lock requested. Cancelling the browser’s leave-page prompt keeps this tab unlocked.';
    // pagehide owns key disposal. Clearing keys before a cancellable navigation
    // would leave a cancelled page visible but unable to save its drafts.
    // Use a fresh document navigation, not the reload state left behind by a
    // cancelled beforeunload. Omitting the fragment prevents same-document
    // navigation; the route and selected-record query remain intact.
    window.location.assign(`${window.location.pathname}${window.location.search}`);
  }
  function arm() {
    timer?.dispose();
    timer = createWorkspaceIdleTimer(minutes, { now: Date.now, expire: lock,
      schedule: (callback, delay) => { const handle = window.setTimeout(callback, delay); return () => window.clearTimeout(handle); } });
  }
  onMount(() => {
    mounted = true;
    try { minutes = readWorkspaceIdleMinutes(id); } catch (cause) { error = cause instanceof Error ? cause.message : 'Idle-lock settings could not be read.'; }
    arm();
    const activity = (event: Event) => { if (event.isTrusted) { timer?.activity(); message = ''; } };
    const visibility = () => { timer?.check(); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, activity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted = false; timer?.dispose(); for (const event of events) window.removeEventListener(event, activity, true); document.removeEventListener('visibilitychange', visibility); };
  });
  function select(event: Event) {
    if (!mounted) return;
    const control = event.currentTarget as HTMLSelectElement, next = Number(control.value);
    try { saveWorkspaceIdleMinutes(id, next); minutes = next; error = ''; message = ''; arm(); }
    catch (cause) { control.value = String(minutes); error = cause instanceof Error ? cause.message : 'The idle-lock choice could not be saved. The previous setting remains active.'; }
  }
</script>

<span class="workspace-lock">
  <button class="btn" type="button" onclick={lock}>Lock workspace</button>
  <label>Auto-lock<select value={minutes} onchange={select} aria-describedby={`lock-policy-${id}`}>
    {#each WORKSPACE_IDLE_MINUTES as value}<option value={value}>{value ? `${value} minutes idle` : 'Off'}</option>{/each}
  </select></label>
  <span id={`lock-policy-${id}`} class:inactive={minutes === 0} class="lock-policy">Locking reloads this tab. Saved encrypted drafts remain; other unsaved page state is lost. This setting applies only to this tab and workspace.</span>
  {#if error}<span role="alert">{error}</span>{/if}
  {#if message}<span role="status">{message}</span>{/if}
</span>

<style>
  .workspace-lock{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;min-width:0;max-width:100%}label{display:flex;align-items:center;flex-wrap:wrap;gap:6px}select{min-height:44px;max-width:100%;font:inherit}.lock-policy,[role]{flex-basis:100%;font-size:var(--text-xs);line-height:1.5;color:var(--muted);max-width:80ch}.inactive{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}[role=alert]{color:var(--danger)}
</style>
