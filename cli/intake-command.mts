import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { MAX_MESSAGE_INTAKE_BYTES, MESSAGE_INTAKE_INPUTS, type MessageIntakeReport } from '../packages/contracts/message-intake.mts';
import { reviewSelectedInputInWorker } from './selected-input-worker.mts';
import { reviewIdentityIncident } from '../packages/investigation/identity-incident-review.mts';
import { selectReceiverTrust, authenticationHeaderLabel } from '../packages/investigation/mail-authentication-review.mts';
import type { CliArguments } from './arguments.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { CliUsageError } from './errors.mts';
import { formatJsonDocument } from './formatters/json.mts';
import EXIT_CODES from './exit-codes.mts';

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
  for (const step of report.identityRecovery.nextSteps) lines.push(`Account response — ${step.title}: ${step.detail}`);
  if (report.coverage.unreviewedAttachments) lines.push(`Unreviewed attachments: ${report.coverage.unreviewedAttachments}`);
  if (report.coverage.rejectedLinks) lines.push(`Unsupported link values: ${report.coverage.rejectedLinks}`);
  if (report.coverage.boundsReached.length) lines.push(`Partial analysis: ${report.coverage.boundsReached.join('; ')}`);
  if (report.source.kind === 'qr' && !report.coverage.reviewedParts) lines.push('No QR text was decoded. This does not establish that the image contains no QR symbol.');
  lines.push('Exact paths, queries, fragments and original message content are not included. Link relationships and authorisation parameters are supplied claims, not proof of a completed redirect or account compromise.');
  return `${lines.join('\n')}\n`;
}

export async function runIntakeCommand(args: Extract<CliArguments, { action: 'intake' }>, dependencies: CliDependencies, context: CliCommandContext): Promise<number> {
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
    const report = { ...result.report, authenticationReview, identityRecovery: reviewIdentityIncident({ reportedActions: args.reportedActions }) };
    dependencies.signal?.throwIfAborted();
    if (!args.quiet) context.writeStdout(args.output === 'json' ? formatJsonDocument(report) : context.terminal(formatMessageIntake(report), args.color));
    return args.strictExit && report.coverage.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  } finally { bytes.fill(0); }
}
