import { resolvePublicAddresses } from '../lib/safe-fetch.mts';
import { withTimeout } from '../lib/abort.mts';
import { whoisQuery } from '../lib/whois-transport.mts';
import type { TerminalPresentation } from './terminal-presentation.mts';

const DOCTOR_SCHEMA = 'whoisleuth.cli.doctor';
const DOCTOR_VERSION = 1;
const MINIMUM_NODE_MAJOR = 24;
const NETWORK_HOST = 'whois.iana.org';
const NETWORK_QUERY = 'example.com';
const NETWORK_TIMEOUT_MS = 6_000;
const MAX_DOCTOR_DETAIL_LENGTH = 180;

type DoctorState = 'pass' | 'partial' | 'skipped';
type DoctorCheck = Readonly<{
  id: string;
  label: string;
  state: DoctorState;
  detail: string;
}>;
type DoctorReport = Readonly<{
  schema: typeof DOCTOR_SCHEMA;
  version: typeof DOCTOR_VERSION;
  generatedAt: string;
  cliVersion: string;
  state: 'pass' | 'partial';
  networkRequested: boolean;
  checks: readonly DoctorCheck[];
}>;
type DoctorOptions = Readonly<{
  version: string;
  generatedAt: string;
  network: boolean;
  presentation: TerminalPresentation;
  nodeVersion?: string;
  platform?: string;
  architecture?: string;
  resolveAddresses?: typeof resolvePublicAddresses;
  queryWhois?: typeof whoisQuery;
  networkTimeoutMs?: number;
}>;

function boundedDetail(value: unknown, fallback: string): string {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_DOCTOR_DETAIL_LENGTH) || fallback;
}

function parseNodeMajor(version: string): number {
  const major = Number(version.split('.')[0]);
  return Number.isSafeInteger(major) && major >= 0 ? major : 0;
}

async function buildDoctorReport(options: DoctorOptions): Promise<DoctorReport> {
  const nodeVersion = boundedDetail(options.nodeVersion || process.versions.node, 'unknown');
  const nodeSupported = parseNodeMajor(nodeVersion) >= MINIMUM_NODE_MAJOR;
  const checks: DoctorCheck[] = [
    Object.freeze({
      id: 'runtime',
      label: 'Node runtime',
      state: nodeSupported ? 'pass' : 'partial',
      detail: nodeSupported
        ? `Node ${nodeVersion} satisfies the supported Node ${MINIMUM_NODE_MAJOR}+ runtime.`
        : `Node ${nodeVersion} is below the supported Node ${MINIMUM_NODE_MAJOR}+ runtime.`,
    }),
    Object.freeze({
      id: 'platform',
      label: 'Platform',
      state: 'pass',
      detail: `${boundedDetail(options.platform || process.platform, 'unknown')} · ${boundedDetail(options.architecture || process.arch, 'unknown')}`,
    }),
    Object.freeze({
      id: 'terminal',
      label: 'Terminal presentation',
      state: 'pass',
      detail: options.presentation.interactive
        ? `Interactive terminal detected at ${options.presentation.width || 'unknown'} columns; semantic colour ${options.presentation.color ? 'enabled' : 'disabled'}.`
        : 'Non-interactive output detected; colour, wrapping, and transient progress are disabled.',
    }),
    Object.freeze({
      id: 'offline_features',
      label: 'Offline features',
      state: 'pass',
      detail: 'Help, completion, registry coverage, lookalike generation, archive inspection, comparison, export, and signature verification are available without network access.',
    }),
  ];

  if (!options.network) {
    checks.push(Object.freeze({
      id: 'network',
      label: 'Network checks',
      state: 'skipped',
      detail: 'Not requested. Run doctor --network to test bounded public DNS and WHOIS connectivity.',
    }));
  } else {
    const resolve = options.resolveAddresses || resolvePublicAddresses;
    const query = options.queryWhois || whoisQuery;
    const networkTimeoutMs = Number.isSafeInteger(options.networkTimeoutMs)
      && Number(options.networkTimeoutMs) >= 1
      && Number(options.networkTimeoutMs) <= NETWORK_TIMEOUT_MS
      ? Number(options.networkTimeoutMs)
      : NETWORK_TIMEOUT_MS;
    try {
      const addresses = await withTimeout(
        () => resolve(NETWORK_HOST),
        networkTimeoutMs,
        `Public DNS check timed out after ${networkTimeoutMs} ms.`,
      );
      checks.push(Object.freeze({
        id: 'public_dns',
        label: 'Public DNS',
        state: addresses.length > 0 ? 'pass' : 'partial',
        detail: addresses.length > 0
          ? `${addresses.length} public address${addresses.length === 1 ? '' : 'es'} validated; addresses were not retained.`
          : 'The fixed diagnostic host returned no validated public addresses.',
      }));
    } catch (error) {
      checks.push(Object.freeze({
        id: 'public_dns',
        label: 'Public DNS',
        state: 'partial',
        detail: boundedDetail(error && typeof error === 'object' && 'message' in error ? error.message : error, 'Public DNS check failed.'),
      }));
    }
    try {
      const response = await query(NETWORK_HOST, NETWORK_QUERY, {
        timeoutMs: Math.max(1, networkTimeoutMs - 1_000),
        totalDeadlineMs: networkTimeoutMs,
      });
      checks.push(Object.freeze({
        id: 'whois_transport',
        label: 'WHOIS transport',
        state: response.trim() ? 'pass' : 'partial',
        detail: response.trim()
          ? 'A bounded port 43 response was received; response content was not retained.'
          : 'The fixed diagnostic query returned an empty response.',
      }));
    } catch (error) {
      checks.push(Object.freeze({
        id: 'whois_transport',
        label: 'WHOIS transport',
        state: 'partial',
        detail: boundedDetail(error && typeof error === 'object' && 'message' in error ? error.message : error, 'WHOIS transport check failed.'),
      }));
    }
  }

  const state = checks.some((check) => check.state === 'partial') ? 'partial' : 'pass';
  return Object.freeze({
    schema: DOCTOR_SCHEMA,
    version: DOCTOR_VERSION,
    generatedAt: options.generatedAt,
    cliVersion: options.version,
    state,
    networkRequested: options.network,
    checks: Object.freeze(checks),
  });
}

function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    'Runtime:',
    `CLI version    ${report.cliVersion}`,
    `Overall        ${report.state === 'pass' ? 'Pass' : 'Partial'}`,
    '',
  ];
  for (const check of report.checks) {
    lines.push(`[${check.state.toUpperCase()}] ${check.label}`);
    lines.push(`  Detail       ${check.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

export {
  DOCTOR_SCHEMA,
  DOCTOR_VERSION,
  MAX_DOCTOR_DETAIL_LENGTH,
  MINIMUM_NODE_MAJOR,
  NETWORK_TIMEOUT_MS,
  buildDoctorReport,
  formatDoctorReport,
};
export type { DoctorCheck, DoctorOptions, DoctorReport, DoctorState };
