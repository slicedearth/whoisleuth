import { array, exact, iso, record, text } from '../evidence/artifact-structure.mts';
import { pageObservationOrigin } from './page-behaviour.mts';
import { CONTEXT_REVIEW_SCHEMA, CONTEXT_REVIEW_VERSION, MAX_CONTEXT_RECORDS, MAX_CONTEXT_INPUT_BYTES, type ContextObservation, type ContextReview } from '../contracts/context-review.mts';
import { parseBoundedJson } from '../analysis/bounded-json.mts';

export { CONNECTOR_INPUT_SCHEMA, CONNECTOR_INPUT_VERSION } from '../contracts/context-review.mts';
export type ConnectorMetadata = Readonly<{ name: string; transport: 'remote' | 'local' | 'ambiguous' | 'unknown'; enabled: 'enabled' | 'disabled' | 'unknown'; origin: string | null; executable: string | null; package: string | null;
  argumentCount: number; environmentCount: number; headerCount: number; authenticationDeclared: boolean; declaredCapabilities: readonly string[]; unsupportedFields: number; privateLocationOmitted: boolean }>;
const KNOWN_FIELDS = new Set(['url', 'serverUrl', 'command', 'args', 'env', 'headers', 'type', 'transport', 'disabled', 'enabled', 'capabilities', 'package', 'oauth', 'auth']);
const CAPABILITIES = ['tools', 'resources', 'prompts', 'logging', 'completions'] as const;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9.+_-]*)?$/u;

function countObject(value: unknown, label: string): number {
  if (value === undefined) return 0;
  const keys = Object.keys(record(value, label));
  if (keys.length > MAX_CONTEXT_RECORDS) throw new TypeError(`${label} exceeds the metadata bound.`);
  return keys.length;
}

/** Configuration is data only. Values of arguments, environment, headers and auth are never returned. */
export function readConnectorConfiguration(raw: unknown): ConnectorMetadata[] {
  const root = record(raw, 'Connector configuration');
  const roots = ['mcpServers', 'servers'].filter(key => Object.hasOwn(root, key));
  if (roots.length !== 1) throw new TypeError('Select a configuration with exactly one mcpServers or servers object.');
  if (Object.keys(root).some(key => !roots.includes(key))) throw new TypeError('Select only the connector configuration section; unrelated settings are not reviewed.');
  const entries = Object.entries(record(root[roots[0]!], 'Connector entries'));
  if (entries.length > MAX_CONTEXT_RECORDS) throw new TypeError('Connector count exceeds the review bound.');
  return entries.map(([name, value]) => {
    text(name, 'Connector name', 200);
    const item = record(value, 'Connector definition');
    if (Object.keys(item).length > MAX_CONTEXT_RECORDS) throw new TypeError('Connector definition exceeds the field bound.');
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean' || item.disabled !== undefined && typeof item.disabled !== 'boolean'
      || item.enabled !== undefined && item.disabled !== undefined && item.enabled === item.disabled) throw new TypeError('Connector enablement declarations are invalid or conflicting.');
    const suppliedUrl = item.url ?? item.serverUrl;
    if (item.url !== undefined && item.serverUrl !== undefined && item.url !== item.serverUrl) throw new TypeError('Conflicting connector URL declarations require a deliberate selection.');
    const origin = suppliedUrl === undefined ? null : pageObservationOrigin(suppliedUrl);
    if (suppliedUrl !== undefined && !origin) throw new TypeError('Remote connector URL must be bounded HTTP(S) without credentials.');
    const command = item.command === undefined ? null : text(item.command, 'Local connector command', 2_000);
    const basename = command?.split(/[\\/]/u).at(-1) ?? null;
    const executable = basename && /^[A-Za-z0-9._-]{1,120}$/u.test(basename) ? basename : null;
    const args = item.args === undefined ? [] : array(item.args, 'Connector arguments', MAX_CONTEXT_RECORDS).map(value => text(value, 'Connector argument', 8_192, true));
    let packageIdentity: string | null = item.package === undefined ? null : text(item.package, 'Declared connector package', 240);
    if (packageIdentity !== null && !PACKAGE.test(packageIdentity)) throw new TypeError('Declared package must be a package identity, not an executable expression or URL.');
    if (packageIdentity === null && ['npx', 'npx.cmd', 'uvx'].includes(executable ?? '')) {
      // Only a simple first package operand is interpreted. Complex invocations remain unknown.
      const operands = args.filter(value => !['--yes', '-y', '--no-install'].includes(value));
      if (operands[0] && PACKAGE.test(operands[0])) packageIdentity = operands[0];
    }
    const capabilityObject = item.capabilities === undefined ? {} : record(item.capabilities, 'Declared capabilities');
    if (Object.keys(capabilityObject).length > MAX_CONTEXT_RECORDS) throw new TypeError('Declared capabilities exceed the bound.');
    return { name, transport: origin && command ? 'ambiguous' : origin ? 'remote' : command ? 'local' : 'unknown', enabled: item.enabled === false || item.disabled === true ? 'disabled' : item.enabled === true || item.disabled === false ? 'enabled' : 'unknown', origin, executable, package: packageIdentity,
      argumentCount: args.length, environmentCount: countObject(item.env, 'Environment metadata'), headerCount: countObject(item.headers, 'Header metadata'),
      authenticationDeclared: item.auth !== undefined || item.oauth !== undefined,
      declaredCapabilities: CAPABILITIES.filter(key => Object.hasOwn(capabilityObject, key) && capabilityObject[key] !== false && capabilityObject[key] !== null),
      unsupportedFields: Object.keys(item).filter(key => !KNOWN_FIELDS.has(key)).length + Object.keys(capabilityObject).filter(key => !(CAPABILITIES as readonly string[]).includes(key)).length,
      privateLocationOmitted: suppliedUrl !== undefined && new URL(suppliedUrl as string).href !== `${origin}/` || command !== null && command !== executable,
    } satisfies ConnectorMetadata;
  });
}

export function connectorProvenancePresentation(raw: unknown, reviewedAt: string): Readonly<{ report: ContextReview; connectors: readonly ConnectorMetadata[] }> {
  iso(reviewedAt, 'Review time');
  const input = exact(raw, ['current', 'previous'], 'Connector review');
  const current = readConnectorConfiguration(input.current), previous = input.previous === null ? null : readConnectorConfiguration(input.previous);
  const signature = (row: ConnectorMetadata) => JSON.stringify([row.transport, row.enabled, row.origin, row.executable, row.package, row.argumentCount, row.environmentCount, row.headerCount, row.authenticationDeclared, row.declaredCapabilities]);
  const observations: ContextObservation[] = current.map(row => {
    const old = previous?.find(value => value.name === row.name);
    const changed = old ? signature(old) !== signature(row) : false;
    return { label: `${row.name} · ${row.transport} connector`, state: row.transport === 'unknown' || row.transport === 'ambiguous' || row.unsupportedFields ? 'partial' : changed ? 'changed' : 'reported',
      detail: `Declared enablement: ${row.enabled}. Endpoint: ${row.origin ?? 'not supplied'}; executable: ${row.executable ?? 'not retained or unknown'}; package: ${row.package ?? 'not established'}. Arguments: ${row.argumentCount}; environment entries: ${row.environmentCount}; headers: ${row.headerCount}; auth declaration ${row.authenticationDeclared ? 'present' : 'not supplied'}. Capabilities: ${row.declaredCapabilities.join(', ') || 'not declared'}. ${previous ? old ? changed ? 'Retained metadata changed.' : 'Retained metadata matches; excluded values were not compared.' : 'Newly listed connector.' : 'No earlier configuration selected.'}${row.unsupportedFields ? ` Uninterpreted fields: ${row.unsupportedFields}.` : ''}${row.privateLocationOmitted ? ' Private location detail omitted.' : ''}`,
      source: 'Analyst-selected local configuration; declarations were not negotiated with a server', observedAt: null, hostname: row.origin ? new URL(row.origin).hostname : null };
  });
  for (const row of previous ?? []) if (!current.some(value => value.name === row.name)) observations.push({ label: `${row.name} · no longer listed`, state: 'changed', detail: 'Absent from the selected current configuration; this does not establish that a process or endpoint has stopped.', source: 'Selected configuration comparison', observedAt: null, hostname: row.origin ? new URL(row.origin).hostname : null });
  const report: ContextReview = { schema: CONTEXT_REVIEW_SCHEMA, version: CONTEXT_REVIEW_VERSION, kind: 'connector', reviewedAt, title: 'Connector provenance', state: !current.length || observations.some(row => row.state === 'partial') ? 'partial' : 'reviewed',
    summary: `Configured connectors: ${current.length}${previous ? `; earlier configuration entries: ${previous.length}` : ''}. Commands were not run and endpoints were not contacted.`, observations,
    nextSteps: ['Verify package publisher, exact version, installation source and requested privileges through a trusted source before enabling a local connector.', 'For remote connectors, investigate the endpoint domain separately and review authentication and data-sharing scope before granting access.', 'Review tool, resource and prompt capabilities against the task. Configuration declarations are not evidence of negotiated capabilities or trustworthy behaviour.'],
    limitations: ['Arguments, local paths, environment values, header values, auth material and URL paths or queries are excluded from this report. Names and package identities remain visible; review them before sharing.', 'Matching retained metadata does not mean excluded values are unchanged. This is not code execution, a server connection, a protocol conformance test or safety certification.'] };
  return { report, connectors: current };
}

export function reviewConnectorProvenance(raw: unknown, reviewedAt: string): ContextReview {
  return connectorProvenancePresentation(raw, reviewedAt).report;
}

export function reviewConnectorConfigurationText(current: string, previous: string, reviewedAt: string): ContextReview {
  return connectorConfigurationPresentation(current, previous, reviewedAt).report;
}

/** Browser presentation receives only the same minimised metadata as the report. */
export function connectorConfigurationPresentation(current: string, previous: string, reviewedAt: string) {
  if (typeof current !== 'string' || typeof previous !== 'string') throw new TypeError('Select connector configuration text.');
  const parse = (value: string) => parseBoundedJson(value, { label: 'Connector configuration', maximumBytes: MAX_CONTEXT_INPUT_BYTES });
  return connectorProvenancePresentation({ current: parse(current), previous: previous.trim() ? parse(previous) : null }, reviewedAt);
}
