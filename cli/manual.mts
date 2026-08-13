import type { CliCommand } from './arguments.mts';

type CommandDetail = Readonly<{
  description: string;
  example: string;
  boundary: string;
}>;
type CommandCollection = Readonly<{
  mode: 'offline' | 'network';
  scope: string;
}>;

function roffText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/-/gu, '\\-')
    .replace(/^([.'])/gmu, '\\&$1');
}

function buildCliManual(options: Readonly<{
  commands: readonly CliCommand[];
  details: Readonly<Record<CliCommand, CommandDetail>>;
  collections: Readonly<Record<CliCommand, CommandCollection>>;
  usage: Readonly<Record<CliCommand, string>>;
  version: string;
}>): string {
  const commands = options.commands.map((command) => {
    const detail = options.details[command];
    const collection = options.collections[command];
    return `.SS ${roffText(command)}\n${roffText(detail.description)}\n.PP\n.B ${roffText(options.usage[command])}\n.PP\nExample: ${roffText(detail.example)}\n.PP\nCollection: ${roffText(collection.mode)}. ${roffText(collection.scope)}\n.PP\nBoundary: ${roffText(detail.boundary)}`;
  }).join('\n');
  return `.TH WHOISLEUTH 1 "" "WHOISleuth ${roffText(options.version)}" "User Commands"
.SH NAME
whoisleuth \- source-aware domain investigation from the terminal
.SH SYNOPSIS
.B whoisleuth
[command|target] [options]
.SH DESCRIPTION
WHOISleuth performs bounded WHOIS, RDAP, DNS, HTTP, TLS, certificate-transparency, posture, lookalike, and offline evidence operations. Evidence sources remain separately attributed, and missing or failed collection is not converted into a claim of absence or safety. With no arguments, an eligible interactive terminal opens a bounded launcher; unsupported or redirected terminals print help, and no request starts before explicit confirmation.
.SH COMMANDS
${commands}
.SH OUTPUT
Human-readable output is the default. Versioned JSON and JSONL are available where documented. Diagnostics and optional progress events are written to standard error. Use --output with an optional --force flag for atomic private file output. Place --palette auto, light, or dark after a command to select a fixed ANSI palette; --no-color, NO_COLOR, and redirected output suppress ANSI. Lookup --browse opens before collection and provides bounded progress, key help, and rendered-panel search.
.SH EXIT STATUS
0 indicates command completion, 2 invalid usage, 3 a collection or comparison failure, 4 an explicitly detected partial result, 70 an internal bootstrap failure, 130 analyst cancellation, and 143 service termination.
.SH PRIVACY
Network commands disclose the target to the directly queried upstream services. Offline commands do not make network requests. Output files are created with private permissions and are never uploaded by the CLI. Lookup --save-lookup writes the exact completed versioned document only after the browser closes normally, refuses existing paths, and can retain normalized evidence omitted from the terminal panels.
.SH LICENSE
AGPL-3.0-only. Copyright 2026 slicedearth.
.SH SEE ALSO
whoisleuth --help, whoisleuth doctor, whoisleuth completion
`;
}

export { buildCliManual };
export type { CommandCollection, CommandDetail };
