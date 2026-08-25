import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLI_CONFIG_SCHEMA,
  parseProfileDocument,
  resolveCliProfileArguments,
} from '../cli/config-profile.mts';
import { parseCliArguments } from '../cli/arguments.mts';

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

  test('applies the same explicit profile defaults to direct Lookup targets', async () => {
    const direct = await resolveCliProfileArguments(['example.test', '--profile', 'careful', '--deep'], {
      readConfig: async () => configuration(['--fast', '--no-color']),
    });
    const explicit = await resolveCliProfileArguments(['lookup', 'example.test', '--profile', 'careful', '--deep'], {
      readConfig: async () => configuration(['--fast', '--no-color']),
    });
    assert.deepEqual(direct, ['example.test', '--no-color', '--deep']);
    assert.deepEqual(explicit, ['lookup', '--no-color', 'example.test', '--deep']);
    assert.deepEqual(parseCliArguments(direct), parseCliArguments(explicit));
  });

  test('allows one fixed palette default and lets explicit colour choices override it', async () => {
    assert.deepEqual(await resolveCliProfileArguments(['lookup', 'example.test', '--profile', 'careful'], {
      readConfig: async () => configuration(['--palette', 'dark']),
    }), ['lookup', '--palette', 'dark', 'example.test']);
    assert.deepEqual(await resolveCliProfileArguments(['lookup', 'example.test', '--profile', 'careful', '--no-color'], {
      readConfig: async () => configuration(['--palette', 'dark']),
    }), ['lookup', 'example.test', '--no-color']);
    assert.deepEqual(await resolveCliProfileArguments(['lookup', 'example.test', '--profile', 'careful', '--palette', 'light'], {
      readConfig: async () => configuration(['--no-color']),
    }), ['lookup', 'example.test', '--palette', 'light']);
    assert.throws(() => parseProfileDocument(configuration(['--palette', 'sepia'])), /auto, light, or dark/iu);
    assert.throws(() => parseProfileDocument(configuration(['--palette', 'dark', '--no-color'])), /conflicting colour defaults/iu);
  });

  test('accepts only low-risk bounded defaults', () => {
    assert.throws(() => parseProfileDocument(configuration(['--deep'])), /cannot set --deep/iu);
    assert.throws(() => parseProfileDocument(configuration(['--output', 'evidence.json'])), /cannot set --output/iu);
    assert.throws(() => parseProfileDocument(configuration(['--concurrency', '99'])), /from 1 to 8/iu);
    assert.throws(() => parseProfileDocument(JSON.stringify({ schema: CLI_CONFIG_SCHEMA, version: 1, profiles: { careful: { arguments: ['--fast'], token: 'secret' } } })), /unsupported field/iu);
    assert.throws(
      () => parseProfileDocument('{"schema":"whoisleuth.cli.config","version":1,"profiles":{"careful":{"arguments":["--fast"],"arguments":["--no-color"]}}}'),
      /without duplicate keys/iu,
    );
  });

  test('leaves registry scaffold capability profiles under command ownership', async () => {
    assert.deepEqual(
      await resolveCliProfileArguments(['registry-scaffold', '.example', '--profile', 'rdap-only']),
      ['registry-scaffold', '.example', '--profile', 'rdap-only'],
    );
    await assert.rejects(
      resolveCliProfileArguments(['registry-scaffold', '.example', '--config', 'defaults.json']),
      /does not accept global CLI configuration/iu,
    );
  });

  test('keeps help and version ahead of configuration reads and default injection', async () => {
    const invocations = [
      ['lookup', '--help', '--profile', 'careful'],
      ['registry-support', '-h', '--config', '/tmp/cli-profile.json'],
      ['--version', '--profile', 'careful'],
      ['-V', '--config', '/tmp/cli-profile.json'],
    ];
    for (const invocation of invocations) {
      let reads = 0;
      assert.deepEqual(await resolveCliProfileArguments(invocation, {
        readConfig: async () => {
          reads += 1;
          return configuration(['--no-color', '--fast', '--observer', 'workstation-a']);
        },
      }), invocation);
      assert.equal(reads, 0, invocation.join(' '));
      assert.throws(() => parseCliArguments(invocation), /Help accepts|does not accept other arguments/iu);
    }
  });

  test('requires a valid named profile and matching version', async () => {
    await assert.rejects(() => resolveCliProfileArguments(['lookup', '--profile', 'missing', 'example.test'], { readConfig: async () => configuration() }), /was not found/iu);
    assert.throws(() => parseProfileDocument(JSON.stringify({ schema: CLI_CONFIG_SCHEMA, version: 2, profiles: {} })), /version 1/iu);
  });
});
