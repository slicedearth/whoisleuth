#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRegistryFixtureScaffold } from '../cli/registry-fixture-scaffold.mts';

export { buildRegistryFixtureScaffold };

type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

function requiredValue(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new TypeError(`${name} requires a value.`);
  if (args.indexOf(name, index + 1) >= 0) throw new TypeError(`${name} may be supplied only once.`);
  return args[index + 1] as string;
}

function parseArguments(args: readonly string[]) {
  const allowed = new Set(['--profile', '--suffix', '--scenario']);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index] || '')) throw new TypeError(`Unknown option: ${args[index] || ''}`);
  }
  return {
    profile: requiredValue(args, '--profile'),
    suffix: requiredValue(args, '--suffix'),
    scenario: requiredValue(args, '--scenario'),
  };
}

export async function main(
  args = process.argv.slice(2),
  options: MainOptions = {},
): Promise<number> {
  try {
    const parsed = parseArguments(args);
    (options.stdout || process.stdout).write(buildRegistryFixtureScaffold(
      parsed.profile,
      parsed.suffix,
      parsed.scenario,
    ));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registry fixture scaffold failed.';
    (options.stderr || process.stderr).write(`${message.replace(/[\r\n]+/gu, ' ').slice(0, 500)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}
