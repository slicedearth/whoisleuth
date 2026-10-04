import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { MAX_MESSAGE_INTAKE_BYTES, MESSAGE_INTAKE_INPUTS, type MessageIntakeReport } from '../packages/contracts/message-intake.mts';
import { reviewSelectedInputInWorker } from './selected-input-worker.mts';
import { reviewIdentityIncident } from '../packages/investigation/identity-incident-review.mts';
import { intakeIndicators, intakeIndicatorSource } from '../packages/investigation/intake-indicators.mts';
import { MAX_INTAKE_CONTEXT_BYTES, parseIntakeContextInput, withIntakeDistributionContext } from '../packages/investigation/intake-context.mts';
import { selectReceiverTrust, authenticationHeaderLabel } from '../packages/investigation/mail-authentication-review.mts';
import type { CliArguments } from './arguments.mts';
import type { CliCommandContext } from './runner-types.mts';
import { CliUsageError } from './errors.mts';
import { formatJsonDocument } from './formatters/json.mts';
import EXIT_CODES from './exit-codes.mts';

export type IntakeCommandDependencies = {
  signal?: AbortSignal;
  readBinaryArtifactInput?: (source: string) => Uint8Array | Promise<Uint8Array>;
};

export function formatMessageIntake(report: MessageIntakeReport): string {
  const lines = [`Offline ${report.source.kind} intake`, `Review: ${report.coverage.state} · Extracted links: ${report.links.length} · Reviewed parts: ${report.coverage.reviewedParts}`,
    `Source: ${report.source.digestSha256} · ${report.source.byteLength} bytes`];
  for (const identity of report.identities) lines.push(`Part ${identity.part} ${identity.role.replaceAll('_', ' ')}: ${identity.domain}`);
  for (const header of report.authenticationReview.headers) {
    lines.push(`${authenticationHeaderLabel(header)} · ${header.state} · receiver trust: ${header.receiverTrust.replaceAll('_', ' ')}`);
    for (const claim of header.claims) lines.push(`  ${claim.method}/${claim.methodVersion}: ${claim.result} (${claim.state})${claim.domains.map(value => ` · ${value.property}=${value.domain}`).join('')}${claim.duplicateProperties.length ? ` · ambiguous properties: ${claim.duplicateProperties.join(', ')}` : ''}`);
    if (header.duplicateOf) lines.push(`  Duplicate of header ${header.duplicateOf} in this part.`);
    lines.push(...header.issues.map(issue => `  ${issue}`));
  }
  for (const link of report.links) {
    lines.push(`${link.id}: ${link.origin} · ${link.source.replaceAll('_', ' ')}${link.parentId ? ` · supplied inside ${link.parentId}` : ''}`);
    if (link.displayedHostname) lines.push(`  Displayed: ${link.displayedHostname} · ${link.displayedDestination.replaceAll('_', ' ')}`);
    if (link.authorisation) {
      lines.push(`  Authorisation: ${link.authorisation.kind.replaceAll('_', ' ')} · client ${link.authorisation.clientId ?? 'not retained or ambiguous'}`);
      if (link.authorisation.scopes.length) lines.push(`  Requested scopes: ${link.authorisation.scopes.join(', ')}`);
      if (link.authorisation.redirectOrigin) lines.push(`  Supplied return origin: ${link.authorisation.redirectOrigin}`);
      if (link.authorisation.duplicateParameters.length) lines.push(`  Ambiguous parameters: ${link.authorisation.duplicateParameters.join(', ')}`);
    }
  }
  for (const indicator of intakeIndicators(report)) lines.push(`${indicator.id}: ${indicator.kind.toUpperCase()} ${indicator.value} · literal selected text · ${indicator.location.partId}${indicator.location.page ? ` page ${indicator.location.page}` : ''} · source ${intakeIndicatorSource(report, indicator)}`);
  if (report.schemaVersion === 2) {
    lines.push(`Indicator coverage: ${report.indicatorCoverage.state.replaceAll('_', ' ')}. Hashes require explicit algorithm labels; no indicator was resolved or reputation-checked.`);
    const supplied = report.distributionContext;
    if (supplied) lines.push(`Analyst-declared distribution: ${supplied.channel} · ${supplied.sourceLabel} · observed ${supplied.observedAt ?? 'unknown'}`,
      `  Reference ${supplied.reference ?? 'not supplied'} · observer ${supplied.observerLabel ?? 'unknown'} · vantage ${supplied.vantageLabel ?? 'unknown'}`,
      'Distribution, observation time and vantage are supplied claims, not verified capture conditions or independent collection.');
  }
  if (report.actionHints.length) lines.push(`Review wording: ${report.actionHints.map(value => value.replaceAll('_', ' ')).join(', ')}`);
  if (report.documentReview) {
    lines.push(`Document coverage: ${report.documentReview.state} · pages ${report.documentReview.reviewedPages}/${report.documentReview.pageCount ?? 'not a paginated review'}`);
    for (const part of report.documentReview.parts) lines.push(`  ${part.id}${part.page ? ` · page ${part.page}` : ''} · ${part.kind} · ${part.identity} · ${part.digestSha256}`);
    lines.push(...report.documentReview.notes);
  }
  if (report.harReview) {
    lines.push('Recorded HTTP sequence (not replayed)');
    for (const entry of report.harReview.entries) lines.push(`  ${entry.sequence}. ${entry.startedAt ?? 'time unavailable'} · ${entry.method} ${entry.origin ?? 'origin unavailable'} · status ${entry.status ?? 'unavailable'} · ${entry.mimeCategory} · ${entry.durationMs === null ? 'duration unavailable' : `${entry.durationMs} ms`}`);
    if (report.harReview.invalidEntries) lines.push(`Invalid request records omitted: ${report.harReview.invalidEntries}`);
  }
  if (report.identityEventReview) {
    const review = report.identityEventReview;
    const matches = new Map(review.comparison?.events.map(event => [event.sequence, event]));
    lines.push(`Selected identity events: ${review.provider} · ${review.events.length} records · ${review.invalidEvents} invalid records omitted`);
    for (const event of review.events) {
      const match = matches.get(event.sequence);
      lines.push(`  ${event.sequence}. ${event.occurredAt ?? 'time unavailable'} · ${event.actorLabel ?? 'actor unavailable'} · ${event.kind} · ${event.result}`,
        `    applications ${event.applicationIds.join(', ') || 'unavailable'} · resource tenant ${event.tenantId ?? 'unavailable'} · protocol ${event.protocol}`);
      if (match) lines.push(`    comparison ${match.state}: application ${match.application}, tenant ${match.tenant}, actor ${match.actor}, time ${match.time}`);
    }
    lines.push('Actor labels are file-local. Matching supplied fields does not establish account compromise.');
  }
  for (const step of report.identityRecovery.nextSteps) lines.push(`Account response — ${step.title}: ${step.detail}`);
  if (report.coverage.unreviewedAttachments) lines.push(`Unreviewed attachments: ${report.coverage.unreviewedAttachments}`);
  if (report.coverage.rejectedLinks) lines.push(`Unsupported link values: ${report.coverage.rejectedLinks}`);
  if (report.coverage.boundsReached.length) lines.push(`Partial analysis: ${report.coverage.boundsReached.join('; ')}`);
  if (report.source.kind === 'qr' && !report.coverage.reviewedParts) lines.push('No QR text was decoded. This does not establish that the image contains no QR symbol.');
  lines.push('Exact paths, queries, fragments and original message content are not included. Link relationships and authorisation parameters are supplied claims, not proof of a completed redirect or account compromise.');
  return `${lines.join('\n')}\n`;
}

export async function runIntakeCommand(args: Extract<CliArguments, { action: 'intake' }>, dependencies: IntakeCommandDependencies, context: CliCommandContext): Promise<number> {
  context.setFailureLabel('Message intake');
  if (MESSAGE_INTAKE_INPUTS[args.kind].binary && (!args.source || args.source === '-')) throw new CliUsageError('Binary intake requires a selected file; binary stdin is not accepted.');
  let bytes: Uint8Array;
  if (dependencies.readBinaryArtifactInput && args.source && args.source !== '-') bytes = await dependencies.readBinaryArtifactInput(args.source);
  else if (args.source && args.source !== '-') bytes = await readBoundedRegularFile(args.source, { maximumBytes: MAX_MESSAGE_INTAKE_BYTES, minimumBytes: 1, label: 'Selected input', ...(dependencies.signal ? { signal: dependencies.signal } : {}) });
  else bytes = new TextEncoder().encode(await context.readInput(args.source, MAX_MESSAGE_INTAKE_BYTES, 'Selected input'));
  try {
    const result = await reviewSelectedInputInWorker(bytes, args.kind, context.now(), dependencies.signal);
    let authenticationReview;
    try { authenticationReview = selectReceiverTrust(result.report.authenticationReview, args.trustedAuthHeaders ?? []); }
    catch (cause) { if (cause instanceof TypeError) throw new CliUsageError(cause.message); throw cause; }
    let report = { ...result.report, authenticationReview, identityRecovery: reviewIdentityIncident({ reportedActions: args.reportedActions }) };
    if (args.intakeContextSource) {
      if (args.intakeContextSource === '-') throw new CliUsageError('Distribution context requires a separate selected file, not stdin.');
      report = withIntakeDistributionContext(report, parseIntakeContextInput(await context.readInput(args.intakeContextSource, MAX_INTAKE_CONTEXT_BYTES, 'Distribution context')));
    }
    dependencies.signal?.throwIfAborted();
    if (!args.quiet) context.writeStdout(args.output === 'json' ? formatJsonDocument(report) : context.terminal(formatMessageIntake(report), args.color));
    return args.strictExit && report.coverage.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  } finally { bytes.fill(0); }
}
