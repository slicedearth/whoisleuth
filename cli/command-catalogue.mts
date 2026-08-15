import type { CliCommand, CommandCollection, CommandDetail } from './command-reference.mts';

export const CLI_COMMAND_CATALOGUE_SCHEMA = 'whoisleuth.cli.command-catalogue';
export const CLI_COMMAND_CATALOGUE_VERSION = 1;

type CommandCatalogueEntry = Readonly<{
  command: CliCommand;
  description: string;
  usage: string;
  example: string;
  collection: CommandCollection;
  boundary: string;
}>;

type CliCommandCatalogue = Readonly<{
  schema: typeof CLI_COMMAND_CATALOGUE_SCHEMA;
  version: typeof CLI_COMMAND_CATALOGUE_VERSION;
  packageVersion: string;
  commands: readonly CommandCatalogueEntry[];
}>;

function buildCliCommandCatalogue(options: Readonly<{
  commands: readonly CliCommand[];
  details: Readonly<Record<CliCommand, CommandDetail>>;
  collections: Readonly<Record<CliCommand, CommandCollection>>;
  usage: Readonly<Record<CliCommand, string>>;
  packageVersion: string;
}>): CliCommandCatalogue {
  return Object.freeze({
    schema: CLI_COMMAND_CATALOGUE_SCHEMA,
    version: CLI_COMMAND_CATALOGUE_VERSION,
    packageVersion: options.packageVersion,
    commands: Object.freeze(options.commands.map((command) => {
      const detail = options.details[command];
      return Object.freeze({
        command,
        description: detail.description,
        usage: options.usage[command],
        example: detail.example,
        collection: options.collections[command],
        boundary: detail.boundary,
      });
    })),
  });
}

function formatCliCommandCatalogue(catalogue: CliCommandCatalogue): string {
  const lines = [
    `WHOISleuth CLI ${catalogue.packageVersion}`,
    'Command catalogue',
    '',
  ];
  for (const entry of catalogue.commands) {
    lines.push(
      `${entry.command} [${entry.collection.mode}]`,
      `  ${entry.description}`,
      `  ${entry.usage}`,
    );
  }
  lines.push('', 'Run "whoisleuth <command> --help" for examples and collection boundaries.');
  return `${lines.join('\n')}\n`;
}

export { buildCliCommandCatalogue, formatCliCommandCatalogue };
export type { CliCommandCatalogue, CommandCatalogueEntry };
