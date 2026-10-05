import type { CaseResponsePacket } from './case-response-packet-types.mts';
import { RESPONSE_AUTHORISATION_CONFIRMATION_IDS, responseContactLabel as contactLabel } from './case-response-packet-vocabulary.mts';
import { escapeCaseMarkdownInline as escapeMarkdown } from './case-markdown.mts';

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
  const selectedCorrection = escalationHistory.find(action => action.actionId === packet.actionBinding.selectedActionId)?.correction;
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
    selectedCorrection ? '## Retained incident context (not a renewed allegation)' : '## Observed harm',
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
          ...(action.amendment ? [`  - Amendment of submitted packet SHA-256: ${action.amendment.packetDigestSha256}`, `  - Prepared request events: ${action.amendment.requestEventIds.map(escapeMarkdown).join(', ')}`] : []),
          ...(action.correction ? [`  - ${action.correction.purpose === 'correction' ? 'Correction request' : 'Retraction request'} for delivery event ${escapeMarkdown(action.correction.deliveryEventId)}; original packet v${action.correction.packetVersion} SHA-256: ${action.correction.packetDigestSha256}`,
            `  - Analyst reason: ${escapeMarkdown(action.correction.reason)}`, `  - Previous statement: ${escapeMarkdown(action.correction.previousStatement)}`,
            `  - Corrected statement: ${escapeMarkdown(action.correction.correctedStatement || 'Request to retract the previous statement')}`,
            `  - Corrected evidence pins: ${action.correction.evidencePinIds.map(escapeMarkdown).join(', ')}`] : []),
          ...action.transitions.flatMap((event) => [
            `  - ${event.occurredAt}: ${escapeMarkdown(event.previousState ?? 'none')} → ${escapeMarkdown(event.nextState)} · ${escapeMarkdown(event.sourceClass)} · ${escapeMarkdown(event.provenance)}${event.providerOutcome ? ` · ${escapeMarkdown(event.providerOutcome.replaceAll('_', ' '))}` : ''}${event.applied ? '' : ' · retained conflict'}`,
            ...(event.reference ? [`    - Reference: ${escapeMarkdown(event.reference)}`] : []),
            ...(event.packetReceipt ? [`    - Exact local packet receipt: v${event.packetReceipt.packetVersion} · ${event.packetReceipt.packetDigestSha256} · ${escapeMarkdown(event.packetReceipt.recipient)} · ${escapeMarkdown(event.packetReceipt.profile)} · generated ${event.packetReceipt.packetGeneratedAt}`] : []),
            ...(event.evidencePinId ? [`    - Evidence pin: ${escapeMarkdown(event.evidencePinId)}`] : []),
            ...(event.evidenceRequest ? [
              `    - Requested evidence (${event.evidenceRequest.state}): ${escapeMarkdown(event.evidenceRequest.summary)}`,
              `    - Original packet SHA-256: ${event.evidenceRequest.packetDigestSha256}; deadline: ${event.evidenceRequest.dueAt ?? 'not provided'}`,
              `    - Prepared pins: ${event.evidenceRequest.evidencePinIds.map(escapeMarkdown).join(', ') || 'none'}${event.evidenceRequest.rationale ? `; ${escapeMarkdown(event.evidenceRequest.rationale)}` : ''}`,
            ] : []),
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
    ...escalationHistory.flatMap(action => [
      `- Action ${escapeMarkdown(action.actionId)} object scope: ${action.responseObjects?.length ? action.responseObjects.map(object => `${escapeMarkdown(object.kind)} · ${escapeMarkdown(object.identifier)}`).join('; ') : 'unknown; no exact-object coverage inferred'}`,
      ...action.transitions.filter(event => event.objectOutcome).map(event => `  - ${escapeMarkdown(event.objectOutcome!)} · ${escapeMarkdown(event.sourceClass)} · ${event.occurredAt} · affected objects: ${event.responseObjects?.map(object => `${escapeMarkdown(object.kind)} · ${escapeMarkdown(object.identifier)}`).join('; ')}${event.applied ? '' : ' · retained conflict'}`),
    ]),
    responseLifecycle.latestProviderOutcome
      ? `- Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${escapeMarkdown(responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' '))})`
      : `- Provider outcome time: Withheld because the typed event state is ${responseLifecycle.providerOutcomeState}.`,
    responseLifecycle.latestObservedChangeAt
      ? `- Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`
      : `- Independently observed change time: Withheld because the independent change state is ${responseLifecycle.observedChangeState}.`,
    ...(responseLifecycle.latestObservedEffect ? [`- Latest independent review: ${escapeMarkdown(responseLifecycle.latestObservedEffect.state.replaceAll('_', ' '))} · ${responseLifecycle.latestObservedEffect.observedAt} · ${escapeMarkdown(responseLifecycle.latestObservedEffect.source)}`] : []),
    ...(responseLifecycle.latestObservedEffect?.responseObject ? [`- Reviewed object: ${escapeMarkdown(responseLifecycle.latestObservedEffect.responseObject.kind)} · ${escapeMarkdown(responseLifecycle.latestObservedEffect.responseObject.identifier)}${responseLifecycle.latestObservedEffect.objectOutcome ? ` · ${escapeMarkdown(responseLifecycle.latestObservedEffect.objectOutcome)}` : ''}`] : []),
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
  const correction = escalationHistory.find(action => action.actionId === packet.actionBinding.selectedActionId)?.correction;
  const email = [
    `Subject: ${profile.subject}`,
    '',
    'Hello,',
    '',
    correction ? `I am requesting ${correction.purpose === 'correction' ? 'a correction' : 'retraction or withdrawal'} of a previous statement involving ${caseRecord.domain}.`
      : `I am reporting observed ${category} activity involving ${caseRecord.domain}.`,
    ...(correction ? [`Original delivery event: ${correction.deliveryEventId}`, `Original canonical packet v${correction.packetVersion} SHA-256: ${correction.packetDigestSha256}`,
      `Analyst reason: ${correction.reason}`, `Previous statement: ${correction.previousStatement}`,
      `Corrected statement: ${correction.correctedStatement || 'Please retract the previous statement.'}`,
      `Corrected evidence references: ${correction.evidencePinIds.join(', ')}`, 'This new request does not establish delivery, recipient acceptance, reversal, restoration or independent recheck.', ''] : []),
    `Affected party: ${affectedParty}`,
    `Observed at (UTC): ${observedAt}`,
    '',
    correction ? 'Retained incident context (not a renewed allegation):' : 'Observed harm:',
    observedHarm,
    '',
    'Exact URLs:',
    ...abusiveUrls.map((url) => `- ${url}`),
    '',
    'Selected evidence:',
    ...escalationHistory.flatMap(action => action.responseObjects?.length ? [`Action ${action.actionId} scope: ${action.responseObjects.map(object => `${object.kind} · ${object.identifier}`).join('; ')}`] : []),
    ...(selectedEvidence.length
      ? selectedEvidence.map((item) => `- ${item.label} — ${item.source}${item.observationHostname ? ` for ${item.observationHostname}` : ''}${item.webObservationMode ? ' · selected URL' : ''}, observed ${item.observedAt ?? 'time unavailable'} (${item.completeness})`)
      : ['- No Case evidence pin was selected.']),
    '',
    `Reviewed packet SHA-256: ${digestSha256}`,
    'Attach the reviewed packet (and any separately reviewed evidence files) through the recipient’s approved submission channel; this message does not embed or transmit attachments.',
    '',
    ...(responseLifecycle.latestProviderOutcome
      ? [`Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')})`]
      : []),
    ...(responseLifecycle.latestObservedChangeAt
      ? [`Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`]
      : []),
    '',
    'Please review this report under the applicable abuse and acceptable-use policies.',
    ...limitations,
    '',
    authorisation.status === 'authorised'
      ? 'This locally prepared packet is bound to explicit review confirmations. It was not submitted automatically and does not promise any provider outcome.'
      : 'This is an unauthorised local draft with cautions. It was not submitted automatically and does not promise any provider outcome.',
  ].join('\n');
  return { markdown, email: `${email}\n` };
}
