import { buildCliCasePack } from '../cli/case-pack.mts';
import { applyCliCaseOperation } from '../cli/case-command.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { CLI_COMMAND_REGISTRY, commandOptionHelp } from '../cli/command-reference.mts';
import {
  buildInvestigationPlan,
  buildWorkflowRecipeCatalogue,
  formatInvestigationPlan,
} from '../cli/investigation-plan.mts';
import { buildCliLookupPlan, formatCliLookupPlan } from '../cli/lookup-plan.mts';
import {
  RPKI_ROUTE_INPUT_SCHEMA,
  buildOfflineEvidenceReview,
  formatOfflineEvidenceReview,
} from '../cli/offline-evidence-review.mts';
import { classifyQuery } from '../lib/classify.mts';
import { registryStandardsCoverageSnapshot } from '../lib/registry-capabilities.mts';
import { createCase } from '../packages/cases/case-model.mts';
import { CAPABILITY_MANIFEST, cliOperationForCommand } from '../packages/contracts/capability-manifest.mts';
import { CLI_HELP_GROUP_ORDER } from '../packages/contracts/cli-command-semantics.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';
import {
  CLI_PUBLIC_GUIDANCE,
  COVERAGE_DISTINCTIONS,
  METHODOLOGY_TOPICS,
} from '../packages/contracts/public-product.mts';

const EXAMPLE_TIME = '2026-08-23T00:00:00.000Z';
const SYNTHETIC_NOTICE = 'Synthetic reserved-domain example. It is not a live finding and no request was made.';

const GENERATED_MODULE_NOTICE = '// Generated from canonical runtime-neutral metadata. Do not edit by hand.\n';

function sourceJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('whoisleuth.', 'whoisleuth\\u002e');
}

function moduleSource(name: string, value: unknown): string {
  return `${GENERATED_MODULE_NOTICE}export const ${name} = ${sourceJson(value)} as const;\n`;
}

function publicCliCatalogue() {
  const workflowCatalogue = buildWorkflowRecipeCatalogue();
  const commands = CLI_COMMAND_REGISTRY.map((definition) => {
    const operation = cliOperationForCommand(definition.command);
    if (!operation) throw new Error(`Capability metadata is missing for CLI command ${definition.command}.`);
    return Object.freeze({
      id: definition.command,
      summary: definition.help.summary,
      description: definition.reference.description,
      group: definition.help.group,
      common: definition.documentation.common,
      usage: definition.reference.usage,
      example: definition.reference.example,
      boundary: definition.reference.boundary,
      collection: definition.collection,
      inputs: Object.freeze(definition.grammar.positionals.map((input) => Object.freeze({
        name: input.name,
        valueKind: input.valueKind,
        minimum: input.minimum,
        maximum: input.maximum,
        values: input.values,
        inputSource: input.inputSource,
        requiredWhenOptions: input.requiredWhenOptions,
      }))),
      importantOptions: definition.completion.options,
      options: commandOptionHelp(definition.command),
      networkEffect: definition.execution.networkEffect,
      disclosureClass: definition.documentation.disclosureClass,
      explicitAuthorisationRequired: definition.documentation.explicitAuthorisationRequired,
      planSupport: definition.documentation.planSupport,
      failurePolicySupport: definition.documentation.failurePolicySupport,
      supportedSchemaIdentifiers: definition.documentation.supportedSchemaIdentifiers,
      inputLimits: definition.documentation.inputLimits,
      outputLimits: definition.documentation.outputLimits,
      presentationOptions: definition.documentation.presentationOptions,
      fileOutput: definition.documentation.fileOutput,
      primaryEvidenceArtefacts: definition.documentation.primaryEvidenceArtefacts,
      capability: Object.freeze({
        familyId: operation.capabilityFamilyId,
        networkMode: operation.networkMode,
        dataSent: operation.disclosedData,
        recipients: operation.recipients,
        authorisation: operation.authorisation,
        retention: operation.retention,
        export: operation.export,
        outcomes: operation.outcomes,
        documentStates: operation.documentStates ?? Object.freeze([]),
        privacyLimitations: operation.privacyLimitations,
      }),
    });
  });
  return Object.freeze({
    commandCount: commands.length,
    groups: CLI_HELP_GROUP_ORDER,
    modes: Object.freeze(['offline', 'network']),
    commands: Object.freeze(commands),
    workflows: Object.freeze({
      recipes: workflowCatalogue.recipes,
      limitations: workflowCatalogue.limitations,
    }),
    limitations: Object.freeze([
      'This browser catalogue is fixed generated metadata. Searching, filtering, or opening a command makes no request and reads no local evidence.',
      'Collection and runtime availability are evaluated only after a deliberate installed CLI invocation.',
    ]),
  });
}

function publicCoverage() {
  const registry = registryStandardsCoverageSnapshot();
  return Object.freeze({
    distinctions: COVERAGE_DISTINCTIONS,
    summary: Object.freeze({
      capabilityFamilies: CAPABILITY_MANIFEST.capabilities.length,
      cliOperations: CAPABILITY_MANIFEST.cliOperations.length,
      registrySnapshot: Object.freeze({
        schema: registry.schema,
        version: registry.version,
        verifiedAt: registry.verifiedAt,
        counts: registry.counts,
        exceptionCount: registry.exceptions.length,
        interpretation: registry.interpretation,
      }),
    }),
    capabilities: Object.freeze(CAPABILITY_MANIFEST.capabilities.map((capability) => Object.freeze({
      id: capability.id,
      title: capability.title,
      job: capability.job,
      implemented: true,
      reviewBasis: 'Versioned capability contract and deterministic repository verification',
      optionalOrConfigurationDependent: capability.trigger === 'deployment_configuration'
        || capability.trigger === 'variant_specific'
        || capability.planes.includes('optional_worker')
        || capability.credentialModel !== 'none',
      executionPlanes: capability.planes,
      scanModes: capability.scanModes,
      networkMode: capability.networkMode,
      runtimeAvailability: 'not_evaluated_by_public_catalogue',
      outcomes: capability.outcomes,
      partialResultContract: capability.partialResults,
      limitations: capability.privacyLimitations,
    }))),
    intentionallyExcluded: Object.freeze([
      'Internet-wide or live-uptime coverage claims',
      'Arbitrary command, path, query-language, agent-protocol, submission, enforcement, or monitoring execution',
      'Inference of safety, ownership, control, attribution, intent, maliciousness, legal status, or universal completeness',
      'Automatic promotion of missing, stale, unsupported, unavailable, partial, blocked, or conflicting evidence into absence',
    ]),
  });
}

function publicMethodology() {
  return Object.freeze({
    topics: METHODOLOGY_TOPICS,
  });
}

function publicExamples() {
  const classified = classifyQuery('example.test');
  if (!classified) throw new Error('Reserved example target did not classify for generated public examples.');
  const lookupPlan = buildCliLookupPlan('example.test', classified, true);
  const offlineReview = buildOfflineEvidenceReview(JSON.stringify({
    schema: RPKI_ROUTE_INPUT_SCHEMA,
    version: 1,
    routePrefix: '192.0.2.0/24',
    originAsn: 'AS64496',
    authorizations: [],
  }), EXAMPLE_TIME);
  const workflow = buildInvestigationPlan('evidence-handoff', 'Example Review', EXAMPLE_TIME);
  const createdCase = createCase({ domain: 'example.test', source: 'manual', tags: ['synthetic'] }, EXAMPLE_TIME);
  const syntheticCase = Object.freeze({ ...createdCase, id: 'case-synthetic-example' });
  const observation = { label: 'Selected page observation', value: 'A form was retained in the supplied fictional capture.', source: 'Analyst supplied fictional capture',
    observedAt: EXAMPLE_TIME, completeness: 'partial', sourceState: 'partial', observationHostname: 'example.test', limitations: ['One supplied page only.'] };
  const inputs: ReadonlyArray<{ operation: 'pin' | 'assess' | 'recheck'; title: string; summary: string; value: Record<string, unknown> }> = [
    { operation: 'pin', title: 'Case evidence-pin input', summary: 'An observation with its own source, time and partial coverage.', value: observation },
    { operation: 'assess', title: 'Case assessment input', summary: 'A reviewed disposition linked to a new source-qualified pin. Replace every fictional claim before using it.',
      value: { disposition: 'suspicious', reviewReasonCode: 'other_reviewed', summary: 'Review the apparent credential request', rationale: 'The supplied observation needs independent corroboration.', evidence: [{ pin: observation, stance: 'supports' }] } },
    { operation: 'recheck', title: 'Case incomplete-recheck input', summary: 'An unavailable observation, not a removal or takedown conclusion.',
      value: { state: 'unavailable', observedAt: EXAMPLE_TIME, completeness: 'partial', source: 'Fictional later capture', comparisonSummary: 'The later capture did not complete.', limitations: ['No later page content is available.'] } },
  ];
  const inputExamples = inputs.map(input => {
    const filename = `synthetic-${input.operation}.json`;
    const argv = ['case', input.operation, 'synthetic-cases.json', '--input', filename, '--output', 'reviewed-cases.json'];
    const args = parseCliArguments(argv);
    if (args.action !== 'case') throw new Error('Case input example selected another command.');
    applyCliCaseOperation([syntheticCase], args, input.value, null, EXAMPLE_TIME);
    return Object.freeze({ id: `case-${input.operation}-input`, title: input.title, format: 'JSON', direction: 'input' as const,
      command: `whoisleuth ${argv.join(' ')}`, summary: input.summary, synthetic: true, notice: SYNTHETIC_NOTICE,
      content: JSON.stringify(input.value, null, 2), large: false, downloadName: filename, mediaType: 'application/json' });
  });
  const casePack = buildCliCasePack(JSON.stringify({
    version: CASE_SCHEMA_VERSION,
    exportedAt: EXAMPLE_TIME,
    cases: [syntheticCase],
  }), { audience: 'public', reviewed: true }, EXAMPLE_TIME);
  const examples = Object.freeze([
    Object.freeze({
      id: 'lookup-preflight',
      direction: 'output' as const,
      title: 'Deep Lookup preflight',
      format: 'terminal',
      command: 'whoisleuth lookup example.test --deep --plan',
      summary: 'A request-free plan naming intended source families and disclosures.',
      synthetic: true,
      notice: SYNTHETIC_NOTICE,
      content: `${SYNTHETIC_NOTICE}\n\n${formatCliLookupPlan(lookupPlan)}`,
      large: false,
      downloadName: 'synthetic-lookup-preflight.txt',
      mediaType: 'text/plain',
    }),
    Object.freeze({
      id: 'offline-route-review',
      direction: 'output' as const,
      title: 'Offline route-origin review',
      format: 'terminal',
      command: 'whoisleuth review-evidence synthetic-route.json',
      summary: 'An offline comparison against an empty analyst-supplied reserved-address authorisation set.',
      synthetic: true,
      notice: SYNTHETIC_NOTICE,
      content: `${SYNTHETIC_NOTICE}\n\n${formatOfflineEvidenceReview(offlineReview)}`,
      large: false,
      downloadName: 'synthetic-offline-route-review.txt',
      mediaType: 'text/plain',
    }),
    Object.freeze({
      id: 'workflow-plan',
      direction: 'output' as const,
      title: 'Reviewed evidence-handoff workflow',
      format: 'terminal',
      command: 'whoisleuth workflow-plan evidence-handoff "Example Review"',
      summary: 'A fixed plan that verifies, packages, and lints reviewed material without submitting it.',
      synthetic: true,
      notice: SYNTHETIC_NOTICE,
      content: `${SYNTHETIC_NOTICE}\n\n${formatInvestigationPlan(workflow)}`,
      large: false,
      downloadName: 'synthetic-evidence-handoff-plan.txt',
      mediaType: 'text/plain',
    }),
    Object.freeze({
      id: 'case-handoff',
      direction: 'output' as const,
      title: 'Importable public Case handoff',
      format: 'JSON',
      command: 'whoisleuth case-pack synthetic-cases.json --audience public --reviewed --json',
      summary: `A complete public Case-pack v2 built from one reserved-domain Case schema ${CASE_SCHEMA_VERSION} record, with a verifiable digest.`,
      synthetic: true,
      notice: SYNTHETIC_NOTICE,
      content: JSON.stringify(casePack, null, 2),
      large: true,
      downloadName: 'synthetic-reviewed-case-handoff.json',
      mediaType: 'application/json',
    }),
    ...inputExamples,
  ]);
  return Object.freeze({
    generatedAt: EXAMPLE_TIME,
    examples,
    limitations: Object.freeze([
      SYNTHETIC_NOTICE,
      'Copying or downloading an example changes no workspace data and does not execute the displayed command.',
    ]),
  });
}

function renderPublicCliCatalogueModule(): string {
  const catalogue = publicCliCatalogue();
  const sharedOptions: ReturnType<typeof commandOptionHelp>[number][] = [];
  const optionIndices = new Map<string, number>();
  const commandSources = catalogue.commands.map((command) => {
    const references = command.options.map((option) => {
      const identity = JSON.stringify(option);
      let index = optionIndices.get(identity);
      if (index === undefined) {
        index = sharedOptions.length;
        optionIndices.set(identity, index);
        sharedOptions.push(option);
      }
      return `SHARED_COMMAND_OPTIONS[${index}]`;
    });
    return sourceJson({ ...command, options: [] })
      .replace('  "options": []', () => `  "options": [${references.join(', ')}]`)
      .split('\n').map((line) => `    ${line}`).join('\n');
  });
  return `${GENERATED_MODULE_NOTICE}const SHARED_COMMAND_OPTIONS = ${sourceJson(sharedOptions)} as const;\n`
    + `export const PUBLIC_CLI_CATALOGUE = ${sourceJson({ ...catalogue, commands: [] })
      .replace('  "commands": []', () => `  "commands": [\n${commandSources.join(',\n')}\n  ]`)} as const;\n`;
}

function renderPublicCliGrammarModule(): string {
  const shared: unknown[] = [], indices = new Map<string, number>();
  const commands = CLI_COMMAND_REGISTRY.map(definition => {
    const references = definition.grammar.options.map(option => {
      const key = JSON.stringify(option);
      let index = indices.get(key);
      if (index === undefined) { index = shared.length; indices.set(key, index); shared.push(option); }
      return `SHARED_OPTIONS[${index}]`;
    });
    const grammar = sourceJson({ ...definition.grammar, options: [] })
      .replace('  "options": []', () => `  "options": [${references.join(', ')}]`);
    return `${JSON.stringify(definition.command)}: ${grammar}`;
  });
  return `${GENERATED_MODULE_NOTICE}import type { CliCommandGrammar } from '../../../../packages/contracts/cli-grammar.mts';\n`
    + `const SHARED_OPTIONS = ${sourceJson(shared)} as const;\n`
    + `export const PUBLIC_CLI_GRAMMAR = {\n${commands.join(',\n')}\n} as const satisfies Readonly<Record<string, CliCommandGrammar>>;\n`;
}

function renderPublicCliIndexModule(): string {
  const catalogue = publicCliCatalogue();
  return moduleSource('PUBLIC_CLI_INDEX', Object.freeze({
    commandCount: catalogue.commandCount,
    groups: catalogue.groups,
    modes: catalogue.modes,
    commands: Object.freeze(catalogue.commands.map((command) => Object.freeze({
      id: command.id,
      summary: command.summary,
      group: command.group,
      common: command.common,
      mode: command.collection.mode,
    }))),
    workflows: Object.freeze(catalogue.workflows.recipes.map((recipe) => Object.freeze({
      id: recipe.id,
      label: recipe.label,
      objective: recipe.objective,
      subjectRequirement: recipe.subjectRequirement,
      runnableByWorkflowRun: recipe.runnableByWorkflowRun,
    }))),
  }));
}

function renderPublicCliGuidanceModule(): string {
  return moduleSource('PUBLIC_CLI_GUIDANCE', CLI_PUBLIC_GUIDANCE);
}

function renderPublicCoverageModule(): string {
  return moduleSource('PUBLIC_COVERAGE', publicCoverage());
}

function renderPublicCoverageSummaryModule(): string {
  const coverage = publicCoverage();
  return moduleSource('PUBLIC_COVERAGE_SUMMARY', Object.freeze({
    distinctions: coverage.distinctions,
    summary: coverage.summary,
    intentionallyExcluded: coverage.intentionallyExcluded,
  }));
}

function renderPublicMethodologyModule(): string {
  return moduleSource('PUBLIC_METHODOLOGY', publicMethodology());
}

function renderPublicExamplesModule(): string {
  return moduleSource('PUBLIC_EXAMPLES', publicExamples());
}

function renderPublicExamplesIndexModule(): string {
  const examples = publicExamples();
  return moduleSource('PUBLIC_EXAMPLES_INDEX', Object.freeze({
    generatedAt: examples.generatedAt,
    examples: Object.freeze(examples.examples.map((example) => Object.freeze({
      id: example.id,
      direction: example.direction,
      title: example.title,
      format: example.format,
      command: example.command,
      summary: example.summary,
      synthetic: example.synthetic,
      notice: example.notice,
      large: example.large,
    }))),
    limitations: examples.limitations,
  }));
}

export {
  publicCliCatalogue,
  publicCoverage,
  publicExamples,
  publicMethodology,
  renderPublicCliCatalogueModule,
  renderPublicCliGrammarModule,
  renderPublicCliGuidanceModule,
  renderPublicCliIndexModule,
  renderPublicCoverageModule,
  renderPublicCoverageSummaryModule,
  renderPublicExamplesIndexModule,
  renderPublicExamplesModule,
  renderPublicMethodologyModule,
};
