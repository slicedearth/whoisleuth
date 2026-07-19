export const THEME_STORAGE_KEY = 'whoisleuth:theme:v1';
export const THEME_CHANGE_EVENT = 'whoisleuth:theme-change';

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const DARK_THEME_COLOR = '#0f1115';
const LIGHT_THEME_COLOR = '#edf2f7';

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'light' ? value : 'system';
}

export function resolveThemePreference(preference: ThemePreference, systemUsesLight: boolean): ResolvedTheme {
  if (preference === 'system') return systemUsesLight ? 'light' : 'dark';
  return preference;
}

function systemUsesLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === null
      ? normalizeThemePreference(document.documentElement.dataset.themePreference)
      : normalizeThemePreference(stored);
  } catch {
    return normalizeThemePreference(document.documentElement.dataset.themePreference);
  }
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveThemePreference(preference, systemUsesLight());
  if (typeof document === 'undefined') return resolved;

  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);
  return resolved;
}

export function setThemePreference(preference: ThemePreference): boolean {
  const normalized = normalizeThemePreference(preference);
  let persisted = false;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
      persisted = true;
    } catch {
      // The preference still applies to the current document when storage is
      // unavailable (for example, in a restrictive private-browsing mode).
    }
  }
  applyThemePreference(normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: normalized }));
  }
  return persisted;
}

export function observeThemePreference(callback: (preference: ThemePreference) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

  const refresh = () => {
    const preference = readThemePreference();
    applyThemePreference(preference);
    callback(preference);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const preference = event.newValue === null
      ? 'system'
      : normalizeThemePreference(event.newValue);
    applyThemePreference(preference);
    callback(preference);
  };
  const handleThemeChange = (event: Event) => {
    const preference = normalizeThemePreference((event as CustomEvent).detail);
    applyThemePreference(preference);
    callback(preference);
  };
  const handleSystemChange = () => {
    if (readThemePreference() === 'system') refresh();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  media?.addEventListener('change', handleSystemChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    media?.removeEventListener('change', handleSystemChange);
  };
}
