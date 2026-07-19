(() => {
  const storageKey = 'whoisleuth:theme:v1';
  const root = document.documentElement;
  let preference = 'system';
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'dark' || stored === 'light' || stored === 'system') preference = stored;
  } catch {
    // The operating-system preference remains the fallback when storage is blocked.
  }
  const systemUsesLight = preference === 'system'
    && typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = preference === 'light' || systemUsesLight ? 'light' : 'dark';
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#edf2f7' : '#0f1115');
})();
