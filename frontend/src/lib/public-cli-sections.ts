import { PUBLIC_CLI_INDEX } from './generated/public-cli-index.ts';

const sections = [
  ['example', 'Example'], ['inputs', 'Inputs and options'], ['output', 'Output'], ['interpretation', 'Interpretation and limits'],
] as const;

export function commandReferenceSections(id: string) {
  return sections.map(([key, label]) => ({ href: `#command-${id}--${key}`, label }));
}

export function resolveCommandReferenceHash(hash: string): { id: string; anchor: string } | null {
  for (const command of PUBLIC_CLI_INDEX.commands) {
    const root = `#command-${command.id}`;
    if (hash === root || sections.some(([section]) => hash === `${root}--${section}`)) {
      return { id: command.id, anchor: hash.slice(1) };
    }
  }
  return null;
}
