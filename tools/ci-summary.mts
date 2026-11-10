// Presentation only: reporting must not replace or hide the producer's exit.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summaryText(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu, ' ')
    .replace(/\b(?:https?|file):\/\/\S+/giu, '[URL omitted]')
    .replace(/(?:\/(?:Users|home|private|tmp)\/|[a-z]:\\)[^\s'"<]+/giu, '[absolute path omitted]')
    .slice(0, 240)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;').replaceAll('`', '&#96;').replaceAll('[', '&#91;').replaceAll(']', '&#93;');
}

export function writeCiSummary(markdown: string): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    if (Buffer.byteLength(markdown) > 64 * 1024) throw new RangeError();
    appendFileSync(path, markdown + '\n', 'utf8');
  } catch {
    process.stderr.write('Job summary could not be written; the original check result is unchanged.\n');
  }
}

export type CiStageResult = Readonly<{ name: string; outcome: string; action?: string }>;
const LABELS = new Map([
  ['success', 'Passed'], ['failure', 'Failed'], ['cancelled', 'Cancelled'], ['skipped', 'Not run'], ['', 'Not run'],
]);

export function renderCiStageSummary(title: string, stages: readonly CiStageResult[]): string {
  const lines = [`## ${summaryText(title)}`, '', '| Stage | Outcome | What to check |', '| --- | --- | --- |'];
  for (const { name, outcome, action } of stages.slice(0, 40)) {
    const status = LABELS.get(outcome) ?? 'Unavailable';
    const guidance = outcome === 'failure' && action ? summaryText(action)
      : status === 'Not run' ? 'An earlier stage did not complete or this lane was not selected.' : '—';
    lines.push(`| ${summaryText(name)} | ${status} | ${guidance} |`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , title = 'Check outcomes', ...stages] = process.argv;
  const summary = renderCiStageSummary(title, stages.map(stage => {
    const [outcome = '', name = 'Unknown stage', action = ''] = stage.split('|', 3);
    return { name, outcome, action };
  }));
  process.stdout.write(summary);
  writeCiSummary(summary);
}
