// Preloaded only by the browser-test server. This denies the maintained Node
// transports independently of browser routing and production request safety.
// It is test isolation, not an operating-system sandbox for hostile code.
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { recordUnexpectedBrowserServerEgress } from './browser-server-egress-report.mts';

function deny(owner: object, name: string, label: string, numericLookup = false): void {
  const original: unknown = Reflect.get(owner, name);
  if (typeof original !== 'function'
    || !Reflect.set(owner, name, function(this: unknown, ...arguments_: unknown[]) {
      // Numeric lookup is local parsing, including the listen-address setup
      // used by Node itself. Outbound socket connections remain denied below.
      if (numericLookup && typeof arguments_[0] === 'string' && net.isIP(arguments_[0])) {
        return Reflect.apply(original, this, arguments_);
      }
      return recordUnexpectedBrowserServerEgress(label);
    })) {
    throw new Error(`Browser server egress guard could not protect ${label}.`);
  }
}

for (const [owner, label] of [
  [dns, 'dns'], [dnsPromises, 'dns.promises'],
  [dns.Resolver.prototype, 'dns.Resolver'], [dnsPromises.Resolver.prototype, 'dns.promises.Resolver'],
] as const) {
  for (const name of Object.getOwnPropertyNames(owner)) {
    if (/^(?:lookup|resolve|reverse)/u.test(name)) deny(owner, name, `${label}.${name}`, name === 'lookup');
  }
}
for (const [owner, names, label] of [
  [http, ['get', 'request'], 'http'], [https, ['get', 'request'], 'https'],
  [net, ['connect', 'createConnection'], 'net'], [net.Socket.prototype, ['connect'], 'net.Socket'],
  [tls, ['connect'], 'tls'], [dgram.Socket.prototype, ['connect', 'send'], 'dgram.Socket'],
] as const) {
  for (const name of names) deny(owner, name, `${label}.${name}`);
}
deny(globalThis, 'fetch', 'fetch');
syncBuiltinESMExports();
