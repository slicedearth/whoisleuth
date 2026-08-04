import { abortable } from '../lib/abort.mts';
import { classifyQuery } from '../lib/classify.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import type { CliArguments } from './arguments.mts';
import { CliUsageError, boundedCliErrorMessage } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import { buildCliEvidenceExport } from './export-evidence.mts';
import { formatLookupEvidenceHtml } from './formatters/html.mts';
import { buildCliLookupDocument, formatJsonDocument } from './formatters/json.mts';
import { formatLookupEvidenceMarkdown } from './formatters/markdown.mts';
import { formatTerminalLookup } from './formatters/terminal.mts';
import { buildCliLookupPlan, formatCliLookupPlan } from './lookup-plan.mts';
import { createCliProgressEvents } from './progress-events.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import { lookupStrictExitFindings } from './strict-exit.mts';

type LookupCommandArguments = Extract<CliArguments, { action: 'lookup' }>;

async function runLookupCommand(
  args: LookupCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const eventProgress = createCliProgressEvents(context.stderr, {
    command: 'lookup',
    enabled: args.events,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  context.setEventProgress(eventProgress);
  eventProgress.emit({ event: 'started' });
  const query = args.query || await context.readSingleInput();
  if (!query) throw new CliUsageError('lookup requires one domain, IP address, or ASN as an argument or on stdin.');
  const classify = dependencies.classifyQuery || classifyQuery;
  const executeLookup = dependencies.runUnifiedLookup || runUnifiedLookup;
  let classified;
  try {
    classified = classify(query);
  } catch (error) {
    throw new CliUsageError(boundedCliErrorMessage(error, 'Invalid query'));
  }
  if ((args.output === 'markdown' || args.output === 'html') && classified.type !== 'domain') {
    throw new CliUsageError('Markdown and HTML reports support domain lookups only.');
  }

  if (args.plan) {
    const plan = buildCliLookupPlan(query, classified, args.deep);
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(plan)
      : context.terminal(formatCliLookupPlan(plan), args.color));
    return EXIT_CODES.SUCCESS;
  }

  const indicator = context.beginProgress(args.deep
    ? 'Collecting deep Lookup evidence'
    : 'Collecting registration evidence');
  let settledSources = 0;
  let result: unknown;
  try {
    result = await abortable(() => executeLookup(classified, args.deep
      ? {
          fast: false,
          compact: false,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          onSourceSettled: (settlement) => {
            settledSources += 1;
            indicator.update(
              `Collected ${settledSources} source${settledSources === 1 ? '' : 's'} · ${settlement.source.replaceAll('_', ' ')} ${settlement.state}`,
            );
            eventProgress.emit({ event: 'source_settled', source: settlement.source, state: settlement.state });
          },
        }
      : {
          fast: true,
          compact: false,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        }), dependencies.signal);
  } finally {
    context.endProgress();
  }

  const now = context.now();
  const document = buildCliLookupDocument(
    query,
    classified,
    result as UnknownRecord,
    now,
    args.deep ? 'deep' : 'fast',
    {
      ...(args.observerLabel ? { observerLabel: args.observerLabel } : {}),
      ...(args.vantageLabel ? { vantageLabel: args.vantageLabel } : {}),
    },
  );
  if (!args.quiet) {
    if (args.output === 'json') context.writeStdout(formatJsonDocument(document));
    else if (args.output === 'markdown' || args.output === 'html') {
      const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
      const evidenceModule = await loadEvidence();
      const report = buildCliEvidenceExport(JSON.stringify(document), evidenceModule, now);
      context.writeStdout(args.output === 'markdown'
        ? formatLookupEvidenceMarkdown(report)
        : formatLookupEvidenceHtml(report));
    } else {
      context.writeStdout(context.terminal(formatTerminalLookup(document, { detail: args.detail }), args.color));
    }
  }

  const strictFindings = args.strictExit ? lookupStrictExitFindings(document) : [];
  const exitCode = strictFindings.length ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  if (strictFindings.length && !args.events) {
    context.writeStderr(`Strict exit: ${strictFindings.length} requested source state${strictFindings.length === 1 ? '' : 's'} were incomplete.\n`);
  }
  eventProgress.emit({ event: 'completed', exitCode });
  return exitCode;
}

export { runLookupCommand };
