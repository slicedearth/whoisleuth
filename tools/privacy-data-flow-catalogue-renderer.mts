import {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
} from '../cli/command-catalogue.mts';
import { CLI_COMMAND_REGISTRY } from '../cli/command-reference.mts';
import { CAPABILITY_MANIFEST } from '../packages/contracts/capability-manifest.mts';
import {
  buildPrivacyDataFlowCatalogue,
  serialisePrivacyDataFlowCatalogue,
  type PrivacyDataFlowCatalogue,
} from '../packages/contracts/privacy-data-flow-catalogue.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { tokenLabel } from './capability-manifest-renderer.mts';

const CLI_PRIVACY_SOURCES = Object.freeze(CLI_COMMAND_REGISTRY.map((definition) => Object.freeze({
  recordId: `command.cli.${definition.command}` as const,
  command: definition.command,
  title: definition.completion.description,
  requestPurpose: definition.collection.scope,
  privacyBoundary: definition.reference.boundary,
  collectionMode: definition.collection.mode,
  networkEffect: definition.execution.networkEffect,
})));

export const PRIVACY_DATA_FLOW_CATALOGUE = buildPrivacyDataFlowCatalogue({
  capabilityManifest: CAPABILITY_MANIFEST,
  cliCommandCatalogue: {
    schema: CLI_COMMAND_CATALOGUE_SCHEMA,
    version: CLI_COMMAND_CATALOGUE_VERSION,
    commands: CLI_PRIVACY_SOURCES,
  },
  schemaLifecycleRegistry: SCHEMA_LIFECYCLE_REGISTRY,
});

function markdownCell(value: string): string {
  return value
    .replace(/[\x00-\x1f\x7f]+/gu, ' ')
    .replace(/\\/gu, '\\\\')
    .replace(/\|/gu, '\\|')
    .replace(/`/gu, '\\`');
}

function tokenList(values: readonly string[]): string {
  return values.map((value) => markdownCell(tokenLabel(value))).join('<br>');
}

export function principalPrivacyBoundarySummary(
  catalogue: PrivacyDataFlowCatalogue = PRIVACY_DATA_FLOW_CATALOGUE,
): string {
  return `Contract ${catalogue.schema} version ${catalogue.version} derives its coverage from the canonical capability, command, lifecycle, privacy-profile, and consumer-flow owners. It distinguishes transient processing, browser-local retention, deliberate local-file export, hosted bounded processing, configured worker storage, third-party disclosure and offline processing with no request.`;
}

export function humanPrivacySummary(
  catalogue: PrivacyDataFlowCatalogue = PRIVACY_DATA_FLOW_CATALOGUE,
) {
  const requiredClasses = [
    'transient_processing',
    'browser_local_retention',
    'deliberate_local_file_export',
    'configured_worker_storage',
    'third_party_disclosure',
    'offline_processing_no_request',
  ] as const;
  const availableClasses = new Set(catalogue.processingClasses.map((item) => item.id));
  for (const id of requiredClasses) {
    if (!availableClasses.has(id)) throw new Error(`Human privacy summary requires processing class ${id}.`);
  }
  const retentionModes = new Set(catalogue.capabilityFlows.map((flow) => flow.retention.mode));
  for (const mode of ['transient', 'browser_deliberate', 'local_output_deliberate', 'worker_compact_encrypted']) {
    if (!retentionModes.has(mode)) throw new Error(`Human privacy summary requires retention mode ${mode}.`);
  }
  const scheduledMonitoring = catalogue.capabilityFlows.find((flow) => flow.id === 'scheduled_monitoring');
  if (!scheduledMonitoring || scheduledMonitoring.retention.mode !== 'worker_compact_encrypted') {
    throw new Error('Human privacy summary requires the canonical optional scheduled-monitoring boundary.');
  }
  return Object.freeze([
    Object.freeze({
      id: 'leaves-device',
      question: 'What leaves the device?',
      answer: 'A deliberate network-capable operation sends only its declared bounded target or evidence classes to the relevant hosted service, registry, DNS resolver, target service or explicitly selected provider. Offline review, plans, public catalogue filtering and documentation make no investigation request.',
    }),
    Object.freeze({
      id: 'stays-browser',
      question: 'What stays in the browser?',
      answer: 'Only deliberately retained bounded workspace records, such as Cases, profiles, watchlists and Review Item decisions, stay in the current browser profile or tab. They are not copied to hosted custody unless a separate documented action says so.',
    }),
    Object.freeze({
      id: 'hosted-monitoring',
      question: 'What does optional hosted monitoring store?',
      answer: `${scheduledMonitoring.title} retains only its documented compact application-encrypted projection and bounded store metadata under operator control. It is not general evidence custody, and disabling collection does not delete retained ciphertext.`,
    }),
    Object.freeze({
      id: 'retention',
      question: 'How long does retained data remain?',
      answer: 'Transient data lasts only for the bounded operation or cache lifetime. Browser-local data remains until the user deletes it or clears site data; optional worker data follows the configured retention and deliberate-deletion policy; downloaded files remain under the operator’s control.',
    }),
    Object.freeze({
      id: 'export-delete',
      question: 'How do users export or delete it?',
      answer: 'Exports require an explicit browser or CLI action. Users can delete browser records, site data and downloaded files. Scheduled-watchlist deletion rewrites encrypted logical state; its storage object needs separate hosting-operator deletion.',
    }),
  ] as const);
}

export function renderPrivacyDataFlowCatalogueJson(
  catalogue: PrivacyDataFlowCatalogue = PRIVACY_DATA_FLOW_CATALOGUE,
): string {
  return serialisePrivacyDataFlowCatalogue(catalogue);
}

export function renderPrivacyDataFlowCatalogueMarkdown(
  catalogue: PrivacyDataFlowCatalogue = PRIVACY_DATA_FLOW_CATALOGUE,
): string {
  const coverage = catalogue.coverage;
  const lines = [
    '# Privacy and data-flow catalogue',
    '',
    '> Generated from the canonical capability manifest, CLI command catalogue and schema lifecycle registry. Run `npm run privacy:check` to verify this file and the machine-readable catalogue.',
    '',
    `Contract: \`${catalogue.schema}\` version ${catalogue.version}.`,
    '',
    principalPrivacyBoundarySummary(catalogue),
    '',
    'The catalogue is fixed metadata. Reading this document or its JSON counterpart does not make a request, enable a capability, inspect a deployment or retain investigation data.',
    '',
    '## Coverage boundary',
    '',
    `- Capability input: \`${coverage.capabilityManifest.schema}\` version ${coverage.capabilityManifest.version}.`,
    `- CLI input: \`${coverage.cliCommandCatalogue.schema}\` version ${coverage.cliCommandCatalogue.version}.`,
    `- Schema lifecycle input: ${coverage.schemaLifecycleRegistry.familyCount} registered families and metadata versions ${coverage.schemaLifecycleRegistry.metadataVersions.join(', ')}.`,
    `- Outside-registry inventory: **${coverage.outsideLifecycleRegistry.classification.replaceAll('_', ' ')}**. ${coverage.outsideLifecycleRegistry.reason}`,
    '',
    '## Processing classes',
    '',
  ];
  for (const definition of catalogue.processingClasses) {
    lines.push(`- **${markdownCell(definition.title)}:** ${markdownCell(definition.description)}`);
  }
  lines.push('', '## Fixed interpretation boundaries', '');
  for (const invariant of catalogue.invariants) lines.push(`- ${markdownCell(invariant)}`);

  lines.push(
    '',
    '## Capability families',
    '',
    '| Capability | Purpose | Plane and network | Sent to recipients | Returned categories | Retention and storage | Deliberate export | Scoring |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const flow of catalogue.capabilityFlows) {
    lines.push(`| \`${markdownCell(flow.id)}\`<br>${markdownCell(flow.title)} | ${markdownCell(flow.requestPurpose)} | ${tokenList(flow.executionPlanes)}<br>${markdownCell(tokenLabel(flow.networkMode))} | ${tokenList(flow.dataSent)}<br>Recipients: ${tokenList(flow.recipientClasses)} | ${tokenList(flow.returnedDataCategories)} | ${markdownCell(tokenLabel(flow.retention.mode))}<br>${markdownCell(tokenLabel(flow.retention.storageClass))}<br>${markdownCell(tokenLabel(flow.retention.durationControl))} | ${markdownCell(tokenLabel(flow.exports.mode))} | ${markdownCell(tokenLabel(flow.scoringEffect))} |`);
  }

  lines.push(
    '',
    '## CLI operations',
    '',
    'Every operation below is joined to the exact installed command identity. Variant rows appear only where the request, authorisation, disclosure, cancellation or result boundary differs.',
    '',
    '| Operation | Purpose | Network and authorisation | Sent to recipients | Returned categories | Retention and export | Outcomes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const flow of catalogue.cliOperationFlows) {
    lines.push(`| \`${markdownCell(flow.id)}\`<br>${markdownCell(flow.title)} | ${markdownCell(flow.requestPurpose)} | ${markdownCell(tokenLabel(flow.networkMode))}<br>${markdownCell(tokenLabel(flow.authorisation))} | ${tokenList(flow.dataSent)}<br>Recipients: ${tokenList(flow.recipientClasses)} | ${tokenList(flow.returnedDataCategories)} | ${markdownCell(tokenLabel(flow.retention.mode))}<br>Export: ${markdownCell(tokenLabel(flow.exports.mode))} | ${tokenList(flow.outcomes)} |`);
    for (const variant of flow.variants) {
      lines.push(`| ↳ \`${markdownCell(variant.variantId)}\` | ${markdownCell(variant.requestPurpose)} | ${markdownCell(tokenLabel(variant.networkMode))}<br>${markdownCell(tokenLabel(variant.authorisation))} | ${tokenList(variant.dataSent)}<br>Recipients: ${tokenList(variant.recipientClasses)} | ${tokenList(variant.returnedDataCategories)} | ${markdownCell(tokenLabel(variant.retention.mode))}<br>Export: ${markdownCell(tokenLabel(variant.exports.mode))} | ${tokenList(variant.outcomes)} |`);
    }
  }

  lines.push(
    '',
    '## Registered schema privacy coverage',
    '',
    'The machine-readable catalogue contains every exact compatibility, privacy-profile and consumer-flow join. This concise view reports the family-level closure without repeating the complete registry.',
    '',
    '| Lifecycle family | Privacy class | Contracts | Privacy profiles | Consumer flows |',
    '| --- | --- | ---: | ---: | ---: |',
  );
  for (const family of catalogue.schemaFamilies) {
    lines.push(`| \`${markdownCell(family.id)}\` | ${markdownCell(tokenLabel(family.privacyClass))} | ${family.compatibilityIds.length} | ${family.privacyProfileIds.length} | ${family.consumerFlowIds.length} |`);
  }
  lines.push(
    '',
    '## Machine-readable form',
    '',
    'The byte-exact version-1 document is [`privacy-data-flow-catalogue.json`](privacy-data-flow-catalogue.json). Unknown keys and future or legacy catalogue versions fail closed.',
    '',
  );
  return lines.join('\n');
}
