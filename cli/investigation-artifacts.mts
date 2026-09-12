import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { CLI_LOOKUP_SCHEMA, CLI_LOOKUP_VERSION } from '../packages/contracts/cli-lookup.mts';
import { DOMAIN_CONTROL_REVIEW_SCHEMA, DOMAIN_CONTROL_REVIEW_VERSION } from '../packages/contracts/domain-control-review.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { validateDomainControlReviewDocument } from '../lib/domain-control-manifest.mts';
import { LOOKUP_EVIDENCE_SCHEMA, LOOKUP_EVIDENCE_SCHEMA_VERSION, serializeLookupEvidence } from '../lib/evidence-export.mts';
import { OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, OFFLINE_ARTIFACT_VERIFICATION_VERSION } from './artifact-verify.mts';
import { validateLookupEvidenceArtifactStructure } from './artifact-validation/lookup-evidence.mts';
import { CLI_DISCOVERY_SCAN_SCHEMA, CLI_DISCOVERY_SCAN_VERSION } from './discovery-scan.mts';
import {
  CLI_DISCOVER_SCHEMA, CLI_DISCOVER_SCHEMA_VERSION, CLI_POSTURE_SCHEMA, CLI_POSTURE_SCHEMA_VERSION,
  CLI_CT_SEARCH_SCHEMA, CLI_CT_SEARCH_SCHEMA_VERSION, CLI_COMPARE_SCHEMA, CLI_COMPARE_SCHEMA_VERSION,
} from './formatters/json.mts';
import { CLI_LOOKUP_BRIEF_SCHEMA, CLI_LOOKUP_BRIEF_VERSION } from './lookup-brief.mts';
import { EXTERNAL_FINDINGS_SCHEMA, EXTERNAL_FINDINGS_VERSION, parseExternalFindingsDocument } from '../packages/interchange/external-findings-import.mts';
import { SOURCE_RELIABILITY_REPORT_SCHEMA, SOURCE_RELIABILITY_REPORT_VERSION } from './source-reliability.mts';
import { CLI_CASE_PACK_SCHEMA, CLI_CASE_PACK_VERSION, verifyCliCasePack } from './case-pack.mts';
import { SHARING_REVIEW_SCHEMA, SHARING_REVIEW_VERSION } from './sharing-review.mts';
import { DOMAIN_ASSURANCE_SCHEMA, DOMAIN_ASSURANCE_VERSION } from '../lib/domain-assurance.mts';
import { DOMAIN_CHANGE_PACKET_SCHEMA, DOMAIN_CHANGE_PACKET_VERSION } from '../lib/domain-change-packet.mts';
import { CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, CLI_DOMAIN_CONTROL_MONITOR_VERSION } from '../packages/contracts/domain-control-monitor.mts';
import { CLI_LOOKUP_DIFF_SCHEMA, CLI_LOOKUP_DIFF_VERSION } from './lookup-diff.mts';
import { CLI_LOOKUP_TIMELINE_SCHEMA, CLI_LOOKUP_TIMELINE_VERSION } from './lookup-timeline.mts';
import { normalizeCliLookupDocument } from './saved-lookup.mts';
import { CliUsageError } from './errors.mts';
import type { buildInvestigationPlan } from './investigation-plan.mts';
import { MAX_INVESTIGATION_RUN_SELECTIONS, type WorkflowArtifactBinding } from '../packages/contracts/investigation-run.mts';

type Plan = ReturnType<typeof buildInvestigationPlan>;
type Step = Plan['steps'][number];
export type WorkflowArtifact = Readonly<{ id: string; schema: string; version: number }>;
export type WorkflowArtifactInput = Readonly<{ input: number; sourceStepId: string; artifactId: string }>;
export type WorkflowStepInputs = ReadonlyMap<string, string>;

// This is a fixed-recipe boundary, not a general command or format registry.
// Non-reusable reports have their envelope checked; reusable evidence also
// passes its existing input validator before it can enter another command.
export function validateWorkflowResult(step: Step, result: unknown, retained: boolean): WorkflowArtifact {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Expected a JSON document.');
  const value = result as Record<string, unknown>;
  let schema: string;
  let version: number;
  switch (step.command) {
    case 'lookup':
      schema = CLI_LOOKUP_SCHEMA; version = CLI_LOOKUP_VERSION;
      normalizeCliLookupDocument(value, { label: 'Workflow Lookup result' });
      break;
    case 'export':
      schema = LOOKUP_EVIDENCE_SCHEMA; version = LOOKUP_EVIDENCE_SCHEMA_VERSION;
      validateLookupEvidenceArtifactStructure(value);
      serializeLookupEvidence(value);
      break;
    case 'domain-control':
      schema = DOMAIN_CONTROL_REVIEW_SCHEMA; version = DOMAIN_CONTROL_REVIEW_VERSION;
      validateDomainControlReviewDocument(value);
      break;
    case 'case-pack':
      schema = CLI_CASE_PACK_SCHEMA; version = CLI_CASE_PACK_VERSION;
      verifyCliCasePack(value);
      break;
    case 'ct-search': schema = CLI_CT_SEARCH_SCHEMA; version = CLI_CT_SEARCH_SCHEMA_VERSION; break;
    case 'ct-intake':
      schema = EXTERNAL_FINDINGS_SCHEMA; version = EXTERNAL_FINDINGS_VERSION;
      parseExternalFindingsDocument(value);
      break;
    case 'brief': schema = CLI_LOOKUP_BRIEF_SCHEMA; version = CLI_LOOKUP_BRIEF_VERSION; break;
    case 'compare': schema = CLI_COMPARE_SCHEMA; version = CLI_COMPARE_SCHEMA_VERSION; break;
    case 'source-report': schema = SOURCE_RELIABILITY_REPORT_SCHEMA; version = SOURCE_RELIABILITY_REPORT_VERSION; break;
    case 'sharing-review': schema = SHARING_REVIEW_SCHEMA; version = SHARING_REVIEW_VERSION; break;
    case 'assurance': schema = DOMAIN_ASSURANCE_SCHEMA; version = DOMAIN_ASSURANCE_VERSION; break;
    case 'change-packet': schema = DOMAIN_CHANGE_PACKET_SCHEMA; version = DOMAIN_CHANGE_PACKET_VERSION; break;
    case 'monitor-once': schema = CLI_DOMAIN_CONTROL_MONITOR_SCHEMA; version = CLI_DOMAIN_CONTROL_MONITOR_VERSION; break;
    case 'discover': schema = CLI_DISCOVER_SCHEMA; version = CLI_DISCOVER_SCHEMA_VERSION; break;
    case 'discover-scan': schema = CLI_DISCOVERY_SCAN_SCHEMA; version = CLI_DISCOVERY_SCAN_VERSION; break;
    case 'posture': schema = CLI_POSTURE_SCHEMA; version = CLI_POSTURE_SCHEMA_VERSION; break;
    case 'verify-artifact': schema = OFFLINE_ARTIFACT_VERIFICATION_SCHEMA; version = OFFLINE_ARTIFACT_VERIFICATION_VERSION; break;
    case 'diff': schema = CLI_LOOKUP_DIFF_SCHEMA; version = CLI_LOOKUP_DIFF_VERSION; break;
    case 'timeline': schema = CLI_LOOKUP_TIMELINE_SCHEMA; version = CLI_LOOKUP_TIMELINE_VERSION; break;
    default: throw new TypeError('This command has no fixed-workflow output contract.');
  }
  const envelope = step.command === 'case-pack' ? value.packet as Record<string, unknown> : value;
  const actualVersion = step.command === 'export' || step.command === 'ct-intake' ? value.schemaVersion : envelope.version;
  // Only existing format validators admit historical versions. Report-only
  // steps use the same output versions as the latest public checkpoint writer.
  const historicalReader = retained && ['lookup', 'export', 'domain-control'].includes(step.command);
  if (envelope.schema !== schema || schema !== step.produces
    || (!historicalReader && actualVersion !== version) || !Number.isSafeInteger(actualVersion)) {
    throw new TypeError('Unsupported workflow output schema or version.');
  }
  const id = `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(value)).digest('hex')}`;
  return Object.freeze({ id, schema, version: Number(actualVersion) });
}

export function normalizeWorkflowBindings(plan: Plan, value: unknown): readonly WorkflowArtifactBinding[] {
  if (!Array.isArray(value) || value.length > MAX_INVESTIGATION_RUN_SELECTIONS) {
    throw new CliUsageError(`Workflow artefact bindings are limited to ${MAX_INVESTIGATION_RUN_SELECTIONS}.`);
  }
  const slots = new Set<string>();
  const bindings = value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !isDeepStrictEqual(Object.keys(raw).sort(), ['input', 'sourceStepId', 'stepId'])) {
      throw new CliUsageError('Workflow artefact bindings must identify a step, input number and earlier source step.');
    }
    const item = raw as Record<string, unknown>;
    const destinationIndex = plan.steps.findIndex((step) => step.id === item.stepId);
    const sourceIndex = plan.steps.findIndex((step) => step.id === item.sourceStepId);
    const step = plan.steps[destinationIndex];
    const source = plan.steps[sourceIndex];
    const input = Number(item.input);
    const expected = step ? workflowInputSchemas(step.command) : [];
    const slot = `${destinationIndex}:${input}`;
    if (!step || !source || sourceIndex >= destinationIndex || !expected.includes(source.produces)
      || typeof item.input !== 'number' || !Number.isSafeInteger(input) || input < 1
      || input > step.arguments.filter((argument) => /^<[^>]+>$/u.test(argument)).length || slots.has(slot)) {
      throw new CliUsageError('Workflow artefact binding does not match a compatible earlier output and file input in the fixed recipe.');
    }
    slots.add(slot);
    return Object.freeze({ stepId: step.id, input, sourceStepId: source.id });
  });
  return Object.freeze(bindings.sort((left, right) =>
    plan.steps.findIndex((step) => step.id === left.stepId) - plan.steps.findIndex((step) => step.id === right.stepId)
      || left.input - right.input));
}

/** Compatible file inputs in the installed recipes, not general CLI pipelines. */
export function workflowInputSchemas(command: Step['command']): readonly string[] {
  switch (command) {
    case 'export': case 'diff': case 'timeline': case 'compare': case 'source-report': case 'brief': return [CLI_LOOKUP_SCHEMA];
    case 'verify-artifact': return [LOOKUP_EVIDENCE_SCHEMA];
    case 'sharing-review': return [CLI_CASE_PACK_SCHEMA];
    default: return [];
  }
}

export function workflowArtifactReference(artifact: WorkflowArtifact): string {
  return `workflow-artifact:${artifact.id}`;
}
