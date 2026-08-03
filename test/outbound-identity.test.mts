import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  WHOISLEUTH_REQUEST_POLICY_URL,
  WHOISLEUTH_USER_AGENT,
  WHOISLEUTH_USER_AGENT_VERSION,
  whoisleuthRequestHeaders,
} from '../lib/outbound-identity.mts';

const root = process.cwd();

test('outbound identity matches the package version and public request policy', () => {
  const packageDocument = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  assert.equal(WHOISLEUTH_USER_AGENT_VERSION, packageDocument.version);
  assert.equal(WHOISLEUTH_REQUEST_POLICY_URL, 'https://whoisleuth.com/request-policy');
  assert.equal(WHOISLEUTH_USER_AGENT, `WHOISleuth/${packageDocument.version} (+${WHOISLEUTH_REQUEST_POLICY_URL})`);
  assert.deepEqual(whoisleuthRequestHeaders({ Accept: 'application/json' }), {
    Accept: 'application/json',
    'User-Agent': WHOISLEUTH_USER_AGENT,
  });
});

test('legacy and divergent outbound identities do not return to production code', () => {
  const files = [
    'lib/availability.mts',
    'lib/ct-search.mts',
    'lib/domain-posture.mts',
    'lib/favicon.mts',
    'lib/threatfox-intelligence.mts',
    'lib/urlhaus-intelligence.mts',
    'lib/urlscan-intelligence.mts',
  ];
  const source = files.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /DomainStatusChecker|WHOISleuth-Posture|WHOISleuth\/1\.0/u);
  for (const file of files) assert.match(readFileSync(join(root, file), 'utf8'), /whoisleuthRequestHeaders/u);
});
