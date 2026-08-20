import { abortable } from '../lib/abort.mts';
import { classifyQuery } from '../lib/classify.mts';
import { runUnifiedLookup } from '../lib/lookup.mts';
import { plannedLookupProgressSources } from '../lib/lookup-source-progress.mts';
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
import { serializeCliLookupDocument, type UnknownRecord } from './saved-lookup.mts';
import { lookupStrictExitFindings } from './strict-exit.mts';
import { evaluateCliFailPolicies, formatFailPolicyNotice } from './fail-policy.mts';
import { formatCliJunit } from './ci-report.mts';
import { browseLookupOperation, canBrowseLookup } from './lookup-browser.mts';
import { writePrivateFile } from './output-file.mts';

type LookupCommandArguments = Extract<CliArguments, { action: 'lookup' }>;

async function runLookupCommand(
  args: LookupCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  const browserInput = dependencies.stdin || process.stdin;
  const browserEnvironment = dependencies.environment || process.env;
  if (args.browse === true) {
    if (!args.query) throw new CliUsageError('--browse requires a positional target because interactive stdin is reserved for navigation.');
    const supportsBrowser = dependencies.canBrowseLookup || canBrowseLookup;
    if (!supportsBrowser(browserInput, context.stdout, browserEnvironment)) {
      throw new CliUsageError('--browse requires interactive terminal input and output. Use ordinary terminal output or --json when redirecting.');
    }
  }
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

  let documentGeneratedAt = '';
  const buildDocument = (result: unknown) => {
    documentGeneratedAt = context.now();
    return buildCliLookupDocument(
      query,
      classified,
      result as UnknownRecord,
      documentGeneratedAt,
      args.deep ? 'deep' : 'fast',
      {
        ...(args.observerLabel ? { observerLabel: args.observerLabel } : {}),
        ...(args.vantageLabel ? { vantageLabel: args.vantageLabel } : {}),
      },
    );
  };
  let document: UnknownRecord;
  if (args.browse === true) {
    const browse = dependencies.browseLookupOperation || browseLookupOperation;
    document = await browse({
      input: browserInput,
      output: context.stdout,
      environment: browserEnvironment,
      color: args.color,
      ...(args.palette ? { palette: args.palette } : {}),
      query,
      mode: args.deep ? 'deep' : 'fast',
      plannedSources: args.deep ? plannedLookupProgressSources(classified) : [],
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      collect: async ({ signal, onSourceSettled }) => {
        const result = await abortable(() => executeLookup(classified, args.deep
          ? {
              fast: false,
              compact: false,
              signal,
              onSourceSettled: (settlement) => {
                onSourceSettled(settlement);
                eventProgress.emit({ event: 'source_settled', source: settlement.source, state: settlement.state });
              },
            }
          : {
              fast: true,
              compact: false,
              signal,
            }), signal);
        return buildDocument(result);
      },
    });
    if (args.saveLookup) {
      if (dependencies.signal?.aborted) {
        throw dependencies.signal.reason || new DOMException('Aborted', 'AbortError');
      }
      const save = dependencies.writePrivateFile || writePrivateFile;
      await save(args.saveLookup, serializeCliLookupDocument(document), {
        existingFileMessage: 'Saved Lookup file already exists. Choose a new --save-lookup path or remove the existing file explicitly.',
      });
      context.writeStderr('Saved the completed private Lookup JSON. It can contain raw public registry and WHOIS responses plus target and collection context; review it before sharing.\n');
    }
  } else {
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
    document = buildDocument(result);
  }
  if (!args.quiet) {
    if (args.output === 'json') context.writeStdout(serializeCliLookupDocument(document));
    else if (args.output === 'junit') context.writeStdout(formatCliJunit(document));
    else if (args.output === 'markdown' || args.output === 'html') {
      const loadEvidence = dependencies.loadEvidenceExport || (() => import('../lib/evidence-export.mts'));
      const evidenceModule = await loadEvidence();
      const report = buildCliEvidenceExport(JSON.stringify(document), evidenceModule, documentGeneratedAt);
      context.writeStdout(args.output === 'markdown'
        ? formatLookupEvidenceMarkdown(report, { includeAttribution: args.includeAttribution })
        : formatLookupEvidenceHtml(report, { includeAttribution: args.includeAttribution }));
    } else if (args.browse !== true) {
      context.writeStdout(context.terminal(formatTerminalLookup(document, { detail: args.detail }), args.color));
    }
  }

  const strictFindings = args.strictExit ? lookupStrictExitFindings(document) : [];
  const policyFindings = evaluateCliFailPolicies(document, args.failOn || []);
  const exitCode = strictFindings.length || policyFindings.length ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  if (strictFindings.length && !args.events) {
    context.writeStderr(`Strict exit: ${strictFindings.length} requested source state${strictFindings.length === 1 ? '' : 's'} were incomplete.\n`);
  }
  if (policyFindings.length && !args.events) context.writeStderr(formatFailPolicyNotice(policyFindings));
  eventProgress.emit({ event: 'completed', exitCode });
  return exitCode;
}

export { runLookupCommand };
