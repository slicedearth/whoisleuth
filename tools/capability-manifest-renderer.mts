import {
  CAPABILITY_MANIFEST,
  type CapabilityManifest,
} from '../packages/contracts/capability-manifest.mts';

function tokenLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function tokenList(values: readonly string[]): string {
  return values.length > 0 ? values.map(tokenLabel).join('<br>') : 'None';
}

function renderCapabilityManifestMarkdown(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): string {
  const lines = [
    '# Capability and Data-flow Contract',
    '',
    '> Generated from `packages/contracts/capability-manifest.mts`. Run `npm run capabilities:check` to verify this file.',
    '',
    `Contract: \`${manifest.schema}\` version ${manifest.version}.`,
    '',
    'This catalogue describes existing execution, disclosure, retention and assurance boundaries. It does not enable a capability, make a request, grant authorisation, or replace the detailed privacy and operations guidance.',
    '',
    '## Execution planes',
    '',
    '| Plane | Boundary |',
    '| --- | --- |',
    '| Browser local | Local derivation, deliberate browser-profile retention and export. |',
    '| Hosted bounded passive | Authenticated, feature-gated and budgeted collection through the hosted runtime. |',
    '| Local CLI offline | Bounded local parsing, comparison, verification, reporting and planning with no request. |',
    '| Local CLI network | Explicit bounded collection from the local CLI. |',
    '| Local CLI authorised active | Isolated owned-or-authorised protocol action with an explicit acknowledgement. |',
    '| Local tool offline | Optional repository-local processing with no network request. |',
    '| Local tool authorised active | Optional repository-local active collection after a specific authorisation acknowledgement. |',
    '| Optional worker | Separately configured bounded monitoring that is not general evidence custody. |',
    '',
    '## Capability catalogue',
    '',
    '| Capability | Job | Trigger | Planes | Scan modes | Network | Disclosure | Recipients | Credentials | Retention | Export | Scoring | Authorisation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of manifest.capabilities) {
    lines.push(`| \`${item.id}\` — ${item.title} | ${item.job} | ${tokenLabel(item.trigger)} | ${tokenList(item.planes)} | ${tokenList(item.scanModes)} | ${tokenLabel(item.networkMode)} | ${tokenList(item.disclosedData)} | ${tokenList(item.recipients)} | ${tokenLabel(item.credentialModel)} | ${tokenLabel(item.retention)} | ${tokenLabel(item.export)} | ${tokenLabel(item.scoringEffect)} | ${tokenLabel(item.authorisation)} |`);
  }
  lines.push(
    '',
    '## CLI operation catalogue',
    '',
    `The public command catalogue keeps its version 1 offline/network label for all ${manifest.cliOperations.length} installed CLI operations. These operation records retain the more precise plane, activation, credential, export and scoring contract.`,
    '',
    '| Operation | Capability family | Legacy collection | Trigger | Planes | Network | Disclosure | Recipients | Credentials | Retention | Export | Scoring | Authorisation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of manifest.cliOperations) {
    lines.push(`| \`${item.recordId}\` | \`${item.capabilityFamilyId}\` | ${item.collectionMode} | ${tokenLabel(item.trigger)} | ${tokenList(item.planes)} | ${tokenLabel(item.networkMode)} | ${tokenList(item.disclosedData)} | ${tokenList(item.recipients)} | ${tokenLabel(item.credentialModel)} | ${tokenLabel(item.retention)} | ${tokenLabel(item.export)} | ${tokenLabel(item.scoringEffect)} | ${tokenLabel(item.authorisation)} |`);
  }
  lines.push(
    '',
    '### Conditional CLI variants',
    '',
    'Variant rows override the aggregate operation boundary; no-request variants never inherit a collection disclosure or scoring claim.',
    '',
    '| Operation | Variant | Trigger | Planes | Network | Disclosure | Recipients | Request budget | Response budget | Concurrency | Credentials | Retention | Export | Scoring | Authorisation | Cancellation | Partial results | Outcomes | Document states |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of manifest.cliOperations) {
    for (const variant of item.variants ?? []) {
      lines.push(`| \`${item.recordId}\` | \`${variant.id}\` | ${tokenLabel(variant.trigger)} | ${tokenList(variant.planes)} | ${tokenLabel(variant.networkMode)} | ${tokenList(variant.disclosedData)} | ${tokenList(variant.recipients)} | ${tokenLabel(variant.requestBudget)} | ${tokenLabel(variant.responseBudget)} | ${tokenLabel(variant.concurrency)} | ${tokenLabel(variant.credentialModel)} | ${tokenLabel(variant.retention)} | ${tokenLabel(variant.export)} | ${tokenLabel(variant.scoringEffect)} | ${tokenLabel(variant.authorisation)} | ${tokenLabel(variant.cancellation)} | ${tokenLabel(variant.partialResults)} | ${tokenList(variant.outcomes)} | ${tokenList(variant.documentStates ?? [])} |`);
    }
  }
  lines.push(
    '',
    '## Hosted policy and budget bindings',
    '',
    'Runtime configuration and admission remain with their existing enforcement owners. This table records the exact stable identities that the manifest validates against them.',
    '',
    '| Capability | Feature policy | Hard dependencies | Operation budget variants |',
    '| --- | --- | --- | --- |',
  );
  for (const item of manifest.capabilities.filter((capability) => (
    capability.featurePolicyId || capability.operationBudgetVariants
  ))) {
    lines.push(`| \`${item.id}\` | ${item.featurePolicyId ? `\`${item.featurePolicyId}\`` : 'None'} | ${(item.featurePolicyDependencies ?? []).map((dependency) => `\`${dependency}\``).join('<br>') || 'None'} | ${(item.operationBudgetVariants ?? []).map((variant) => `\`${variant.featureId}\` → \`${variant.classId}\``).join('<br>') || 'Parent operation budget'} |`);
  }
  lines.push(
    '',
    '### Worker-cycle bounds',
    '',
    '| Capability | Maximum lookups | Maximum processed deliveries | Soft cycle budget | Minimum lookup window |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const item of manifest.capabilities.filter((capability) => capability.workerCycleBudget)) {
    const budget = item.workerCycleBudget;
    if (budget) lines.push(`| \`${item.id}\` | ${budget.maxLookups} | ${budget.maxProcessedDeliveries} | ${budget.softCycleBudgetMs} ms | ${budget.minLookupWindowMs} ms |`);
  }
  lines.push(
    '',
    '### Distributed-control bounds',
    '',
    '| Capability | Request timeout | Response | Provider-unavailable retry hint | Request attempts | Automatic retries | Default lease | Lease range | Maximum counter |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const item of manifest.capabilities.filter((capability) => capability.distributedControlBudget)) {
    const budget = item.distributedControlBudget;
    if (budget) lines.push(`| \`${item.id}\` | ${budget.requestTimeoutMs} ms | ${budget.maxResponseBytes} bytes | ${budget.providerUnavailableRetryAfterSeconds} seconds | ${budget.maxRequestAttempts} | ${budget.automaticRetries} | ${budget.defaultLeaseTtlMs} ms | ${budget.minLeaseTtlMs}–${budget.maxLeaseTtlMs} ms | ${budget.maxUsageCounter} |`);
  }
  lines.push(
    '',
    '### Rendered-capture bounds',
    '',
    '| Capability | Requests | Hosts | URL length | Deadline | Per response | Aggregate transfer | Manifest | DOM digest | Screenshot | DOM elements | DOM projection | Visible-text input |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const item of manifest.capabilities.filter((capability) => capability.renderedCaptureBudget)) {
    const budget = item.renderedCaptureBudget;
    if (budget) lines.push(`| \`${item.id}\` | ${budget.maxRequests} | ${budget.maxHosts} | ${budget.maxUrlLength} characters | ${budget.maxTimeoutMs} ms | ${budget.maxResponseBytes} bytes | ${budget.maxTransferBytes} bytes | ${budget.maxManifestBytes} bytes | ${budget.maxDomDigestBytes} bytes | ${budget.maxScreenshotBytes} bytes | ${budget.maxDomElements} | ${budget.maxDomProjectionCharacters} characters | ${budget.maxVisibleTextBytes} bytes |`);
  }
  lines.push(
    '',
    '## Request and failure contracts',
    '',
    '| Capability | Request budget | Response budget | Concurrency | Cancellation | Partial results | Normalised outcomes | Document states |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of manifest.capabilities) {
    lines.push(`| \`${item.id}\` | ${tokenLabel(item.requestBudget)} | ${tokenLabel(item.responseBudget)} | ${tokenLabel(item.concurrency)} | ${tokenLabel(item.cancellation)} | ${tokenLabel(item.partialResults)} | ${tokenList(item.outcomes)} | ${tokenList(item.documentStates ?? [])} |`);
  }
  lines.push(
    '',
    '### CLI request and failure contracts',
    '',
    '| Operation | Request budget | Response budget | Concurrency | Cancellation | Partial results | Normalised outcomes | Document states |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const item of manifest.cliOperations) {
    lines.push(`| \`${item.recordId}\` | ${tokenLabel(item.requestBudget)} | ${tokenLabel(item.responseBudget)} | ${tokenLabel(item.concurrency)} | ${tokenLabel(item.cancellation)} | ${tokenLabel(item.partialResults)} | ${tokenList(item.outcomes)} | ${tokenList(item.documentStates ?? [])} |`);
  }
  lines.push('', '## Privacy limitations', '');
  for (const item of manifest.capabilities) {
    lines.push(`### ${item.title}`, '', ...item.privacyLimitations.map((limitation) => `- ${limitation}`), '');
  }
  lines.push(
    '## CLI privacy limitations',
    '',
    '| Operation | Fixed limitations |',
    '| --- | --- |',
  );
  for (const item of manifest.cliOperations) {
    lines.push(`| \`${item.recordId}\` | ${item.privacyLimitations.join('<br>')} |`);
  }
  lines.push(
    '',
    '## Invariants',
    '',
    '- Availability is dynamic state, not an execution plane.',
    '- A capability family link does not override an operation\'s execution plane, trigger, credential or request contract.',
    '- Fast, Compact, Deep, monitoring, offline review and authorised active actions remain distinct.',
    '- Partial, blocked, unsupported, unavailable, stale and budget-exhausted document outcomes remain explicit; cancellation is reported separately.',
    '- The manifest contains only fixed metadata; it cannot contain a target, credential, runtime secret or collected evidence value.',
  );
  return `${lines.join('\n')}\n`;
}

export { renderCapabilityManifestMarkdown, tokenLabel };
