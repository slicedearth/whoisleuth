import { fetchHomepage } from '../lib/availability.mts';
import { searchCertificateTransparency } from '../lib/ct-search.mts';
import { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } from '../lib/domain-posture.mts';
import { collectTlsIntelligence, normalizeTlsHostname } from '../lib/tls-intelligence.mts';
import type { CliArguments } from './arguments.mts';
import { CliUsageError } from './errors.mts';
import {
  buildCliCtSearchDocument,
  buildCliHttpDocument,
  buildCliPostureDocument,
  buildCliTlsDocument,
  formatJsonDocument,
} from './formatters/json.mts';
import {
  formatTerminalCtSearch,
  formatTerminalHttp,
  formatTerminalPosture,
  formatTerminalTls,
} from './formatters/terminal.mts';
import { buildHttpProbeResult } from './http.mts';
import { normalizePostureSelectors } from './posture.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import type { UnknownRecord } from './saved-lookup.mts';
import EXIT_CODES from './exit-codes.mts';
import { buildPostureSarif } from './ci-report.mts';

type NetworkCommandArguments = Extract<CliArguments, {
  action: 'ct-search' | 'posture' | 'http' | 'tls';
}>;

async function runNetworkCommand(
  args: NetworkCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  if (args.action === 'ct-search') {
    const keyword = args.keyword || await context.readSingleInput();
    if (!keyword) throw new CliUsageError('ct-search requires one keyword as an argument or on stdin.');
    const search = dependencies.searchCertificateTransparency || searchCertificateTransparency;
    const result = await context.withProgress('Searching certificate observations', () => search(keyword));
    const document = buildCliCtSearchDocument(keyword, result as UnknownRecord, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatTerminalCtSearch(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'posture') {
    const requestedDomain = args.domain || await context.readSingleInput();
    if (!requestedDomain) throw new CliUsageError('posture requires one domain as an argument or on stdin.');
    const normalizeDomain = dependencies.normalizeAuditDomain || normalizeAuditDomain;
    const domain = normalizeDomain(requestedDomain);
    if (!domain) throw new CliUsageError('posture requires a valid domain name.');
    const normalizeSelectors = dependencies.normalizeDkimSelectors || normalizeDkimSelectors;
    const dkimSelectors = normalizePostureSelectors(args.selectorText, normalizeSelectors);
    const retiredDkimSelectors = normalizePostureSelectors(args.retiredSelectorText, normalizeSelectors)
      .filter((selector) => !dkimSelectors.includes(selector))
      .slice(0, Math.max(0, 10 - dkimSelectors.length));
    const audit = dependencies.checkDomainPosture || checkDomainPosture;
    const report = await context.withProgress('Collecting domain posture evidence', () => audit(domain, {
      dkimSelectors,
      retiredDkimSelectors,
      mailProtectionProfile: args.mailProfile,
    }));
    const document = buildCliPostureDocument(requestedDomain, report as UnknownRecord, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : args.output === 'sarif'
          ? formatJsonDocument(buildPostureSarif(document))
          : context.terminal(formatTerminalPosture(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'http') {
    const requestedDomain = args.domain || await context.readSingleInput();
    if (!requestedDomain) throw new CliUsageError('http requires one domain as an argument or on stdin.');
    const normalizeDomain = dependencies.normalizeAuditDomain || normalizeAuditDomain;
    const domain = normalizeDomain(requestedDomain);
    if (!domain) throw new CliUsageError('http requires a valid domain name.');
    const probe = dependencies.fetchHomepage || fetchHomepage;
    const result = buildHttpProbeResult(
      domain,
      await context.withProgress('Inspecting the homepage request', () => probe(domain)),
    );
    const document = buildCliHttpDocument(requestedDomain, result, context.now());
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatTerminalHttp(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  const requestedHostname = args.hostname || await context.readSingleInput();
  if (!requestedHostname) throw new CliUsageError('tls requires one hostname as an argument or on stdin.');
  const normalizeHostname = dependencies.normalizeTlsHostname || normalizeTlsHostname;
  const hostname = normalizeHostname(requestedHostname);
  if (!hostname) throw new CliUsageError('tls requires a valid DNS hostname, not an IP address.');
  const collect = dependencies.collectTlsIntelligence || collectTlsIntelligence;
  const result = await context.withProgress('Inspecting the current TLS connection', () => collect(hostname));
  const document = buildCliTlsDocument(requestedHostname, result as UnknownRecord, context.now());
  if (!args.quiet) {
    context.writeStdout(args.output === 'json'
      ? formatJsonDocument(document)
      : context.terminal(formatTerminalTls(document), args.color));
  }
  return EXIT_CODES.SUCCESS;
}

export { runNetworkCommand };
