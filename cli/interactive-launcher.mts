import { classifyQuery, isDirectLookupTarget } from '../lib/classify.mts';
import { StringDecoder } from 'node:string_decoder';
import { boundedCliErrorMessage, CliUsageError, hasUnsafeCliText } from './errors.mts';
import {
  INVESTIGATION_PLAN_RECIPES,
  type InvestigationPlanRecipe,
} from './investigation-plan.mts';
import { buildCliLookupPlan, formatCliLookupPlan } from './lookup-plan.mts';
import {
  canBrowseLookup,
  type LookupBrowserInput,
  type LookupBrowserOutput,
} from './lookup-browser.mts';
import type { TerminalEnvironment } from './terminal-presentation.mts';

const MAX_INTERACTIVE_ANSWER_SCALARS = 1_024;
const MAX_INTERACTIVE_ANSWER_BYTES = 4_096;

type InteractiveLauncherInput = LookupBrowserInput & {
  on?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
  off?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
};

type InteractiveLauncherOutput = LookupBrowserOutput;

type InteractiveQuestion = (prompt: string) => Promise<string>;

type InteractiveLauncherOptions = Readonly<{
  input: InteractiveLauncherInput;
  output: InteractiveLauncherOutput;
  environment?: TerminalEnvironment;
  signal?: AbortSignal;
  question?: InteractiveQuestion;
}>;

const WORKFLOW_LABELS: Readonly<Record<InvestigationPlanRecipe, string>> = Object.freeze({
  'domain-triage': 'New domain triage',
  'lookalike-review': 'Lookalike candidate review',
  'owned-domain-review': 'Owned domain posture review',
  'historical-comparison': 'Historical observation comparison',
});

function canLaunchInteractiveCli(
  input: InteractiveLauncherInput | null | undefined,
  output: InteractiveLauncherOutput | null | undefined,
  environment: TerminalEnvironment = process.env,
): boolean {
  return input?.isTTY === true
    && canBrowseLookup(input, output, environment);
}

function boundedInteractiveAnswer(value: unknown): string {
  const supplied = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(supplied, 'utf8') > MAX_INTERACTIVE_ANSWER_BYTES
    || Array.from(supplied).length > MAX_INTERACTIVE_ANSWER_SCALARS
    || hasUnsafeCliText(supplied)) {
    throw new CliUsageError('Interactive input must be bounded text without control characters.');
  }
  return supplied.trim();
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function readBoundedInteractiveLine(
  prompt: string,
  options: Pick<InteractiveLauncherOptions, 'input' | 'output' | 'signal'>,
): Promise<string> {
  const { input, output, signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason || abortError());
  const previousRaw = input.isRaw === true;
  const wasPaused = input.isPaused?.() === true;
  let receivedBytes = 0;
  let receivedScalars = 0;
  let settled = false;
  let characters: string[] = [];
  const decoder = new StringDecoder('utf8');

  return new Promise<string>((resolve, reject) => {
    const cleanup = (): Error | null => {
      let failure: Error | null = null;
      const attempt = (operation: () => unknown) => {
        try { operation(); } catch (error) {
          failure ||= error instanceof Error ? error : new Error('Interactive terminal cleanup failed.');
        }
      };
      attempt(() => input.off?.('data', onData));
      attempt(() => input.off?.('end', onEnd));
      attempt(() => signal?.removeEventListener('abort', onAbort));
      attempt(() => input.setRawMode?.(previousRaw));
      if (wasPaused) attempt(() => input.pause?.());
      return failure;
    };
    const finish = (value?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      const cleanupFailure = cleanup();
      characters = [];
      if (error && cleanupFailure) {
        reject(new AggregateError(
          [error, cleanupFailure],
          `${error.message}; terminal cleanup also failed: ${cleanupFailure.message}`,
        ));
      } else if (error || cleanupFailure) reject(error || cleanupFailure!);
      else resolve(value || '');
    };
    const rejectUsage = () => finish(undefined, new CliUsageError(
      'Interactive input must be bounded text without control characters.',
    ));
    const onData = (chunk: unknown) => {
      if (settled) return;
      let rawChunk: Buffer;
      if (Buffer.isBuffer(chunk)) {
        if (chunk.length > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes) {
          rejectUsage();
          return;
        }
        rawChunk = chunk;
      } else {
        const supplied = String(chunk ?? '');
        if (supplied.length > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes
          || Buffer.byteLength(supplied, 'utf8') > MAX_INTERACTIVE_ANSWER_BYTES - receivedBytes) {
          rejectUsage();
          return;
        }
        rawChunk = Buffer.from(supplied, 'utf8');
      }
      receivedBytes += rawChunk.length;
      const value = decoder.write(rawChunk);
      receivedScalars += Array.from(value).length;
      if (receivedBytes > MAX_INTERACTIVE_ANSWER_BYTES
        || receivedScalars > MAX_INTERACTIVE_ANSWER_SCALARS
        || value.includes('\ufffd')) {
        rejectUsage();
        return;
      }
      for (const character of value) {
        if (character === '\r' || character === '\n') {
          try { output.write('\n'); } catch (error) {
            finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
            return;
          }
          finish(characters.join(''));
          return;
        }
        if (character === '\u0003' || character === '\u0004' || character === '\u001b') {
          finish(undefined, abortError());
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          if (characters.length) {
            characters.pop();
            try { output.write('\b \b'); } catch (error) {
              finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
              return;
            }
          }
          continue;
        }
        if (hasUnsafeCliText(character)) {
          rejectUsage();
          return;
        }
        characters.push(character);
        try { output.write(character); } catch (error) {
          finish(undefined, error instanceof Error ? error : new Error('Interactive terminal output failed.'));
          return;
        }
      }
    };
    const onEnd = () => {
      const remainder = decoder.end();
      if (remainder) rejectUsage();
      else finish(undefined, abortError());
    };
    const onAbort = () => finish(undefined, signal?.reason instanceof Error ? signal.reason : abortError());

    try {
      output.write(prompt);
      input.on?.('data', onData);
      input.on?.('end', onEnd);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      input.setRawMode?.(true);
      if (settled) return;
      input.resume?.();
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error('Interactive terminal input failed.'));
    }
  });
}

async function launchInteractiveCli(options: InteractiveLauncherOptions): Promise<string[] | null> {
  const environment = options.environment || process.env;
  if (!canLaunchInteractiveCli(options.input, options.output, environment)) {
    throw new CliUsageError('Interactive launch requires terminal input and output.');
  }
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');

  const question = options.question || ((prompt: string) => readBoundedInteractiveLine(prompt, options));

  const ask = async (prompt: string) => boundedInteractiveAnswer(await question(prompt));
  const write = (value: string) => options.output.write(value);
  write([
      'WHOISleuth interactive launch',
      '',
      '  1  Fast Lookup',
      '  2  Deep Lookup',
      '  3  Build an investigation workflow plan (offline)',
      '  4  List commands',
      '  q  Exit',
      '',
    ].join('\n'));
  const selection = (await ask('Select: ')).toLowerCase();
  if (selection === 'q' || selection === 'quit' || selection === 'exit' || selection === '') return null;
  if (selection === '4') return ['commands'];
  if (selection === '3') {
    write(`\n${INVESTIGATION_PLAN_RECIPES.map((recipe, index) => `  ${index + 1}  ${WORKFLOW_LABELS[recipe]}`).join('\n')}\n\n`);
    const recipeSelection = await ask('Workflow: ');
    const recipe = INVESTIGATION_PLAN_RECIPES[Number(recipeSelection) - 1];
    if (!recipe) throw new CliUsageError('Choose one listed workflow number.');
    const subject = await ask('Domain or brand subject: ');
    if (!subject) throw new CliUsageError('A workflow plan requires one domain or brand subject.');
    return ['workflow-plan', recipe, subject];
  }
  if (selection !== '1' && selection !== '2') throw new CliUsageError('Choose 1, 2, 3, 4, or q.');

  const query = await ask('Domain, IP address, or ASN: ');
  if (!isDirectLookupTarget(query)) {
    throw new CliUsageError('Interactive Lookup requires an unambiguous domain with a recognised public suffix, public IP, or ASN.');
  }
  const deep = selection === '2';
  let classified;
  try {
    classified = classifyQuery(query);
  } catch (error) {
    throw new CliUsageError(boundedCliErrorMessage(error, 'Invalid Lookup target'));
  }
  const plan = buildCliLookupPlan(query, classified, deep);
  write(`\n${formatCliLookupPlan(plan)}\n`);
  const confirmed = (await ask('Start this collection and open the evidence browser? [y/N] ')).toLowerCase();
  if (confirmed !== 'y' && confirmed !== 'yes') return null;
  return ['lookup', query, deep ? '--deep' : '--fast', '--browse'];
}

export {
  MAX_INTERACTIVE_ANSWER_BYTES,
  MAX_INTERACTIVE_ANSWER_SCALARS,
  boundedInteractiveAnswer,
  canLaunchInteractiveCli,
  launchInteractiveCli,
  readBoundedInteractiveLine,
};
export type {
  InteractiveLauncherInput,
  InteractiveLauncherOptions,
  InteractiveLauncherOutput,
  InteractiveQuestion,
};
