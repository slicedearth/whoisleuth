import { createHash } from 'node:crypto';
import path from 'node:path';
import { types as utilTypes } from 'node:util';

import ts from 'typescript';

import * as offlineArtifactValidationModule from '../cli/offline-artifact-validation.mts';
import * as artifactVerifyModule from '../cli/artifact-verify.mts';
import * as casePackModule from '../cli/case-pack.mts';
import * as domainControlMonitorModule from '../cli/domain-control-monitor.mts';
import * as domainControlObservationsModule from '../cli/domain-control-observations.mts';
import * as ciReportModule from '../cli/ci-report.mts';
import * as evidenceSigningModule from '../cli/evidence-signing.mts';
import * as jsonFormatterModule from '../cli/formatters/json.mts';
import * as terminalFormatterModule from '../cli/formatters/terminal.mts';
import * as interchangeReportModule from '../cli/interchange-report.mts';
import * as outputFileModule from '../cli/output-file.mts';
import * as pageCompareModule from '../cli/page-compare.mts';
import * as retainedArtifactDiffModule from '../cli/retained-artifact-diff.mts';
import * as riskCalibrationModule from '../cli/risk-calibration.mts';
import * as sharingReviewModule from '../cli/sharing-review.mts';
import * as savedLookupModule from '../cli/saved-lookup.mts';
import * as sourceReliabilityModule from '../cli/source-reliability.mts';
import * as caseModelModule from '../packages/cases/case-model.mts';
import * as caseReportModule from '../packages/cases/case-report.mts';
import * as caseResponsePacketModule from '../packages/cases/case-response-packet.mts';
import * as acquisitionDecisionPacketModule from '../packages/investigation/acquisition-decision-packet.mts';
import * as bulkDomainComparisonModule from '../packages/investigation/bulk-domain-comparison.mts';
import * as bulkMailExposureModule from '../packages/investigation/bulk-mail-exposure.mts';
import * as bulkReviewExportModule from '../packages/investigation/bulk-review-export.mts';
import * as investigationCapsuleModule from '../packages/investigation/investigation-capsule.mts';
import * as lookupAssetGraphModule from '../packages/investigation/lookup-asset-graph.mts';
import * as lookupClaimPassportModule from '../packages/investigation/lookup-claim-passport.mts';
import * as lookupInvestigationBriefModule from '../packages/investigation/lookup-investigation-brief.mts';
import * as candidateHandoffModule from '../packages/investigation/candidate-handoff.mts';
import * as campaignTemporalReviewModule from '../packages/investigation/campaign-temporal-review.mts';
import * as parentDomainCampaignReviewModule from '../packages/investigation/parent-domain-campaign-review.mts';
import * as investigationProjectionModule from '../packages/investigation/investigation-projection.mts';
import * as investigationSearchModule from '../packages/investigation/investigation-search.mts';
import * as observationEnvelopeModule from '../packages/investigation/observation-envelope.mts';
import * as externalFindingsConvertersModule from '../packages/interchange/external-findings-converters.mts';
import * as externalFindingsImportModule from '../packages/interchange/external-findings-import.mts';
import * as analystInterchangeModule from '../packages/contracts/analyst-interchange.mts';
import * as investigationProjectionsContractModule from '../packages/contracts/investigation-projections.mts';
import * as monitoringPortabilityModule from '../packages/contracts/monitoring-portability.mts';
import * as privacyDataFlowCatalogueModule from '../packages/contracts/privacy-data-flow-catalogue.mts';
import * as relationshipPortabilityModule from '../packages/contracts/relationship-portability.mts';
import * as tabPortabilityModule from '../packages/contracts/tab-portability.mts';
import * as brandProtectionOperationsReportModule from '../packages/interchange/brand-protection-operations-report.mts';
import * as defensiveIndicatorExportModule from '../packages/interchange/defensive-indicator-export.mts';
import * as dnsChangeRehearsalModule from '../packages/interchange/dns-change-rehearsal.mts';
import * as investigationPlaybookInterchangeModule from '../packages/interchange/investigation-playbook-interchange.mts';
import * as mailReportWorkbenchModule from '../packages/interchange/mail-report-workbench.mts';
import * as mispIndicatorExportModule from '../packages/interchange/misp-indicator-export.mts';
import * as registrationDisclosurePlanModule from '../packages/interchange/registration-disclosure-plan.mts';
import * as staticPagePatternPacksModule from '../packages/interchange/static-page-pattern-packs.mts';
import * as stixIndicatorExportModule from '../packages/interchange/stix-indicator-export.mts';
import * as webCaptureImportModule from '../packages/interchange/web-capture-import.mts';
import * as scheduledMonitorDispatcherModule from '../packages/monitoring/scheduled-monitor-dispatcher.mts';
import * as scheduledMonitorModelModule from '../packages/monitoring/scheduled-monitor-model.mts';
import * as analystReviewStateModule from '../packages/monitoring/analyst-review-state.mts';
import * as caseRelationshipClustersModule from '../packages/relationships/case-relationship-clusters.mts';
import * as caseRelationshipGraphExportModule from '../packages/relationships/case-relationship-graph-export.mts';
import * as brandProfileModelModule from '../packages/workspace/brand-profile-model.mts';
import * as bulkReviewModelModule from '../packages/workspace/bulk-review-model.mts';
import * as bulkSessionModelModule from '../packages/workspace/bulk-session-model.mts';
import * as campaignModelModule from '../packages/workspace/campaign-model.mts';
import * as ctHistoryModule from '../packages/workspace/ct-history.mts';
import * as detectionRuleModelModule from '../packages/workspace/detection-rule-model.mts';
import * as investigationTemplateModelModule from '../packages/workspace/investigation-template-model.mts';
import * as relationshipObservationModelModule from '../packages/workspace/relationship-observation-model.mts';
import * as shortlistModelModule from '../packages/workspace/shortlist-model.mts';
import * as watchlistStoreModule from '../packages/workspace/watchlist-store.mts';
import * as websiteSnapshotModelModule from '../packages/workspace/website-snapshot-model.mts';
import * as workspaceArchiveModule from '../packages/workspace/workspace-archive.mts';
import * as encryptedWorkspaceArchiveModule from '../packages/workspace/workspace-archive-crypto.mts';
import * as domainControlPassportModule from '../packages/workspace/domain-control-passport.mts';
import * as riskCalibrationDashboardModule from '../packages/investigation/risk-calibration-dashboard.mts';
import * as riskCalibrationExportModule from '../packages/investigation/risk-calibration-export.mts';
import { decodeBoundedUtf8, readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import * as domainControlFlightRecorderModule from '../lib/domain-control-flight-recorder.mts';
import * as domainControlManifestModule from '../lib/domain-control-manifest.mts';
import * as riskCalibrationSummaryModule from '../lib/risk-calibration-summary.mts';
import type { SchemaLifecycleRegistry } from '../packages/contracts/schema-lifecycle.mts';
import * as casePortabilityModule from '../packages/contracts/case-portability.mts';
import * as workspacePortabilityModule from '../packages/contracts/workspace-portability.mts';
import {
  CASE_CONTRACT_OWNER,
  CASE_DOMAIN_COMPATIBILITY_FACADES,
  CASE_DOMAIN_RUNTIME_ADAPTERS,
  CASE_PORTABILITY_BOUND_CONSTANTS,
  CASE_PORTABILITY_IDENTITY_CONSTANTS,
} from '../packages/contracts/case-portability.mts';
import {
  WORKSPACE_CONTRACT_OWNER,
  WORKSPACE_DOMAIN_COMPATIBILITY_FACADES,
  WORKSPACE_PORTABILITY_BOUND_CONSTANTS,
  WORKSPACE_PORTABILITY_IDENTITY_CONSTANTS,
} from '../packages/contracts/workspace-portability.mts';
import * as domainControlRuntimeModule from '../packages/evidence/domain-control-runtime.mts';
import { compareCodeUnits as ordinalCompare } from './maintainer-tool-helpers.mts';
import {
  MAX_SCHEMA_SOURCE_BINDINGS,
  MAX_SCHEMA_SOURCE_AST_DEPTH,
  MAX_SCHEMA_SOURCE_AST_NODES,
  MAX_SCHEMA_SOURCE_FILE_BYTES,
  MAX_SCHEMA_SOURCE_FILES,
  MAX_SCHEMA_SOURCE_TOTAL_BYTES,
  type SchemaSourceDiscovery,
} from './schema-source-coverage.mts';

const SCHEMA_LIFECYCLE_REGISTRY_FILE = 'packages/contracts/schema-lifecycle-registry.mts';
const SCHEMA_LIFECYCLE_MODULE_FILE = 'packages/contracts/schema-lifecycle.mts';
const SCHEMA_LIFECYCLE_REPOSITORY_FILE = 'tools/schema-lifecycle-repository.mts';
export const MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES = 64 * 1024 * 1024;
const MAX_SCHEMA_LIFECYCLE_HOOK_MODULES = 128;
const MAX_SCHEMA_LIFECYCLE_STATIC_STRING_LENGTH = 256;
const MAX_SCHEMA_LIFECYCLE_STATIC_STRING_PARTS = 32;
const MAX_SCHEMA_LIFECYCLE_MATRIX_BYTES = 512 * 1024;
const LIFECYCLE_CODE_EXTENSIONS = new Set([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx',
]);

export const SCHEMA_LIFECYCLE_HOOK_MODULES = Object.freeze({
  'cli/offline-artifact-validation.mts': offlineArtifactValidationModule,
  'cli/artifact-verify.mts': artifactVerifyModule,
  'cli/case-pack.mts': casePackModule,
  'cli/domain-control-monitor.mts': domainControlMonitorModule,
  'cli/domain-control-observations.mts': domainControlObservationsModule,
  'cli/ci-report.mts': ciReportModule,
  'cli/evidence-signing.mts': evidenceSigningModule,
  'cli/formatters/json.mts': jsonFormatterModule,
  'cli/formatters/terminal.mts': terminalFormatterModule,
  'cli/interchange-report.mts': interchangeReportModule,
  'cli/output-file.mts': outputFileModule,
  'cli/page-compare.mts': pageCompareModule,
  'cli/retained-artifact-diff.mts': retainedArtifactDiffModule,
  'cli/risk-calibration.mts': riskCalibrationModule,
  'cli/sharing-review.mts': sharingReviewModule,
  'cli/saved-lookup.mts': savedLookupModule,
  'cli/source-reliability.mts': sourceReliabilityModule,
  'packages/cases/case-model.mts': caseModelModule,
  'packages/cases/case-report.mts': caseReportModule,
  'packages/cases/case-response-packet.mts': caseResponsePacketModule,
  'packages/investigation/acquisition-decision-packet.mts': acquisitionDecisionPacketModule,
  'packages/investigation/bulk-domain-comparison.mts': bulkDomainComparisonModule,
  'packages/investigation/bulk-mail-exposure.mts': bulkMailExposureModule,
  'packages/investigation/bulk-review-export.mts': bulkReviewExportModule,
  'packages/investigation/investigation-capsule.mts': investigationCapsuleModule,
  'packages/investigation/lookup-asset-graph.mts': lookupAssetGraphModule,
  'packages/investigation/lookup-claim-passport.mts': lookupClaimPassportModule,
  'packages/investigation/lookup-investigation-brief.mts': lookupInvestigationBriefModule,
  'packages/investigation/candidate-handoff.mts': candidateHandoffModule,
  'packages/investigation/campaign-temporal-review.mts': campaignTemporalReviewModule,
  'packages/investigation/parent-domain-campaign-review.mts': parentDomainCampaignReviewModule,
  'packages/investigation/investigation-projection.mts': investigationProjectionModule,
  'packages/investigation/investigation-search.mts': investigationSearchModule,
  'packages/investigation/observation-envelope.mts': observationEnvelopeModule,
  'packages/interchange/external-findings-converters.mts': externalFindingsConvertersModule,
  'packages/interchange/external-findings-import.mts': externalFindingsImportModule,
  'packages/contracts/analyst-interchange.mts': analystInterchangeModule,
  'packages/contracts/investigation-projections.mts': investigationProjectionsContractModule,
  'packages/contracts/monitoring-portability.mts': monitoringPortabilityModule,
  'packages/contracts/privacy-data-flow-catalogue.mts': privacyDataFlowCatalogueModule,
  'packages/contracts/relationship-portability.mts': relationshipPortabilityModule,
  'packages/contracts/tab-portability.mts': tabPortabilityModule,
  'packages/interchange/brand-protection-operations-report.mts': brandProtectionOperationsReportModule,
  'packages/interchange/defensive-indicator-export.mts': defensiveIndicatorExportModule,
  'packages/interchange/dns-change-rehearsal.mts': dnsChangeRehearsalModule,
  'packages/interchange/investigation-playbook-interchange.mts': investigationPlaybookInterchangeModule,
  'packages/interchange/mail-report-workbench.mts': mailReportWorkbenchModule,
  'packages/interchange/misp-indicator-export.mts': mispIndicatorExportModule,
  'packages/interchange/registration-disclosure-plan.mts': registrationDisclosurePlanModule,
  'packages/interchange/static-page-pattern-packs.mts': staticPagePatternPacksModule,
  'packages/interchange/stix-indicator-export.mts': stixIndicatorExportModule,
  'packages/interchange/web-capture-import.mts': webCaptureImportModule,
  'packages/monitoring/scheduled-monitor-dispatcher.mts': scheduledMonitorDispatcherModule,
  'packages/monitoring/scheduled-monitor-model.mts': scheduledMonitorModelModule,
  'packages/monitoring/analyst-review-state.mts': analystReviewStateModule,
  'packages/relationships/case-relationship-clusters.mts': caseRelationshipClustersModule,
  'packages/relationships/case-relationship-graph-export.mts': caseRelationshipGraphExportModule,
  'packages/workspace/brand-profile-model.mts': brandProfileModelModule,
  'packages/workspace/bulk-review-model.mts': bulkReviewModelModule,
  'packages/workspace/bulk-session-model.mts': bulkSessionModelModule,
  'packages/workspace/campaign-model.mts': campaignModelModule,
  'packages/workspace/ct-history.mts': ctHistoryModule,
  'packages/workspace/detection-rule-model.mts': detectionRuleModelModule,
  'packages/workspace/investigation-template-model.mts': investigationTemplateModelModule,
  'packages/workspace/relationship-observation-model.mts': relationshipObservationModelModule,
  'packages/workspace/shortlist-model.mts': shortlistModelModule,
  'packages/workspace/watchlist-store.mts': watchlistStoreModule,
  'packages/workspace/website-snapshot-model.mts': websiteSnapshotModelModule,
  'packages/workspace/workspace-archive-crypto.mts': encryptedWorkspaceArchiveModule,
  'packages/workspace/workspace-archive.mts': workspaceArchiveModule,
  'packages/workspace/domain-control-passport.mts': domainControlPassportModule,
  'packages/investigation/risk-calibration-dashboard.mts': riskCalibrationDashboardModule,
  'packages/investigation/risk-calibration-export.mts': riskCalibrationExportModule,
  'lib/domain-control-flight-recorder.mts': domainControlFlightRecorderModule,
  'lib/domain-control-manifest.mts': domainControlManifestModule,
  'lib/risk-calibration-summary.mts': riskCalibrationSummaryModule,
  'packages/contracts/case-portability.mts': casePortabilityModule,
  'packages/contracts/workspace-portability.mts': workspacePortabilityModule,
  'packages/evidence/domain-control-runtime.mts': domainControlRuntimeModule,
} as const);

type LifecycleSource = Readonly<{ file: string; source: string }>;

export type SchemaLifecycleSourceBinding = Readonly<{
  owner: string;
  exportName: string;
  line: number;
}>;

export type SchemaLifecycleHookModuleSourceBinding = Readonly<{
  module: string;
  localName: string;
  line: number;
}>;

export type SchemaLifecycleSourceBindings = Readonly<{
  definitions: readonly SchemaLifecycleSourceBinding[];
  registryEntries: readonly SchemaLifecycleSourceBinding[];
  hookModules: readonly SchemaLifecycleHookModuleSourceBinding[];
}>;

type PendingRegistryReference = Readonly<{
  file: string;
  imported: string;
  specifier: string;
  line: number;
}>;

function validateSourceAstBounds(sourceFile: ts.SourceFile, file: string): void {
  const pending: Array<Readonly<{ node: ts.Node; depth: number }>> = [{ node: sourceFile, depth: 1 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_SCHEMA_SOURCE_AST_NODES) {
      throw new TypeError(`Schema lifecycle source ${file} exceeds its AST node ceiling.`);
    }
    if (current.depth > MAX_SCHEMA_SOURCE_AST_DEPTH) {
      throw new TypeError(`Schema lifecycle source ${file} exceeds its AST depth ceiling.`);
    }
    ts.forEachChild(current.node, (child) => {
      pending.push({ node: child, depth: current.depth + 1 });
    });
  }
}

function snapshotLifecycleSources(value: unknown): readonly LifecycleSource[] {
  if (utilTypes.isProxy(value)
    || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Object.prototype.hasOwnProperty.call(value, Symbol.iterator)) {
    throw new TypeError('Schema lifecycle sources must use a bounded ordinary source list.');
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > MAX_SCHEMA_SOURCE_FILES) {
    throw new TypeError('Schema lifecycle sources must use a bounded ordinary source list.');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== Number(length) + 1
    || ownKeys.at(-1) !== 'length'
    || ownKeys.slice(0, -1).some((key, index) => key !== String(index))) {
    throw new TypeError('Schema lifecycle sources must use a dense ordinary source list.');
  }
  const sources: LifecycleSource[] = [];
  const files = new Set<string>();
  let totalBytes = 0;
  for (let index = 0; index < Number(length); index += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !entry.enumerable || !('value' in entry)) {
      throw new TypeError('Schema lifecycle sources must contain ordinary enumerable data entries.');
    }
    const item = entry.value;
    if (utilTypes.isProxy(item)
      || !item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`Schema lifecycle source ${index} must be an ordinary source record.`);
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Schema lifecycle source ${index} must be an ordinary source record.`);
    }
    const itemKeys = Reflect.ownKeys(item);
    if (itemKeys.length !== 2 || !itemKeys.includes('file') || !itemKeys.includes('source')) {
      throw new TypeError(`Schema lifecycle source ${index} must use its exact fields.`);
    }
    const fileDescriptor = Object.getOwnPropertyDescriptor(item, 'file');
    const sourceDescriptor = Object.getOwnPropertyDescriptor(item, 'source');
    if (!fileDescriptor?.enumerable || !('value' in fileDescriptor)
      || !sourceDescriptor?.enumerable || !('value' in sourceDescriptor)
      || typeof fileDescriptor.value !== 'string'
      || typeof sourceDescriptor.value !== 'string') {
      throw new TypeError(`Schema lifecycle source ${index} must use ordinary string fields.`);
    }
    const file = fileDescriptor.value;
    const source = sourceDescriptor.value;
    if (!file
      || file.length > 200
      || file.includes('\\')
      || path.posix.isAbsolute(file)
      || path.posix.normalize(file) !== file
      || file === '..'
      || file.startsWith('../')
      || files.has(file)) {
      throw new TypeError(`Schema lifecycle source ${index} must use a unique repository-relative path.`);
    }
    if (source.length > MAX_SCHEMA_SOURCE_FILE_BYTES) {
      throw new TypeError(`Schema lifecycle source ${file} exceeds its source byte ceiling.`);
    }
    const sourceBytes = Buffer.byteLength(source, 'utf8');
    if (sourceBytes > MAX_SCHEMA_SOURCE_FILE_BYTES) {
      throw new TypeError(`Schema lifecycle source ${file} exceeds its source byte ceiling.`);
    }
    totalBytes += sourceBytes;
    if (totalBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError('Schema lifecycle sources exceed their aggregate byte ceiling.');
    }
    files.add(file);
    sources.push(Object.freeze({ file, source }));
  }
  return Object.freeze(sources);
}

function unwrapExpression(value: ts.Expression): ts.Expression {
  let current = value;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

function resolveStaticString(
  value: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  visited: ReadonlySet<string> = new Set(),
  remainingParts = MAX_SCHEMA_LIFECYCLE_STATIC_STRING_PARTS,
): string | null {
  if (remainingParts < 1) return null;
  const current = unwrapExpression(value);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text.length <= MAX_SCHEMA_LIFECYCLE_STATIC_STRING_LENGTH ? current.text : null;
  }
  if (ts.isIdentifier(current)) {
    if (visited.has(current.text)) return null;
    const initializer = bindings.get(current.text);
    if (!initializer) return null;
    return resolveStaticString(
      initializer,
      bindings,
      new Set([...visited, current.text]),
      remainingParts - 1,
    );
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticString(current.left, bindings, visited, remainingParts - 1);
    const right = resolveStaticString(current.right, bindings, visited, remainingParts - 1);
    if (left === null || right === null || left.length + right.length > MAX_SCHEMA_LIFECYCLE_STATIC_STRING_LENGTH) {
      return null;
    }
    return left + right;
  }
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    let parts = remainingParts - 1;
    for (const span of current.templateSpans) {
      const expression = resolveStaticString(span.expression, bindings, visited, parts);
      if (expression === null) return null;
      result += expression + span.literal.text;
      parts -= 1;
      if (parts < 0 || result.length > MAX_SCHEMA_LIFECYCLE_STATIC_STRING_LENGTH) return null;
    }
    return result;
  }
  return null;
}

function hasExportModifier(statement: ts.VariableStatement): boolean {
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function scriptKind(file: string): ts.ScriptKind {
  const extension = path.posix.extname(file).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function resolveSourceModule(sourceFile: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier));
  if (base === '..' || base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  const extension = path.posix.extname(base).toLowerCase();
  const candidates = [base];
  if (!extension) {
    for (const candidateExtension of ['.mts', '.ts', '.cts', '.mjs', '.js', '.cjs', '.tsx', '.jsx']) {
      candidates.push(`${base}${candidateExtension}`, `${base}/index${candidateExtension}`);
    }
  } else if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.mts`, `${stem}.cts`, `${stem}.tsx`);
  }
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function parseLifecycleSource(
  item: LifecycleSource,
  sourceFiles: ReadonlySet<string>,
): Readonly<{
  definitions: readonly SchemaLifecycleSourceBinding[];
  registryReferences: readonly PendingRegistryReference[];
  registryDeclarations: number;
  hookModules: readonly SchemaLifecycleHookModuleSourceBinding[];
  hookModuleDeclarations: number;
}> {
  const sourceFile = ts.createSourceFile(item.file, item.source, ts.ScriptTarget.Latest, true, scriptKind(item.file));
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) throw new TypeError(`Schema lifecycle source ${item.file} must contain valid source syntax.`);
  validateSourceAstBounds(sourceFile, item.file);
  const familyFactories = new Set<string>();
  const registryFactories = new Set<string>();
  const nonCanonicalFamilyFactories = new Set<string>();
  const nonCanonicalRegistryFactories = new Set<string>();
  const importedBindings = new Map<string, Readonly<{ imported: string; specifier: string; line: number }>>();
  const namespaceImports = new Map<string, string>();
  const staticStringBindings = new Map<string, ts.Expression>();
  const lineFor = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)
      || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        staticStringBindings.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.importClause) continue;
    const importedModule = resolveSourceModule(item.file, statement.moduleSpecifier.text, sourceFiles);
    if (statement.importClause.namedBindings
      && ts.isNamespaceImport(statement.importClause.namedBindings)
      && importedModule) {
      namespaceImports.set(statement.importClause.namedBindings.name.text, importedModule);
    }
    if (importedModule === SCHEMA_LIFECYCLE_MODULE_FILE
      && (statement.importClause.name
        || (statement.importClause.namedBindings
          && ts.isNamespaceImport(statement.importClause.namedBindings)))) {
      throw new TypeError('Schema lifecycle factories must use direct named imports from the canonical module.');
    }
    if (!statement.importClause.namedBindings
      || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const binding = Object.freeze({
        imported,
        specifier: statement.moduleSpecifier.text,
        line: lineFor(element.getStart(sourceFile)),
      });
      importedBindings.set(element.name.text, binding);
      if (imported === 'defineSchemaLifecycleFamily') {
        (importedModule === SCHEMA_LIFECYCLE_MODULE_FILE
          ? familyFactories
          : nonCanonicalFamilyFactories).add(element.name.text);
      }
      if (imported === 'defineSchemaLifecycleRegistry') {
        (importedModule === SCHEMA_LIFECYCLE_MODULE_FILE
          ? registryFactories
          : nonCanonicalRegistryFactories).add(element.name.text);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || resolveSourceModule(item.file, statement.moduleSpecifier.text, sourceFiles) !== SCHEMA_LIFECYCLE_MODULE_FILE) continue;
    if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
      throw new TypeError('Schema lifecycle factories must not be re-exported.');
    }
    if (ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.some((element) => {
      const exported = element.propertyName?.text ?? element.name.text;
      return exported === 'defineSchemaLifecycleFamily' || exported === 'defineSchemaLifecycleRegistry';
    })) {
      throw new TypeError('Schema lifecycle factories must not be re-exported.');
    }
  }

  const definitions: SchemaLifecycleSourceBinding[] = [];
  const registryReferences: PendingRegistryReference[] = [];
  const hookModules: SchemaLifecycleHookModuleSourceBinding[] = [];
  let registryDeclarations = 0;
  let hookModuleDeclarations = 0;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (declaration.name.text === 'SCHEMA_LIFECYCLE_HOOK_MODULES') {
        if (item.file !== SCHEMA_LIFECYCLE_REPOSITORY_FILE
          || !(statement.declarationList.flags & ts.NodeFlags.Const)
          || !ts.isCallExpression(initializer)
          || initializer.arguments.length !== 1) {
          throw new TypeError('Schema lifecycle hook modules must use one canonical static declaration.');
        }
        const hookCallee = unwrapExpression(initializer.expression);
        const hookObject = unwrapExpression(initializer.arguments[0]!);
        if (!ts.isPropertyAccessExpression(hookCallee)
          || !ts.isIdentifier(hookCallee.expression)
          || hookCallee.expression.text !== 'Object'
          || hookCallee.name.text !== 'freeze'
          || !ts.isObjectLiteralExpression(hookObject)) {
          throw new TypeError('Schema lifecycle hook modules must use one frozen static object.');
        }
        hookModuleDeclarations += 1;
        for (const property of hookObject.properties) {
          if (!ts.isPropertyAssignment(property)
            || !ts.isStringLiteral(property.name)) {
            throw new TypeError('Schema lifecycle hook modules must use static path-to-namespace bindings.');
          }
          const namespace = unwrapExpression(property.initializer);
          if (!ts.isIdentifier(namespace)) {
            throw new TypeError('Schema lifecycle hook modules must use static namespace imports.');
          }
          const importedModule = namespaceImports.get(namespace.text);
          if (!importedModule || property.name.text !== importedModule) {
            throw new TypeError(`Schema lifecycle hook module path does not match its static import: ${property.name.text}.`);
          }
          hookModules.push(Object.freeze({
            module: property.name.text,
            localName: namespace.text,
            line: lineFor(property.getStart(sourceFile)),
          }));
          if (hookModules.length > MAX_SCHEMA_LIFECYCLE_HOOK_MODULES) {
            throw new TypeError('Schema lifecycle hook modules exceed their bounded entry ceiling.');
          }
        }
        continue;
      }
      if (!ts.isCallExpression(initializer)) continue;
      const callee = unwrapExpression(initializer.expression);
      if (!ts.isIdentifier(callee)) continue;
      if (nonCanonicalFamilyFactories.has(callee.text)
        || nonCanonicalRegistryFactories.has(callee.text)) {
        throw new TypeError('Schema lifecycle factories must be imported from the canonical lifecycle module.');
      }
      if (familyFactories.has(callee.text)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
          throw new TypeError('Schema lifecycle families must use exported const declarations.');
        }
        definitions.push(Object.freeze({
          owner: item.file,
          exportName: declaration.name.text,
          line: lineFor(declaration.getStart(sourceFile)),
        }));
        continue;
      }
      if (!registryFactories.has(callee.text)
        || declaration.name.text !== 'SCHEMA_LIFECYCLE_REGISTRY'
        || initializer.arguments.length !== 1) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
        throw new TypeError('Schema lifecycle registry must use an exported const declaration.');
      }
      registryDeclarations += 1;
      const registryArray = unwrapExpression(initializer.arguments[0]!);
      if (!ts.isArrayLiteralExpression(registryArray)) {
        throw new TypeError('Schema lifecycle registry must use one static family array.');
      }
      for (const element of registryArray.elements) {
        const reference = unwrapExpression(element as ts.Expression);
        if (!ts.isIdentifier(reference)) {
          throw new TypeError('Schema lifecycle registry entries must be statically imported identifiers.');
        }
        const imported = importedBindings.get(reference.text);
        if (!imported
          || resolveSourceModule(item.file, imported.specifier, sourceFiles) === SCHEMA_LIFECYCLE_MODULE_FILE) {
          throw new TypeError(`Schema lifecycle registry entry is not a statically imported family: ${reference.text}.`);
        }
        registryReferences.push(Object.freeze({
          file: item.file,
          imported: imported.imported,
          specifier: imported.specifier,
          line: lineFor(reference.getStart(sourceFile)),
        }));
      }
    }
  }
  let familyFactoryCalls = 0;
  let registryFactoryCalls = 0;
  let familyFactoryUses = 0;
  let registryFactoryUses = 0;
  const visitFactoryCalls = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isExpression(node.arguments[0]!)) {
      const specifier = resolveStaticString(node.arguments[0]!, staticStringBindings);
      if (specifier !== null
        && resolveSourceModule(item.file, specifier, sourceFiles) === SCHEMA_LIFECYCLE_MODULE_FILE) {
        throw new TypeError('Schema lifecycle factories must not be loaded dynamically.');
      }
    }
    const memberName = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression
        ? resolveStaticString(node.argumentExpression, staticStringBindings)
        : null;
    if (memberName === 'defineSchemaLifecycleFamily'
      || memberName === 'defineSchemaLifecycleRegistry') {
      throw new TypeError('Schema lifecycle factories must use direct named imports.');
    }
    if (ts.isIdentifier(node)) {
      if (nonCanonicalFamilyFactories.has(node.text)
        || nonCanonicalRegistryFactories.has(node.text)) {
        throw new TypeError('Schema lifecycle factories must be imported from the canonical lifecycle module.');
      }
      if (familyFactories.has(node.text)) familyFactoryUses += 1;
      if (registryFactories.has(node.text)) registryFactoryUses += 1;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        if (nonCanonicalFamilyFactories.has(callee.text)
          || nonCanonicalRegistryFactories.has(callee.text)) {
          throw new TypeError('Schema lifecycle factories must be imported from the canonical lifecycle module.');
        }
        if (familyFactories.has(callee.text)) familyFactoryCalls += 1;
        if (registryFactories.has(callee.text)) registryFactoryCalls += 1;
      }
    }
    ts.forEachChild(node, visitFactoryCalls);
  };
  visitFactoryCalls(sourceFile);
  if (familyFactoryUses !== familyFactoryCalls || familyFactoryCalls !== definitions.length) {
    throw new TypeError('Schema lifecycle family factories must define direct exported constants.');
  }
  if (registryFactoryUses !== registryFactoryCalls || registryFactoryCalls !== registryDeclarations) {
    throw new TypeError('Schema lifecycle registry factories must define the canonical static registry.');
  }

  if (definitions.length > MAX_SCHEMA_SOURCE_BINDINGS || registryReferences.length > MAX_SCHEMA_SOURCE_BINDINGS) {
    throw new TypeError('Schema lifecycle source exceeds the bounded binding ceiling.');
  }
  for (const reference of registryReferences) {
    if (!resolveSourceModule(reference.file, reference.specifier, sourceFiles)) {
      throw new TypeError(`Schema lifecycle registry import cannot be resolved: ${reference.specifier}.`);
    }
  }
  return Object.freeze({
    definitions: Object.freeze(definitions),
    registryReferences: Object.freeze(registryReferences),
    registryDeclarations,
    hookModules: Object.freeze(hookModules),
    hookModuleDeclarations,
  });
}

export function discoverSchemaLifecycleSourceBindings(
  sources: readonly LifecycleSource[],
  registryFile = SCHEMA_LIFECYCLE_REGISTRY_FILE,
): SchemaLifecycleSourceBindings {
  const sourceSnapshot = snapshotLifecycleSources(sources);
  const sourceFiles = new Set(sourceSnapshot.map((item) => item.file));
  const definitions: SchemaLifecycleSourceBinding[] = [];
  const registryEntries: SchemaLifecycleSourceBinding[] = [];
  const hookModules: SchemaLifecycleHookModuleSourceBinding[] = [];
  let registryDeclarations = 0;
  let hookModuleDeclarations = 0;
  for (const item of sourceSnapshot) {
    if (!LIFECYCLE_CODE_EXTENSIONS.has(path.posix.extname(item.file).toLowerCase())) {
      if (item.source.includes('schema-lifecycle')
        || item.source.includes('defineSchemaLifecycle')
        || /defineSchemaLifecycle\\u[0-9a-f]{4}/iu.test(item.source)) {
        throw new TypeError(`Schema lifecycle factories are not allowed in non-code source ${item.file}.`);
      }
      continue;
    }
    const parsed = parseLifecycleSource(item, sourceFiles);
    definitions.push(...parsed.definitions);
    if (definitions.length > MAX_SCHEMA_SOURCE_BINDINGS) {
      throw new TypeError('Schema lifecycle sources exceed the bounded definition ceiling.');
    }
    if (parsed.registryDeclarations) {
      if (item.file !== registryFile) {
        throw new TypeError(`Schema lifecycle registry must be declared in ${registryFile}.`);
      }
      registryDeclarations += parsed.registryDeclarations;
      for (const reference of parsed.registryReferences) {
        const owner = resolveSourceModule(reference.file, reference.specifier, sourceFiles);
        if (!owner) throw new TypeError(`Schema lifecycle registry import cannot be resolved: ${reference.specifier}.`);
        registryEntries.push(Object.freeze({ owner, exportName: reference.imported, line: reference.line }));
        if (registryEntries.length > MAX_SCHEMA_SOURCE_BINDINGS) {
          throw new TypeError('Schema lifecycle registry exceeds the bounded entry ceiling.');
        }
      }
    }
    if (parsed.hookModuleDeclarations) {
      if (item.file !== SCHEMA_LIFECYCLE_REPOSITORY_FILE) {
        throw new TypeError(`Schema lifecycle hook modules must be declared in ${SCHEMA_LIFECYCLE_REPOSITORY_FILE}.`);
      }
      hookModuleDeclarations += parsed.hookModuleDeclarations;
      hookModules.push(...parsed.hookModules);
    }
  }
  if (registryDeclarations !== 1) {
    throw new TypeError('Schema lifecycle source coverage requires one canonical registry declaration.');
  }
  if ((sourceFiles.has(SCHEMA_LIFECYCLE_REPOSITORY_FILE) && hookModuleDeclarations !== 1)
    || hookModuleDeclarations > 1) {
    throw new TypeError('Schema lifecycle source coverage requires one canonical hook-module declaration.');
  }
  return Object.freeze({
    definitions: Object.freeze(definitions),
    registryEntries: Object.freeze(registryEntries),
    hookModules: Object.freeze(hookModules),
  });
}

function bindingKey(value: SchemaLifecycleSourceBinding): string {
  return `${value.owner}\0${value.exportName}`;
}

export function validateSchemaLifecycleDefinitionCoverage(bindings: SchemaLifecycleSourceBindings): void {
  const definitions = new Map<string, SchemaLifecycleSourceBinding>();
  for (const definition of bindings.definitions) {
    const key = bindingKey(definition);
    if (definitions.has(key)) throw new TypeError(`Schema lifecycle definition is duplicated: ${definition.owner}#${definition.exportName}.`);
    definitions.set(key, definition);
  }
  const registryEntries = new Set<string>();
  for (const entry of bindings.registryEntries) {
    const key = bindingKey(entry);
    if (registryEntries.has(key)) throw new TypeError(`Schema lifecycle registry entry is duplicated: ${entry.owner}#${entry.exportName}.`);
    registryEntries.add(key);
    if (!definitions.has(key)) {
      throw new TypeError(`Schema lifecycle registry entry has no canonical definition: ${entry.owner}#${entry.exportName}.`);
    }
  }
  for (const [key, definition] of definitions) {
    if (!registryEntries.has(key)) {
      throw new TypeError(`Schema lifecycle definition is not registered: ${definition.owner}#${definition.exportName}.`);
    }
  }
}

async function repositoryLifecycleBindings(discovery: SchemaSourceDiscovery): Promise<SchemaLifecycleSourceBindings> {
  const sources: LifecycleSource[] = [];
  let bytes = 0;
  for (const file of discovery.files) {
    const raw = await readBoundedRegularFileWithin(discovery.repositoryRoot, file, {
      maximumBytes: MAX_SCHEMA_SOURCE_FILE_BYTES,
      minimumBytes: 0,
      label: `Schema lifecycle source ${file}`,
    });
    bytes += raw.byteLength;
    if (bytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError('Schema lifecycle source coverage exceeds its aggregate byte ceiling.');
    }
    const source = decodeBoundedUtf8(raw, `Schema lifecycle source ${file}`);
    sources.push(Object.freeze({ file, source }));
  }
  return discoverSchemaLifecycleSourceBindings(sources);
}

type HookModuleMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export function assertSchemaLifecycleFixtureDiscriminator(
  raw: string,
  maximumBytes: number,
  pathValue: string,
  expectedValue: string,
  label: string,
): void {
  const document = parseBoundedJsonObject(raw, { label, maximumBytes });
  const segments = pathValue.startsWith('$.') ? pathValue.slice(2).split('.') : [];
  let values: unknown[] = [document];
  for (const segment of segments) {
    const traversesArray = segment.endsWith('[]');
    const field = traversesArray ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} does not match its registered lifecycle discriminator.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${label} does not match its registered lifecycle discriminator.`);
      }
      if (traversesArray) {
        if (!Array.isArray(descriptor.value)) {
          throw new TypeError(`${label} does not match its registered lifecycle discriminator.`);
        }
        for (const item of descriptor.value) next.push(item);
      } else {
        next.push(descriptor.value);
      }
    }
    values = next;
  }
  if (segments.length === 0 || values.length !== 1 || values[0] !== expectedValue) {
    throw new TypeError(`${label} does not match its registered lifecycle discriminator.`);
  }
}

function snapshotHookModules(value: unknown): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  if (utilTypes.isProxy(value)
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Schema lifecycle hook modules must use an ordinary static map.');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length < 1
    || keys.length > MAX_SCHEMA_LIFECYCLE_HOOK_MODULES
    || keys.some((key) => typeof key !== 'string')) {
    throw new TypeError('Schema lifecycle hook modules must use a bounded exact string-key map.');
  }
  const modules = new Map<string, Readonly<Record<string, unknown>>>();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)
      || !descriptor.value || typeof descriptor.value !== 'object') {
      throw new TypeError(`Schema lifecycle hook module ${key} must use an ordinary data binding.`);
    }
    modules.set(key, descriptor.value as Readonly<Record<string, unknown>>);
  }
  return modules;
}

export function validateCasePortabilitySourceSnapshot(value: unknown): void {
  const sources = snapshotLifecycleSources(value);
  const sourceByPath = new Map(sources.map((source) => [source.file, source.source]));
  const sourceFiles = new Set(sourceByPath.keys());
  const facadePaths = new Set<string>();
  const adapterPaths = new Set<string>();
  const ownerPaths = new Set<string>();
  for (const [facade, owner] of CASE_DOMAIN_COMPATIBILITY_FACADES) {
    if (facadePaths.has(facade)) {
      throw new TypeError('Case domain compatibility facades contain a duplicate facade path.');
    }
    facadePaths.add(facade);
    ownerPaths.add(owner);
    if (!sourceByPath.has(facade) || !sourceByPath.has(owner)) {
      throw new TypeError(`Case domain compatibility facade is not source-covered: ${facade}.`);
    }
    const relative = path.posix.relative(path.posix.dirname(facade), owner);
    const specifier = relative.startsWith('.') ? relative : `./${relative}`;
    const expected = `export * from '${specifier}';\n`;
    if (sourceByPath.get(facade) !== expected) {
      throw new TypeError(`Case domain compatibility facade is stale or is not an exact re-export: ${facade}.`);
    }
  }
  for (const adapter of CASE_DOMAIN_RUNTIME_ADAPTERS) {
    if (adapterPaths.has(adapter) || facadePaths.has(adapter) || !sourceByPath.has(adapter)) {
      throw new TypeError(`Case domain runtime adapter is duplicated or not source-covered: ${adapter}.`);
    }
    adapterPaths.add(adapter);
  }

  const staticReExports = new Map<string, readonly string[]>();
  for (const item of sources) {
    const sourceFile = ts.createSourceFile(item.file, item.source, ts.ScriptTarget.Latest, true, scriptKind(item.file));
    const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diagnostics.length) throw new TypeError(`Case portability source ${item.file} must contain valid source syntax.`);
    validateSourceAstBounds(sourceFile, item.file);
    const importedTargets = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.importClause) continue;
      const target = resolveSourceModule(item.file, statement.moduleSpecifier.text, sourceFiles);
      if (!target) continue;
      if (statement.importClause.name) importedTargets.set(statement.importClause.name.text, target);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) importedTargets.set(bindings.name.text, target);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) importedTargets.set(element.name.text, target);
      }
    }
    const targets = new Set<string>();
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = resolveSourceModule(item.file, statement.moduleSpecifier.text, sourceFiles);
          if (target) targets.add(target);
        } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const localName = element.propertyName?.text ?? element.name.text;
            const target = importedTargets.get(localName);
            if (target) targets.add(target);
          }
        }
      } else if (ts.isExportAssignment(statement)) {
        const expression = unwrapExpression(statement.expression);
        if (ts.isIdentifier(expression)) {
          const target = importedTargets.get(expression.text);
          if (target) targets.add(target);
        }
      }
    }
    staticReExports.set(item.file, Object.freeze([...targets]));
  }

  function reachesCaseOwner(file: string, visiting: Set<string>): boolean {
    if (ownerPaths.has(file) || facadePaths.has(file)) return true;
    if (visiting.has(file)) return false;
    visiting.add(file);
    return (staticReExports.get(file) ?? []).some((target) => reachesCaseOwner(target, visiting));
  }

  for (const adapter of adapterPaths) {
    if (!reachesCaseOwner(adapter, new Set<string>())) {
      throw new TypeError(`Case domain runtime adapter is stale: ${adapter}.`);
    }
  }

  for (const { file, source } of sources) {
    if (!facadePaths.has(file)
      && !adapterPaths.has(file)
      && !ownerPaths.has(file)
      && reachesCaseOwner(file, new Set<string>())) {
      throw new TypeError(`Case domain compatibility facade is hidden from the canonical register: ${file}.`);
    }
    if (file === CASE_CONTRACT_OWNER) continue;
    for (const name of [
      ...CASE_PORTABILITY_IDENTITY_CONSTANTS,
      ...CASE_PORTABILITY_BOUND_CONSTANTS,
    ]) {
      const declaration = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'u');
      if (declaration.test(source)) {
        throw new TypeError(`Case portability constant is declared outside its canonical owner: ${file}#${name}.`);
      }
    }
  }
}

async function validateCasePortabilitySourceClosure(discovery: SchemaSourceDiscovery): Promise<void> {
  const sources: LifecycleSource[] = [];
  let inspectedBytes = 0;
  for (const file of discovery.files) {
    if (!LIFECYCLE_CODE_EXTENSIONS.has(path.posix.extname(file))) continue;
    const raw = await readBoundedRegularFileWithin(discovery.repositoryRoot, file, {
      maximumBytes: MAX_SCHEMA_SOURCE_FILE_BYTES,
      minimumBytes: 1,
      label: `Case portability source ${file}`,
    });
    inspectedBytes += raw.byteLength;
    if (inspectedBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError('Case portability source closure exceeds its aggregate byte ceiling.');
    }
    sources.push(Object.freeze({
      file,
      source: decodeBoundedUtf8(raw, `Case portability source ${file}`),
    }));
  }
  validateCasePortabilitySourceSnapshot(sources);
}

export function validateWorkspacePortabilitySourceSnapshot(value: unknown): void {
  const sources = snapshotLifecycleSources(value);
  const sourceByPath = new Map(sources.map((source) => [source.file, source.source]));
  const facadePaths = new Set<string>();
  const ownerPaths = new Set<string>();
  for (const [facade, owner] of WORKSPACE_DOMAIN_COMPATIBILITY_FACADES) {
    if (facadePaths.has(facade)) {
      throw new TypeError('Workspace domain compatibility facades contain a duplicate facade path.');
    }
    facadePaths.add(facade);
    ownerPaths.add(owner);
    if (!sourceByPath.has(facade) || !sourceByPath.has(owner)) {
      throw new TypeError(`Workspace domain compatibility facade is not source-covered: ${facade}.`);
    }
    const relative = path.posix.relative(path.posix.dirname(facade), owner);
    const specifier = relative.startsWith('.') ? relative : `./${relative}`;
    if (sourceByPath.get(facade) !== `export * from '${specifier}';\n`) {
      throw new TypeError(`Workspace domain compatibility facade is stale or is not an exact re-export: ${facade}.`);
    }
  }

  for (const item of sources) {
    if (item.file === WORKSPACE_CONTRACT_OWNER
      || (!facadePaths.has(item.file) && !ownerPaths.has(item.file))) continue;
    for (const name of [
      ...WORKSPACE_PORTABILITY_IDENTITY_CONSTANTS,
      ...WORKSPACE_PORTABILITY_BOUND_CONSTANTS,
    ]) {
      if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'u').test(item.source)) {
        throw new TypeError(`Workspace portability constant is declared outside its canonical owner: ${item.file}#${name}.`);
      }
    }
  }
}

async function validateWorkspacePortabilitySourceClosure(discovery: SchemaSourceDiscovery): Promise<void> {
  const sources: LifecycleSource[] = [];
  let inspectedBytes = 0;
  for (const file of discovery.files) {
    if (!LIFECYCLE_CODE_EXTENSIONS.has(path.posix.extname(file))) continue;
    const raw = await readBoundedRegularFileWithin(discovery.repositoryRoot, file, {
      maximumBytes: MAX_SCHEMA_SOURCE_FILE_BYTES,
      minimumBytes: 1,
      label: `Workspace portability source ${file}`,
    });
    inspectedBytes += raw.byteLength;
    if (inspectedBytes > MAX_SCHEMA_SOURCE_TOTAL_BYTES) {
      throw new TypeError('Workspace portability source closure exceeds its aggregate byte ceiling.');
    }
    sources.push(Object.freeze({
      file,
      source: decodeBoundedUtf8(raw, `Workspace portability source ${file}`),
    }));
  }
  validateWorkspacePortabilitySourceSnapshot(sources);
}

/**
 * Projects the routine compatibility matrix directly from the canonical
 * lifecycle registry. The repository validator still performs the byte and
 * digest reads below; this projection proves that every declared version,
 * migration, hook, bound, shape, serializer, privacy profile, consumer and
 * exact-output fixture link closes over that same metadata.
 */
export function buildSchemaLifecycleCompatibilityMatrix(registry: SchemaLifecycleRegistry) {
  if (registry.length < 1 || registry.length > 32) {
    throw new TypeError('Schema lifecycle compatibility matrix requires a bounded registry.');
  }
  const declaredContracts = registry.reduce((sum, family) => sum + family.contracts.length, 0);
  const declaredFixtures = registry.reduce((sum, family) => sum + family.fixtures.length, 0);
  const declaredCompatibility = registry.reduce((sum, family) => sum + family.compatibility.length, 0);
  if (declaredContracts > 512 || declaredFixtures > 1_024 || declaredCompatibility > 512) {
    throw new TypeError('Schema lifecycle compatibility matrix exceeds its aggregate bounds.');
  }
  let contracts = 0;
  let fixtures = 0;
  const families = registry.map((family) => {
    if (!('metadata' in family)) {
      throw new TypeError(`Schema lifecycle family ${family.id} must declare generated-coverage metadata.`);
    }
    const contractByCompatibility = new Map<string, typeof family.contracts>();
    for (const compatibility of family.compatibility) {
      const matching = family.contracts.filter((contract) => contract.compatibilityId === compatibility.id);
      contractByCompatibility.set(compatibility.id, matching);
    }
    const compatibility = family.compatibility.map((descriptor) => {
      const matching = contractByCompatibility.get(descriptor.id) ?? [];
      const versions = [...new Set(matching.map((contract) => contract.version))].sort((left, right) => left - right);
      if (versions.length !== descriptor.supportedVersions.length
        || versions.some((version, index) => version !== descriptor.supportedVersions[index])) {
        throw new TypeError(`Generated compatibility versions do not close for ${family.id}#${descriptor.id}.`);
      }
      const current = matching.find((contract) => contract.version === descriptor.currentVersion);
      if (!current) throw new TypeError(`Generated compatibility current version is missing for ${family.id}#${descriptor.id}.`);
      const readable = matching.some((contract) => contract.readable);
      const emitted = matching.some((contract) => contract.emitted);
      const disposition = readable && emitted
        ? 'reader_writer'
        : readable ? 'reader_only' : emitted ? 'output_only' : 'retired';
      const fixtureIds = new Set(matching.flatMap((contract) => contract.fixtureIds));
      const compatibilityFixtures = family.fixtures.filter((fixture) => fixtureIds.has(fixture.id));
      if (compatibilityFixtures.length !== fixtureIds.size) {
        throw new TypeError(`Generated compatibility fixtures do not close for ${family.id}#${descriptor.id}.`);
      }
      const migrationFixtures = compatibilityFixtures.filter((fixture) => fixture.role === 'input');
      const expectedOutputs = migrationFixtures.map((fixture) => {
        if (descriptor.migration === 'normalize_to_current' && !fixture.expectedOutputFixtureId) {
          throw new TypeError(`Generated compatibility migration output is missing for ${family.id}#${fixture.id}.`);
        }
        if (!fixture.expectedOutputFixtureId) return null;
        const target = family.fixtures.find((candidate) => candidate.id === fixture.expectedOutputFixtureId);
        const targetContract = target && family.contracts.find((contract) => (
          contract.fixtureIds.includes(target.id)
          && contract.lifecycle === 'current'
          && contract.emitted
        ));
        if (!target || !targetContract || target.expectation === 'normalises_to_current_output') {
          throw new TypeError(`Generated compatibility migration output is invalid for ${family.id}#${fixture.id}.`);
        }
        return Object.freeze({ inputFixtureId: fixture.id, expectedOutputFixtureId: target.id });
      }).filter((value): value is NonNullable<typeof value> => value !== null);
      return Object.freeze({
        id: descriptor.id,
        schemaIdentity: descriptor.schema,
        supportedVersions: Object.freeze([...descriptor.supportedVersions]),
        currentVersion: descriptor.currentVersion,
        disposition,
        migration: descriptor.migration,
        futureVersionBehaviour: descriptor.futureVersionBehavior,
        writeSemantics: descriptor.writeSemantics,
        contractCount: matching.length,
        fixtureCount: compatibilityFixtures.length,
        expectedOutputs: Object.freeze(expectedOutputs),
      });
    });
    contracts += family.contracts.length;
    fixtures += family.fixtures.length;
    if (contracts > 512 || fixtures > 1_024) throw new TypeError('Schema lifecycle compatibility matrix exceeds its aggregate bounds.');
    const fixtureEvidence = family.fixtures.map((fixture) => Object.freeze({
      id: fixture.id,
      path: fixture.path,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      contentDigestSha256: fixture.contentDigestSha256,
      expectedOutputFixtureId: fixture.expectedOutputFixtureId,
    }));
    const metadata = family.metadata;
    const shapeReferences = new Set(metadata.consumerEdges.flatMap((edge) => edge.shapeIds));
    const boundReferences = new Set(metadata.consumerEdges.flatMap((edge) => edge.boundProfileIds));
    const hookReferences = new Set(metadata.consumerEdges.flatMap((edge) => edge.hookIds));
    const serialisationReferences = new Set(metadata.consumerEdges.map((edge) => edge.serialisationProfileId).filter(Boolean));
    const privacyReferences = new Set(metadata.consumerEdges.map((edge) => edge.privacyProfileId));
    const missingClosure = [
      ...shapeReferences].filter((id) => !metadata.shapes.some((item) => item.id === id)).length
      + [...boundReferences].filter((id) => !metadata.boundProfiles.some((item) => item.id === id)).length
      + [...hookReferences].filter((id) => !metadata.hooks.some((item) => item.id === id)).length
      + [...serialisationReferences].filter((id) => !metadata.serialisationProfiles.some((item) => item.id === id)).length
      + [...privacyReferences].filter((id) => !metadata.privacyProfiles.some((item) => item.id === id)).length;
    if (missingClosure) throw new TypeError(`Generated compatibility metadata does not close for ${family.id}.`);
    return Object.freeze({
      id: family.id,
      owner: family.owner,
      privacy: family.privacy,
      metadataVersion: metadata.metadataVersion,
      compatibility: Object.freeze(compatibility),
      fixtureEvidence: Object.freeze(fixtureEvidence),
      closure: Object.freeze({
        shapes: metadata.shapes.length,
        boundProfiles: metadata.boundProfiles.length,
        hooks: metadata.hooks.length,
        serialisationProfiles: metadata.serialisationProfiles.length,
        privacyProfiles: metadata.privacyProfiles.length,
        consumerEdges: metadata.consumerEdges.length,
        consumerRelationships: 'consumerRelationships' in metadata ? metadata.consumerRelationships.length : 0,
      }),
    });
  });
  const matrix = Object.freeze({
    version: 1 as const,
    familyCount: families.length,
    compatibilityCount: families.reduce((sum, family) => sum + family.compatibility.length, 0),
    contractCount: contracts,
    fixtureCount: fixtures,
    families: Object.freeze(families),
  });
  if (Buffer.byteLength(JSON.stringify(matrix), 'utf8') > MAX_SCHEMA_LIFECYCLE_MATRIX_BYTES) {
    throw new TypeError('Schema lifecycle compatibility matrix exceeds its serialised byte bound.');
  }
  return matrix;
}

export async function validateSchemaLifecycleRepository(
  registry: SchemaLifecycleRegistry,
  discovery: SchemaSourceDiscovery,
): Promise<void> {
  const snapshot = await prepareSchemaLifecycleRepositorySnapshot(registry, discovery);
  validatePreparedSchemaLifecycleRepository(registry, snapshot);
}

type PreparedFixture = Readonly<{
  bytes: number;
  contentBase64: string;
  sha256: string;
}>;

export type PreparedSchemaLifecycleRepository = Readonly<{
  bindings: SchemaLifecycleSourceBindings;
  discoveryFiles: ReadonlySet<string>;
  fixtureByPath: ReadonlyMap<string, PreparedFixture>;
  hookModules: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}>;

function validatePreparedSchemaLifecycleStructure(
  registry: SchemaLifecycleRegistry,
  snapshot: PreparedSchemaLifecycleRepository,
): void {
  buildSchemaLifecycleCompatibilityMatrix(registry);
  const { bindings, discoveryFiles, hookModules } = snapshot;
  validateSchemaLifecycleDefinitionCoverage(bindings);
  if (bindings.registryEntries.length !== registry.length) {
    throw new TypeError('Schema lifecycle source registry and runtime registry lengths do not match.');
  }
  for (let index = 0; index < registry.length; index += 1) {
    if (bindings.registryEntries[index]?.owner !== registry[index]?.owner) {
      throw new TypeError(`Schema lifecycle runtime family owner does not match registry entry ${index + 1}.`);
    }
  }

  const declaredHookModules = [...hookModules.keys()].sort(ordinalCompare);
  const sourceHookModules = bindings.hookModules.map((binding) => binding.module).sort(ordinalCompare);
  if (declaredHookModules.length !== sourceHookModules.length
    || declaredHookModules.some((value, index) => value !== sourceHookModules[index])) {
    throw new TypeError('Schema lifecycle static hook-module bindings do not match their source imports.');
  }
  for (const module of declaredHookModules) {
    if (!discoveryFiles.has(module)) {
      throw new TypeError(`Schema lifecycle hook module is not an admitted source file: ${module}.`);
    }
  }

  const fixturePaths = new Set<string>();
  const hookModulePaths = new Set<string>();
  let declaredFixtureBytes = 0;
  for (const family of registry) {
    for (const fixture of family.fixtures) {
      if (fixturePaths.has(fixture.path)) throw new TypeError(`Schema lifecycle fixture path is duplicated: ${fixture.path}.`);
      fixturePaths.add(fixture.path);
      if (fixture.bytes > MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES - declaredFixtureBytes) {
        throw new TypeError('Schema lifecycle fixtures exceed their aggregate byte ceiling.');
      }
      declaredFixtureBytes += fixture.bytes;
    }
    if (!('metadata' in family)) continue;
    for (const hook of family.metadata.hooks) {
      hookModulePaths.add(hook.module);
      if (!hookModules.has(hook.module)) {
        throw new TypeError(`Schema lifecycle hook module is not statically bound: ${hook.module}.`);
      }
      const module = hookModules.get(hook.module)!;
      const descriptor = Object.getOwnPropertyDescriptor(module, hook.exportName);
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Schema lifecycle hook export is missing or is not callable: ${hook.module}#${hook.exportName}.`);
      }
    }
  }
  const referencedHookModules = [...hookModulePaths].sort(ordinalCompare);
  if (declaredHookModules.length !== referencedHookModules.length
    || declaredHookModules.some((value, index) => value !== referencedHookModules[index])) {
    throw new TypeError('Schema lifecycle static hook-module bindings are stale or incomplete.');
  }

}

export async function prepareSchemaLifecycleRepositorySnapshot(
  registry: SchemaLifecycleRegistry,
  discovery: SchemaSourceDiscovery,
): Promise<PreparedSchemaLifecycleRepository> {
  await validateCasePortabilitySourceClosure(discovery);
  await validateWorkspacePortabilitySourceClosure(discovery);
  const bindings = await repositoryLifecycleBindings(discovery);
  const hookModules = snapshotHookModules(SCHEMA_LIFECYCLE_HOOK_MODULES as HookModuleMap);
  const fixtureByPath = new Map<string, PreparedFixture>();
  const snapshot = Object.freeze({
    bindings,
    discoveryFiles: new Set(discovery.files),
    fixtureByPath,
    hookModules,
  });
  validatePreparedSchemaLifecycleStructure(registry, snapshot);

  let fixtureBytes = 0;
  for (const family of registry) {
    for (const fixture of family.fixtures) {
      const raw = await readBoundedRegularFileWithin(discovery.repositoryRoot, fixture.path, {
        maximumBytes: fixture.bytes,
        minimumBytes: fixture.bytes,
        label: `Schema lifecycle fixture ${fixture.id}`,
      });
      fixtureBytes += raw.byteLength;
      if (fixtureBytes > MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES) {
        throw new TypeError('Schema lifecycle fixtures exceed their aggregate byte ceiling.');
      }
      fixtureByPath.set(fixture.path, Object.freeze({
        bytes: raw.byteLength,
        contentBase64: raw.toString('base64'),
        sha256: createHash('sha256').update(raw).digest('hex'),
      }));
    }
  }
  return snapshot;
}

export function validatePreparedSchemaLifecycleRepository(
  registry: SchemaLifecycleRegistry,
  snapshot: PreparedSchemaLifecycleRepository,
): void {
  validatePreparedSchemaLifecycleStructure(registry, snapshot);
  let actualFixtureBytes = 0;
  for (const family of registry) {
    for (const fixture of family.fixtures) {
      const prepared = snapshot.fixtureByPath.get(fixture.path);
      if (!prepared) {
        throw new TypeError(`Schema lifecycle fixture ${fixture.id} is not present in the prepared repository snapshot.`);
      }
      if (prepared.bytes !== fixture.bytes) {
        throw new TypeError(`Schema lifecycle fixture ${fixture.id} does not match its registered byte length.`);
      }
      actualFixtureBytes += prepared.bytes;
      if (actualFixtureBytes > MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES) {
        throw new TypeError('Schema lifecycle fixtures exceed their aggregate byte ceiling.');
      }
      if (prepared.sha256 !== fixture.sha256) {
        throw new TypeError(`Schema lifecycle fixture ${fixture.id} does not match its registered SHA-256.`);
      }
      if ('metadata' in family && fixture.shapeId) {
        const shape = family.metadata.shapes.find((candidate) => candidate.id === fixture.shapeId);
        if (!shape) {
          throw new TypeError(`Schema lifecycle fixture ${fixture.id} does not name a registered shape.`);
        }
        if (shape.discriminator) {
          const label = `Schema lifecycle fixture ${fixture.id}`;
          assertSchemaLifecycleFixtureDiscriminator(
            decodeBoundedUtf8(Buffer.from(prepared.contentBase64, 'base64'), label),
            fixture.bytes,
            shape.discriminator.path,
            shape.discriminator.value,
            label,
          );
        }
      }
    }
  }
}
