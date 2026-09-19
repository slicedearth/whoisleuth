import { readable } from 'svelte/store';

/** One clock for mounted review views; no persisted timestamps are changed. */
export const reviewClock = readable(Date.now(), (set) => {
  const refresh = () => set(Date.now());
  refresh();
  if (typeof window === 'undefined') return;
  const visible = () => { if (document.visibilityState === 'visible') refresh(); };
  const timer = window.setInterval(visible, 60_000);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', refresh);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('focus', refresh);
  };
});
