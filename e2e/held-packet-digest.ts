import type { Page } from '@playwright/test';

/** Hold the raw-file digest after full packet validation, with an explicit
 * handshake so disposal tests do not race the digest's actual start. */
export async function holdPacketFileDigest(page: Page, fail = false) {
  await page.evaluate(shouldFail => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const scope = window as unknown as { packetDigestHeld: boolean; releasePacketDigest: () => Promise<void> };
    scope.packetDigestHeld = false;
    let release!: () => void, finished!: () => void;
    const held = new Promise<void>(resolve => release = resolve), completed = new Promise<void>(resolve => finished = resolve);
    scope.releasePacketDigest = async () => {
      release(); await completed;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    };
    crypto.subtle.digest = async (algorithm, data) => {
      const text = new TextDecoder().decode(data as ArrayBuffer);
      if (text.includes('"schema":"whoisleuth.case-response-packet"') && text.includes('"integrity":')) {
        crypto.subtle.digest = original;
        scope.packetDigestHeld = true;
        await held;
        try {
          if (shouldFail) throw new Error('Synthetic packet digest failure');
          return await original(algorithm, data);
        } finally { finished(); }
      }
      return original(algorithm, data);
    };
  }, fail);
}
