import { expect, test } from './fixtures';
import { boundingBox, expectNoHorizontalOverflow } from './helpers';
import { sectionedLookupFixture } from './lookup-design-fixtures';

// Data-heavy Lookup evidence presentation and accessibility coverage.

function analystQuestion(page: import('@playwright/test').Page) {
  return page.getByRole('region', { name: 'Choose evidence depth for the question' })
    .getByLabel('Analyst question');
}

test('a data-heavy Lookup result groups evidence into navigable sections', {
  tag: [
    '@analyst-journey',
    '@journey-first-domain-assessment',
    '@journey-acquisition-uncertainty-review',
  ],
}, async ({ page }) => {
  test.slow();
  const reviewedAt = new Date('2026-08-21T12:00:00.000Z');
  await page.clock.setFixedTime(reviewedAt);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sectionedResult = {
    ...sectionedLookupFixture('sectioned-result.invalid'),
    observedAt: reviewedAt.toISOString(),
  };
  Object.assign(sectionedResult.whois.parsed, {
    domainName: 'different.invalid',
  });
  Object.assign(sectionedResult.availability.dns, {
    limitations: ['The DNS collection is incomplete for this bounded comparison.'],
  });
  const lookupRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/lookup') lookupRequests.push(request.url());
  });
  await page.route('**/api/lookup?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(sectionedResult),
  }));
  await page.goto('/lookup');
  await page.locator('#query').fill('sectioned-result.invalid');
  await page.getByRole('button', { name: 'Run lookup' }).click();

  const controls = page.getByRole('region', { name: 'Choose what to review' });
  const visibility = controls.getByRole('group', { name: 'Evidence family visibility' });
  await expect(visibility.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
  await visibility.getByRole('button', { name: 'Expand all' }).click();
  await expect(visibility.getByRole('button', { name: 'Expand all' })).toBeDisabled();

  const localNav = page.getByRole('navigation', { name: 'Result sections', includeHidden: true });
  await expect(localNav).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Web & DNS' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Registration' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Relationships & history' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Source quality' })).toBeVisible();
  await expect(localNav.getByRole('link', { name: 'Advanced' })).toBeVisible();
  const activeNavigation = localNav.locator('a.active');
  await expect(activeNavigation).toHaveAttribute('aria-current', 'location');
  expect(await activeNavigation.evaluate((link) => getComputedStyle(link).boxShadow)).toContain('inset');

  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Web and DNS evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Registration$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Raw evidence' })).toBeVisible();
  await expect(page.getByLabel('Source diagnostics')).toContainText('rdap');
  const sourceQualityColour = await page.locator('#source-quality-title').evaluate((heading) => getComputedStyle(heading).color);
  const caseResponseColour = await page.locator('#case-response-title').evaluate((heading) => getComputedStyle(heading).color);
  expect(caseResponseColour).not.toBe(sourceQualityColour);

  // The D3-backed visual is paired with a complete, keyboard-operable source
  // rail. It does not replace the detailed source sections.
  const topology = page.getByRole('region', { name: 'Where this result came from' });
  await expect(topology).toBeVisible();
  await expect(topology.getByRole('img', { name: 'Where this result came from visual overview' })).toBeVisible();
  const visualKey = topology.getByRole('group', { name: 'Evidence topology visual key' });
  await expect(visualKey).toContainText('Registry');
  await expect(visualKey).toContainText('Network');
  await expect(visualKey).toContainText('Web');
  await expect(visualKey).toContainText('Derived');
  await expect(visualKey).toContainText('Analyst');
  await expect(visualKey).toContainText('Colour, shape, and icon identify each evidence family');
  await expect(visualKey).toContainText('Dot and label show evidence state');
  for (const [family, sectionTitleId] of [
    ['registry', 'registry-title'],
    ['network', 'relationships-history-title'],
    ['web', 'web-evidence-title'],
    ['derived', 'source-quality-title'],
    ['analyst', 'case-response-title'],
  ] as const) {
    const keyColour = await visualKey.locator(`.key-item.family-${family} i`).evaluate((key) => getComputedStyle(key).borderColor);
    const sectionColour = await page.locator(`#${sectionTitleId}`).evaluate((heading) => getComputedStyle(heading).color);
    expect(keyColour).toBe(sectionColour);
  }
  const topologyCopies = topology.locator('foreignObject.node-copy');
  await expect(topologyCopies.first()).toBeVisible();
  expect(await topologyCopies.evaluateAll((copies) => copies.every((copy) => {
    const text = copy.firstElementChild;
    const copyRect = copy.getBoundingClientRect();
    const nodeRect = copy.closest('g')?.querySelector(':scope > .node-surface')?.getBoundingClientRect();
    const styles = text ? getComputedStyle(text) : null;
    const wrapped = copy.classList.contains('wrapped');
    return Boolean(
      text
      && nodeRect
      && copyRect.left >= nodeRect.left - 0.5
      && copyRect.right <= nodeRect.right + 0.5
      && copyRect.top >= nodeRect.top - 0.5
      && copyRect.bottom <= nodeRect.bottom + 0.5
      && styles?.overflow === 'hidden'
      && (wrapped
        ? styles.textOverflow === 'clip'
          && styles.whiteSpace === 'normal'
          && text.scrollWidth <= text.clientWidth
          && text.scrollHeight <= text.clientHeight
        : styles.textOverflow === 'ellipsis'
          && styles.whiteSpace === 'nowrap')
    );
  }))).toBe(true);
  const sourceRail = topology.getByRole('list', { name: 'Evidence item status' });
  const mappedEvidenceCount = await sourceRail.getByRole('listitem').count();
  const derivedCount = await sourceRail.locator('.family-derived').count();
  const directCount = mappedEvidenceCount - derivedCount;
  await expect(topology.locator('.topology-summary strong')).toHaveText(String(mappedEvidenceCount));
  await expect(page.locator('#relationships-history .metric').filter({ hasText: 'mapped direct sources' })).toHaveText(`${directCount} mapped direct sources`);
  await expect(page.locator('#relationships-history .metric').filter({ hasText: 'mapped derived analyses' })).toHaveText(`${derivedCount} mapped derived analyses`);
  await expect(page.getByRole('tab', { name: /^Evidence/ }).locator('span')).toHaveText(String(mappedEvidenceCount));
  await expect(sourceRail.locator('.source-icon')).toHaveCount(await sourceRail.locator('li').count());
  await expect(page.locator('[id="dns-title"]')).toHaveCount(1);
  await expect(page.locator('[id="reverse-dns-title"]')).toHaveCount(1);
  const desktopSourceIcons = topology.locator('.node-source-icon .source-icon');
  await expect(desktopSourceIcons).toHaveCount(await sourceRail.locator('li').count());
  await expect(desktopSourceIcons.first()).toBeVisible();
  const topologyPalette = await topology.evaluate((region) => {
    const styleValue = (selector: string, property: 'fill' | 'stroke') => {
      const element = region.querySelector<SVGElement>(selector);
      return element ? getComputedStyle(element)[property] : '';
    };
    return {
      sourceFamilies: [...region.querySelectorAll<SVGGElement>('.source-node')]
        .map((node) => ({
          family: [...node.classList].find((name) => name.startsWith('family-')) ?? '',
          stroke: getComputedStyle(node.querySelector<SVGElement>('.node-surface')!).stroke,
          icon: getComputedStyle(node.querySelector<SVGElement>('.source-icon')!).color,
        })),
      keyColours: [...region.querySelectorAll<HTMLElement>('.key-item')]
        .map((element) => getComputedStyle(element.querySelector<HTMLElement>('i')!).borderColor),
      successFill: styleValue('.source-node.state-success .status-dot', 'fill'),
      successLabel: getComputedStyle(region.querySelector<HTMLElement>('.state-success .source-state')!).color,
      successEdge: styleValue('.topology-edges path.success', 'stroke'),
      partialFill: styleValue('.source-node.state-partial .status-dot', 'fill'),
    };
  });
  const familyColours = new Map<string, { stroke: string; icon: string }>();
  for (const source of topologyPalette.sourceFamilies) {
    const existing = familyColours.get(source.family);
    if (existing) expect(source).toEqual({ family: source.family, ...existing });
    else familyColours.set(source.family, { stroke: source.stroke, icon: source.icon });
  }
  expect(new Set([...familyColours.values()].map((value) => value.icon)).size).toBe(familyColours.size);
  expect(new Set(topologyPalette.keyColours).size).toBe(topologyPalette.keyColours.length);
  expect(topologyPalette.successFill).not.toBe(topologyPalette.partialFill);
  expect(topologyPalette.successFill).toBe(topologyPalette.successLabel);
  expect(topologyPalette.successEdge).not.toBe(topologyPalette.partialFill);
  expect(await desktopSourceIcons.evaluateAll((icons) => icons.every((icon) => {
    const iconRect = icon.getBoundingClientRect();
    const discRect = icon.closest('.source-node')?.querySelector('.glyph-disc')?.getBoundingClientRect();
    return Boolean(
      discRect
      && iconRect.width > 0
      && iconRect.width <= 32
      && iconRect.height > 0
      && iconRect.height <= 32
      && iconRect.left >= discRect.left - 2
      && iconRect.right <= discRect.right + 2
      && iconRect.top >= discRect.top - 2
      && iconRect.bottom <= discRect.bottom + 2
    );
  }))).toBe(true);
  await expect(sourceRail.getByRole('link', { name: /Registry RDAP.*success/i })).toHaveAttribute('href', '#evidence-registry');
  await expect(sourceRail.getByRole('link', { name: /WHOIS.*success/i })).toHaveAttribute('href', '#evidence-registry');
  const dnsSource = sourceRail.getByRole('link', { name: /DNS.*partial/i });
  await expect(dnsSource).toHaveAttribute('href', '#evidence-dns');
  await dnsSource.focus();
  await expect(dnsSource.locator('xpath=..')).toHaveClass(/active/);
  await expect(topology.locator('.source-node.family-network.active')).toHaveCount(1);
  await expect(topology.locator('.topology-edges path.active')).toHaveCount(1);

  const visualTabs = page.getByRole('tablist', { name: 'Relationship and history view' });
  const sourcesTab = visualTabs.getByRole('tab', { name: /^Evidence/ });
  await sourcesTab.focus();
  await sourcesTab.press('ArrowRight');
  await expect(visualTabs.getByRole('tab', { name: /^Relationships/ })).toBeFocused();
  await expect(visualTabs.getByRole('tab', { name: /^Relationships/ })).toHaveAttribute('aria-selected', 'true');
  await visualTabs.getByRole('tab', { name: /^Relationships/ }).press('Home');
  await expect(sourcesTab).toBeFocused();
  await expect(sourcesTab).toHaveAttribute('aria-selected', 'true');

  const linkedVisualNode = topology.locator('.source-nodes > g.linked').first();
  const hashBeforeDrag = await page.evaluate(() => window.location.hash);
  await linkedVisualNode.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  await linkedVisualNode.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20, button: 0 });
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBeforeDrag);

  await page.getByRole('button', { name: 'Collapse Web and DNS evidence' }).click();
  await expect(page.locator('#evidence-dns')).toHaveCount(0);
  await dnsSource.press('Enter');
  await expect(page).toHaveURL(/#evidence-dns$/);
  await expect(page.locator('#evidence-dns')).toBeInViewport();

  await page.getByRole('button', { name: 'Collapse Web and DNS evidence' }).click();
  await expect(page.locator('#evidence-dns')).toHaveCount(0);
  await page.evaluate(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname);
    window.location.hash = '#evidence-dns';
  });
  await expect(page).toHaveURL(/#evidence-dns$/);
  await expect(page.locator('#evidence-dns')).toBeInViewport();

  const registrySource = sourceRail.getByRole('link', { name: /Registry RDAP.*success/i });
  await expect(registrySource).toHaveAttribute('href', '#evidence-registry');
  await page.getByRole('button', { name: 'Collapse Registration evidence' }).click();
  await expect(page.locator('#evidence-registry')).toHaveCount(0);
  await registrySource.press('Enter');
  await expect(page).toHaveURL(/#evidence-registry$/);
  await expect(page.locator('#evidence-registry')).toBeInViewport();

  await page.getByRole('tab', { name: /^Timeline/ }).click();
  const lifecycle = page.getByRole('region', { name: 'Observed lifecycle' });
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle.getByRole('img', { name: 'Chronological lookup lifecycle overview' })).toBeVisible();
  const lifecycleEventList = lifecycle.locator('ol[aria-label="Lookup lifecycle events"]');
  await expect(lifecycleEventList).toContainText('Domain created');
  await expect(lifecycle.locator('.visual-fallback')).toHaveCSS('clip-path', 'inset(50%)');
  const lifecycleTokens = await lifecycle.locator('g.event').evaluateAll((events) => (
    events.map((event) => ({
      kind: event.getAttribute('data-kind'),
      colour: getComputedStyle(event).getPropertyValue('--event-color').trim(),
    }))
  ));
  const colourByKind = new Map<string | null, string>();
  for (const event of lifecycleTokens) {
    expect(event.colour).not.toBe('');
    expect(colourByKind.get(event.kind) ?? event.colour).toBe(event.colour);
    colourByKind.set(event.kind, event.colour);
  }
  expect([...colourByKind.keys()].sort()).toEqual(['observation', 'registry']);
  expect(new Set(colourByKind.values()).size).toBe(colourByKind.size);
  await expect(lifecycle.locator('.event-shape')).toHaveCount(lifecycleTokens.length);
  await expect(lifecycle.locator('.registry-shape')).toHaveCount(3);
  await expect(lifecycle.locator('.observation-shape')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-circle')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-diamond')).toHaveCount(1);
  await expect(lifecycle.locator('.visual-legend .shape-square')).toHaveCount(1);

  const activationContext = page.getByRole('region', { name: 'Observed service relationship' });
  await expect(activationContext).toBeVisible();
  await expect(activationContext).toContainText('Web response observed');
  await expect(activationContext).toContainText('Mail state inconclusive');
  await expect(activationContext).toContainText('Cross-layer timing inconclusive');

  const atAGlance = page.locator('.at-a-glance');
  const nextReviewQueue = atAGlance.locator('.next-actions');
  await expect(nextReviewQueue).toHaveCount(1);
  const nextReviewCounts = await nextReviewQueue.evaluate((queue) => ({
    total: Number(queue.getAttribute('data-total')),
    displayed: Number(queue.getAttribute('data-displayed-count')),
    omitted: Number(queue.getAttribute('data-omitted-count')),
    rendered: queue.querySelectorAll('.next-action').length,
  }));
  expect(nextReviewCounts.total).toBe(nextReviewCounts.displayed + nextReviewCounts.omitted);
  expect(nextReviewCounts.displayed).toBe(nextReviewCounts.rendered);
  expect(nextReviewCounts.displayed).toBeLessThanOrEqual(3);
  const factBackedReviews = nextReviewQueue.locator('.next-action[data-basis="decision_fact"]');
  expect(await factBackedReviews.count()).toBeGreaterThan(0);
  for (const action of await factBackedReviews.all()) {
    const contributingFactIds = (await action.getAttribute('data-contributing-fact-ids'))
      ?.split(',').filter(Boolean) ?? [];
    expect(contributingFactIds.length).toBeGreaterThan(0);
    expect(contributingFactIds.every((id) => /^lookup-(?:decision|evidence):[a-z0-9._:-]+$/u.test(id))).toBe(true);
    await expect(action.locator('.action-facts')).toContainText(contributingFactIds.join(' · '));
  }
  expect(await nextReviewQueue.locator('.next-action').evaluateAll((actions) => actions.every((action) => (
    /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u.test(action.getAttribute('href') ?? '')
  )))).toBe(true);

  const taskQuestion = analystQuestion(page);
  await taskQuestion.selectOption('acquisition');
  const acquisitionAction = nextReviewQueue.locator('[data-action-id="review-acquisition-dependencies"]');
  await expect(acquisitionAction).toHaveCount(1);
  await expect(acquisitionAction).toHaveAttribute('data-basis', 'task_context');
  await expect(acquisitionAction).toHaveAttribute('data-contributing-fact-ids', '');
  await expect(acquisitionAction.locator('.contextual-note')).toContainText('no evidence fact or provenance is claimed');
  expect(lookupRequests).toHaveLength(1);

  await taskQuestion.selectOption('brand');
  expect(lookupRequests).toHaveLength(1);
  const detailedAssessment = page.locator('details.detailed-assessment');
  await detailedAssessment.locator(':scope > summary').click();
  await expect(detailedAssessment).toHaveAttribute('open', '');
  const impactPlan = detailedAssessment.locator('details.impact-plan');
  await expect(impactPlan).toHaveCount(1);
  const impactStateBefore = await page.evaluate(() => {
    const state = window as typeof window & { __reviewDisclosureWrites?: number };
    state.__reviewDisclosureWrites = 0;
    const count = () => { state.__reviewDisclosureWrites = (state.__reviewDisclosureWrites ?? 0) + 1; };
    const originalPut = IDBObjectStore.prototype.put;
    const originalAdd = IDBObjectStore.prototype.add;
    const originalDelete = IDBObjectStore.prototype.delete;
    const originalClear = IDBObjectStore.prototype.clear;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalStorageClear = Storage.prototype.clear;
    IDBObjectStore.prototype.put = function put(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    IDBObjectStore.prototype.add = function add(value: unknown, key?: IDBValidKey) { count(); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key); };
    IDBObjectStore.prototype.delete = function deleteRecord(query: IDBValidKey | IDBKeyRange) { count(); return originalDelete.call(this, query); };
    IDBObjectStore.prototype.clear = function clear() { count(); return originalClear.call(this); };
    Storage.prototype.setItem = function setItem(key: string, value: string) { count(); return originalSetItem.call(this, key, value); };
    Storage.prototype.removeItem = function removeItem(key: string) { count(); return originalRemoveItem.call(this, key); };
    Storage.prototype.clear = function clear() { count(); return originalStorageClear.call(this); };
    return {
      hash: window.location.hash,
      localStorage: Object.fromEntries(Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))),
      sessionStorage: Object.fromEntries(Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right))),
    };
  });
  const impactSummary = impactPlan.locator(':scope > summary');
  await impactSummary.focus();
  await impactSummary.press('Enter');
  await expect(impactPlan).toHaveAttribute('open', '');
  const impactCounts = await impactPlan.evaluate((plan) => ({
    total: Number(plan.getAttribute('data-total')),
    displayed: Number(plan.getAttribute('data-displayed-count')),
    omitted: Number(plan.getAttribute('data-omitted-count')),
    rendered: plan.querySelectorAll('.impacts > li').length,
  }));
  expect(impactCounts.total).toBe(impactCounts.displayed + impactCounts.omitted);
  expect(impactCounts.displayed).toBe(impactCounts.rendered);
  const factBackedImpacts = impactPlan.locator('.impacts > li[data-basis="decision_fact"]');
  const localImpacts = impactPlan.locator('.impacts > li[data-mode="local_review"]');
  const networkImpacts = impactPlan.locator('.impacts > li[data-mode="network_collection"]');
  expect(await factBackedImpacts.count()).toBeGreaterThan(0);
  expect(await localImpacts.count()).toBeGreaterThan(0);
  expect(await networkImpacts.count()).toBeGreaterThan(0);
  const tlsImpact = impactPlan.locator('[data-fact-id="lookup-evidence:tls"]');
  const pageIdentityImpact = impactPlan.locator('[data-fact-id="lookup-evidence:page-identity"]');
  await expect(tlsImpact).toHaveAttribute('data-evidence-state', 'unknown');
  await expect(tlsImpact).toHaveAttribute('data-freshness', 'current');
  await expect(tlsImpact.locator('.fact-id')).toContainText('lookup-evidence:tls');
  await expect(tlsImpact.locator('[data-provenance="direct_observation"]')).toContainText('Direct observation');
  await expect(tlsImpact.locator('[data-freshness="current"]')).toHaveAttribute('data-tone', 'neutral');
  await expect(pageIdentityImpact).toHaveAttribute('data-evidence-state', 'unknown');
  await expect(pageIdentityImpact).toHaveAttribute('data-freshness', 'stale');
  const localImpact = localImpacts.first();
  await expect(localImpact).toHaveAttribute('data-basis', 'task_context');
  await expect(localImpact).toHaveAttribute('data-fact-id', '');
  await expect(localImpact.locator('.context-note')).toContainText('No Decision Fact or collected-evidence provenance');
  await expect(localImpact.locator('[data-provenance]')).toHaveCount(0);
  await expect(localImpact.locator('.limitation')).toContainText('No reviewed Brand Profile is active');
  await expect(localImpact).toContainText('does not start a network request');
  expect(await impactPlan.locator('.impacts a').evaluateAll((links) => links.every((link) => (
    /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u.test(link.getAttribute('href') ?? '')
  )))).toBe(true);
  expect(await page.evaluate(() => ({
    hash: window.location.hash,
    localStorage: Object.fromEntries(Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right))),
    writes: (window as typeof window & { __reviewDisclosureWrites?: number }).__reviewDisclosureWrites ?? 0,
  }))).toEqual({ ...impactStateBefore, writes: 0 });
  expect(lookupRequests).toHaveLength(1);

  await taskQuestion.selectOption('general');
  expect(lookupRequests).toHaveLength(1);
  const decisionSupport = detailedAssessment.locator('.decision-support');
  await expect(decisionSupport.getByRole('heading', { name: 'General investigation' })).toBeVisible();
  const presentationStateBefore = await page.evaluate(() => ({
    hash: window.location.hash,
    localStorage: Object.fromEntries(Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right))),
  }));
  await expect(decisionSupport.getByRole('button', { name: 'Copy current brief' })).toBeVisible();
  await expect(decisionSupport.locator('[data-review-group-summary="disagreements"]')).toHaveText('1 disagreement');
  await expect(decisionSupport.locator('[data-review-group-summary="unresolved"]')).toHaveText('1 unresolved comparison');
  const decisionRecords = decisionSupport.locator('details.decision-records');
  const decisionSummary = decisionRecords.locator(':scope > summary');
  await decisionSummary.focus();
  await decisionSummary.press('Enter');
  await expect(decisionRecords).toHaveAttribute('open', '');
  await decisionSummary.press('Space');
  await expect(decisionRecords).not.toHaveAttribute('open', '');
  await decisionSummary.press('Enter');
  await expect(decisionRecords).toHaveAttribute('open', '');

  const expectedDecisionGroups = [{
    id: 'disagreements',
    consistency: 'contradictory',
    factIds: ['lookup-decision:registry-whois-domain'],
  }, {
    id: 'unresolved',
    consistency: 'unknown',
    factIds: ['lookup-decision:certificate-policy-caa'],
  }] as const;
  for (const expectedGroup of expectedDecisionGroups) {
    const reviewGroup = decisionSupport.locator(`[data-review-group="${expectedGroup.id}"]`);
    await expect(reviewGroup).toHaveCount(1);
    await expect(reviewGroup).toHaveAttribute('data-consistency', expectedGroup.consistency);
    await expect(reviewGroup).toHaveAttribute('data-total', String(expectedGroup.factIds.length));
    await expect(reviewGroup).toHaveAttribute('data-displayed-count', String(expectedGroup.factIds.length));
    await expect(reviewGroup).toHaveAttribute('data-omitted-count', '0');
    await expect(reviewGroup).toHaveAttribute('data-contributing-fact-ids', expectedGroup.factIds.join(','));
    expect(await reviewGroup.locator('.decision-entry').evaluateAll((entries) => (
      entries.map((entry) => entry.getAttribute('data-fact-id'))
    ))).toEqual(expectedGroup.factIds);
  }

  const disagreement = decisionSupport.locator('[data-review-group="disagreements"] .decision-entry');
  const unresolved = decisionSupport.locator('[data-review-group="unresolved"] .decision-entry');
  await expect(disagreement.locator('.consistency[data-consistency="contradictory"]')).toContainText('Contradictory');
  await expect(disagreement.locator('.consistency')).toHaveAttribute('data-tone', 'conflict');
  await expect(disagreement.locator('.consistency')).toHaveAttribute('aria-label', /Source ordering does not decide/iu);
  await expect(unresolved.locator('.consistency[data-consistency="unknown"]')).toContainText('Consistency unknown');
  await expect(unresolved.locator('.consistency')).toHaveAttribute('data-tone', 'caution');
  await expect(disagreement.locator('.fact-state [data-evidence-state="observed"]')).toContainText('Observed');
  await expect(disagreement.locator('.fact-state [data-freshness="current"]')).toContainText('Current');
  await expect(unresolved.locator('.fact-state [data-evidence-state="partial"]')).toContainText('Partial');
  await expect(unresolved.locator('.fact-state [data-freshness="current"]')).toContainText('Current');
  const presentationIcons = decisionSupport.locator('.presentation-icon');
  expect(await presentationIcons.count()).toBeGreaterThan(0);
  expect(await presentationIcons.evaluateAll((icons) => (
    icons.every((icon) => icon.getAttribute('aria-hidden') === 'true')
  ))).toBe(true);

  const registryContributor = disagreement.locator('[data-contributor-id="evidence:rdap"]');
  const whoisContributor = disagreement.locator('[data-contributor-id="evidence:whois"]');
  for (const contributor of [registryContributor, whoisContributor]) {
    await expect(contributor).toHaveCount(1);
    await expect(contributor).toHaveAttribute('data-provenance', 'provider_reported');
  }
  const dnsContributor = unresolved.locator('[data-contributor-id="evidence:dns"]');
  const tlsContributor = unresolved.locator('[data-contributor-id="evidence:tls"]');
  await expect(dnsContributor).toHaveAttribute('data-provenance', 'direct_observation');
  await expect(tlsContributor).toHaveAttribute('data-provenance', 'direct_observation');
  await expect(registryContributor).toContainText('Provider reported');
  await expect(registryContributor).toContainText('Observed');
  await expect(dnsContributor).toContainText('Direct observation');
  await expect(dnsContributor).toContainText('Partial');
  await expect(tlsContributor).toContainText('Direct observation');
  await expect(tlsContributor).toContainText('Unknown');
  await expect(disagreement.getByRole('region', { name: /Contradictions for/ })).toContainText('differs between registration sources');
  await expect(unresolved.getByRole('region', { name: 'Limitations from DNS' })).toContainText('DNS collection is incomplete');

  const reviewLinks = decisionSupport.locator('a.fact-action, a.evidence-link');
  expect(await reviewLinks.count()).toBeGreaterThan(0);
  expect(await reviewLinks.evaluateAll((links) => links.every((link) => (
    /^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u.test(link.getAttribute('href') ?? '')
  )))).toBe(true);
  expect(lookupRequests).toHaveLength(1);
  expect(await page.evaluate(() => ({
    hash: window.location.hash,
    localStorage: Object.fromEntries(Object.entries(localStorage).sort(([left], [right]) => left.localeCompare(right))),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage).sort(([left], [right]) => left.localeCompare(right))),
  }))).toEqual(presentationStateBefore);

  await taskQuestion.selectOption('acquisition');
  await expect(taskQuestion).toHaveValue('acquisition');
  const acquisitionReview = page.locator('details.acquisition');
  await expect(acquisitionReview).toContainText('Acquisition due diligence');
  await expect(acquisitionReview).not.toHaveAttribute('open', '');
  await acquisitionReview.locator(':scope > summary').click();
  await expect(acquisitionReview).toContainText('Registration observed');
  await expect(acquisitionReview).toContainText('Transfer or update constraints observed');
  await expect(acquisitionReview).toContainText(/published escalation route/iu);
  await expect(acquisitionReview).toContainText('does not value a domain');
  const acquisitionDecision = acquisitionReview.getByRole('region', { name: 'Analyst decision workspace' });
  await acquisitionDecision.getByLabel('Current decision').selectOption('continue_manual_review');
  await acquisitionDecision.getByLabel('Registry eligibility and current availability checked').check();
  await acquisitionDecision.getByLabel('Rationale or unresolved questions').fill('Continue manual checks with the current evidence limitations.');
  const acquisitionDownload = page.waitForEvent('download');
  await acquisitionDecision.getByRole('button', { name: 'Download acquisition review' }).click();
  await expect((await acquisitionDownload).suggestedFilename()).toMatch(/^whoisleuth-acquisition-review-.+\.json$/u);
  await expect(acquisitionDecision.getByRole('status')).toContainText('draft acquisition review');

  const coverage = page.getByRole('region', { name: 'Evidence coverage' });
  await expect(coverage).toBeVisible();
  const coverageSummary = coverage.getByRole('group', { name: 'Evidence coverage summary' });
  const recordsDisclosure = coverage.locator('details.records-disclosure');
  await expect(recordsDisclosure).not.toHaveAttribute('open', '');
  await recordsDisclosure.locator(':scope > summary').click();
  await expect(recordsDisclosure).toHaveAttribute('open', '');
  await expect(coverage).toContainText('Registry RDAP');
  await expect(coverage).toContainText('WHOIS');
  await expect(coverage).toContainText('DNS');
  await expect(coverage).toContainText('Missing, failed, stale, unsupported, and not-found evidence remains distinct');
  const sourceQualityTable = coverage.getByRole('table', { name: 'Source quality and freshness' });
  await expect(sourceQualityTable).toHaveAttribute('aria-colcount', '5');
  await expect(sourceQualityTable.getByRole('row').first().getByRole('columnheader')).toHaveCount(5);
  const qualityRows = sourceQualityTable.locator('.quality-record');
  const qualityRowCount = await qualityRows.count();
  expect(qualityRowCount).toBeGreaterThan(0);
  await expect(sourceQualityTable).toHaveAttribute('data-displayed-row-count', String(qualityRowCount));
  await expect(sourceQualityTable).toHaveAttribute('data-canonical-fact-count', String(qualityRowCount));
  const canonicalStateLabels = qualityRows.locator('.state[data-evidence-state]');
  await expect(canonicalStateLabels).toHaveCount(qualityRowCount);
  const completeRows = await sourceQualityTable.locator('.quality-record[data-counts-as-complete="true"]').count();
  const limitedRows = await sourceQualityTable.locator('.quality-record[data-counts-as-limited="true"]').count();
  expect(completeRows).toBeGreaterThan(0);
  expect(limitedRows).toBeGreaterThan(0);
  await expect(coverageSummary.locator('[data-summary="complete"] strong')).toHaveText(String(completeRows));
  await expect(coverageSummary.locator('[data-summary="limited"] strong')).toHaveText(String(limitedRows));

  const rdapQualityRow = sourceQualityTable.locator('.quality-record[data-evidence-id="rdap"]');
  const dnsQualityRow = sourceQualityTable.locator('.quality-record[data-evidence-id="dns"]');
  const httpQualityRow = sourceQualityTable.locator('.quality-record[data-evidence-id="http"]');
  const availabilityQualityRow = sourceQualityTable.locator('.quality-record[data-evidence-id="availability"]');
  for (const row of [rdapQualityRow, dnsQualityRow, httpQualityRow, availabilityQualityRow]) {
    await expect(row).toHaveCount(1);
  }
  await expect(rdapQualityRow.locator('.state[data-evidence-state="observed"]')).toContainText('Observed');
  await expect(dnsQualityRow.locator('.state[data-evidence-state="partial"]')).toContainText('Partial');
  await expect(rdapQualityRow.locator('[data-provenance="provider_reported"]')).toContainText('Provider reported');
  await expect(dnsQualityRow.locator('[data-provenance="direct_observation"]')).toContainText('Direct observation');
  await expect(availabilityQualityRow.locator('[data-provenance="derived"]')).toContainText('Derived');
  const currentFreshness = rdapQualityRow.locator('.observed > .freshness[data-freshness="current"]');
  const staleFreshness = httpQualityRow.locator('.observed > .freshness[data-freshness="stale"]');
  await expect(currentFreshness).toContainText('Current');
  await expect(staleFreshness).toContainText('Stale');
  const freshnessPlacement = await rdapQualityRow.locator('.observed').evaluate((cell) => {
    const observed = cell.querySelector<HTMLElement>(':scope > span:first-child')!;
    const freshness = cell.querySelector<HTMLElement>(':scope > .freshness')!;
    return {
      observedBottom: observed.getBoundingClientRect().bottom,
      freshnessTop: freshness.getBoundingClientRect().top,
    };
  });
  expect(freshnessPlacement.freshnessTop).toBeGreaterThanOrEqual(freshnessPlacement.observedBottom);
  const neutralPresentation = await rdapQualityRow.evaluate((row) => {
    const reference = row.querySelector<HTMLElement>('.source strong')!;
    const state = row.querySelector<HTMLElement>('.state[data-evidence-state="observed"]')!;
    const freshness = row.querySelector<HTMLElement>('.freshness[data-freshness="current"]')!;
    return {
      reference: getComputedStyle(reference).color,
      state: getComputedStyle(state).color,
      stateTone: state.dataset.tone,
      freshness: getComputedStyle(freshness).color,
      freshnessTone: freshness.dataset.tone,
    };
  });
  expect(neutralPresentation).toEqual({
    reference: neutralPresentation.reference,
    state: neutralPresentation.reference,
    stateTone: 'neutral',
    freshness: neutralPresentation.reference,
    freshnessTone: 'neutral',
  });
  await expect(rdapQualityRow.locator('.state .presentation-icon')).toHaveAttribute('aria-hidden', 'true');
  await expect(currentFreshness.locator('.presentation-icon')).toHaveAttribute('aria-hidden', 'true');

  const limitationCell = sourceQualityTable.getByRole('cell', { name: 'Limitations for Reverse DNS' });
  await expect(limitationCell).toHaveAttribute('aria-colspan', '5');
  await expect(limitationCell).toContainText('PTR context does not prove hosting control.');
  const reverseDnsLimitations = limitationCell.locator('section[aria-label="Limitations from Reverse DNS"]');
  await expect(reverseDnsLimitations).toHaveCount(1);
  await expect(reverseDnsLimitations).toContainText('Reverse DNS');
  await expect(reverseDnsLimitations).toContainText('PTR context does not prove hosting control.');

  const freshnessDisclosure = coverage.locator('details.freshness-policy');
  await expect(freshnessDisclosure).not.toHaveAttribute('open', '');
  await freshnessDisclosure.locator(':scope > summary').click();
  await expect(freshnessDisclosure).toHaveAttribute('open', '');
  await coverage.getByRole('combobox', { name: 'Policy', exact: true }).selectOption('analyst-custom');
  await coverage.getByLabel('Registration days').fill('10');
  await coverage.getByLabel('Registration days').blur();
  await expect(coverage).toContainText('Freshness policy · analyst-defined');
  await expect(coverage).toContainText('Thresholds organise source-refresh suggestions');

  await page.getByRole('button', { name: 'Collapse Source quality evidence' }).click();
  await page.getByRole('button', { name: 'Expand Source quality evidence' }).click();
  await recordsDisclosure.locator(':scope > summary').click();
  await freshnessDisclosure.locator(':scope > summary').click();
  await expect(coverage.getByRole('combobox', { name: 'Policy', exact: true })).toHaveValue('analyst-custom');
  await expect(coverage.getByLabel('Registration days')).toHaveValue('10');

  const registrationFact = page.locator('.summaries article').filter({ hasText: 'Registration' }).first();
  await registrationFact.getByText('Inspect evidence').click();
  await expect(registrationFact).toContainText('Registry RDAP');
  await expect(registrationFact).toContainText('Authority-aware registration evidence');
  await expect(registrationFact).toContainText('does not recalculate or override');

  const rdapDiagnostic = page.locator('.diagnostics article').filter({ hasText: 'rdap' }).first();
  const diagnosticArticles = page.locator('.diagnostics article');
  const diagnosticStates = page.locator('.diagnostics article > strong');
  expect(await diagnosticArticles.count()).toBeGreaterThan(0);
  expect(await diagnosticStates.count()).toBe(await diagnosticArticles.count());
  expect(await diagnosticStates.evaluateAll((states) => {
    const reference = document.querySelector<HTMLElement>('.summaries article strong');
    if (!reference) return false;
    const referenceColour = getComputedStyle(reference).color;
    return states.every((state) => getComputedStyle(state).color === referenceColour);
  })).toBe(true);
  await rdapDiagnostic.getByText('Inspect source route').click();
  await expect(rdapDiagnostic).toContainText('IANA RDAP bootstrap discovery');
  await expect(rdapDiagnostic).toContainText('Selected endpoint');

  // Detailed registry and raw unified records stay collapsed and subordinate.
  await expect(page.locator('.sources > details').first()).not.toHaveAttribute('open', '');
  await expect(page.locator('details.raw')).not.toHaveAttribute('open', '');

  // Keyboard operation: activating an anchor link moves to the section.
  const registryLink = localNav.getByRole('link', { name: 'Registration' });
  await registryLink.focus();
  await registryLink.press('Enter');
  await expect(page).toHaveURL(/#registry$/);
  await expect(page.locator('#registry')).toBeInViewport();
  await expect(registryLink).toHaveAttribute('aria-current', 'location');

  // The DNS status stays visible while its detailed warning is disclosed on demand.
  const dnsCard = page.getByLabel('DNS evidence');
  await expect(dnsCard.locator(':scope > summary .evidence-status')).toHaveText('partial');
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeHidden();
  await dnsCard.locator(':scope > summary').click();
  await expect(page.getByText(/A resolver failure is not evidence that a record is absent/)).toBeVisible();

  const httpCard = page.locator('.http-card');
  await httpCard.locator(':scope > summary').click();
  const redirectDisclosure = httpCard.getByText('Redirect chain · 1 hop');
  await redirectDisclosure.click();
  await expect(httpCard.getByRole('img', { name: 'HTTP redirect path with 1 hop' })).toBeVisible();
  const dependencyReview = page.locator('details.dependency-review');
  await dependencyReview.locator(':scope > summary').click();
  await expect(dependencyReview.getByText('within domain', { exact: true }).first()).toBeVisible();

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 700, height: 900 },
    { width: 430, height: 932 },
    { width: 393, height: 852 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page);
    const decisionGeometry = await decisionSupport.evaluate((section) => ({
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
      entriesContained: [...section.querySelectorAll<HTMLElement>('.decision-entry')].every((entry) => {
        const entryBox = entry.getBoundingClientRect();
        const sectionBox = section.getBoundingClientRect();
        return entryBox.left >= sectionBox.left - 1 && entryBox.right <= sectionBox.right + 1;
      }),
    }));
    expect(decisionGeometry.scrollWidth).toBeLessThanOrEqual(decisionGeometry.clientWidth + 1);
    expect(decisionGeometry.entriesContained).toBe(true);
    const reviewActionGeometry = await atAGlance.evaluate((section) => ({
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
      actionsContained: [...section.querySelectorAll<HTMLElement>('.next-action')].every((action) => {
        const actionBox = action.getBoundingClientRect();
        const sectionBox = section.getBoundingClientRect();
        return actionBox.left >= sectionBox.left - 1 && actionBox.right <= sectionBox.right + 1;
      }),
    }));
    expect(reviewActionGeometry.scrollWidth).toBeLessThanOrEqual(reviewActionGeometry.clientWidth + 1);
    expect(reviewActionGeometry.actionsContained).toBe(true);
    const readinessGeometry = await detailedAssessment.locator('.claim-readiness').evaluate((section) => ({
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
    }));
    expect(readinessGeometry.scrollWidth).toBeLessThanOrEqual(readinessGeometry.clientWidth + 1);

    const redirectPath = httpCard.locator('.redirect-path');
    if (size.width <= 720) {
      const mobileRedirects = redirectPath.getByRole('list', { name: 'HTTP redirect steps' });
      await expect(mobileRedirects).toBeVisible();
      await expect(mobileRedirects.getByRole('listitem')).toHaveCount(1);
      await expect(mobileRedirects).toContainText('HTTP 301');
      await expect(mobileRedirects).toContainText('https://sectioned-result.invalid/');
      await expect(mobileRedirects).toContainText('https://www.sectioned-result.invalid/home');
      await expect(mobileRedirects).toContainText('Query omitted from retained provenance');
      const desktopRedirects = httpCard.locator('.disclosure > ol');
      await expect(desktopRedirects).toHaveCount(1);
      await expect(desktopRedirects).toBeHidden();
      const redirectWidth = await redirectPath.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
      }));
      expect(redirectWidth.scroll).toBeLessThanOrEqual(redirectWidth.client);
    }

    await page.getByRole('tab', { name: /^Evidence/ }).click();
    const topologyGraphic = topology.getByRole('img', {
      name: 'Where this result came from visual overview',
      includeHidden: true,
    });
    if (size.width > 700) {
      await expect(topologyGraphic).toBeVisible();
      const graphicBox = await boundingBox(topologyGraphic);
      const panelBox = await boundingBox(topology);
      expect(graphicBox.width).toBeGreaterThan(Math.min(520, panelBox.width * 0.72));
      expect(graphicBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphicBox.height).toBeGreaterThan(150);
      expect(graphicBox.height).toBeLessThan(560);
    } else {
      await expect(topologyGraphic).toHaveCount(1);
      await expect(topologyGraphic).toBeHidden();
      await expect(topology.locator('.mobile-target')).toBeVisible();
    }

    await page.getByRole('tab', { name: /^Relationships/ }).click();
    const relationshipMap = page.locator('.asset-graph .relationship-map');
    await expect(relationshipMap).toHaveCount(1);
    const mapFrame = relationshipMap.locator('.map-frame');
    const mobileMap = relationshipMap.locator('.map-mobile');
    const mapFrameVisible = await mapFrame.isVisible();
    const mobileMapVisible = await mobileMap.isVisible();
    expect(Number(mapFrameVisible) + Number(mobileMapVisible)).toBe(1);
    if (size.width === 1920 || size.width === 1440) expect(mapFrameVisible).toBe(true);
    if (size.width === 320) expect(mobileMapVisible).toBe(true);
    if (mapFrameVisible) {
      const graphBox = await boundingBox(mapFrame);
      const panelBox = await boundingBox(relationshipMap);
      expect(graphBox.width).toBeGreaterThan(Math.min(500, panelBox.width * 0.7));
      expect(graphBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphBox.height).toBeGreaterThan(180);
      expect(graphBox.height).toBeLessThan(700);
      expect(await mapFrame.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await mapFrame.evaluate((element) => getComputedStyle(element).touchAction)).toContain('pinch-zoom');
      if (size.width === 1440) {
        await mapFrame.scrollIntoViewIfNeeded();
        const wheelTarget = await boundingBox(mapFrame);
        const before = await page.evaluate(() => ({
          y: window.scrollY,
          maximum: document.documentElement.scrollHeight - window.innerHeight,
        }));
        const wheelDelta = before.y < before.maximum - 320 ? 320 : -320;
        await page.mouse.move(
          wheelTarget.x + wheelTarget.width / 2,
          wheelTarget.y + Math.min(wheelTarget.height / 2, 180),
        );
        await page.mouse.wheel(0, wheelDelta);
        if (wheelDelta > 0) {
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before.y);
        } else {
          await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before.y);
        }
      }
    } else {
      expect(await mobileMap.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }

    await page.getByRole('tab', { name: /^Timeline/ }).click();
    const lifecycleGraphic = lifecycle.getByRole('img', {
      name: 'Chronological lookup lifecycle overview',
      includeHidden: true,
    });
    if (size.width > 620) {
      await expect(lifecycleGraphic).toBeVisible();
      const graphicBox = await boundingBox(lifecycleGraphic);
      const panelBox = await boundingBox(lifecycle);
      expect(graphicBox.width).toBeGreaterThan(Math.min(500, panelBox.width * 0.7));
      expect(graphicBox.width).toBeLessThanOrEqual(panelBox.width + 1);
      expect(graphicBox.height).toBeGreaterThan(130);
      expect(graphicBox.height).toBeLessThan(520);
    } else {
      await expect(lifecycleGraphic).toHaveCount(1);
      await expect(lifecycleGraphic).toBeHidden();
      await expect(lifecycle.locator('ol[aria-label="Lookup lifecycle events"]')).toBeVisible();
    }
  }

  // The desktop source graph becomes a connected, full-width source map on
  // narrow screens instead of shrinking every label into the wide SVG.
  await page.getByRole('tab', { name: /^Evidence/ }).click();
  const mobileTopologyGraphic = topology.getByRole('img', {
    name: 'Where this result came from visual overview',
    includeHidden: true,
  });
  await expect(mobileTopologyGraphic).toHaveCount(1);
  await expect(mobileTopologyGraphic).toBeHidden();
  await expect(topology.locator('.mobile-target')).toBeVisible();
  await expect(sourceRail.locator('.source-copy small').first()).toBeVisible();
  const mobileSourceIcons = sourceRail.locator('.source-glyph .source-icon');
  await expect(mobileSourceIcons.first()).toBeVisible();
  expect(await mobileSourceIcons.evaluateAll((icons) => icons.every((icon) => {
    const iconRect = icon.getBoundingClientRect();
    const holderRect = icon.closest('.source-glyph')?.getBoundingClientRect();
    return Boolean(
      holderRect
      && iconRect.width > 0
      && iconRect.width <= 20
      && iconRect.height > 0
      && iconRect.height <= 20
      && iconRect.left >= holderRect.left - 0.5
      && iconRect.right <= holderRect.right + 0.5
      && iconRect.top >= holderRect.top - 0.5
      && iconRect.bottom <= holderRect.bottom + 0.5
    );
  }))).toBe(true);
  expect(await sourceRail.locator('li').evaluateAll((items) => items.every((item) => {
    const listRect = item.parentElement?.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Boolean(
      listRect
      && itemRect.width >= 180
      && itemRect.height >= 58
      && itemRect.left >= listRect.left - 0.5
      && itemRect.right <= listRect.right + 0.5
    );
  }))).toBe(true);

  // The wide chronological plot becomes a connected vertical timeline on
  // narrow screens rather than requiring a nested horizontal scrollbar.
  await page.getByRole('tab', { name: /^Timeline/ }).click();
  const mobileLifecycleGraphic = lifecycle.getByRole('img', {
    name: 'Chronological lookup lifecycle overview',
    includeHidden: true,
  });
  await expect(mobileLifecycleGraphic).toHaveCount(1);
  await expect(mobileLifecycleGraphic).toBeHidden();
  const mobileTimeline = lifecycle.locator('ol[aria-label="Lookup lifecycle events"]');
  await expect(mobileTimeline).toBeVisible();
  expect(await mobileTimeline.locator('li').evaluateAll((items) => items.every((item) => {
    const listRect = item.parentElement?.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    return Boolean(listRect && itemRect.left >= listRect.left - 0.5 && itemRect.right <= listRect.right + 0.5);
  }))).toBe(true);

  // Mobile uses one compact native section picker instead of a horizontally
  // scrolling trace strip. The chosen destination clears the sticky toolbar.
  await expect(localNav).toHaveCount(1);
  await expect(localNav).toBeHidden();
  const sectionPicker = page.getByLabel('Jump to section');
  await expect(sectionPicker).toBeVisible();
  await sectionPicker.selectOption('#advanced-evidence');
  await expect(page).toHaveURL(/#advanced-evidence$/);
  await expect.poll(async () => page.locator('#advanced-evidence').evaluate((section) => {
    const sectionTop = section.getBoundingClientRect().top;
    const navigation = document.querySelector('.local-nav-shell');
    return navigation ? sectionTop >= navigation.getBoundingClientRect().bottom + 4 : false;
  })).toBe(true);
  await expect(sectionPicker).toHaveValue('#advanced-evidence');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.export-menu > summary').click();
  await page.getByRole('button', { name: 'Export evidence JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^whoisleuth-evidence-sectioned-result\.invalid-.+\.json$/);
});
