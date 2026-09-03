import type { UnknownRecord } from './saved-lookup.mts';
import { formatTerminalLookup, safeTerminalValue } from './formatters/terminal.mts';
import {
  presentTerminalOutput,
  wrapTerminalOutput,
  type TerminalEnvironment,
  type TerminalPalette,
} from './terminal-presentation.mts';

const MIN_LOOKUP_BROWSER_HEIGHT = 12;
const MAX_LOOKUP_BROWSER_HEIGHT = 80;
const MAX_LOOKUP_BROWSER_PANELS = 9;
const MAX_LOOKUP_BROWSER_SEARCH_BYTES = 256;
const MAX_LOOKUP_BROWSER_SEARCH_SCALARS = 80;
const MAX_LOOKUP_BROWSER_SEARCH_MATCHES = 256;
const ANSI_SEQUENCE_RE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;

type LookupBrowserPanel = Readonly<{
  id: string;
  label: string;
  lines: readonly string[];
}>;

type LookupBrowserCollectionSource = Readonly<{
  source: string;
  state: string;
  complete: boolean;
  truncated: boolean;
  limitation: string | null;
}>;

type LookupBrowserSearchMatch = Readonly<{
  panelIndex: number;
  lineIndex: number;
}>;

type LookupBrowserFrame = Readonly<{
  value: string;
  scrollOffset: number;
  maximumScrollOffset: number;
  pageSize: number;
  totalBodyLines: number;
}>;

function boundedHeight(value: unknown): number {
  const height = Number(value);
  if (!Number.isSafeInteger(height)) return 24;
  return Math.max(MIN_LOOKUP_BROWSER_HEIGHT, Math.min(MAX_LOOKUP_BROWSER_HEIGHT, height));
}

function panelId(value: string, index: number): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  return normalized || `panel-${index + 1}`;
}

function terminalCharacterWidth(character: string): number {
  const codePoint = character.codePointAt(0) || 0;
  if (/\p{Mark}/u.test(character)
    || codePoint === 0x200d
    || codePoint >= 0xfe00 && codePoint <= 0xfe0f
    || codePoint >= 0xe0100 && codePoint <= 0xe01ef) return 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f
    || codePoint >= 0xac00 && codePoint <= 0xd7a3
    || codePoint >= 0xf900 && codePoint <= 0xfaff
    || codePoint >= 0xfe10 && codePoint <= 0xfe19
    || codePoint >= 0xfe30 && codePoint <= 0xfe6f
    || codePoint >= 0xff00 && codePoint <= 0xff60
    || codePoint >= 0xffe0 && codePoint <= 0xffe6
    || codePoint >= 0x1f300 && codePoint <= 0x1faff
    || codePoint >= 0x20000 && codePoint <= 0x3fffd
  ) ? 2 : 1;
}

function terminalDisplayWidth(value: string): number {
  return Array.from(value.replace(ANSI_SEQUENCE_RE, ''))
    .reduce((total, character) => total + terminalCharacterWidth(character), 0);
}

function hardWrapTerminalLine(line: string, width: number): string[] {
  if (!line || terminalDisplayWidth(line) <= width) return [line];
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const character of line) {
    const characterWidth = terminalCharacterWidth(character);
    if (current && currentWidth + characterWidth > width) {
      lines.push(current);
      current = '';
      currentWidth = 0;
    }
    current += character;
    currentWidth += characterWidth;
  }
  if (current || !lines.length) lines.push(current);
  return lines;
}

function clipTerminalLine(line: string, width: number): string {
  if (terminalDisplayWidth(line) <= width) return line;
  const maximumContentWidth = Math.max(1, width - 1);
  let clipped = '';
  let clippedWidth = 0;
  for (const character of line) {
    const characterWidth = terminalCharacterWidth(character);
    if (clippedWidth + characterWidth > maximumContentWidth) break;
    clipped += character;
    clippedWidth += characterWidth;
  }
  return `${clipped}…`;
}

function wrapLookupBrowserLines(value: string, width: number): string[] {
  const softlyWrapped = wrapTerminalOutput(`${value}\n`, width).replace(/\n$/u, '').split('\n');
  return softlyWrapped.flatMap((line) => hardWrapTerminalLine(line, width));
}

function buildLookupBrowserPanels(document: UnknownRecord): LookupBrowserPanel[] {
  const blocks = formatTerminalLookup(document, { detail: 'verbose' })
    .trimEnd()
    .split(/\n\n/gu)
    .slice(0, MAX_LOOKUP_BROWSER_PANELS);
  return blocks.flatMap((block, index) => {
    const [heading, ...lines] = block.split('\n');
    if (!heading?.endsWith(':') || lines.length === 0) return [];
    const label = heading.slice(0, -1);
    return [Object.freeze({
      id: panelId(label, index),
      label,
      lines: Object.freeze(lines),
    })];
  });
}

function browserTabLine(panels: readonly LookupBrowserPanel[], activeIndex: number, width: number): string {
  const labels = panels.map((panel, index) => index === activeIndex
    ? `[${index + 1} ${panel.label}]`
    : `${index + 1} ${panel.label}`);
  const complete = labels.join('  ');
  if (terminalDisplayWidth(complete) <= width) return complete;
  const visible = [activeIndex - 1, activeIndex, activeIndex + 1]
    .filter((index) => index >= 0 && index < panels.length)
    .map((index) => labels[index]);
  const windowed = `${activeIndex > 1 ? '‹  ' : ''}${visible.join('  ')}${activeIndex + 2 < panels.length ? '  ›' : ''}`;
  return clipTerminalLine(windowed, width);
}

function boundedTargetLine(query: string, width: number): string {
  return clipTerminalLine(`Target  ${query}`, width);
}

function boundedBrowserDimensions(options: Readonly<{ width?: number; height?: number }>): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(40, Math.min(160, Number.isSafeInteger(options.width) ? Number(options.width) : 100)),
    height: boundedHeight(options.height),
  };
}

function boundedSearchText(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(text, 'utf8') > MAX_LOOKUP_BROWSER_SEARCH_BYTES
    || Array.from(text).length > MAX_LOOKUP_BROWSER_SEARCH_SCALARS
    || /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(text)) {
    throw new RangeError(`Lookup browser search is limited to ${MAX_LOOKUP_BROWSER_SEARCH_SCALARS} characters and ${MAX_LOOKUP_BROWSER_SEARCH_BYTES} UTF-8 bytes.`);
  }
  return text;
}

function findLookupBrowserMatches(
  panels: readonly LookupBrowserPanel[],
  query: string,
): { matches: LookupBrowserSearchMatch[]; truncated: boolean } {
  const normalized = boundedSearchText(query).trim().toLocaleLowerCase('en-US');
  if (!normalized) return { matches: [], truncated: false };
  const matches: LookupBrowserSearchMatch[] = [];
  let truncated = false;
  outer: for (let panelIndex = 0; panelIndex < panels.length; panelIndex += 1) {
    const panel = panels[panelIndex]!;
    const lines = [panel.label, ...panel.lines];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!String(lines[lineIndex] || '').toLocaleLowerCase('en-US').includes(normalized)) continue;
      if (matches.length >= MAX_LOOKUP_BROWSER_SEARCH_MATCHES) {
        truncated = true;
        break outer;
      }
      matches.push(Object.freeze({ panelIndex, lineIndex: Math.max(0, lineIndex - 1) }));
    }
  }
  return { matches, truncated };
}

function renderedPanelLineOffset(panel: LookupBrowserPanel, lineIndex: number, width: number): number {
  if (lineIndex <= 0) return 0;
  return panel.lines
    .slice(0, Math.min(lineIndex, panel.lines.length))
    .reduce((total, line) => total + wrapLookupBrowserLines(line, width).length, 0);
}

function renderStandaloneBrowserFrame(
  lines: readonly string[],
  options: Readonly<{ width?: number; height?: number; color?: boolean; palette?: TerminalPalette }>,
): string {
  const { width, height } = boundedBrowserDimensions(options);
  const clipped = lines.slice(0, height).map((line) => clipTerminalLine(line, width));
  return presentTerminalOutput(`${clipped.join('\n')}\n`, {
    color: options.color === true,
    interactive: true,
    palette: options.palette || 'auto',
    width: null,
  });
}

function buildLookupBrowserHelpFrame(
  document: UnknownRecord | null,
  options: Readonly<{
    query?: string;
    mode?: string;
    collecting?: boolean;
    width?: number;
    height?: number;
    color?: boolean;
    palette?: TerminalPalette;
  }> = {},
): string {
  const query = safeTerminalValue(document?.query ?? options.query, 'unknown target');
  const mode = safeTerminalValue(document?.mode ?? options.mode, 'unknown mode');
  return renderStandaloneBrowserFrame([
    'WHOISleuth evidence browser help',
    boundedTargetLine(query, boundedBrowserDimensions(options).width),
    `Mode    ${mode}`,
    '',
    options.collecting ? 'Collection' : 'Panels',
    options.collecting
      ? '  q / Ctrl-C  cancel the active collection'
      : '  ←/→ h/l Tab  move panels · 1-9 select',
    options.collecting
      ? '  progress is transient and is never retained'
      : '  ↑/↓ j/k PgUp/PgDn Home/End  scroll',
    options.collecting ? '  ? / Esc  return to collection progress' : '  /  search rendered panels · n/N matches',
    '  ? / Esc  return · q  close',
  ], options);
}

function buildLookupBrowserSearchFrame(
  document: UnknownRecord,
  query: string,
  notice: string,
  options: Readonly<{ width?: number; height?: number; color?: boolean; palette?: TerminalPalette }> = {},
): string {
  return renderStandaloneBrowserFrame([
    'WHOISleuth evidence browser search',
    boundedTargetLine(safeTerminalValue(document.query, 'unknown target'), boundedBrowserDimensions(options).width),
    `Mode    ${safeTerminalValue(document.mode, 'unknown mode')}`,
    '',
    `Search  ${query || 'type a bounded term'}`,
    notice || 'Search covers only the bounded text rendered in the evidence panels.',
    '',
    'Enter apply · Backspace edit · Esc cancel',
  ], options);
}

function buildLookupCollectionFrame(
  queryValue: unknown,
  modeValue: 'fast' | 'deep',
  sources: readonly LookupBrowserCollectionSource[],
  options: Readonly<{ width?: number; height?: number; color?: boolean; palette?: TerminalPalette }> = {},
): string {
  const { width, height } = boundedBrowserDimensions(options);
  const query = safeTerminalValue(queryValue, 'unknown target');
  const mode = modeValue === 'deep' ? 'deep' : 'fast';
  const header = [
    'WHOISleuth evidence browser',
    boundedTargetLine(query, width),
    `Mode    ${mode}`,
    'Collection in progress:',
  ];
  const footer = ['? help · progress is transient', 'q/Esc/Ctrl-C cancel'];
  const bodyCapacity = Math.max(1, height - header.length - footer.length);
  const body = mode === 'fast'
    ? [
        'Registration evidence  collecting',
        'Fast mode waits for the final bounded result.',
        'Per-source states are not fabricated.',
      ]
    : sources.flatMap((source) => {
        const state = source.state === 'pending'
          ? 'pending'
          : `${source.state}${source.complete ? ' · complete' : ' · incomplete'}${source.truncated ? ' · truncated' : ''}`;
        const limitation = source.state !== 'pending' && source.limitation
          ? ` · ${source.limitation}`
          : '';
        return [clipTerminalLine(`${source.source.replaceAll('_', ' ')}  ${state}${limitation}`, width)];
      });
  const visible = body.slice(0, bodyCapacity);
  if (body.length > visible.length && visible.length) {
    visible[visible.length - 1] = `+${body.length - visible.length + 1} source states not visible at this height`;
  }
  return renderStandaloneBrowserFrame([...header, ...visible, ...footer], {
    ...options,
    width,
    height,
  });
}

function buildLookupBrowserFrame(
  document: UnknownRecord,
  options: Readonly<{
    activeIndex?: number;
    scrollOffset?: number;
    width?: number;
    height?: number;
    color?: boolean;
    palette?: TerminalPalette;
    environment?: TerminalEnvironment;
    searchStatus?: string;
  }> = {},
): LookupBrowserFrame {
  const panels = buildLookupBrowserPanels(document);
  const { width, height } = boundedBrowserDimensions(options);
  if (!panels.length) return Object.freeze({
    value: `${clipTerminalLine('WHOISleuth evidence browser', width)}\n${clipTerminalLine('No bounded terminal panels were available.', width)}\n`,
    scrollOffset: 0,
    maximumScrollOffset: 0,
    pageSize: 0,
    totalBodyLines: 0,
  });
  const activeIndex = Math.max(0, Math.min(panels.length - 1, Number.isSafeInteger(options.activeIndex) ? Number(options.activeIndex) : 0));
  const panel = panels[activeIndex]!;
  const query = safeTerminalValue(document.query, 'unknown target');
  const mode = safeTerminalValue(document.mode, 'unknown mode');
  const header = [
    'WHOISleuth evidence browser',
    boundedTargetLine(query, width),
    `Mode    ${clipTerminalLine(mode, Math.max(1, width - 8))}`,
    browserTabLine(panels, activeIndex, width),
    `${panel.label}:`,
  ];
  const footerLineCount = 2;
  const body = wrapLookupBrowserLines(panel.lines.join('\n'), width);
  const bodyCapacity = Math.max(1, height - header.length - footerLineCount);
  const maximumScrollOffset = Math.max(0, body.length - bodyCapacity);
  const requestedScrollOffset = Number.isSafeInteger(options.scrollOffset) ? Number(options.scrollOffset) : 0;
  const scrollOffset = Math.max(0, Math.min(maximumScrollOffset, requestedScrollOffset));
  const visibleBody = body.slice(scrollOffset, scrollOffset + bodyCapacity);
  const firstVisibleLine = body.length ? scrollOffset + 1 : 0;
  const lastVisibleLine = body.length ? scrollOffset + visibleBody.length : 0;
  const footer = [
    options.searchStatus || `View ${activeIndex + 1}/${panels.length} · lines ${firstVisibleLine}-${lastVisibleLine}/${body.length}`,
    '←/→ panels · ↑/↓ scroll · / search · ? help · q close',
  ].map((line) => clipTerminalLine(line, width));
  const value = [...header, ...visibleBody, ...footer].slice(0, height).join('\n');
  return Object.freeze({
    value: presentTerminalOutput(`${value}\n`, {
      color: options.color === true,
      interactive: true,
      palette: options.palette || 'auto',
      width: null,
    }),
    scrollOffset,
    maximumScrollOffset,
    pageSize: bodyCapacity,
    totalBodyLines: body.length,
  });
}

function renderLookupBrowser(
  document: UnknownRecord,
  options: Readonly<{
    activeIndex?: number;
    scrollOffset?: number;
    width?: number;
    height?: number;
    color?: boolean;
    palette?: TerminalPalette;
    environment?: TerminalEnvironment;
  }> = {},
): string {
  return buildLookupBrowserFrame(document, options).value;
}

export {
  MIN_LOOKUP_BROWSER_HEIGHT,
  MAX_LOOKUP_BROWSER_PANELS,
  MAX_LOOKUP_BROWSER_SEARCH_BYTES,
  MAX_LOOKUP_BROWSER_SEARCH_MATCHES,
  MAX_LOOKUP_BROWSER_SEARCH_SCALARS,
  boundedBrowserDimensions,
  boundedSearchText,
  buildLookupBrowserHelpFrame,
  buildLookupBrowserFrame,
  buildLookupBrowserPanels,
  buildLookupBrowserSearchFrame,
  buildLookupCollectionFrame,
  findLookupBrowserMatches,
  renderedPanelLineOffset,
  renderLookupBrowser,
  terminalDisplayWidth,
};
export type {
  LookupBrowserCollectionSource,
  LookupBrowserFrame,
  LookupBrowserPanel,
  LookupBrowserSearchMatch,
};
