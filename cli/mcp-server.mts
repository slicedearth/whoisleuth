import { Readable, Writable } from 'node:stream';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { buildReadOnlyMcpServer, prepareMcpEvidence } from './mcp-evidence.mts';
import { MAX_MCP_MESSAGE_BYTES } from '../packages/contracts/local-tool-adapter.mts';

export async function serveReadOnlyMcp(options: Readonly<{
  inputs: readonly string[]; input: unknown; output: unknown; version: string; now: () => string;
  signal?: AbortSignal; diagnostic(message: string): void;
}>): Promise<void> {
  if (!(options.input instanceof Readable) || !(options.output instanceof Writable)) throw new TypeError('MCP stdio requires Node readable and writable streams.');
  options.signal?.throwIfAborted();
  // Read once before starting the protocol; later file replacement cannot broaden selection.
  const selected = await prepareMcpEvidence(options.inputs);
  const transport = new StdioServerTransport(options.input, options.output, { maxBufferSize: MAX_MCP_MESSAGE_BYTES });
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    const handle = serveStdio(() => buildReadOnlyMcpServer(selected, options.version, options.now), {
      transport, maxSubscriptions: 1,
      onerror: () => {
        if (!failure) options.diagnostic('MCP transport rejected an invalid or over-bound message.\n');
        failure = new Error('MCP transport closed after a protocol failure.');
        void handle.close();
      },
    });
    const priorClose = transport.onclose;
    const abort = () => { failure = new DOMException('Aborted', 'AbortError'); void handle.close(); };
    transport.onclose = () => {
      try { priorClose?.(); }
      finally { options.signal?.removeEventListener('abort', abort); failure ? reject(failure) : resolve(); }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
