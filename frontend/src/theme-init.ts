(() => {
  type ThemePreference = 'dark' | 'light' | 'system';

  const STORAGE_KEY = 'whoisleuth:theme:v1';

  function isThemePreference(value: string | null): value is ThemePreference {
    return value === 'dark' || value === 'light' || value === 'system';
  }

  function readThemePreference(): ThemePreference {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isThemePreference(stored) ? stored : 'system';
    } catch {
      // The operating-system preference remains the fallback when storage is blocked.
      return 'system';
    }
  }

  const root = document.documentElement;
  const preference = readThemePreference();
  const systemUsesLight = preference === 'system'
    && typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = preference === 'light' || systemUsesLight ? 'light' : 'dark';

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#d4dde7' : '#0f1115');
})();
