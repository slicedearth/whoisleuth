import { classifyQuery, isDirectLookupTarget } from '../lib/classify.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import {
  INVESTIGATION_PLAN_RECIPE_LABELS,
  INVESTIGATION_PLAN_RECIPES,
} from './investigation-plan.mts';
import { buildCliLookupPlan, formatCliLookupPlan } from './lookup-plan.mts';
import {
  canBrowseLookup,
  type LookupBrowserInput,
  type LookupBrowserOutput,
} from './lookup-browser.mts';
import type { TerminalEnvironment } from './terminal-presentation.mts';
import { MAX_INTERACTIVE_ANSWER_BYTES, MAX_INTERACTIVE_ANSWER_SCALARS, boundedInteractiveAnswer, readBoundedInteractiveLine } from './terminal-input.mts';

type InteractiveLauncherInput = LookupBrowserInput;

type InteractiveLauncherOutput = LookupBrowserOutput;

type InteractiveQuestion = (prompt: string) => Promise<string>;

type InteractiveLauncherOptions = Readonly<{
  input: InteractiveLauncherInput;
  output: InteractiveLauncherOutput;
  environment?: TerminalEnvironment;
  signal?: AbortSignal;
  question?: InteractiveQuestion;
}>;

function canLaunchInteractiveCli(
  input: InteractiveLauncherInput | null | undefined,
  output: InteractiveLauncherOutput | null | undefined,
  environment: TerminalEnvironment = process.env,
): boolean {
  return input?.isTTY === true
    && canBrowseLookup(input, output, environment);
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
    write(`\n${INVESTIGATION_PLAN_RECIPES.map((recipe, index) => `  ${index + 1}  ${INVESTIGATION_PLAN_RECIPE_LABELS[recipe]}`).join('\n')}\n\n`);
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
