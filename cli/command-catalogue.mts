import {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
} from '../packages/contracts/cli-command-catalogue.mts';
import type {
  CliCommand,
  CliCommandDefinition,
  CliHelpGroup,
  CommandCollection,
  CommandDetail,
} from './command-reference.mts';

export {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
};

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

type CliCommandCatalogueFilter = Readonly<{
  common: boolean;
  group: CliHelpGroup | null;
  mode: 'offline' | 'network' | null;
}>;

function selectCliCommands(
  definitions: readonly CliCommandDefinition[],
  filter: CliCommandCatalogueFilter,
): readonly CliCommand[] {
  return Object.freeze(definitions
    .filter((definition) => !filter.common || definition.documentation.common)
    .filter((definition) => filter.group === null || definition.help.group === filter.group)
    .filter((definition) => filter.mode === null || definition.collection.mode === filter.mode)
    .map((definition) => definition.command));
}

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
  if (catalogue.commands.length === 0) lines.push('No commands match the selected filters.');
  lines.push('', 'Run "whoisleuth <command> --help" for examples and collection boundaries.');
  return `${lines.join('\n')}\n`;
}

export { buildCliCommandCatalogue, formatCliCommandCatalogue, selectCliCommands };
export type { CliCommandCatalogue, CliCommandCatalogueFilter, CommandCatalogueEntry };
