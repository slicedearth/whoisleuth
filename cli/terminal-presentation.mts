type WritableTerminal = {
  write(value: string): unknown;
  isTTY?: boolean;
  columns?: number;
};

type TerminalEnvironment = Readonly<Record<string, string | undefined>>;

type TerminalPresentation = Readonly<{
  color: boolean;
  interactive: boolean;
  palette: TerminalPalette;
  width: number | null;
}>;

type TerminalTone = 'accent' | 'danger' | 'dim' | 'info' | 'success' | 'warning';
type TerminalPalette = 'auto' | 'light' | 'dark';

const MIN_TERMINAL_WIDTH = 40;
const MAX_TERMINAL_WIDTH = 160;
const DEFAULT_TERMINAL_WIDTH = 100;
const ANSI_RESET = '\u001b[0m';
const ANSI_BY_PALETTE: Readonly<Record<TerminalPalette, Readonly<Record<TerminalTone, string>>>> = Object.freeze({
  auto: Object.freeze({
    accent: '\u001b[1;36m',
    danger: '\u001b[31m',
    dim: '\u001b[2m',
    info: '\u001b[36m',
    success: '\u001b[32m',
    warning: '\u001b[33m',
  }),
  light: Object.freeze({
    accent: '\u001b[1;34m',
    danger: '\u001b[31m',
    dim: '\u001b[2;30m',
    info: '\u001b[34m',
    success: '\u001b[32m',
    warning: '\u001b[33m',
  }),
  dark: Object.freeze({
    accent: '\u001b[1;96m',
    danger: '\u001b[91m',
    dim: '\u001b[2m',
    info: '\u001b[96m',
    success: '\u001b[92m',
    warning: '\u001b[93m',
  }),
});

const SECTION_LABELS = new Set([
  'Collection',
  'DNS',
  'Discover',
  'Integrity and calibration',
  'Investigate',
  'Network',
  'Mail',
  'Quick start',
  'Registration',
  'Result',
  'Review saved evidence',
  'Runtime',
  'Source health',
  'Target',
  'Terminal',
  'TLS and certificate',
  'Website and security',
]);

function boundedTerminalWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isSafeInteger(width)) return DEFAULT_TERMINAL_WIDTH;
  return Math.max(MIN_TERMINAL_WIDTH, Math.min(MAX_TERMINAL_WIDTH, width));
}

function terminalPresentation(
  stream: WritableTerminal | null | undefined,
  requestedColor = true,
  environment: TerminalEnvironment = process.env,
  palette: TerminalPalette = 'auto',
): TerminalPresentation {
  const interactive = stream?.isTTY === true
    && environment.TERM !== 'dumb'
    && !environment.CI;
  const color = interactive
    && requestedColor
    && (environment.NO_COLOR === undefined || environment.NO_COLOR === '');
  return Object.freeze({
    color,
    interactive,
    palette,
    width: interactive ? boundedTerminalWidth(stream?.columns) : null,
  });
}

function tone(
  value: string,
  selectedTone: TerminalTone,
  presentation: boolean | TerminalPalette,
): string {
  if (presentation === false) return value;
  const palette = presentation === true ? 'auto' : presentation;
  return `${ANSI_BY_PALETTE[palette][selectedTone]}${value}${ANSI_RESET}`;
}

function statusTone(value: string): TerminalTone | null {
  const normalized = value.trim().toLowerCase();
  if (/^(?:success|complete|completed|available|active|observed|pass|passed|equivalent|yes)(?:\b|\s|·|\()/u.test(normalized)) {
    return 'success';
  }
  if (/^(?:error|failed|failure|danger|conflict|invalid)(?:\b|\s|·|\()/u.test(normalized)) {
    return 'danger';
  }
  if (/^(?:partial|warning|review|unknown|inconclusive|rate limited|rate_limited|unsupported|unavailable|skipped|not found)(?:\b|\s|·|\()/u.test(normalized)) {
    return 'warning';
  }
  return null;
}

function splitAtWord(value: string, maximum: number): readonly [string, string] | null {
  if (value.length <= maximum) return null;
  const boundary = value.lastIndexOf(' ', maximum);
  if (boundary <= 0) {
    const nextBoundary = value.indexOf(' ', maximum);
    return nextBoundary > 0
      ? [value.slice(0, nextBoundary), value.slice(nextBoundary + 1).trimStart()]
      : null;
  }
  return [value.slice(0, boundary), value.slice(boundary + 1).trimStart()];
}

function wrapLine(line: string, width: number): string[] {
  if (!line || line.length <= width) return [line];
  if (/^\s*(?:whoisleuth\b|node\s+bin\/whoisleuth\.mts\b|(?:cat|printf)\b.*\|\s*whoisleuth\b)/u.test(line)) {
    return [line];
  }
  const keyValue = line.match(/^(\s{0,4}\S(?:.*?\S)?)(\s{2,})(\S.*)$/u);
  const leading = line.match(/^\s*/u)?.[0] || '';
  const prefix = keyValue ? `${keyValue[1]}${keyValue[2]}` : leading;
  let remaining = keyValue ? keyValue[3] || '' : line.slice(leading.length);
  const firstPrefix = prefix;
  const continuationPrefix = ' '.repeat(Math.min(prefix.length, Math.floor(width / 2)));
  const lines: string[] = [];
  let currentPrefix = firstPrefix;
  while (remaining) {
    const available = Math.max(16, width - currentPrefix.length);
    const split = splitAtWord(remaining, available);
    if (!split) {
      lines.push(`${currentPrefix}${remaining}`);
      break;
    }
    lines.push(`${currentPrefix}${split[0]}`);
    remaining = split[1];
    currentPrefix = continuationPrefix;
  }
  return lines.length ? lines : [line];
}

function wrapTerminalOutput(value: string, width: number | null): string {
  if (width === null) return value;
  const trailingNewline = value.endsWith('\n');
  const lines = value.replace(/\n$/u, '').split('\n').flatMap((line) => wrapLine(line, width));
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function colorizeLine(line: string, palette: TerminalPalette): string {
  const trimmed = line.trim();
  if (!trimmed) return line;
  const section = trimmed.endsWith(':') ? trimmed.slice(0, -1) : trimmed;
  if (SECTION_LABELS.has(section)) {
    const prefixLength = line.indexOf(trimmed);
    return `${line.slice(0, prefixLength)}${tone(trimmed, 'accent', palette)}${line.slice(prefixLength + trimmed.length)}`;
  }
  if (trimmed.startsWith('✓')) return line.replace('✓', tone('✓', 'success', palette));
  if (trimmed.startsWith('!')) return line.replace('!', tone('!', 'danger', palette));
  if (/^(?:Limitation|Access note|Boundary)\s{2,}/u.test(trimmed)) {
    return tone(line, 'dim', palette);
  }
  const bracket = line.match(/^(\s*)\[([^\]]+)\](.*)$/u);
  if (bracket) {
    const selectedTone = statusTone(bracket[2] || '') || 'info';
    return `${bracket[1]}${tone(`[${bracket[2]}]`, selectedTone, palette)}${bracket[3]}`;
  }
  const keyValue = line.match(/^(\s*)(\S(?:.*?\S)?)(\s{2,})(\S.*)$/u);
  if (keyValue) {
    const value = keyValue[4] || '';
    const selectedTone = statusTone(value);
    return `${keyValue[1]}${tone(keyValue[2] || '', 'info', palette)}${keyValue[3]}${selectedTone ? tone(value, selectedTone, palette) : value}`;
  }
  return line;
}

function presentTerminalOutput(value: string, presentation: TerminalPresentation): string {
  const wrapped = wrapTerminalOutput(value, presentation.width);
  if (!presentation.color) return wrapped;
  const trailingNewline = wrapped.endsWith('\n');
  const lines = wrapped.replace(/\n$/u, '').split('\n').map((line) => colorizeLine(line, presentation.palette));
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

export {
  presentTerminalOutput,
  terminalPresentation,
  tone,
  wrapTerminalOutput,
};
export type {
  TerminalEnvironment,
  TerminalPalette,
  TerminalPresentation,
  TerminalTone,
  WritableTerminal,
};
