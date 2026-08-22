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
  const capability = catalogue.coverage.capabilityManifest;
  const lifecycle = catalogue.coverage.schemaLifecycleRegistry;
  return `Contract ${catalogue.schema} version ${catalogue.version} covers ${capability.capabilityCount} capability families, ${capability.cliOperationCount} CLI operations, ${capability.cliVariantCount} conditional CLI variants, ${lifecycle.compatibilityCount} registered compatibility entries, ${lifecycle.privacyProfileCount} privacy profiles and ${lifecycle.consumerFlowCount} consumer flows. It distinguishes transient processing, browser-local retention, deliberate local-file export, hosted bounded processing, configured worker storage, third-party disclosure and offline processing with no request.`;
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

export function renderPrivacyDataFlowSummaryModule(
  catalogue: PrivacyDataFlowCatalogue = PRIVACY_DATA_FLOW_CATALOGUE,
): string {
  const capability = catalogue.coverage.capabilityManifest;
  const lifecycle = catalogue.coverage.schemaLifecycleRegistry;
  const principalBoundaries = catalogue.processingClasses.map((item) => item.title);
  return `export const PRIVACY_DATA_FLOW_SUMMARY = Object.freeze({\n  version: ${catalogue.version},\n  capabilityCount: ${capability.capabilityCount},\n  cliOperationCount: ${capability.cliOperationCount},\n  cliVariantCount: ${capability.cliVariantCount},\n  schemaFamilyCount: ${lifecycle.familyCount},\n  schemaContractCount: ${lifecycle.compatibilityCount},\n  privacyProfileCount: ${lifecycle.privacyProfileCount},\n  consumerFlowCount: ${lifecycle.consumerFlowCount},\n  principalBoundaries: Object.freeze(${JSON.stringify(principalBoundaries, null, 2).replaceAll('\n', '\n  ')}),\n  summary: ${JSON.stringify(principalPrivacyBoundarySummary(catalogue))},\n  limitations: Object.freeze(${JSON.stringify(catalogue.invariants, null, 2).replaceAll('\n', '\n  ')}),\n});\n`;
}
