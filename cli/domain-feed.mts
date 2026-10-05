import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { DOMAIN_FEED_LIMITS, normalizeDomainFeedSelection, type DomainFeedSelection } from '../packages/monitoring/domain-feed.mts';
import { CliUsageError } from './errors.mts';

export function parseDomainFeedSelectors(values: readonly string[]): DomainFeedSelection {
  const hosts: string[] = [], terms: string[] = [], negativeTerms: string[] = [];
  for (const value of values) {
    if (value.startsWith('host:')) hosts.push(value.slice(5));
    else if (value.startsWith('term:')) terms.push(value.slice(5));
    else if (value.startsWith('exclude:')) negativeTerms.push(value.slice(8));
    else throw new CliUsageError('--select requires host:<plain-hostname>, term:<literal-text> or exclude:<literal-text>.');
  }
  const selection = normalizeDomainFeedSelection({ hosts, terms, ...(negativeTerms.length ? { negativeTerms } : {}) });
  if (!selection.hosts.length && !selection.terms.length) throw new CliUsageError('Select at least one exact host or literal term.');
  return selection;
}

/** Stream one descriptor-bound local regular file; URLs, pipes and symlinks are not inputs. */
export async function* readDomainFeedFile(source: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (!source || /^[a-z][a-z0-9+.-]*:\/\//iu.test(source)) throw new CliUsageError('Domain feed review requires an explicit local regular file, not a URL.');
  if (signal?.aborted) throw new DOMException('Feed reading was cancelled.', 'AbortError');
  const handle = await open(source, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  let stream: ReturnType<typeof handle.createReadStream> | undefined;
  const abort = () => stream?.destroy(new DOMException('Feed reading was cancelled.', 'AbortError'));
  try {
    if (signal?.aborted) throw new DOMException('Feed reading was cancelled.', 'AbortError');
    const before = await handle.stat();
    if (!before.isFile()) throw new CliUsageError('The domain feed must be a regular file.');
    if (before.size > DOMAIN_FEED_LIMITS.bytes) throw new CliUsageError('The domain feed exceeds its 256 MiB raw-byte ceiling.');
    stream = handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let bytes = 0;
    for await (const chunk of stream) {
      if (signal?.aborted) throw new DOMException('Feed reading was cancelled.', 'AbortError');
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > DOMAIN_FEED_LIMITS.bytes - bytes)
        throw new CliUsageError('The domain feed exceeds its raw-byte ceiling.');
      bytes += chunk.byteLength; yield chunk;
    }
    const after = await handle.stat();
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new CliUsageError('The domain feed changed while it was being read; no review was produced.');
  } finally {
    signal?.removeEventListener('abort', abort);
    stream?.destroy();
    await handle.close();
  }
}
