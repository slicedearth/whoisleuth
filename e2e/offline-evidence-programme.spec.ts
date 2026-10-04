import { test, expect, isLookupEndpointUrl } from './fixtures';
import { captureVisualEvidenceEnabled } from '../tools/playwright-execution-contract.mts';
import { openSeededTimelineCase } from './case-test-fixtures';
import { openCaseSection } from './console-navigation';
import { expectNoHorizontalOverflow, readBrowserLocalCollection, useTheme } from './helpers';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import { historyCase } from '../test/context-review-fixtures.mts';
import AxeBuilder from '@axe-core/playwright';

const NOW = '2026-01-02T03:04:05.000Z';

test('source-linked indicators and supplied distribution context retain only the explicitly reviewed report', async ({
  page,
}, testInfo) => {
  let requests = 0;
  await page.route(
    (url) => isLookupEndpointUrl(url.href),
    (route) => {
      requests++;
      return route.abort();
    },
  );
  const record = createCase({ domain: 'example.test' }, NOW);
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await page.getByText('Review a message, link or selected file', { exact: true }).click();
  const intake = page.locator('details.intake');
  await intake
    .getByLabel('Text to review')
    .fill(
      `192.0.2.17 SHA256:${'a'.repeat(64)}\nhttps://example.test/private-path?token=private-token`,
    );
  await intake.getByRole('button', { name: 'Review locally', exact: true }).click();
  const context = intake.getByRole('region', {
    name: 'Source-linked indicators and distribution context',
  });
  await expect(context).toContainText('Literal IPs and labelled hashes · 2');
  await expect(
    context.getByRole('button', { name: 'Copy source citation for indicator-1' }),
  ).toBeVisible();
  await context.getByText('Declare distribution context', { exact: true }).click();
  await context.getByLabel('Declared distribution channel').selectOption('sms');
  await context.getByLabel('Context source label').fill('Reported message');
  await expect(
    intake.getByRole('button', { name: 'Save review in Case', exact: true }),
  ).toBeDisabled();
  await context.getByLabel('Declared observation time (ISO with timezone)').fill(NOW);
  await context.getByRole('button', { name: 'Apply distribution declaration' }).click();
  await expect(
    context.getByRole('region', { name: 'Applied distribution declaration' }),
  ).toContainText('sms · Reported message');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    intake.getByRole('button', { name: 'Download review', exact: true }).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8'),
    report = JSON.parse(raw);
  expect(report.schemaVersion).toBe(2);
  expect(report.indicators).toHaveLength(2);
  expect(report.distributionContext.channel).toBe('sms');
  expect(raw).not.toContain('private-token');
  expect(raw).not.toContain('private-path');
  await intake.getByRole('button', { name: 'Save review in Case', exact: true }).click();
  await expect(intake.getByRole('status')).toHaveText('Saved the review in this Case.');
  const saved = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: 2,
  });
  expect(saved.records[0]!.value.attachments).toHaveLength(1);
  expect(JSON.stringify(saved.records)).toContain('source-linked literal indicators');
  expect(JSON.stringify(saved.records)).not.toContain('192.0.2.17');
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(context).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled())
        await context.screenshot({
          path: testInfo.outputPath(`intake-context-${theme}-${width}.png`),
        });
    }
  }
  expect((await new AxeBuilder({ page }).include('.intake-context').analyze()).violations).toEqual(
    [],
  );
  expect(requests).toBe(0);
});

test('registration boundaries preserve earlier history and survive explicit report retention', async ({
  page,
}) => {
  const record = historyCase();
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseSection(page, 'Evidence');
  const entry = page.locator('.context-entry');
  await entry.locator(':scope > summary').click();
  await entry.getByRole('button', { name: 'Check domain history', exact: true }).click();
  const review = entry.getByRole('region', {
    name: 'Domain history and retired dependencies',
    exact: true,
  });
  await review
    .getByText('Declare a registration-lifecycle review boundary', { exact: true })
    .click();
  await review.getByLabel('Boundary kind').selectOption('reregistration_reported');
  await review.getByLabel('Declared boundary time (local)').fill('2026-09-21T00:00');
  await review.getByLabel('Boundary source label').fill('Selected publication');
  await review
    .getByLabel('Boundary rationale')
    .fill('Review prior relevance without discarding history');
  await review
    .getByLabel('Retained snapshot reference')
    .selectOption(record.evidenceHistory[0]!.id);
  await review.getByRole('button', { name: 'Add declared boundary' }).click();
  await review.getByRole('button', { name: 'Review retained history' }).click();
  const report = review.locator('.context-report');
  await expect(report).toContainText('Analyst-declared registration boundaries: 1');
  await expect(report).toContainText('Earlier evidence and open follow-ups remain unchanged');
  await report.getByRole('button', { name: 'Save review in Case', exact: true }).click();
  await expect(report.getByRole('status')).toContainText('Review saved');
  const saved = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: 2,
  });
  expect(saved.records[0]!.value.evidenceHistory).toEqual(record.evidenceHistory);
  expect(saved.records[0]!.value.assertions).toEqual(record.assertions);
  await page.setViewportSize({ width: 320, height: 900 });
  await expectNoHorizontalOverflow(page);
});

test('containment handoff selects exact retained requests, previews audience disclosure and preserves open state in a resolved Case', async ({
  page,
}, testInfo) => {
  let record = createCase({ domain: 'example.test', title: 'Unshared title' }, NOW);
  record = updateCase(
    [record],
    record.id,
    {
      evidencePin: {
        label: 'Selected context',
        value: 'Selected context value',
        source: 'Retained review',
        observedAt: NOW,
        completeness: 'partial',
      },
    },
    NOW,
  ).record;
  const pin = record.evidencePins[0]!;
  record = updateCase(
    [record],
    record.id,
    {
      assertion: {
        kind: 'next_step',
        statement: 'Review the selected sessions',
        state: 'open',
        evidenceRelations: [{ evidencePinId: pin.id, stance: 'unresolved' }],
      },
    },
    NOW,
  ).record;
  record = { ...record, status: 'resolved' };
  const originalAssertions = structuredClone(record.assertions);
  await openSeededTimelineCase(page, record.domain, [record], CASE_SCHEMA_VERSION);
  await openCaseSection(page, 'Response');
  await page.getByText('Account and device recovery', { exact: true }).click();
  await page.getByText('Prepare an internal containment handoff', { exact: true }).click();
  const handoff = page.locator('details.containment');
  await handoff.getByLabel(/Review the selected sessions/u).check();
  await handoff.getByLabel(/Pin 1: Selected context/u).check();
  await handoff.getByLabel('Internal recipient role').selectOption('identity_response');
  await handoff.getByRole('button', { name: 'Preview containment disclosure' }).click();
  const preview = handoff.getByRole('region', { name: 'Containment disclosure preview' });
  await expect(
    preview.getByRole('heading', { name: 'Containment disclosure preview' }),
  ).toBeFocused();
  await expect(preview).toContainText('Coverage: partial');
  await expect(preview).toContainText('do not resolve open internal requests');
  await expect(
    handoff.getByRole('button', { name: 'Download containment handoff' }),
  ).toBeDisabled();
  await handoff.getByLabel('Disclosure audience').selectOption('public');
  await expect(preview).toHaveCount(0);
  await handoff.getByRole('button', { name: 'Preview containment disclosure' }).click();
  await expect(preview).toContainText('Included requests: 0');
  await expect(preview).not.toContainText('Selected context value');
  await expect(preview).not.toContainText('Review the selected sessions');
  await handoff.getByLabel('Disclosure audience').selectOption('trusted');
  await handoff.getByRole('button', { name: 'Preview containment disclosure' }).click();
  await handoff
    .getByLabel(
      'I reviewed these exact statements, evidence values and audience disclosures for this recipient.',
    )
    .check();
  await handoff.getByRole('button', { name: 'Save containment handoff in Case' }).click();
  await expect(handoff.getByRole('status')).toContainText('Handoff saved');
  await expect(handoff.locator(':scope > summary')).toBeFocused();
  const saved = await readBrowserLocalCollection(page, 'cases', {
    minimumRecords: 1,
    minimumRevision: 2,
  });
  expect(saved.records[0]!.value.assertions).toEqual(originalAssertions);
  expect(saved.records[0]!.value.attachments).toHaveLength(1);
  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme);
    for (const width of [320, 390, 1280, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(handoff).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (captureVisualEvidenceEnabled())
        await handoff.screenshot({
          path: testInfo.outputPath(`containment-${theme}-${width}.png`),
        });
    }
  }
  expect((await new AxeBuilder({ page }).include('.containment').analyze()).violations).toEqual([]);
});
