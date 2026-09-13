import { parseArgs } from 'node:util';

export function parseLocalApplicationArguments(args: readonly string[]) {
  if (args.length > 12 || args.some(value => value.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(value))) throw new TypeError('Local application arguments exceed their bounds.');
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0]!)) return { operation: 'help' as const };
  if (args.length === 1 && args[0] === '--version') return { operation: 'version' as const };
  const parsed = parseArgs({ args: [...args], strict: true, allowPositionals: false, tokens: true, options: {
    workspace: { type: 'string' }, port: { type: 'string' }, init: { type: 'boolean' }, offline: { type: 'boolean' },
  } });
  const names = parsed.tokens.filter(token => token.kind === 'option').map(token => token.name);
  if (new Set(names).size !== names.length) throw new TypeError('Specify each local application option once.');
  const workspace = parsed.values.workspace;
  if (!workspace?.trim()) throw new TypeError('Choose --workspace <directory> explicitly. Add --init only to create a new workspace.');
  const rawPort = parsed.values.port ?? '0';
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(rawPort) || Number(rawPort) > 65_535) throw new TypeError('The local port must be between 0 and 65535.');
  return { operation: 'start' as const, workspace, port: Number(rawPort), create: parsed.values.init ?? false, offline: parsed.values.offline ?? false };
}
