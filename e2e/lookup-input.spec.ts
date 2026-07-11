import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';

// Every value here is deliberately dotless (no TLD), so classifyQuery on the
// server rejects it with a 400 before any RDAP/WHOIS/DNS call - these tests
// never trigger a live lookup, only client-side parsing/navigation.

test.beforeEach(async ({ page }) => {
  await page.goto('/lookup');
});

test('a single domain can be entered normally', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await expect(query).toHaveValue('bad-domain-one');
  await expect(page.getByRole('button', { name: 'Run lookup' })).toBeVisible();
  await expect(page.getByText('Separate multiple domains with commas, semicolons, tabs, or new lines.')).toBeVisible();
});

test('newlines, commas, and semicolons all parse as multiple domains and hand off to Bulk', async ({ page }) => {
  // Each delimiter gets its own line: the client-side parser picks one
  // dominant delimiter per line, so a line mixing "," and ";" together would
  // only split on one of them. Using `.invalid` (RFC 2606) keeps these
  // syntactically domain-shaped - required for the parser to treat a line as
  // a pasted list rather than a single free-text token - without this test
  // ever reaching /api/lookup: the multi-domain path only hands candidates
  // off to Bulk client-side and never submits a lookup itself.
  const query = page.locator('#query');
  await query.fill(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid,bad-domain-three.invalid',
      'bad-domain-four.invalid;bad-domain-five.invalid',
    ].join('\n')
  );
  await expect(page.getByRole('button', { name: 'Open 5 in Bulk' })).toBeVisible();

  await page.getByRole('button', { name: 'Open 5 in Bulk' }).click();
  await expect(page).toHaveURL(/\/bulk/);
  await expect(page.locator('#domains')).toHaveValue(
    [
      'bad-domain-one.invalid',
      'bad-domain-two.invalid',
      'bad-domain-three.invalid',
      'bad-domain-four.invalid',
      'bad-domain-five.invalid',
    ].join('\n')
  );
});

test('Enter inserts a newline in the query field instead of submitting', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await query.press('End');
  await query.press('Enter');
  await query.pressSequentially('bad-domain-two');

  await expect(query).toHaveValue('bad-domain-one\nbad-domain-two');
  // Enter must not have already submitted the multi-domain handoff.
  await expect(page).toHaveURL(/\/lookup$/);
  await expect(page.getByRole('button', { name: 'Open 2 in Bulk' })).toBeVisible();
});

test('the clear action empties the field', async ({ page }) => {
  const query = page.locator('#query');
  await query.fill('bad-domain-one');
  await page.getByRole('button', { name: 'Clear query' }).click();
  await expect(query).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Clear query' })).toHaveCount(0);
});

test('the clear action stays within the input wrapper at desktop and mobile widths, with no overflow', async ({ page }) => {
  const query = page.locator('#query');
  const wrapper = page.locator('.query-field');
  const clearButton = page.getByRole('button', { name: 'Clear query' });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await query.fill('bad-domain-one');
    const wrapperBox = await boundingBox(wrapper);
    const clearBox = await boundingBox(clearButton);
    expect(clearBox.x).toBeGreaterThanOrEqual(wrapperBox.x - 1);
    expect(clearBox.y).toBeGreaterThanOrEqual(wrapperBox.y - 1);
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(wrapperBox.x + wrapperBox.width + 1);
    expect(clearBox.y + clearBox.height).toBeLessThanOrEqual(wrapperBox.y + wrapperBox.height + 1);
    await expectNoHorizontalOverflow(page);
    await query.fill('');
  }
});
