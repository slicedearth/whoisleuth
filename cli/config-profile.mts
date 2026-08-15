import { Buffer } from 'node:buffer';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { CliUsageError } from './errors.mts';
import { cliMetaActionForInvocation } from './command-reference.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';

export const CLI_CONFIG_SCHEMA = 'whoisleuth.cli.config';
export const CLI_CONFIG_VERSION = 1;
export const MAX_CLI_CONFIG_BYTES = 64 * 1024;

const SAFE_BOOLEAN_DEFAULTS = new Set(['--no-color', '--summary', '--verbose', '--fast']);
const SAFE_VALUE_DEFAULTS = new Set(['--concurrency', '--observer', '--palette', '--vantage']);
const OPTION_GROUPS = Object.freeze({
  '--no-color': 'colour',
  '--summary': 'detail',
  '--verbose': 'detail',
  '--fast': 'scan',
  '--concurrency': 'concurrency',
  '--observer': 'observer',
  '--palette': 'colour',
  '--vantage': 'vantage',
} as const);

type ProfileDocument = Readonly<{
  schema: typeof CLI_CONFIG_SCHEMA;
  version: typeof CLI_CONFIG_VERSION;
  defaultProfile?: string;
  profiles: Readonly<Record<string, Readonly<{ arguments: readonly string[] }>>>;
}>;

function validProfileName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/u.test(value);
}

function safeArgumentText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CliUsageError('CLI profile arguments must be bounded text without control characters.');
  }
  return value;
}

function validateProfileArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) throw new CliUsageError('Each CLI profile is limited to 16 safe default arguments.');
  const argumentsList = value.map(safeArgumentText);
  const validated: string[] = [];
  const groups = new Set<string>();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    if (SAFE_BOOLEAN_DEFAULTS.has(argument)) {
      const group = OPTION_GROUPS[argument as keyof typeof OPTION_GROUPS];
      if (groups.has(group)) throw new CliUsageError(`CLI profile contains conflicting ${group} defaults.`);
      groups.add(group);
      validated.push(argument);
      continue;
    }
    if (!SAFE_VALUE_DEFAULTS.has(argument)) {
      throw new CliUsageError(`CLI profiles cannot set ${argument}. Only presentation labels, fast mode, and bounded concurrency are supported.`);
    }
    const next = argumentsList[++index];
    if (!next || next.startsWith('-')) throw new CliUsageError(`${argument} in a CLI profile requires one value.`);
    const group = OPTION_GROUPS[argument as keyof typeof OPTION_GROUPS];
    if (groups.has(group)) throw new CliUsageError(`CLI profile contains duplicate ${group} defaults.`);
    if (argument === '--concurrency' && (!/^\d+$/u.test(next) || Number(next) < 1 || Number(next) > 8)) {
      throw new CliUsageError('CLI profile concurrency must be an integer from 1 to 8.');
    }
    if (argument === '--palette' && !['auto', 'light', 'dark'].includes(next)) {
      throw new CliUsageError('CLI profile palette must be auto, light, or dark.');
    }
    groups.add(group);
    validated.push(argument, next);
  }
  return validated;
}

function parseProfileDocument(input: string): ProfileDocument {
  if (Buffer.byteLength(input, 'utf8') > MAX_CLI_CONFIG_BYTES) throw new CliUsageError('CLI configuration is limited to 64 KiB.');
  const normalized = input.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalized);
    parsed = JSON.parse(normalized);
  } catch { throw new CliUsageError('CLI configuration must be valid bounded JSON without duplicate keys.'); }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  if (root.schema !== CLI_CONFIG_SCHEMA || root.version !== CLI_CONFIG_VERSION || !root.profiles || typeof root.profiles !== 'object' || Array.isArray(root.profiles)) {
    throw new CliUsageError(`CLI configuration must use ${CLI_CONFIG_SCHEMA} version ${CLI_CONFIG_VERSION}.`);
  }
  if (Object.keys(root).some((key) => !['schema', 'version', 'defaultProfile', 'profiles'].includes(key))) throw new CliUsageError('CLI configuration contains an unsupported root field.');
  if (root.defaultProfile !== undefined && !validProfileName(root.defaultProfile)) throw new CliUsageError('CLI configuration defaultProfile is invalid.');
  const profileEntries = Object.entries(root.profiles as Record<string, unknown>);
  if (profileEntries.length < 1 || profileEntries.length > 20) throw new CliUsageError('CLI configuration requires from 1 to 20 profiles.');
  const profiles = Object.fromEntries(profileEntries.map(([name, value]) => {
    if (!validProfileName(name)) throw new CliUsageError(`CLI profile name "${name}" is invalid.`);
    const profile = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (Object.keys(profile).some((key) => key !== 'arguments')) throw new CliUsageError(`CLI profile "${name}" contains an unsupported field.`);
    return [name, Object.freeze({ arguments: Object.freeze(validateProfileArguments(profile.arguments)) })];
  }));
  return Object.freeze({ schema: CLI_CONFIG_SCHEMA, version: CLI_CONFIG_VERSION, ...(root.defaultProfile ? { defaultProfile: root.defaultProfile as string } : {}), profiles: Object.freeze(profiles) });
}

async function readConfigFile(path: string): Promise<string> {
  return readBoundedRegularTextFile(path, {
    maximumBytes: MAX_CLI_CONFIG_BYTES,
    label: 'CLI configuration',
    allowSymbolicLink: true,
  });
}

function suppliedGroups(argumentsList: readonly string[]): Set<string> {
  const groups = new Set<string>();
  for (const argument of argumentsList) {
    const group = OPTION_GROUPS[argument as keyof typeof OPTION_GROUPS];
    if (group) groups.add(group);
    if (argument === '--deep') groups.add('scan');
  }
  return groups;
}

export async function resolveCliProfileArguments(
  argv: readonly string[],
  options: Readonly<{
    environment?: Readonly<Record<string, string | undefined>>;
    homeDirectory?: string;
    readConfig?: (path: string) => Promise<string>;
  }> = {},
): Promise<string[]> {
  if (cliMetaActionForInvocation(argv)) return [...argv];
  // registry-scaffold owns --profile as the capability template to generate.
  // Do not reinterpret it as a global CLI-default profile.
  if (argv[0] === 'registry-scaffold') {
    if (argv.includes('--config')) {
      throw new CliUsageError('registry-scaffold does not accept global CLI configuration options.');
    }
    return [...argv];
  }
  const retained: string[] = [];
  let configPath: string | null = null;
  let profileName: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break;
    if (argument === '--config' || argument === '--profile') {
      const next = argv[++index];
      if (!next || next.startsWith('-')) throw new CliUsageError(`${argument} requires one value.`);
      if (argument === '--config') {
        if (configPath !== null) throw new CliUsageError('--config may be supplied only once.');
        configPath = next;
      } else {
        if (profileName !== null) throw new CliUsageError('--profile may be supplied only once.');
        if (!validProfileName(next)) throw new CliUsageError('--profile requires a lower-case name of at most 40 characters.');
        profileName = next;
      }
    } else retained.push(argument);
  }
  if (!configPath && !profileName) return retained;
  const environment = options.environment || process.env;
  const baseDirectory = environment.XDG_CONFIG_HOME || join(options.homeDirectory || homedir(), '.config');
  const selectedPath = resolve(configPath || join(baseDirectory, 'whoisleuth', 'config.json'));
  let input: string;
  try { input = await (options.readConfig || readConfigFile)(selectedPath); } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError('CLI configuration could not be read as a bounded regular file.');
  }
  const document = parseProfileDocument(input);
  const selectedName = profileName || document.defaultProfile;
  if (!selectedName) throw new CliUsageError('CLI configuration requires --profile or a defaultProfile.');
  const selected = document.profiles[selectedName];
  if (!selected) throw new CliUsageError(`CLI profile "${selectedName}" was not found.`);
  if (!retained.length) throw new CliUsageError('A CLI profile must accompany a command.');
  const explicitGroups = suppliedGroups(retained.slice(1));
  const defaults: string[] = [];
  for (let index = 0; index < selected.arguments.length; index += 1) {
    const argument = selected.arguments[index]!;
    const group = OPTION_GROUPS[argument as keyof typeof OPTION_GROUPS];
    const hasValue = SAFE_VALUE_DEFAULTS.has(argument);
    const value = hasValue ? selected.arguments[++index] : undefined;
    if (explicitGroups.has(group)) continue;
    defaults.push(argument, ...(value ? [value] : []));
  }
  return [retained[0]!, ...defaults, ...retained.slice(1)];
}

export { parseProfileDocument };
