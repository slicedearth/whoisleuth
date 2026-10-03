import { buildManagedIndicatorRevision, managedIndicatorState, parseManagedIndicatorJson, readManagedIndicatorSet } from '../packages/interchange/managed-indicator-set.mts';
import { exportManagedIndicators } from '../packages/interchange/managed-indicator-export.mts';
import { MAX_MANAGED_INDICATOR_PLAN_BYTES, MAX_MANAGED_INDICATOR_SET_BYTES } from '../packages/contracts/analyst-interchange.mts';
import type { CliArguments } from './arguments.mts';
import type { CliCommandContext } from './runner-types.mts';

import { formatJsonDocument } from './formatters/json.mts';
import { safeTerminalValue } from './formatters/terminal.mts';
import EXIT_CODES from './exit-codes.mts';

export type IndicatorSetCommandDependencies = {
  signal?: AbortSignal;
  readArtifactInput?: (source?: string | null) => string | Promise<string>;
};

export async function runIndicatorSetCommand(args: Extract<CliArguments, { action: 'indicator-set' }>, dependencies: IndicatorSetCommandDependencies, context: CliCommandContext): Promise<number> {
  context.setFailureLabel('Indicator revision');
  const raw = dependencies.readArtifactInput ? await dependencies.readArtifactInput(args.source)
    : await context.readInput(args.source, args.operation === 'revise' ? MAX_MANAGED_INDICATOR_PLAN_BYTES : MAX_MANAGED_INDICATOR_SET_BYTES, 'Indicator input');
  const input = parseManagedIndicatorJson(raw, args.operation === 'revise');
  const now = context.now();
  const revision = args.operation === 'revise' ? await buildManagedIndicatorRevision(input, now) : null;
  const manifest = revision?.manifest ?? await readManagedIndicatorSet(input);
  dependencies.signal?.throwIfAborted();
  if (args.quiet) return EXIT_CODES.SUCCESS;
  if (args.operation === 'stix' || args.operation === 'misp') context.writeStdout((await exportManagedIndicators(manifest, args.operation)).content);
  else if (args.output === 'json') context.writeStdout(formatJsonDocument(manifest));
  else {
    const lines = [`${safeTerminalValue(manifest.name)} · revision ${manifest.revision}`, `Set ${manifest.id}`, `Content digest ${manifest.integrity.digestSha256}`,
      'Content verified; authorship and earlier revisions are not authenticated.'];
    if (revision) lines.push(`Changes: ${revision.changes.length} · unchanged: ${revision.unchanged} · excluded candidates: ${revision.exclusions.length}`);
    for (const entry of manifest.entries) lines.push(`${entry.domain} · ${managedIndicatorState(entry, now)} · ${entry.id}`,
      `  Review expires ${entry.expiresAt} · source observed ${entry.observation.observedAt ?? 'time unavailable'}`,
      `  ${safeTerminalValue(entry.reviewBasis)}`);
    lines.push('Save the manifest for the next revision. Nothing was submitted or applied.');
    context.writeStdout(context.terminal(`${lines.join('\n')}\n`, args.color));
  }
  return EXIT_CODES.SUCCESS;
}
