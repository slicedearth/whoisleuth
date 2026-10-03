import assert from 'node:assert/strict';
import { Socket, type TcpNetConnectOpts } from 'node:net';
import type { TLSSocket, ConnectionOptions } from 'node:tls';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import {
  SocketReplyReader, defaultSmtpProbe, EHLO_COMMAND, STARTTLS_COMMAND,
  MAX_SMTP_LINE_BYTES, MAX_SMTP_REPLY_LINES, MAX_SMTP_RESPONSE_BYTES,
  type SmtpProbeTransport,
} from '../lib/smtp-transport-review.mts';

class FixtureSocket extends Socket {
  commands: string[] = [];
  onCommand: (command: string) => void = () => {};
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const command = chunk.toString('ascii');
    this.commands.push(command);
    callback();
    queueMicrotask(() => this.onCommand(command));
  }
  receive(value: string | Buffer): void { this.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(value)); }
}

describe('SMTP socket reply reader', () => {
  test('frames split CRLF and multiline replies while retaining exact bounded diagnostics', async () => {
    const socket = new FixtureSocket();
    const reader = new SocketReplyReader(socket);
    try {
      const pending = reader.readReply();
      socket.receive('250-fixture\r');
      socket.receive('\n250 START');
      socket.receive('TLS\r\n');
      const reply = await pending;
      assert.equal(reply.code, 250);
      assert.deepEqual(reply.lines, ['250-fixture', '250 STARTTLS']);
      assert.equal(reader.bytesRead, Buffer.byteLength('250-fixture\r\n250 STARTTLS\r\n'));
      assert.equal(reader.lineCount, 2);
      reader.assertIdle();
    } finally { reader.detach(); socket.destroy(); }
  });

  for (const [name, chunks, message] of [
    ['aggregate bytes', [Buffer.alloc(MAX_SMTP_RESPONSE_BYTES + 1)], /response-byte limit/u],
    ['unterminated line', ['x'.repeat(MAX_SMTP_LINE_BYTES + 1)], /line-byte limit/u],
    ['terminated line', ['220 ' + 'x'.repeat(MAX_SMTP_LINE_BYTES) + '\r\n'], /line-byte limit/u],
    ['malformed framing', ['not an SMTP reply\r\n'], /framing is invalid/u],
    ['mismatched status', ['250-first\r\n220 final\r\n'], /status changed/u],
    ['line count', [Array(MAX_SMTP_REPLY_LINES).fill('250-more\r\n').join('')], /line-count limit/u],
  ] as const) {
    test(`rejects ${name} without a network socket`, async () => {
      const socket = new FixtureSocket();
      const reader = new SocketReplyReader(socket);
      try {
        const rejected = assert.rejects(reader.readReply(), message);
        for (const chunk of chunks) socket.receive(chunk);
        await rejected;
      } finally { reader.detach(); socket.destroy(); }
    });
  }

  test('counts lines across separate replies, not only within each reply', async () => {
    const socket = new FixtureSocket();
    const reader = new SocketReplyReader(socket);
    try {
      for (let index = 0; index < MAX_SMTP_REPLY_LINES; index += 1) {
        const pending = reader.readReply();
        socket.receive('220 OK\r\n');
        assert.equal((await pending).code, 220);
      }
      const rejected = assert.rejects(reader.readReply(), /line-count limit/u);
      socket.receive('220 OK\r\n');
      await rejected;
      assert.equal(socket.destroyed, true);
    } finally { reader.detach(); socket.destroy(); }
  });

  for (const phase of ['same chunk', 'later chunk', 'pending read'] as const) {
    test(`refuses upgrade with ${phase} plaintext work`, async () => {
      const socket = new FixtureSocket();
      const reader = new SocketReplyReader(socket);
      try {
        const reply = reader.readReply();
        socket.receive('220 Ready\r\n' + (phase === 'same chunk' ? '250 Unsolicited\r\n' : ''));
        await reply;
        if (phase === 'later chunk') socket.receive('250 Unsolicited\r\n');
        const pending = phase === 'pending read' ? assert.rejects(reader.readReply(), /closed/u) : null;
        assert.throws(() => reader.assertIdle(), /unsolicited buffered reply/u);
        assert.throws(() => reader.release(), /unsolicited buffered reply/u);
        if (pending) { socket.destroy(); await pending; }
      } finally { reader.detach(); socket.destroy(); }
    });
  }

  for (const event of ['error', 'end', 'close', 'timeout'] as const) {
    test(`settles a pending read on ${event}`, async () => {
      const socket = new FixtureSocket();
      const reader = new SocketReplyReader(socket);
      try {
        const rejected = assert.rejects(reader.readReply(), event === 'error' ? /fixture failure/u : /closed|timed out/u);
        socket.emit(event, new Error('fixture failure'));
        await rejected;
        assert.equal(socket.destroyed, true);
        await assert.rejects(reader.readReply(), /fixture failure|closed|timed out/u);
      } finally { reader.detach(); socket.destroy(); }
    });
  }

  test('upgrade detaches only the reader-owned listeners', () => {
    const socket = new FixtureSocket();
    const independent = () => {};
    const events = ['data', 'error', 'end', 'close', 'timeout'];
    for (const event of events) socket.on(event, independent);
    const original = new Map(events.map(event => [event, socket.listeners(event)]));
    const reader = new SocketReplyReader(socket);
    reader.release();
    for (const event of events) assert.deepEqual(socket.listeners(event), original.get(event));
    socket.destroy();
  });
});

function fixtureProbe(options: { greeting?: string; ehlo?: string; handshake?: 'success' | 'failure' | 'held'; connect?: 'success' | 'held' } = {}) {
  const socket = new FixtureSocket();
  const secure = new FixtureSocket();
  const connectionOptions: TcpNetConnectOpts[] = [];
  const tlsOptions: ConnectionOptions[] = [];
  Object.assign(secure, { authorized: true, authorizationError: null,
    getCipher: () => ({ name: 'fixture-cipher' }), getProtocol: () => 'TLSv1.3', getPeerCertificate: () => ({}) });
  const transport: SmtpProbeTransport = {
    connect: options_ => {
      connectionOptions.push(options_);
      if (options.connect !== 'held') queueMicrotask(() => {
        socket.emit('connect');
        queueMicrotask(() => { socket.receive(options.greeting ?? '220 Fixture\r\n'); socket.emit('fixture-greeting'); });
      });
      return socket;
    },
    startTls: options_ => {
      tlsOptions.push(options_);
      queueMicrotask(() => {
        socket.emit('fixture-upgrade');
        if (options.handshake === 'success') secure.emit('secureConnect');
        else if (options.handshake !== 'held') secure.emit('error', new Error('fixture TLS failure'));
      });
      return secure as unknown as TLSSocket;
    },
  };
  socket.onCommand = command => socket.receive(command === EHLO_COMMAND
    ? options.ehlo ?? '250-Fixture\r\n250 STARTTLS\r\n' : '220 Upgrade\r\n');
  const controller = new AbortController();
  const run = () => defaultSmtpProbe({ hostname: 'mx.example.test', address: '192.0.2.1', family: 4,
    timeoutMs: 8_000, signal: controller.signal }, transport);
  return { socket, secure, connectionOptions, tlsOptions, controller, run };
}

describe('default SMTP socket and TLS coordination', () => {
  test('pins port 25 and sends only EHLO then STARTTLS on success', async () => {
    const fixture = fixtureProbe({ handshake: 'success' });
    const result = await fixture.run();
    assert.deepEqual(fixture.connectionOptions, [{ host: '192.0.2.1', port: 25, family: 4 }]);
    assert.deepEqual(fixture.socket.commands, [EHLO_COMMAND, STARTTLS_COMMAND]);
    assert.equal(result.starttlsState, 'negotiated');
    assert.equal(result.tls?.protocol, 'TLSv1.3');
    assert.equal(fixture.tlsOptions[0]?.socket, fixture.socket);
    assert.equal(fixture.tlsOptions[0]?.servername, 'mx.example.test');
    assert.equal(fixture.socket.destroyed, true);
    assert.equal(fixture.secure.destroyed, true);
    for (const event of ['data', 'error', 'timeout', 'connect', 'close']) {
      assert.equal(fixture.socket.listenerCount(event), 0);
      assert.equal(fixture.secure.listenerCount(event), 0);
    }
  });

  for (const [label, options, state, commands] of [
    ['non-220 greeting', { greeting: '554 Refused\r\n' }, 'rejected', []],
    ['absent STARTTLS', { ehlo: '250 Fixture\r\n' }, 'not_advertised', [EHLO_COMMAND]],
    ['failed TLS', { handshake: 'failure' as const }, 'failed', [EHLO_COMMAND, STARTTLS_COMMAND]],
  ] as const) {
    test(label, async () => {
      const fixture = fixtureProbe(options);
      assert.equal((await fixture.run()).starttlsState, state);
      assert.deepEqual(fixture.socket.commands, commands);
      assert.equal(fixture.socket.destroyed, true);
    });
  }

  test('pre-aborted collection creates no socket', async () => {
    const fixture = fixtureProbe();
    fixture.controller.abort();
    await assert.rejects(fixture.run(), { name: 'AbortError' });
    assert.equal(fixture.connectionOptions.length, 0);
  });

  test('abort settles a held connection', async () => {
    const fixture = fixtureProbe({ connect: 'held' });
    const rejected = assert.rejects(fixture.run(), /closed before connecting/u);
    fixture.controller.abort();
    await rejected;
    assert.equal(fixture.socket.destroyed, true);
  });

  test('abort settles a held TLS handshake and destroys both sockets', async () => {
    const fixture = fixtureProbe({ handshake: 'held' });
    const upgraded = once(fixture.socket, 'fixture-upgrade');
    const pending = fixture.run();
    await upgraded;
    fixture.controller.abort();
    assert.equal((await pending).starttlsState, 'failed');
    assert.equal(fixture.socket.destroyed, true);
    assert.equal(fixture.secure.destroyed, true);
  });

  test('abort settles a pending greeting after connection', async () => {
    const fixture = fixtureProbe({ greeting: '' });
    const ready = once(fixture.socket, 'fixture-greeting');
    const rejected = assert.rejects(fixture.run(), /closed.*reply/u);
    await ready;
    fixture.controller.abort();
    await rejected;
    assert.deepEqual(fixture.socket.commands, []);
  });

  test('connection timeout and write failure reject and release their sockets', async () => {
    const held = fixtureProbe({ connect: 'held' });
    const timedOut = assert.rejects(held.run(), /connection timed out/u);
    held.socket.emit('timeout');
    await timedOut;
    assert.equal(held.socket.destroyed, true);
    const failedWrite = fixtureProbe();
    failedWrite.socket._write = (_chunk, _encoding, callback) => callback(new Error('fixture write failure'));
    await assert.rejects(failedWrite.run(), /fixture write failure/u);
    assert.equal(failedWrite.socket.destroyed, true);
  });

  test('handshake timeout remains a failed TLS observation, not negotiated evidence', async () => {
    const fixture = fixtureProbe({ handshake: 'held' });
    const upgraded = once(fixture.socket, 'fixture-upgrade');
    const pending = fixture.run();
    await upgraded;
    fixture.secure.emit('timeout');
    const result = await pending;
    assert.equal(result.starttlsState, 'failed');
    assert.equal(result.tls, null);
    assert.equal(fixture.socket.destroyed, true);
    assert.equal(fixture.secure.destroyed, true);
  });
});
