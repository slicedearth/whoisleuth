import type { UnknownRecord } from './saved-lookup.mts';
import { StringDecoder } from 'node:string_decoder';
import type { LookupSourceSettlement } from '../lib/lookup.mts';
import { formatTerminalLookup, safeTerminalValue } from './formatters/terminal.mts';
import {
  presentTerminalOutput,
  terminalPresentation,
  wrapTerminalOutput,
  type TerminalEnvironment,
  type TerminalPalette,
  type WritableTerminal,
} from './terminal-presentation.mts';

const MIN_LOOKUP_BROWSER_HEIGHT = 12;
const MAX_LOOKUP_BROWSER_HEIGHT = 80;
const MAX_LOOKUP_BROWSER_PANELS = 9;
const ENTER_ALTERNATE_SCREEN = '\u001b[?1049h\u001b[?25l';
const LEAVE_ALTERNATE_SCREEN = '\u001b[?25h\u001b[?1049l';
const CLEAR_SCREEN = '\u001b[2J\u001b[H';
const ESCAPE_SEQUENCE_WAIT_MS = 40;
const MAX_PENDING_INPUT_LENGTH = 512;
const MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES = 2_048;
const MAX_LOOKUP_BROWSER_SEARCH_BYTES = 256;
const MAX_LOOKUP_BROWSER_SEARCH_SCALARS = 80;
const MAX_LOOKUP_BROWSER_SEARCH_MATCHES = 256;
const ANSI_SEQUENCE_RE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const COMPLETE_CSI_RE = /^\u001b\[[0-?]*[ -/]*[@-~]/u;

type LookupBrowserInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(enabled: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
  isPaused?(): boolean;
  on?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
  off?(event: 'data' | 'end', listener: (chunk?: unknown) => void): unknown;
};

type LookupBrowserOutput = WritableTerminal & {
  rows?: number;
  on?(event: 'resize', listener: () => void): unknown;
  off?(event: 'resize', listener: () => void): unknown;
};

type LookupBrowserPanel = Readonly<{
  id: string;
  label: string;
  lines: readonly string[];
}>;

type LookupBrowserOptions = Readonly<{
  input: LookupBrowserInput;
  output: LookupBrowserOutput;
  environment?: TerminalEnvironment;
  color?: boolean;
  palette?: TerminalPalette;
  signal?: AbortSignal;
}>;

type LookupBrowserCollectionContext = Readonly<{
  signal: AbortSignal;
  onSourceSettled(settlement: LookupSourceSettlement): void;
}>;

type LookupBrowserOperationOptions = LookupBrowserOptions & Readonly<{
  query: string;
  mode: 'fast' | 'deep';
  plannedSources?: readonly string[];
  collect(context: LookupBrowserCollectionContext): UnknownRecord | Promise<UnknownRecord>;
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

function canBrowseLookup(
  input: LookupBrowserInput | null | undefined,
  output: LookupBrowserOutput | null | undefined,
  environment: TerminalEnvironment = process.env,
): boolean {
  return input?.isTTY === true
    && output?.isTTY === true
    && typeof input.setRawMode === 'function'
    && typeof input.resume === 'function'
    && typeof input.pause === 'function'
    && typeof input.on === 'function'
    && typeof input.off === 'function'
    && typeof output.write === 'function'
    && !(Number.isFinite(output.columns) && Number(output.columns) < 40)
    && !(Number.isFinite(output.rows) && Number(output.rows) < MIN_LOOKUP_BROWSER_HEIGHT)
    && environment.TERM !== 'dumb'
    && !environment.CI;
}

type InternalLookupBrowserOptions = LookupBrowserOptions & Readonly<{
  document?: UnknownRecord;
  query?: string;
  mode?: 'fast' | 'deep';
  plannedSources?: readonly string[];
  collect?: LookupBrowserOperationOptions['collect'];
}>;

function runLookupBrowserSession(options: InternalLookupBrowserOptions): Promise<UnknownRecord> {
  const environment = options.environment || process.env;
  if (!canBrowseLookup(options.input, options.output, environment)) {
    throw new TypeError('Lookup browsing requires interactive terminal input and output.');
  }
  if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (!options.document && (!options.collect || !options.query || !options.mode)) {
    throw new TypeError('Lookup browser collection requires a target, mode, and collection operation.');
  }
  const input = options.input;
  const output = options.output;
  const previousRaw = input.isRaw === true;
  const wasPaused = input.isPaused?.() === true;
  const collectionController = new AbortController();
  const collectionSignal = options.signal
    ? AbortSignal.any([options.signal, collectionController.signal])
    : collectionController.signal;
  const sourceOrder = [...(options.plannedSources || [])];
  if (sourceOrder.length > 16
    || new Set(sourceOrder).size !== sourceOrder.length
    || sourceOrder.some((source) => !/^[a-z][a-z0-9_]{0,39}$/u.test(source))) {
    throw new TypeError('Lookup browser planned sources are invalid or exceed their bound.');
  }
  const sourceStates = new Map<string, LookupBrowserCollectionSource>(sourceOrder.map((source) => [source, Object.freeze({
    source,
    state: 'pending',
    complete: false,
    truncated: false,
    limitation: null,
  })]));
  const settledSourceIds = new Set<string>();
  let document: UnknownRecord | null = options.document || null;
  let collecting = document === null;
  let panels = document ? buildLookupBrowserPanels(document) : [];
  let activeIndex = 0;
  let scrollOffset = 0;
  let maximumScrollOffset = 0;
  let pageSize = 1;
  let settled = false;
  let pendingInput = '';
  let escapeTimer: ReturnType<typeof setTimeout> | null = null;
  let view: 'normal' | 'help' | 'search' = 'normal';
  let searchDraft = '';
  let searchNotice = '';
  let searchQuery = '';
  let searchMatches: LookupBrowserSearchMatch[] = [];
  let searchMatchIndex = 0;
  let searchTruncated = false;
  let renderedWidth = 100;
  let inputDecoder = new StringDecoder('utf8');

  return new Promise<UnknownRecord>((resolve, reject) => {
    const render = () => {
      if (Number.isFinite(output.columns) && Number(output.columns) < 40
        || Number.isFinite(output.rows) && Number(output.rows) < MIN_LOOKUP_BROWSER_HEIGHT) {
        throw new RangeError(`Lookup browsing requires a terminal of at least 40 columns by ${MIN_LOOKUP_BROWSER_HEIGHT} rows.`);
      }
      const presentation = terminalPresentation(output, options.color !== false, environment, options.palette);
      const geometry = {
        width: presentation.width ?? output.columns ?? 100,
        ...(output.rows !== undefined ? { height: output.rows } : {}),
        color: presentation.color,
        palette: presentation.palette,
      };
      renderedWidth = boundedBrowserDimensions(geometry).width;
      let value: string;
      if (view === 'help') {
        value = buildLookupBrowserHelpFrame(document, {
          ...geometry,
          ...(options.query ? { query: options.query } : {}),
          ...(options.mode ? { mode: options.mode } : {}),
          collecting,
        });
      } else if (view === 'search' && document) {
        value = buildLookupBrowserSearchFrame(document, searchDraft, searchNotice, geometry);
      } else if (collecting) {
        value = buildLookupCollectionFrame(
          options.query,
          options.mode || 'fast',
          sourceOrder.map((source) => sourceStates.get(source)!),
          geometry,
        );
      } else if (document) {
        const searchStatus = searchQuery
          ? searchMatches.length
            ? `Match ${searchMatchIndex + 1}/${searchMatches.length}${searchTruncated ? '+' : ''} · ${safeTerminalValue(searchQuery, 'search')}`
            : `No matches · ${safeTerminalValue(searchQuery, 'search')}`
          : undefined;
        const frame = buildLookupBrowserFrame(document, {
          activeIndex,
          scrollOffset,
          ...geometry,
          environment,
          ...(searchStatus ? { searchStatus } : {}),
        });
        scrollOffset = frame.scrollOffset;
        maximumScrollOffset = frame.maximumScrollOffset;
        pageSize = Math.max(1, frame.pageSize);
        value = frame.value;
      } else {
        throw new Error('Lookup browser has no collection or final document to render.');
      }
      output.write(CLEAR_SCREEN);
      output.write(value);
    };
    const redraw = () => {
      try { render(); } catch (error) {
        if (collecting && !collectionController.signal.aborted) collectionController.abort(error);
        finish(error instanceof Error ? error : new Error('Lookup browser could not redraw.'));
      }
    };
    const cleanup = (): Error | null => {
      let failure: Error | null = null;
      const attempt = (operation: () => unknown) => {
        try { operation(); } catch (error) {
          failure ||= error instanceof Error ? error : new Error('Lookup browser terminal cleanup failed.');
        }
      };
      if (escapeTimer) clearTimeout(escapeTimer);
      escapeTimer = null;
      attempt(() => input.off?.('data', onData));
      attempt(() => input.off?.('end', onEnd));
      attempt(() => output.off?.('resize', onResize));
      attempt(() => options.signal?.removeEventListener('abort', onAbort));
      attempt(() => input.setRawMode?.(previousRaw));
      if (wasPaused) attempt(() => input.pause?.());
      attempt(() => output.write(LEAVE_ALTERNATE_SCREEN));
      return failure;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      const cleanupFailure = cleanup();
      if (error && cleanupFailure) {
        reject(new AggregateError(
          [error, cleanupFailure],
          `${error.message}; terminal cleanup also failed: ${cleanupFailure.message}`,
        ));
      } else if (error || cleanupFailure) reject(error || cleanupFailure!);
      else if (document) resolve(document);
      else reject(new Error('Lookup browser closed without a final document.'));
    };
    const clearSearch = () => {
      searchQuery = '';
      searchMatches = [];
      searchMatchIndex = 0;
      searchTruncated = false;
    };
    const movePanel = (offset: number, preserveSearch = false) => {
      if (!panels.length) return;
      activeIndex = (activeIndex + offset + panels.length) % panels.length;
      scrollOffset = 0;
      if (!preserveSearch) clearSearch();
      redraw();
    };
    const scrollBy = (offset: number) => {
      scrollOffset = Math.max(0, Math.min(maximumScrollOffset, scrollOffset + offset));
      redraw();
    };
    const scrollTo = (offset: number) => {
      scrollOffset = Math.max(0, Math.min(maximumScrollOffset, offset));
      redraw();
    };
    const cancelCollection = () => {
      const error = new DOMException('Aborted', 'AbortError');
      if (!collectionController.signal.aborted) collectionController.abort(error);
      finish(error);
    };
    const handleEscape = () => {
      if (view !== 'normal') {
        view = 'normal';
        searchDraft = '';
        searchNotice = '';
        redraw();
      } else if (collecting) cancelCollection();
      else finish();
    };
    const scheduleEscapeAction = () => {
      if (escapeTimer) return;
      escapeTimer = setTimeout(() => {
        escapeTimer = null;
        pendingInput = '';
        handleEscape();
      }, ESCAPE_SEQUENCE_WAIT_MS);
    };
    const scheduleIncompleteCsiDiscard = () => {
      if (escapeTimer) return;
      escapeTimer = setTimeout(() => {
        escapeTimer = null;
        pendingInput = '';
      }, ESCAPE_SEQUENCE_WAIT_MS);
    };
    const applySearchMatch = () => {
      const match = searchMatches[searchMatchIndex];
      if (!match) return;
      activeIndex = match.panelIndex;
      const panel = panels[match.panelIndex];
      scrollOffset = panel ? renderedPanelLineOffset(panel, match.lineIndex, renderedWidth) : 0;
      redraw();
    };
    const onResize = () => {
      if (searchMatches.length) {
        const match = searchMatches[searchMatchIndex];
        const panel = match ? panels[match.panelIndex] : null;
        const width = boundedBrowserDimensions(output.columns === undefined ? {} : { width: output.columns }).width;
        if (match && panel) scrollOffset = renderedPanelLineOffset(panel, match.lineIndex, width);
      }
      redraw();
    };
    const commitSearch = () => {
      searchQuery = searchDraft.trim();
      const result = findLookupBrowserMatches(panels, searchQuery);
      searchMatches = result.matches;
      searchTruncated = result.truncated;
      searchMatchIndex = 0;
      view = 'normal';
      searchDraft = '';
      searchNotice = '';
      if (searchMatches.length) applySearchMatch();
      else redraw();
    };
    const moveSearchMatch = (offset: number) => {
      if (!searchMatches.length) return;
      searchMatchIndex = (searchMatchIndex + offset + searchMatches.length) % searchMatches.length;
      applySearchMatch();
    };
    const appendSearchCharacter = (character: string) => {
      const candidate = `${searchDraft}${character}`;
      try {
        searchDraft = boundedSearchText(candidate);
        searchNotice = '';
      } catch (error) {
        searchNotice = error instanceof Error ? error.message : 'Search input exceeds its bound.';
      }
      redraw();
    };
    const processSearchCharacter = (character: string): boolean => {
      if (view !== 'search') return false;
      if (character === '\r' || character === '\n') {
        commitSearch();
        return true;
      }
      if (character === '\u0008' || character === '\u007f') {
        searchDraft = Array.from(searchDraft).slice(0, -1).join('');
        searchNotice = '';
        redraw();
        return true;
      }
      if (!/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(character)) {
        appendSearchCharacter(character);
      } else {
        searchNotice = 'Search input is not valid bounded UTF-8 text.';
        redraw();
      }
      return true;
    };
    const processPendingInput = () => {
      while (pendingInput && !settled) {
        if (pendingInput.startsWith('\u001b')) {
          if (pendingInput.length === 1) {
            scheduleEscapeAction();
            return;
          }
          if (pendingInput[1] === '[') {
            const sequence = pendingInput.match(COMPLETE_CSI_RE)?.[0];
            if (!sequence) {
              if (pendingInput.length < MAX_PENDING_INPUT_LENGTH) { scheduleIncompleteCsiDiscard(); return; }
              pendingInput = '';
              return;
            }
            pendingInput = pendingInput.slice(sequence.length);
            if (!collecting && view === 'normal') {
              if (sequence === '\u001b[D' || sequence === '\u001b[Z') movePanel(-1);
              else if (sequence === '\u001b[C') movePanel(1);
              else if (sequence === '\u001b[A') scrollBy(-1);
              else if (sequence === '\u001b[B') scrollBy(1);
              else if (sequence === '\u001b[5~') scrollBy(-pageSize);
              else if (sequence === '\u001b[6~') scrollBy(pageSize);
              else if (sequence === '\u001b[H' || sequence === '\u001b[1~') scrollTo(0);
              else if (sequence === '\u001b[F' || sequence === '\u001b[4~') scrollTo(maximumScrollOffset);
            }
            continue;
          }
          pendingInput = pendingInput.slice(1);
          handleEscape();
          continue;
        }
        const character = Array.from(pendingInput)[0]!;
        pendingInput = pendingInput.slice(character.length);
        if (character === '\u0003') {
          if (collecting) cancelCollection();
          else finish(new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (character === '\u0004') {
          cancelCollection();
          return;
        }
        if (processSearchCharacter(character)) continue;
        if (character === '?') {
          view = view === 'help' ? 'normal' : 'help';
          redraw();
          continue;
        }
        if (character === 'q' || character === 'Q') {
          if (collecting) cancelCollection();
          else finish();
          return;
        }
        if (collecting || view === 'help') continue;
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '/') {
          view = 'search';
          searchDraft = '';
          searchNotice = '';
          redraw();
        } else if (character === 'n') moveSearchMatch(1);
        else if (character === 'N') moveSearchMatch(-1);
        else if (character === '\t' || character === 'l' || character === 'L') movePanel(1);
        else if (character === 'h' || character === 'H') movePanel(-1);
        else if (character === 'j' || character === 'J') scrollBy(1);
        else if (character === 'k' || character === 'K') scrollBy(-1);
        else if (/^[1-9]$/u.test(character)) {
          const requested = Number(character) - 1;
          if (requested < panels.length) {
            activeIndex = requested;
            scrollOffset = 0;
            clearSearch();
            redraw();
          }
        }
      }
    };
    const onData = (chunk: unknown) => {
      if (escapeTimer) clearTimeout(escapeTimer);
      escapeTimer = null;
      let rawChunk: Buffer;
      if (Buffer.isBuffer(chunk)) {
        if (chunk.length > MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES) {
          inputDecoder = new StringDecoder('utf8');
          pendingInput = '';
          if (view === 'search') {
            searchNotice = `Search input is limited to ${MAX_LOOKUP_BROWSER_SEARCH_SCALARS} characters and ${MAX_LOOKUP_BROWSER_SEARCH_BYTES} UTF-8 bytes.`;
            redraw();
          }
          return;
        }
        rawChunk = chunk;
      } else {
        const supplied = String(chunk ?? '');
        if (supplied.length > MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES
          || Buffer.byteLength(supplied, 'utf8') > MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES) {
          inputDecoder = new StringDecoder('utf8');
          pendingInput = '';
          if (view === 'search') {
            searchNotice = `Search input is limited to ${MAX_LOOKUP_BROWSER_SEARCH_SCALARS} characters and ${MAX_LOOKUP_BROWSER_SEARCH_BYTES} UTF-8 bytes.`;
            redraw();
          }
          return;
        }
        rawChunk = Buffer.from(supplied, 'utf8');
      }
      const value = inputDecoder.write(rawChunk);
      if (value.includes('\ufffd')) {
        inputDecoder = new StringDecoder('utf8');
        pendingInput = '';
        if (view === 'search') {
          searchNotice = 'Search input must be valid UTF-8 text.';
          redraw();
        }
        return;
      }
      const combinedInput = `${pendingInput}${value}`;
      if (combinedInput.length > MAX_PENDING_INPUT_LENGTH) {
        inputDecoder = new StringDecoder('utf8');
        pendingInput = '';
        if (view === 'search') {
          searchNotice = `Search input is limited to ${MAX_LOOKUP_BROWSER_SEARCH_SCALARS} characters and ${MAX_LOOKUP_BROWSER_SEARCH_BYTES} UTF-8 bytes.`;
          redraw();
        }
        return;
      }
      pendingInput = combinedInput;
      processPendingInput();
    };
    const onEnd = () => cancelCollection();
    const onAbort = () => {
      const suppliedReason = options.signal?.reason;
      const error = suppliedReason instanceof Error && suppliedReason.name !== 'AbortError'
        ? suppliedReason
        : new DOMException('Aborted', 'AbortError');
      if (collecting && !collectionController.signal.aborted) collectionController.abort(error);
      finish(error);
    };
    const onSourceSettled = (settlement: LookupSourceSettlement) => {
      if (settled || !collecting) return;
      if (!sourceStates.has(settlement.source) || settledSourceIds.has(settlement.source)) {
        const error = new Error('Lookup browser received an unplanned or duplicate source settlement.');
        if (!collectionController.signal.aborted) collectionController.abort(error);
        finish(error);
        return;
      }
      settledSourceIds.add(settlement.source);
      const limitation = typeof settlement.fragment?.limitation === 'string'
        ? safeTerminalValue(settlement.fragment.limitation, 'Source limitation unavailable')
        : null;
      sourceStates.set(settlement.source, Object.freeze({
        source: settlement.source,
        state: settlement.state,
        complete: settlement.complete,
        truncated: settlement.truncated,
        limitation,
      }));
      redraw();
    };
    const startCollection = () => {
      if (settled || !collecting || !options.collect) return;
      void new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => {
          if (settled || collectionSignal.aborted) {
            throw collectionSignal.reason || new DOMException('Aborted', 'AbortError');
          }
          return options.collect!({ signal: collectionSignal, onSourceSettled });
        })
        .then((nextDocument) => {
          if (settled) return;
          if (!nextDocument || typeof nextDocument !== 'object' || Array.isArray(nextDocument)) {
            throw new TypeError('Lookup collection did not return one final document.');
          }
          document = nextDocument;
          panels = buildLookupBrowserPanels(nextDocument);
          collecting = false;
          view = 'normal';
          activeIndex = 0;
          scrollOffset = 0;
          redraw();
        })
        .catch((error: unknown) => {
          if (settled) return;
          finish(error instanceof Error ? error : new Error('Lookup collection failed.'));
        });
    };

    try {
      output.write(ENTER_ALTERNATE_SCREEN);
      input.on?.('data', onData);
      input.on?.('end', onEnd);
      output.on?.('resize', onResize);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      input.setRawMode?.(true);
      if (settled) return;
      render();
      if (settled) return;
      input.resume?.();
      startCollection();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Lookup browser could not start.'));
    }
  });
}

function browseLookupDocument(document: UnknownRecord, options: LookupBrowserOptions): Promise<void> {
  return runLookupBrowserSession({ ...options, document }).then(() => undefined);
}

function browseLookupOperation(options: LookupBrowserOperationOptions): Promise<UnknownRecord> {
  return runLookupBrowserSession(options);
}

export {
  MAX_LOOKUP_BROWSER_PANELS,
  MAX_LOOKUP_BROWSER_INPUT_CHUNK_BYTES,
  MAX_LOOKUP_BROWSER_SEARCH_BYTES,
  MAX_LOOKUP_BROWSER_SEARCH_MATCHES,
  MAX_LOOKUP_BROWSER_SEARCH_SCALARS,
  browseLookupOperation,
  browseLookupDocument,
  boundedSearchText,
  buildLookupBrowserHelpFrame,
  buildLookupBrowserFrame,
  buildLookupBrowserPanels,
  buildLookupBrowserSearchFrame,
  buildLookupCollectionFrame,
  canBrowseLookup,
  findLookupBrowserMatches,
  renderedPanelLineOffset,
  renderLookupBrowser,
  terminalDisplayWidth,
};
export type {
  LookupBrowserCollectionContext,
  LookupBrowserInput,
  LookupBrowserOperationOptions,
  LookupBrowserOptions,
  LookupBrowserOutput,
  LookupBrowserPanel,
};
