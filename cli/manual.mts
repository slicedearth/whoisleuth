import type { CliCommand, CommandCollection, CommandDetail } from './command-reference.mts';

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
whoisleuth \- domain investigation from the terminal
.SH SYNOPSIS
.B whoisleuth
[command|target] [options]
.SH DESCRIPTION
WHOISleuth performs WHOIS, RDAP, DNS, HTTP, TLS, certificate-transparency, posture, lookalike and offline evidence operations with explicit source and collection states. With no arguments, an eligible interactive terminal opens the Lookup and command launcher; unsupported or redirected terminals print help.
.SH COMMANDS
${commands}
.SH OUTPUT
Human-readable output is the default. Versioned JSON and JSONL are available where documented. Diagnostics and optional progress events use standard error. Use --output and optional --force for atomic private file output. Use --palette auto, light, or dark for a fixed terminal palette. Lookup --browse provides an interactive terminal view.
.SH EXIT STATUS
0 indicates command completion, 2 invalid usage, 3 a collection or comparison failure, 4 an explicitly detected partial result, 70 an internal bootstrap failure, 130 analyst cancellation, and 143 service termination.
.SH PRIVACY
Network commands disclose the target to the sources named in focused help. Offline commands read local input only. Output files use private permissions and remain on the operator's machine.
.SH LICENSE
AGPL-3.0-only. Copyright 2026 slicedearth.
.SH SEE ALSO
whoisleuth --help, whoisleuth doctor, whoisleuth completion
`;
}

export { buildCliManual };
export type { CommandCollection, CommandDetail };
