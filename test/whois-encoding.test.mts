import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { queryWhoisAddress } from '../lib/whois.mts';

class FixtureSocket extends EventEmitter {
  written = '';

  setTimeout(_timeoutMs: number): this {
    return this;
  }

  write(value: string): boolean {
    this.written += value;
    return true;
  }

  destroy(): this {
    return this;
  }
}

function fixtureConnection(chunks: readonly Buffer[]) {
  const socket = new FixtureSocket();
  const createConnection = (
    _options: { host: string; port: number },
    connected: () => void,
  ): FixtureSocket => {
    queueMicrotask(() => {
      connected();
      for (const chunk of chunks) socket.emit('data', chunk);
      socket.emit('end');
    });
    return socket;
  };
  return { createConnection, written: () => socket.written };
}

test('WHOIS decoding preserves a UTF-8 character split across TCP chunks', async () => {
  const encoded = Buffer.from('Registrant Name: Jos\u00e9 Example\r\n', 'utf8');
  const split = encoded.indexOf(0xc3) + 1;
  const fixture = fixtureConnection([encoded.subarray(0, split), encoded.subarray(split)]);

  const response = await queryWhoisAddress('203.0.113.10', 'whois.example', 'example.test', {
    createConnection: fixture.createConnection,
  });

  assert.equal(response, 'Registrant Name: Jos\u00e9 Example\r\n');
  assert.equal(response.includes('\ufffd'), false);
  assert.equal(fixture.written(), 'example.test\r\n');
});

test('WHOIS decoding preserves ordinary ASCII across several TCP chunks', async () => {
  const fixture = fixtureConnection([
    Buffer.from('Domain Name: EXAMPLE.TEST\r\n'),
    Buffer.from('Status: active\r\n'),
  ]);

  const response = await queryWhoisAddress('203.0.113.10', 'whois.example', 'example.test', {
    createConnection: fixture.createConnection,
  });
  assert.equal(response, 'Domain Name: EXAMPLE.TEST\r\nStatus: active\r\n');
});

test('WHOIS decoding rejects malformed UTF-8 instead of fabricating parsed evidence', async () => {
  const fixture = fixtureConnection([
    Buffer.from('Domain Name: EXAMPLE.TEST\r\nRegistrar: ', 'utf8'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('\r\n', 'utf8'),
  ]);

  await assert.rejects(
    queryWhoisAddress('203.0.113.10', 'whois.example', 'example.test', {
      createConnection: fixture.createConnection,
    }),
    /not valid UTF-8/u,
  );
});
