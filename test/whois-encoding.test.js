const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { queryWhoisAddress } = require('../lib/whois.mts');

function fixtureConnection(chunks) {
  let written = '';
  const socket = new EventEmitter();
  socket.setTimeout = () => {};
  socket.write = (value) => { written += value; };
  socket.destroy = () => {};
  const createConnection = (_options, connected) => {
    queueMicrotask(() => {
      connected();
      for (const chunk of chunks) socket.emit('data', chunk);
      socket.emit('end');
    });
    return socket;
  };
  return { createConnection, written: () => written };
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
