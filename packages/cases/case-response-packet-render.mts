import type { CaseResponsePacket } from './case-response-packet-types.mts';
import { RESPONSE_AUTHORISATION_CONFIRMATION_IDS, responseContactLabel as contactLabel } from './case-response-packet-vocabulary.mts';

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/gu, '\\$1').replace(/\r?\n/gu, ' ');
}

/** Render only the projected packet, never the source Case or private inputs. */
export function renderCaseResponsePacket(packet: CaseResponsePacket): { markdown: string; email: string } {
  const {
    profile, case: caseRecord,
    incident: { category, affectedParty, abusiveUrls, observedHarm, observedAt },
    generatedAt: normalizedGeneratedAt, recipientRoute, escalationHistory,
    escalationHistoryOmitted, escalationHistoryLimitations, authorisation,
    readiness, selectedEvidence, artefactReferences, responseLifecycle, preflight,
    provenance: { limitations, evidencePinCount, decisionCount, assertionCount, observationAge: age },
    integrity: { digestSha256 },
  } = packet;
  const lines = [
    `# ${escapeMarkdown(profile.label)} packet`,
    '',
    `**Domain:** ${escapeMarkdown(caseRecord.domain)}`,
    `**Category:** ${escapeMarkdown(category)}`,
    `**Affected party:** ${escapeMarkdown(affectedParty)}`,
    `**Observed at (UTC):** ${observedAt}`,
    `**Generated at (UTC):** ${normalizedGeneratedAt}`,
    `**Audience:** ${escapeMarkdown(profile.audience)}`,
    `**Suggested subject:** ${escapeMarkdown(profile.subject)}`,
    '',
    '## Observed harm',
    '',
    escapeMarkdown(observedHarm),
    '',
    '## Exact abusive URLs',
    '',
    ...abusiveUrls.map((url) => `- ${escapeMarkdown(url)}`),
    '',
    '## Selected response route',
    '',
    ...(recipientRoute
      ? [
          `### ${contactLabel(recipientRoute.kind)}`,
          '',
          `- Case action: ${escapeMarkdown(recipientRoute.actionId)}`,
          `- Contact: ${escapeMarkdown(recipientRoute.contact)}`,
          `- Source: ${escapeMarkdown(recipientRoute.source)}`,
          `- Route observed: ${recipientRoute.observedAt ?? 'Not provided'} (${recipientRoute.freshness})`,
          `- Route review after: ${recipientRoute.reviewAfter ?? 'Not provided'}`,
          `- Limitations: ${recipientRoute.limitations.length ? recipientRoute.limitations.map(escapeMarkdown).join('; ') : 'None recorded'}`,
          '',
        ]
      : ['No profile-appropriate response route was bound to this packet.', '']),
    '## Selected action lineage',
    '',
    ...(escalationHistory.length
      ? escalationHistory.flatMap((action) => [
          `- ${escapeMarkdown(action.type.replaceAll('_', ' '))} to ${escapeMarkdown(action.recipient)} · ${escapeMarkdown(action.state.replaceAll('_', ' '))} · updated ${action.updatedAt}`,
          `  - Route observed: ${action.routeObservedAt ?? 'Not provided'}`,
          ...(action.reference ? [`  - Reference: ${escapeMarkdown(action.reference)}`] : []),
          ...(action.providerOutcome ? [`  - Typed provider outcome: ${escapeMarkdown(action.providerOutcome.replaceAll('_', ' '))}`] : []),
          ...(action.outcomeDetail ? [`  - Outcome detail: ${escapeMarkdown(action.outcomeDetail)}`] : []),
          ...(action.originActionId ? [`  - Originating action: ${escapeMarkdown(action.originActionId)}`] : []),
          ...action.transitions.flatMap((event) => [
            `  - ${event.occurredAt}: ${escapeMarkdown(event.previousState ?? 'none')} → ${escapeMarkdown(event.nextState)} · ${escapeMarkdown(event.sourceClass)} · ${escapeMarkdown(event.provenance)}${event.providerOutcome ? ` · ${escapeMarkdown(event.providerOutcome.replaceAll('_', ' '))}` : ''}${event.applied ? '' : ' · retained conflict'}`,
            ...(event.reference ? [`    - Reference: ${escapeMarkdown(event.reference)}`] : []),
            ...(event.evidencePinId ? [`    - Evidence pin: ${escapeMarkdown(event.evidencePinId)}`] : []),
            ...(event.originActionId ? [`    - Originating action: ${escapeMarkdown(event.originActionId)}`] : []),
            ...event.limitations.map((limitation) => `    - Limitation: ${escapeMarkdown(limitation)}`),
          ]),
          ...(action.historyOmitted ? [`  - ${action.historyOmitted} earlier transition event${action.historyOmitted === 1 ? '' : 's'} omitted by bound.`] : []),
          ...action.historyLimitations.map((limitation) => `  - History limitation: ${escapeMarkdown(limitation)}`),
        ])
      : ['No Case action was selected.']),
    ...(escalationHistoryOmitted ? [`- Unrelated Case actions excluded from packet: ${escalationHistoryOmitted}`] : []),
    ...escalationHistoryLimitations.map((limitation) => `- Packet history limitation: ${escapeMarkdown(limitation)}`),
    '',
    '## Readiness and authorisation',
    '',
    `- Packet state: ${authorisation.status}`,
    `- Reviewed-input SHA-256: ${authorisation.reviewedInputDigestSha256}`,
    `- Supplied review digest matches: ${authorisation.digestMatches ? 'yes' : 'no'}`,
    ...RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => `- Confirmation ${id}: ${authorisation.confirmations[id] ? 'yes' : 'no'}`),
    ...readiness.rows.flatMap((row) => [
      `- ${escapeMarkdown(row.label)} [${row.state}]: ${escapeMarkdown(row.detail)}`,
      ...row.limitations.map((limitation) => `  - Limitation: ${escapeMarkdown(limitation)}`),
    ]),
    ...authorisation.limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    '',
    '## Selected evidence and integrity references',
    '',
    ...(selectedEvidence.length ? selectedEvidence.map((item) => `- ${escapeMarkdown(item.id)} · ${escapeMarkdown(item.label)} · ${escapeMarkdown(item.source)}${item.observationHostname ? ` · ${escapeMarkdown(item.observationHostname)}` : ''}${item.webObservationMode ? ' · selected URL' : ''} · ${item.observedAt ?? 'Observation time unavailable'} · ${escapeMarkdown(item.completeness)}`) : ['- No evidence pin was explicitly selected.']),
    ...artefactReferences.map((item) => `- ${escapeMarkdown(item.id)} · ${escapeMarkdown(item.label)} · SHA-256 ${item.digestSha256} · captured ${item.capturedAt}`),
    '',
    '## Provider outcome and independent effect',
    '',
    responseLifecycle.latestProviderOutcome
      ? `- Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${escapeMarkdown(responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' '))})`
      : `- Provider outcome time: Withheld because the typed event state is ${responseLifecycle.providerOutcomeState}.`,
    responseLifecycle.latestObservedChangeAt
      ? `- Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`
      : `- Independently observed change time: Withheld because the independent change state is ${responseLifecycle.observedChangeState}.`,
    ...(responseLifecycle.latestObservedEffect ? [`- Latest independent review: ${escapeMarkdown(responseLifecycle.latestObservedEffect.state.replaceAll('_', ' '))} · ${responseLifecycle.latestObservedEffect.observedAt} · ${escapeMarkdown(responseLifecycle.latestObservedEffect.source)}`] : []),
    ...responseLifecycle.limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    '',
    '## Review and provenance',
    '',
    `- Preflight: ${preflight.status.replaceAll('_', ' ')} (${preflight.counts.pass} pass, ${preflight.counts.caution} caution, ${preflight.counts.block} block)`,
    ...preflight.checks.map((check) => `- ${escapeMarkdown(check.label)} [${check.state}]: ${escapeMarkdown(check.detail)}`),
    ...limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    `- Case evidence pins: ${evidencePinCount}`,
    `- Case decision records: ${decisionCount}`,
    `- Case structured assertions: ${assertionCount}`,
    `- Observation-age band at export: ${age.band.replaceAll('_', ' ')}`,
    `- Canonical packet SHA-256: ${digestSha256}`,
    '- Digest scope: canonical sorted JSON packet excluding the integrity object',
    '',
    '## Audience profile',
    '',
    ...profile.checklist.map((item) => `- Checklist: ${escapeMarkdown(item)}`),
    ...profile.includedEvidence.map((item) => `- Included: ${escapeMarkdown(item)}`),
    ...profile.excludedEvidence.map((item) => `- Excluded: ${escapeMarkdown(item)}`),
    ...profile.redactions.map((item) => `- Redaction to confirm: ${escapeMarkdown(item)}`),
    ...profile.attachments.map((item) => `- Attachment expectation: ${escapeMarkdown(item)}`),
    ...profile.followUpFields.map((item) => `- Follow-up field: ${escapeMarkdown(item)}`),
  ];
  const markdown = `${lines.join('\n').trim()}\n`;
  const email = [
    `Subject: ${profile.subject}`,
    '',
    'Hello,',
    '',
    `I am reporting observed ${category} activity involving ${caseRecord.domain}.`,
    `Affected party: ${affectedParty}`,
    `Observed at (UTC): ${observedAt}`,
    '',
    'Observed harm:',
    observedHarm,
    '',
    'Exact URLs:',
    ...abusiveUrls.map((url) => `- ${url}`),
    '',
    'Selected evidence:',
    ...(selectedEvidence.length
      ? selectedEvidence.map((item) => `- ${item.label} — ${item.source}${item.observationHostname ? ` for ${item.observationHostname}` : ''}${item.webObservationMode ? ' · selected URL' : ''}, observed ${item.observedAt ?? 'time unavailable'} (${item.completeness})`)
      : ['- No Case evidence pin was selected.']),
    '',
    `Reviewed packet SHA-256: ${digestSha256}`,
    'Attach the reviewed packet (and any separately reviewed evidence files) through the recipient’s approved submission channel; this message does not embed or transmit attachments.',
    '',
    responseLifecycle.latestProviderOutcome
      ? `Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')})`
      : `Provider outcome time: Withheld because the typed event state is ${responseLifecycle.providerOutcomeState}.`,
    responseLifecycle.latestObservedChangeAt
      ? `Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`
      : `Independently observed change time: Withheld because the independent change state is ${responseLifecycle.observedChangeState}.`,
    '',
    'Please review this report under the applicable abuse and acceptable-use policies.',
    '',
    authorisation.status === 'authorised'
      ? 'This locally prepared packet is bound to explicit review confirmations. It was not submitted automatically and does not promise any provider outcome.'
      : 'This is an unauthorised local draft with cautions. It was not submitted automatically and does not promise any provider outcome.',
  ].join('\n');
  return { markdown, email: `${email}\n` };
}
