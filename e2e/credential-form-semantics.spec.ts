import { expect, test } from './fixtures';
import { analyzeStaticHtml } from '../lib/static-html-analysis.mts';
import { attributeCredentialForms, staticControlIsSubmitter } from '../lib/credential-form-attribution.mts';
import { externalPasswordFormObservation } from '../packages/evidence/credential-form-attribution.mts';

test('static submitter classification agrees with native script-free button semantics', async ({ page }) => {
  for (const type of ['', 'type=invalid', 'type=submit', 'type=reset', 'type=button']) {
    for (const attributes of ['', 'command=show-modal', 'commandfor=help', 'command="" commandfor=""']) {
      const html = `<form action="https://portal.example/login"><input type=password><button ${type} ${attributes} formaction="https://collector.example">Help</button></form><dialog id=help>Help</dialog>`;
      await page.setContent(html);
      const native = await page.locator('button').evaluate(element => (element as HTMLButtonElement).type === 'submit');
      const analysis = analyzeStaticHtml(html, { baseUrl: 'https://portal.example/' });
      const button = analysis.elements.find(element => element.name === 'button')!;
      expect(staticControlIsSubmitter(button, button.parent === null ? undefined : analysis.elements[button.parent])).toBe(native);
    }
  }
});

test('malformed and table form ownership never turns an unassociated input into positive attribution', async ({ page }) => {
  for (const [html, nativeExpected, staticExpected] of [
    ['<form id=remote action="https://collector.example"><input type=password></form>', true, true],
    ['<input type=password form=remote><form id=remote action="https://collector.example"></form>', true, true],
    ['<table><form id=remote action="https://collector.example"><tr><td><input type=password></td></tr></form></table>', true, null],
    ['<form id=local action="https://portal.example/"><form id=remote action="https://collector.example"><input type=password></form></form>', false, false],
  ] as const) {
    await page.setContent(html);
    const native = await page.locator('input').evaluate(element => {
      const form = (element as HTMLInputElement).form;
      return form ? new URL(form.action).origin === 'https://collector.example' : null;
    });
    const staticValue = externalPasswordFormObservation(attributeCredentialForms(analyzeStaticHtml(html, { baseUrl: 'https://portal.example/' }), 'https://portal.example/'));
    expect(native).toBe(nativeExpected);
    expect(staticValue).toBe(staticExpected);
  }
});
