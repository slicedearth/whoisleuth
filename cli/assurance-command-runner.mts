import { Buffer } from 'node:buffer';

import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  MAX_ASSURANCE_INPUT_BYTES,
  buildDomainAssurance,
  formatDomainAssurance,
} from '../lib/domain-assurance.mts';
import {
  MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES,
  buildDomainChangePacket,
  formatDomainChangePacket,
} from '../lib/domain-change-packet.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  buildDomainControlFlightRecorder,
  formatDomainControlFlightRecorder,
  serializeDomainControlFlightRecorder,
} from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildDomainControlManifest,
  formatDomainControlResult,
  reviewDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
  MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
  buildCliDomainControlReview,
  formatCliDomainControlReview,
} from './domain-control-observations.mts';
import { serializeDomainControlManifest } from '../packages/evidence/domain-control-runtime.mts';
import { MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES } from '../packages/contracts/domain-control-review.mts';
import type { CliArguments } from './arguments.mts';
import {
  MAX_CT_EVENT_INPUT_BYTES,
  buildCtEventFindings,
  formatCtEventFindings,
} from './ct-event-intake.mts';
import { boundedCliErrorMessage, CliUsageError } from './errors.mts';
import EXIT_CODES from './exit-codes.mts';
import {
  MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES,
  formatExternalObservationMapping,
  mapExternalObservations,
} from './external-observation-mapping.mts';
import { formatJsonDocument } from './formatters/json.mts';
import {
  MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
  buildInvestigationManifest,
  formatInvestigationManifest,
} from './investigation-manifest.mts';
import {
  buildOpenAssetModelBridge,
  formatOpenAssetModelBridge,
} from './open-asset-model-bridge.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { ASSURANCE_INLINE_COMMANDS } from './inline-command-families.mts';
import {
  MAX_SHARING_REVIEW_BYTES,
  buildSharingReview,
  formatSharingReview,
} from './sharing-review.mts';

type AssuranceInlineCommand = typeof ASSURANCE_INLINE_COMMANDS[number];
type AssuranceCommandArguments = Extract<CliArguments, { action: AssuranceInlineCommand }>;

async function runAssuranceCommand(
  args: AssuranceCommandArguments,
  dependencies: CliDependencies,
  context: CliCommandContext,
): Promise<number> {
  if (args.action === 'manifest') {
    context.setFailureLabel('Investigation manifest');
    const artifacts: { content: string }[] = [];
    let totalBytes = 0;
    try {
      for (const source of args.sources) {
        const content = dependencies.readDiffInput
          ? await dependencies.readDiffInput(source)
          : await context.readInput(source, MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES, 'Manifest artefact input');
        totalBytes += Buffer.byteLength(content, 'utf8');
        if (totalBytes > MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) {
          throw new CliUsageError(`Manifest artefacts exceed the ${MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES}-byte combined limit.`);
        }
        artifacts.push({ content });
      }
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read manifest artefact input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    let document;
    try {
      document = await buildInvestigationManifest({
        workflow: args.workflow,
        configurationDigestSha256: args.configurationDigestSha256,
        artifacts,
      }, context.now(), context.packageVersion);
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Investigation manifest input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatInvestigationManifest(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'map-observations' || args.action === 'oam-export') {
    const mapping = args.action === 'map-observations';
    context.setFailureLabel(mapping ? 'External observation mapping' : 'Open Asset Model export');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(
          args.source,
          MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES,
          mapping ? 'External observation mapping input' : 'Open Asset Model bridge input',
        );
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read ${mapping ? 'observation mapping' : 'asset bridge'} input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError(`${args.action} requires one versioned JSON file or a document on stdin.`);
    let parsed: unknown;
    try {
      scanBoundedJson(input);
      parsed = JSON.parse(input);
    } catch {
      throw new CliUsageError(`${mapping ? 'External observation mapping' : 'Open Asset Model bridge'} input is not valid bounded JSON without duplicate keys.`);
    }
    let document;
    try {
      document = mapping
        ? mapExternalObservations(parsed)
        : buildOpenAssetModelBridge(parsed, context.now());
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, `${mapping ? 'External observation mapping' : 'Open Asset Model bridge'} input is invalid`));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(mapping
          ? formatExternalObservationMapping(document as ReturnType<typeof mapExternalObservations>)
          : formatOpenAssetModelBridge(document as ReturnType<typeof buildOpenAssetModelBridge>), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'domain-control') {
    context.setFailureLabel('Domain control review');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(args.source, MAX_DOMAIN_CONTROL_REVIEW_COMMAND_BYTES, 'Domain control input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read domain control input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('domain-control requires one JSON file or a document on stdin.');
    const normalisedInput = input.replace(/^\uFEFF/u, '');
    let parsed: unknown;
    try {
      scanBoundedJson(normalisedInput, {
        maximumDepth: MAX_DOMAIN_CONTROL_REVIEW_JSON_DEPTH,
        maximumKeys: MAX_DOMAIN_CONTROL_REVIEW_JSON_KEYS,
        maximumValues: MAX_DOMAIN_CONTROL_REVIEW_JSON_VALUES,
      });
      parsed = JSON.parse(normalisedInput);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '';
      if (detail.startsWith('Artefact JSON ')) {
        throw new CliUsageError(`Domain control input ${detail.slice('Artefact JSON '.length)}`);
      }
      throw new CliUsageError('Domain control input is not valid JSON.');
    }
    const schema = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).schema
      : null;
    const document = schema === DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA
      ? buildDomainControlManifest(parsed, context.now())
      : schema === DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
        ? reviewDomainControlManifest(parsed, context.now())
        : schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
          ? buildCliDomainControlReview(input, context.now())
          : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
            ? buildDomainControlFlightRecorder(parsed, context.now())
            : null;
    if (!document) {
      throw new CliUsageError('Domain control input must use a supported manifest, review, saved-Lookup review, or flight-recorder schema.');
    }
    const terminalDocument = schema === CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA
      ? formatCliDomainControlReview(document as ReturnType<typeof buildCliDomainControlReview>)
      : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
        ? formatDomainControlFlightRecorder(document as ReturnType<typeof buildDomainControlFlightRecorder>)
        : formatDomainControlResult(document as ReturnType<typeof buildDomainControlManifest> | ReturnType<typeof reviewDomainControlManifest>);
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? schema === DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA
          ? serializeDomainControlManifest(document)
          : schema === DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA
            ? serializeDomainControlFlightRecorder(document as ReturnType<typeof buildDomainControlFlightRecorder>)
            : formatJsonDocument(document)
        : context.terminal(terminalDocument, args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'assurance') {
    context.setFailureLabel('Domain assurance review');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(args.source, MAX_ASSURANCE_INPUT_BYTES, 'Domain assurance input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read domain assurance input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('assurance requires one versioned JSON file or a document on stdin.');
    let parsed: unknown;
    try {
      scanBoundedJson(input);
      parsed = JSON.parse(input);
    } catch {
      throw new CliUsageError('Domain assurance input is not valid bounded JSON without duplicate keys.');
    }
    let document;
    try {
      document = buildDomainAssurance(parsed, context.now());
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Domain assurance input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatDomainAssurance(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  if (args.action === 'change-packet') {
    context.setFailureLabel('Domain change packet');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(args.source, MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES, 'Domain change packet input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read domain change packet input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('change-packet requires one versioned JSON file or a document on stdin.');
    let parsed: unknown;
    try {
      scanBoundedJson(input);
      parsed = JSON.parse(input);
    } catch {
      throw new CliUsageError('Domain change packet input is not valid bounded JSON without duplicate keys.');
    }
    let document;
    try {
      document = await buildDomainChangePacket(parsed, context.now());
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Domain change packet input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatDomainChangePacket(document), args.color));
    }
    return document.gate.pass ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE;
  }

  if (args.action === 'sharing-review') {
    context.setFailureLabel('Evidence sharing review');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(args.source, MAX_SHARING_REVIEW_BYTES, 'Sharing review input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read sharing review input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('sharing-review requires one artefact JSON file or a document on stdin.');
    let document;
    try {
      document = await buildSharingReview(input, {
        marking: args.marking,
        recipientScope: args.recipientScope,
        purpose: args.purpose,
        humanReviewed: args.humanReviewed,
        personalDataReviewed: args.personalDataReviewed,
        redactionsConfirmed: args.redactionsConfirmed,
      }, context.now());
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Sharing review input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatSharingReview(document), args.color));
    }
    return document.summary.status === 'blocked' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  }

  if (args.action === 'ct-intake') {
    context.setFailureLabel('Certificate event intake');
    let input: string;
    try {
      input = dependencies.readArtifactInput
        ? await dependencies.readArtifactInput(args.source)
        : await context.readInput(args.source, MAX_CT_EVENT_INPUT_BYTES, 'Certificate event input');
    } catch (error) {
      if (error instanceof CliUsageError) throw error;
      throw new CliUsageError(`Could not read certificate event input: ${boundedCliErrorMessage(error, 'Input could not be read')}`);
    }
    if (!input.trim()) throw new CliUsageError('ct-intake requires one versioned JSON file or a document on stdin.');
    let parsed: unknown;
    try {
      scanBoundedJson(input);
      parsed = JSON.parse(input);
    } catch {
      throw new CliUsageError('Certificate event input is not valid bounded JSON without duplicate keys.');
    }
    let document;
    try {
      document = buildCtEventFindings(parsed);
    } catch (error) {
      throw new CliUsageError(boundedCliErrorMessage(error, 'Certificate event input is invalid'));
    }
    if (!args.quiet) {
      context.writeStdout(args.output === 'json'
        ? formatJsonDocument(document)
        : context.terminal(formatCtEventFindings(document), args.color));
    }
    return EXIT_CODES.SUCCESS;
  }

  throw new Error('Assurance command routing is inconsistent.');
}

export { runAssuranceCommand };
