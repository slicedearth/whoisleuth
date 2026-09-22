import { readBoundedRegularFile } from '../lib/bounded-file.mts';
import { MAX_MESSAGE_INTAKE_BYTES, type MessageIntakeReport } from '../packages/contracts/message-intake.mts';
import { reviewMessageInput } from '../packages/investigation/message-intake.mts';
import { reviewQrInput } from '../packages/investigation/qr-intake.mts';
import { reviewIdentityIncident } from '../packages/investigation/identity-incident-review.mts';
import type { CliArguments } from './arguments.mts';
import type { CliCommandContext, CliDependencies } from './runner-types.mts';
import { CliUsageError } from './errors.mts';
import { formatJsonDocument } from './formatters/json.mts';
import EXIT_CODES from './exit-codes.mts';

export function formatMessageIntake(report: MessageIntakeReport): string {
  const lines = [`Offline ${report.source.kind} intake`, `Review: ${report.coverage.state} · Extracted links: ${report.links.length} · Reviewed parts: ${report.coverage.reviewedParts}`,
    `Source: ${report.source.digestSha256} · ${report.source.byteLength} bytes`];
  for (const identity of report.identities) lines.push(`Part ${identity.part} ${identity.role.replaceAll('_', ' ')}: ${identity.domain}`);
  for (const claim of report.authenticationClaims) lines.push(`Part ${claim.part} reported ${claim.method}: ${claim.result} (not independently verified)`);
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
  if (args.kind === 'qr' && (!args.source || args.source === '-')) throw new CliUsageError('QR intake requires a selected PNG file; binary stdin is not accepted.');
  let bytes: Uint8Array;
  if (dependencies.readBinaryArtifactInput && args.source && args.source !== '-') bytes = await dependencies.readBinaryArtifactInput(args.source);
  else if (args.source && args.source !== '-') bytes = await readBoundedRegularFile(args.source, { maximumBytes: MAX_MESSAGE_INTAKE_BYTES, minimumBytes: 1, label: 'Selected input', ...(dependencies.signal ? { signal: dependencies.signal } : {}) });
  else bytes = new TextEncoder().encode(await context.readInput(args.source, MAX_MESSAGE_INTAKE_BYTES, 'Selected input'));
  try {
    const result = args.kind === 'qr' ? await reviewQrInput(bytes, context.now()) : await reviewMessageInput(bytes, args.kind, context.now());
    const report = { ...result.report, identityRecovery: reviewIdentityIncident({ reportedActions: args.reportedActions }) };
    dependencies.signal?.throwIfAborted();
    if (!args.quiet) context.writeStdout(args.output === 'json' ? formatJsonDocument(report) : context.terminal(formatMessageIntake(report), args.color));
    return args.strictExit && report.coverage.state === 'partial' ? EXIT_CODES.PARTIAL_FAILURE : EXIT_CODES.SUCCESS;
  } finally { bytes.fill(0); }
}
