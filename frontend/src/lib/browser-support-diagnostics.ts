export type BrowserSupportDiagnosticInput = Readonly<{
  applicationVersion: string;
  buildRevision: string;
  viewportWidth: number;
  selectedTheme: 'dark' | 'light' | 'system';
  renderedTheme: 'dark' | 'light';
  secureContext: boolean;
  indexedDbAvailable: boolean;
  storageManagerAvailable: boolean;
  webCryptoAvailable: boolean;
  clipboardAvailable: boolean;
}>;

export function browserViewportClass(width: number): 'compact' | 'standard' | 'wide' {
  if (!Number.isFinite(width) || width < 0) return 'standard';
  if (width <= 520) return 'compact';
  if (width <= 1180) return 'standard';
  return 'wide';
}

function boundedRevision(value: string): string {
  const revision = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/u.test(revision) ? revision.slice(0, 12) : 'local';
}

export function buildBrowserSupportDiagnostics(input: BrowserSupportDiagnosticInput) {
  return Object.freeze({
    product: 'WHOISleuth',
    applicationVersion: String(input.applicationVersion).slice(0, 32),
    buildRevision: boundedRevision(input.buildRevision),
    viewportClass: browserViewportClass(input.viewportWidth),
    selectedTheme: input.selectedTheme,
    renderedTheme: input.renderedTheme,
    capabilities: Object.freeze({
      secureContext: input.secureContext,
      indexedDb: input.indexedDbAvailable,
      storageManager: input.storageManagerAvailable,
      webCrypto: input.webCryptoAvailable,
      clipboardWrite: input.clipboardAvailable,
    }),
  });
}

export function captureBrowserSupportDiagnostics(
  build: Readonly<{ applicationVersion: string; buildRevision: string }>,
) {
  const renderedTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const selectedTheme = document.documentElement.dataset.themePreference;
  return buildBrowserSupportDiagnostics({
    applicationVersion: build.applicationVersion,
    buildRevision: build.buildRevision,
    viewportWidth: window.innerWidth,
    selectedTheme: selectedTheme === 'dark' || selectedTheme === 'light' ? selectedTheme : 'system',
    renderedTheme,
    secureContext: window.isSecureContext,
    indexedDbAvailable: typeof window.indexedDB !== 'undefined',
    storageManagerAvailable: typeof navigator.storage !== 'undefined',
    webCryptoAvailable: typeof globalThis.crypto?.subtle !== 'undefined',
    clipboardAvailable: typeof navigator.clipboard?.writeText === 'function',
  });
}

export function formatBrowserSupportDiagnostics(
  diagnostics: ReturnType<typeof buildBrowserSupportDiagnostics>,
): string {
  return JSON.stringify(diagnostics, null, 2);
}
