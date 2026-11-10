import { getStore } from '@netlify/blobs';
import { HOSTED_SOURCE_IDS } from '../../packages/contracts/retained-source-edition.mts';
import { runSourceEditionCycle } from '../../lib/retained-source-channel.mts';
import { assessAutomaticSourceEdition, readAutomaticPublisher } from '../../lib/retained-source-refresh.mts';
import { retainedSourceStoreFactory, retainedSourcesEnabled } from '../../lib/retained-source-netlify.mts';

export const config = { schedule: '17 3 * * *' };
type DeployContext = { deploy?: { context?: unknown } };
const openRetainedSourceStore = retainedSourceStoreFactory(getStore);

export async function runRetainedSourceRefresh(context?: DeployContext, {
  enabled = process.env.RETAINED_SOURCE_EDITIONS,
  openStore = openRetainedSourceStore,
  readPublisher = readAutomaticPublisher,
  now = new Date(),
} = {}) {
  if (!retainedSourcesEnabled(context, enabled)) return [];
  // Stay inside the host's scheduled invocation budget even if storage or
  // one publisher is unavailable. The only parallel lanes are fixed sources.
  const signal = AbortSignal.timeout(20_000);
  try {
    const store = openStore(signal);
    return await Promise.all(HOSTED_SOURCE_IDS.map(source => runSourceEditionCycle({
      source, store, now, signal,
      async observe(id, current) {
        const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
        const text = await readPublisher(id, downloadSignal);
        return assessAutomaticSourceEdition(id, text, current, now);
      },
    })));
  } catch {
    return HOSTED_SOURCE_IDS.map(source => ({ source, status: 'unavailable' as const }));
  }
}

export default async function retainedSourceRefresh(_request: Request, context?: DeployContext) {
  for (const cycle of await runRetainedSourceRefresh(context)) {
    console.info(JSON.stringify({ ...cycle, checkedAt: new Date().toISOString() }));
  }
}
