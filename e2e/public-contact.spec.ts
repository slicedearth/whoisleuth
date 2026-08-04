import { expect, test } from './fixtures';
import { expectNoHorizontalOverflow } from './helpers';

test('contact handoff keeps the draft local and reveals only the selected role route', async ({ page }) => {
  const submissions: unknown[] = [];

  await page.route('**/api/contact-route', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          siteKey: 'public-test-key',
          categories: ['privacy', 'security'],
        }),
      });
      return;
    }

    submissions.push(request.postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ category: 'privacy', route: 'privacy@example.test' }),
    });
  });
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    async (route) => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile={
        render:(container,options)=>{
          container.textContent='Verification ready';
          queueMicrotask(()=>options.callback('browser-test-token'));
          return 'contact-widget';
        },
        reset:()=>{},
        remove:()=>{}
      };`,
    }),
  );

  await page.goto('/contact');

  await expect(page.getByRole('heading', { name: 'Prepare a contact email' })).toBeVisible();
  await expect(page.getByText('Your draft stays in this browser.')).toBeVisible();
  await expect(page.getByText('Verification ready')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('privacy@example.test');

  await page.getByLabel('Subject').fill('A bounded privacy request');
  await page.getByLabel('Message').fill('This private draft must not cross the application boundary.');
  await page.getByRole('button', { name: 'Verify and prepare email' }).click();

  await expect.poll(() => submissions).toEqual([
    { category: 'privacy', token: 'browser-test-token' },
  ]);
  const draftLink = page.getByRole('link', { name: 'Open email draft' });
  await expect(draftLink).toBeVisible();
  await expect(draftLink).toHaveAttribute(
    'href',
    /subject=A%20bounded%20privacy%20request&body=Contact%20category%3A%20Privacy%20request/u,
  );
  await expect(page.getByText('Nothing has been sent.')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page);
});

test('contact handoff fails closed when a deployment is not configured', async ({ page }) => {
  await page.route('**/api/contact-route', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ available: false, siteKey: null, categories: [] }),
  }));

  await page.goto('/contact');

  await expect(page.getByText('The protected contact route is not available on this deployment.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify and prepare email' })).toBeDisabled();
  await expect(page.locator('script[src*="challenges.cloudflare.com"]')).toHaveCount(0);
});
