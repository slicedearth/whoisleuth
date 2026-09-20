import { ALLOWED_ORIGIN, expect, test } from './fixtures';
import { HTML_TREE_FIXTURES } from '../test/html-tree-fixtures.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { CSP_POLICY_FIXTURES } from '../test/csp-policy-fixtures.mts';
import { analyzeResponsePolicyHeaders } from '../lib/response-policy.mts';
import { EXACT_ONLY_GIF, EXACT_ONLY_SVG, expectedIconPixels, faviconTransparencyFixtures } from '../test/favicon-image-fixtures.mts';
import { faviconPerceptualHash } from '../lib/perceptual-hash.mts';
import { fetchFaviconHash } from '../lib/favicon.mts';
import { createHash } from 'node:crypto';

test('bounded static evidence agrees with native inert document parsing', async ({ page }) => {
  // Use a policy-neutral fixture document: the application's own base-uri
  // protection also applies to DOMParser documents and would mask the HTML
  // rule being tested. Do not change the served application's CSP.
  const url = new URL('/__inert-document-fixture', ALLOWED_ORIGIN).toString();
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Inert document fixture</title>' }));
  await page.goto(url);
  for (const fixture of HTML_TREE_FIXTURES) {
    const native = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, 'text/html');
      const elements = [...document.querySelectorAll('*')];
      return {
        forms: document.forms.length,
        passwordInputs: document.querySelectorAll('input[type=password]').length,
        handlers: elements.reduce((count, element) => count + [...element.attributes].filter((attribute) => /^on[a-z]{2,24}$/u.test(attribute.name)).length, 0),
      };
    }, fixture.html);
    expect(native, fixture.name).toEqual({ forms: fixture.forms, passwordInputs: fixture.passwordInputs, handlers: fixture.handlers });
    const evidence = await extractHtmlSignals(fixture.html, 'example.test');
    expect(evidence.pageIdentity?.forms.count, fixture.name).toBe(native.forms);
    expect(evidence.hasPasswordField, fixture.name).toBe(native.passwordInputs > 0);
    expect(evidence.clientBehaviorProfile?.indicators.find((indicator) => indicator.id === 'inline_event_handlers')?.occurrences ?? 0, fixture.name).toBe(native.handlers);
  }
  const withBodyBase = '<body><base href="https://assets.example/root/"><form action=submit><input type=password></form></body>';
  const nativeBase = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return { base: document.baseURI, action: document.forms[0]!.action };
  }, withBodyBase);
  const evidence = await extractHtmlSignals(withBodyBase, 'example.test', { baseUrl: 'https://example.test/page' });
  expect(nativeBase).toEqual({ base: 'https://assets.example/root/', action: 'https://assets.example/root/submit' });
  expect(evidence.pageIdentity?.forms.externalActionOrigins).toEqual(['https://assets.example']);
});

test('favicon transparency and exact-only admission agree with native image decoding', async ({ page }) => {
  await page.goto('/privacy');
  const fixtures = faviconTransparencyFixtures();
  for (const fixture of [
    ...fixtures,
    { name: 'exact-only SVG', mime: 'image/svg+xml', bytes: EXACT_ONLY_SVG },
    { name: 'exact-only GIF', mime: 'image/gif', bytes: EXACT_ONLY_GIF },
  ]) {
    const native = await page.evaluate(async ({ data, mime }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: [...context.getImageData(0, 0, canvas.width, canvas.height).data],
      };
    }, { data: fixture.bytes.toString('base64'), mime: fixture.mime });
    if (!fixture.name.startsWith('exact-only')) {
      expect(native.width, fixture.name).toBe(32);
      expect(native.height, fixture.name).toBe(32);
      expect(native.pixels, fixture.name).toEqual(expectedIconPixels());
      expect(faviconPerceptualHash(fixture.bytes), fixture.name).toBe('5432aa315432aa31');
    } else {
      expect([native.width, native.height], fixture.name).toEqual([1, 1]);
      expect(faviconPerceptualHash(fixture.bytes), fixture.name).toBeNull();
    }
  }
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#336699';
    context.fillRect(0, 0, 16, 16);
    return ['image/jpeg', 'image/webp'].map((mime) => ({ mime, data: canvas.toDataURL(mime) }));
  });
  for (const fixture of encoded) {
    expect(fixture.data).toMatch(new RegExp(`^data:${fixture.mime};base64,`));
    const bytes = Buffer.from(fixture.data.split(',')[1]!, 'base64');
    const result = await fetchFaviconHash('example.test', {
      fetcher: async () => new Response(new Uint8Array(bytes)),
    });
    expect(result).toEqual({ hash: createHash('sha256').update(bytes).digest('hex'), phash: null });
  }
});

test.describe('native policy enforcement', () => {
test.use({ allowExpectedPolicyFixtureDiagnostics: true });
test('response policy interpretation agrees with native inline-script enforcement', async ({ context }) => {
  // A separate fixture document deliberately produces CSP diagnostics; keep
  // the application page's strict console guard unchanged and inspect every
  // diagnostic from this page explicitly. The context network guard applies.
  const probe = await context.newPage();
  const errors: string[] = [];
  const diagnostics: string[] = [];
  probe.on('pageerror', (error) => errors.push(error.message));
  probe.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text());
  });
  const url = new URL('/__policy-fixture', ALLOWED_ORIGIN).toString();
  let policy = '';
  await probe.route(url, (route) => route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/html', 'content-security-policy': policy },
    body: '<!doctype html><title>Policy fixture</title><script>document.documentElement.dataset.block="ran"</script><button onclick="document.documentElement.dataset.attribute=\'ran\'">Exercise handler</button>',
  }));
  try {
    for (const fixture of CSP_POLICY_FIXTURES) {
      policy = fixture.policy;
      await probe.goto(url);
      await probe.getByRole('button', { name: 'Exercise handler' }).click();
      const native = await probe.evaluate(() => ({
        blocks: document.documentElement.dataset.block === 'ran',
        attributes: document.documentElement.dataset.attribute === 'ran',
      }));
      expect(native, fixture.name).toEqual({ blocks: fixture.blocks, attributes: fixture.attributes });
      const evidence = analyzeResponsePolicyHeaders(new Headers({ 'content-security-policy': policy }));
      expect(evidence.signals.some((signal) => signal.id === 'csp_unsafe_inline'), fixture.name).toBe(native.blocks);
      expect(evidence.signals.some((signal) => signal.id === 'csp_unsafe_inline_attributes'), fixture.name).toBe(native.attributes);
    }
    expect(errors).toEqual([]);
    expect(diagnostics.length, 'denied fixture scripts must produce native diagnostics').toBeGreaterThan(0);
    for (const diagnostic of diagnostics) expect(diagnostic).toMatch(/Content.Security.Policy|source list.*directive|inline.*policy|duplicate.*directive/iu);
  } finally {
    await probe.close();
  }
});
});
