import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDomainFeedReview } from '../packages/monitoring/domain-feed.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import type { RunInstalledCli } from './installed-cli-check.mts';

/** Exercise actual compiled command dispatch, raw digest and the existing portable handoff. */
export async function checkInstalledDomainFeed(temporaryRoot: string, run: RunInstalledCli): Promise<void> {
  const source = path.join(temporaryRoot, 'selected-domain-feed.txt'), context = path.join(temporaryRoot, 'feed-watch-context.json'), selected = path.join(temporaryRoot, 'feed-watch-input.json');
  const raw = '# Last modified: 03 Oct 2026 07:50 UTC\r\n# Version: fixture-1\r\nexact.example\r\nsub.exact.example\r\nbrand-candidate.example';
  await writeFile(source, raw, { mode: 0o600, flag: 'wx' });
  const selectors = ['--select', 'host:exact.example', '--select', 'term:brand'];
  const output = await run(['domain-feed', 'review', 'tif-mini', source, ...selectors, '--json'], 'offline domain-feed streaming review');
  const review = normalizeDomainFeedReview(JSON.parse(output));
  if (!review || review.revision !== `sha256:${createHash('sha256').update(raw).digest('hex')}` || review.rows !== 3
    || review.matches.map(match => match.domain).join(',') !== 'exact.example,brand-candidate.example'
    || review.declaredPublishedAt !== '2026-10-03T07:50:00.000Z' || review.matches.some(match => match.candidate.sources.some(source => source.sourceFirstObservedAt !== null || source.sourceLastObservedAt !== null)))
    throw new TypeError('Installed domain-feed review lost exact matching, raw identity or clock attribution.');
  if (output.includes(temporaryRoot) || output.includes(source)) throw new TypeError('Installed domain-feed review retained a private source path.');
  await writeFile(context, JSON.stringify({ schema: 'whoisleuth.candidate-watch-input', version: 1, watchlists: null,
    selection: { name: 'Feed review', candidates: [], brandProfileId: 'review-profile', priority: 'p3', reason: 'Review the explicit local feed selection.' } }), { mode: 0o600, flag: 'wx' });
  const handoff = await run(['domain-feed', 'watch-input', 'tif-mini', source, context, ...selectors, '--json'], 'offline domain-feed watch-input projection');
  await writeFile(selected, handoff, { mode: 0o600, flag: 'wx' });
  const plan = record(JSON.parse(await run(['watchlist-review', 'plan', selected, '--json'], 'offline domain-feed handoff plan')), 'Installed feed handoff plan');
  if (plan.additionalRequests !== 0 || plan.collectionAuthorised !== false || !Array.isArray(plan.rows) || plan.rows.length !== 2)
    throw new TypeError('Installed domain-feed handoff acquired collection authority or lost exact membership.');
  const exported = record(JSON.parse(await run(['watchlist-review', 'export', selected, '--json'], 'offline domain-feed portable watch export')), 'Installed feed export');
  const list = record(record(exported.watchlists, 'Exported feed watchlists')['Feed review'], 'Exported feed watchlist');
  if (!Array.isArray(list.results) || list.results.length || !Array.isArray(list.baseline) || list.baseline.length
    || !Array.isArray(list.domainMetadata) || list.domainMetadata.length !== 2)
    throw new TypeError('Installed domain-feed export invented a scan, baseline or candidate membership.');
  await run(['domain-feed', 'review', 'tif-mini', 'https://example.test/feed', ...selectors, '--json'], 'offline domain-feed URL refusal', 2, /explicit local regular file/u);
}
