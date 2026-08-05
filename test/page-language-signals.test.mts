import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PAGE_LANGUAGE_SIGNAL_VERSION,
  detectPageLanguageSignal,
  pageLanguagePackCatalogue,
} from '../lib/page-language-signals.mts';
import { analyzeStaticHtml } from '../lib/static-html-analysis.mts';

describe('reviewed page-language signal packs', () => {
  test('detects reviewed high-specificity phrases without retaining matched page text', () => {
    const signal = detectPageLanguageSignal('<html lang="es"><body>Acción inmediata requerida</body></html>', 'es');
    assert.equal(signal?.version, PAGE_LANGUAGE_SIGNAL_VERSION);
    assert.equal(signal?.packId, 'es-reviewed-v1');
    assert.equal(signal?.category, 'urgent_action');
    assert.equal(signal?.label, 'Reviewed Spanish urgent-action language');
    assert.doesNotMatch(JSON.stringify(signal), /Acción inmediata requerida/u);
  });

  test('falls back across packs when the document language is absent or inaccurate', () => {
    assert.equal(detectPageLanguageSignal('Veuillez confirmer votre identité')?.language, 'fr');
    assert.equal(detectPageLanguageSignal('Sofortiges Handeln erforderlich', 'en')?.language, 'de');
  });

  test('keeps ordinary copy, oversized input, and control-bearing input neutral', () => {
    assert.equal(detectPageLanguageSignal('Read the account security guide.'), null);
    assert.equal(detectPageLanguageSignal('x'.repeat(300_001)), null);
    assert.equal(detectPageLanguageSignal('Security alert\u0007'), null);
  });

  test('does not interpret comments, scripts, styles, or tag attributes as visible review language', () => {
    assert.equal(detectPageLanguageSignal('<!-- verify your account --><body>Account help</body>'), null);
    assert.equal(detectPageLanguageSignal('<script>"immediate action required"</script><body>Account help</body>'), null);
    assert.equal(detectPageLanguageSignal('<style>.notice::after{content:"security alert"}</style><body>Account help</body>'), null);
    assert.equal(detectPageLanguageSignal('<div data-copy="verify your account">Account help</div>'), null);
    assert.equal(detectPageLanguageSignal(`<div data-copy="${'x'.repeat(5_000)} verify your account">Account help</div>`), null);
    assert.equal(detectPageLanguageSignal('<div data-copy="a>verify your account">Account help</div>'), null);
    assert.equal(detectPageLanguageSignal('<input data-rule="len>5" placeholder="Verify your account">'), null);
    assert.equal(detectPageLanguageSignal('<button onclick="if(x>1)go()" title="Confirm your identity">Continue</button>'), null);
    assert.equal(detectPageLanguageSignal(`<div data-cfg='{"min":1>0}' aria-label="Security alert">Account help</div>`), null);
    assert.equal(detectPageLanguageSignal('<body><strong>Verify your account</strong></body>')?.category, 'account_verification');
  });

  test('publishes only fixed pack metadata for authoring review', () => {
    const catalogue = pageLanguagePackCatalogue();
    assert.equal(catalogue.length, 7);
    assert.equal(catalogue.every((pack) => pack.categories.length === 5), true);
    assert.doesNotMatch(JSON.stringify(catalogue), /verify your account/iu);
  });

  test('keeps visible-text retention opt-in on the shared static tokenizer', () => {
    const html = '<main>Account help</main>';
    assert.equal(analyzeStaticHtml(html).visibleText, '');
    assert.equal(analyzeStaticHtml(html, { includeVisibleText: true }).visibleText, 'Account help');
  });
});
