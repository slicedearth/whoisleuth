import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLI_CONFIG_SCHEMA,
  parseProfileDocument,
  resolveCliProfileArguments,
} from '../cli/config-profile.mts';

function configuration(argumentsList: string[] = ['--fast', '--no-color', '--concurrency', '2']) {
  return JSON.stringify({ schema: CLI_CONFIG_SCHEMA, version: 1, defaultProfile: 'careful', profiles: { careful: { arguments: argumentsList } } });
}

describe('CLI configuration profiles', () => {
  test('loads only an explicitly selected file or profile and lets command flags override defaults', async () => {
    let readPath = '';
    const resolved = await resolveCliProfileArguments(['bulk', '--profile', 'careful', '--deep', '--concurrency', '1'], {
      environment: { XDG_CONFIG_HOME: '/tmp/config-root' },
      readConfig: async (path) => { readPath = path; return configuration(); },
    });
    assert.equal(readPath, '/tmp/config-root/whoisleuth/config.json');
    assert.deepEqual(resolved, ['bulk', '--no-color', '--deep', '--concurrency', '1']);

    let read = false;
    assert.deepEqual(await resolveCliProfileArguments(['lookup', 'example.test'], { readConfig: async () => { read = true; return configuration(); } }), ['lookup', 'example.test']);
    assert.equal(read, false);
  });

  test('accepts only low-risk bounded defaults', () => {
    assert.throws(() => parseProfileDocument(configuration(['--deep'])), /cannot set --deep/iu);
    assert.throws(() => parseProfileDocument(configuration(['--output', 'evidence.json'])), /cannot set --output/iu);
    assert.throws(() => parseProfileDocument(configuration(['--concurrency', '99'])), /from 1 to 8/iu);
    assert.throws(() => parseProfileDocument(JSON.stringify({ schema: CLI_CONFIG_SCHEMA, version: 1, profiles: { careful: { arguments: ['--fast'], token: 'secret' } } })), /unsupported field/iu);
  });

  test('requires a valid named profile and matching version', async () => {
    await assert.rejects(() => resolveCliProfileArguments(['lookup', '--profile', 'missing', 'example.test'], { readConfig: async () => configuration() }), /was not found/iu);
    assert.throws(() => parseProfileDocument(JSON.stringify({ schema: CLI_CONFIG_SCHEMA, version: 2, profiles: {} })), /version 1/iu);
  });
});
