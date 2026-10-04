import type { CaseRecord } from './case-record-contracts.mts';
import { projectCaseForAudience, type CaseAudience } from './case-record-projection.mts';
import { readEditableCaseExport } from './case-export-input.mts';
import { array, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';
import { escapeCaseMarkdownInline } from './case-markdown.mts';
import { MAX_CASE_ASSERTIONS, MAX_CASE_EVIDENCE_PINS } from '../contracts/case-portability.mts';

export const CASE_CONTAINMENT_INPUT_SCHEMA = 'whoisleuth.internal-containment.input';
export const CASE_CONTAINMENT_HANDOFF_SCHEMA = 'whoisleuth.internal-containment';
export const CASE_CONTAINMENT_VERSION = 1;
export const MAX_CONTAINMENT_ASSERTIONS = 20;
export const MAX_CONTAINMENT_PINS = 40;
export const MAX_CONTAINMENT_OUTPUT_BYTES = 128 * 1024;
export const CONTAINMENT_RECIPIENT_ROLES = [
  'security_operations',
  'identity_response',
  'endpoint_response',
  'network_response',
] as const;
export type ContainmentRecipientRole = (typeof CONTAINMENT_RECIPIENT_ROLES)[number];
export type ContainmentSelection = Readonly<{
  audience: CaseAudience;
  recipientRole: ContainmentRecipientRole;
  assertionIds: readonly string[];
  evidencePinIds: readonly string[];
}>;

const ROLE_GUIDANCE: Record<ContainmentRecipientRole, readonly string[]> = {
  security_operations: [
    'Confirm the responsible internal owner and track the selected requests independently of external removal.',
    'Separate reported actions, retained observations and unresolved evidence before authorising a control.',
  ],
  identity_response: [
    'Review the selected requests against authorised account, session and application-grant evidence in the identity system.',
    'Do not treat a reported password entry, sign-in approval or provider resolution as proof of account compromise or recovery.',
  ],
  endpoint_response: [
    'Review the selected requests against authorised device evidence before deciding whether isolation, collection or remediation is needed.',
    'Do not execute supplied commands or attachments; a reported execution is not a verified device outcome.',
  ],
  network_response: [
    'Review exact scope, collateral effects and an appropriate review/expiry period before applying an approved network control.',
    'Shared infrastructure and literal indicators do not establish ownership, maliciousness or an appropriate blocking scope.',
  ],
};

function uniqueIds(value: unknown, maximum: number, label: string): string[] {
  const ids = array(value, label, maximum).map((id) => text(id, label, 240));
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} must be unique.`);
  return ids;
}

export function readContainmentSelection(raw: unknown): ContainmentSelection {
  const value = exact(
    raw,
    ['audience', 'recipientRole', 'assertionIds', 'evidencePinIds'],
    'Containment handoff selection',
  );
  return {
    audience: enumeration(
      value.audience,
      ['internal', 'trusted', 'public'] as const,
      'Handoff audience',
    ),
    recipientRole: enumeration(
      value.recipientRole,
      CONTAINMENT_RECIPIENT_ROLES,
      'Internal recipient role',
    ),
    assertionIds: uniqueIds(value.assertionIds, MAX_CONTAINMENT_ASSERTIONS, 'Selected follow-ups'),
    evidencePinIds: uniqueIds(
      value.evidencePinIds,
      MAX_CONTAINMENT_PINS,
      'Selected supporting pins',
    ),
  };
}

/** Select retained assertions; never infer completed containment from Case or provider status. */
export function previewCaseContainmentHandoff(
  record: CaseRecord,
  raw: unknown,
  generatedAt: string,
) {
  iso(generatedAt, 'Handoff generation time');
  const selection = readContainmentSelection(raw);
  array(record.assertions, 'Retained Case assertions', MAX_CASE_ASSERTIONS);
  array(record.evidencePins, 'Retained Case pins', MAX_CASE_EVIDENCE_PINS);
  const followUps = record.assertions.filter((item) => item.kind === 'next_step');
  const original = selection.assertionIds.map((id) => {
    const matches = followUps.filter((item) => item.id === id);
    if (matches.length !== 1)
      throw new TypeError('A selected follow-up is missing or ambiguous; refresh the selection.');
    return matches[0]!;
  });
  const linkedIds = new Set(original.flatMap((item) => item.evidencePinIds));
  for (const id of selection.evidencePinIds) {
    if (!linkedIds.has(id) || record.evidencePins.filter((pin) => pin.id === id).length !== 1)
      throw new TypeError('Select only uniquely retained pins linked to the selected follow-ups.');
  }
  const permitted = selection.audience !== 'public';
  // Reuse the canonical audience policy before constructing a narrow projection.
  const projected = projectCaseForAudience(record, selection.audience);
  const pins = permitted
    ? projected.evidencePins.filter((pin) => selection.evidencePinIds.includes(pin.id))
    : [];
  const assertions = permitted
    ? original.map((item) => {
        const selected = projected.assertions.find((assertion) => assertion.id === item.id)!;
        return {
          id: selected.id,
          kind: 'next_step' as const,
          statement: selected.statement,
          rationale: selected.rationale,
          state: selected.state,
          createdAt: selected.createdAt,
          updatedAt: selected.updatedAt,
          provenance: selected.provenance ?? null,
          recheck: selected.recheck ?? null,
          evidence: selected.evidencePinIds.map((id) => ({
            evidencePinId: id,
            stance:
              selected.evidenceRelations?.find((relation) => relation.evidencePinId === id)
                ?.stance ?? 'not_recorded',
            state: pins.some((pin) => pin.id === id)
              ? ('included' as const)
              : record.evidencePins.some((pin) => pin.id === id)
                ? ('not_selected' as const)
                : ('unavailable' as const),
          })),
        };
      })
    : [];
  const missingContext = assertions.some(
    (item) => !item.evidence.length || item.evidence.some((link) => link.state !== 'included'),
  );
  const report = {
    schema: CASE_CONTAINMENT_HANDOFF_SCHEMA,
    version: CASE_CONTAINMENT_VERSION,
    generatedAt,
    audience: selection.audience,
    recipientRole: selection.recipientRole,
    case: { id: projected.id, domain: projected.domain, status: projected.status },
    state:
      !permitted ||
      !assertions.length ||
      missingContext ||
      pins.some((pin) => pin.completeness !== 'complete' || pin.truncated === true)
        ? ('partial' as const)
        : ('reviewed' as const),
    reviewRequired: true,
    actionsPerformed: false,
    assertions,
    evidencePins: pins,
    disclosure: {
      exportAllowed: permitted && assertions.length > 0,
      included: permitted
        ? [
            'Case identifier, domain and recorded status',
            'Only selected next-step statements, rationale, states and recording times',
            'Exact selected supporting pins and separately qualified evidence relationships',
          ]
        : ['Case identifier, domain and recorded status only'],
      excluded: [
        'Unselected assertions and evidence',
        'Case title, notes, contacts, action recipients and original files',
        'Raw upstream responses, automatic assignments and control execution',
        ...(permitted ? [] : ['Internal follow-up statements and their supporting pins']),
      ],
      caution:
        'Selected statements and pin values can contain sensitive analyst text or exact scope. Review each included value for the intended recipient; minimisation is not automatic anonymisation.',
    },
    nextSteps: [...ROLE_GUIDANCE[selection.recipientRole]],
    limitations: [
      'These are retained analyst requests, not verified assignments, executed controls or independent recovery results.',
      'Open and resolved assertion states are preserved as recorded. External provider resolution, object closure and Case status do not resolve open internal requests.',
      'Unselected or missing supporting pins remain explicit. A linked pin may support, contradict or leave a request unresolved; linkage does not establish truth.',
      'This local handoff sends no message, changes no Case state and includes no original attachment bytes.',
    ],
  };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > MAX_CONTAINMENT_OUTPUT_BYTES)
    throw new TypeError(
      'The selected handoff exceeds 128 KiB. Choose fewer follow-ups or pins; nothing was silently omitted.',
    );
  return report;
}

export type CaseContainmentHandoff = ReturnType<typeof previewCaseContainmentHandoff>;

export function buildCaseContainmentHandoff(
  record: CaseRecord,
  selection: ContainmentSelection,
  generatedAt: string,
  disclosureReviewed: boolean,
): CaseContainmentHandoff {
  const report = previewCaseContainmentHandoff(record, selection, generatedAt);
  if (!disclosureReviewed || !report.disclosure.exportAllowed)
    throw new TypeError(
      'Review the audience disclosure and select at least one retained follow-up for an internal or trusted handoff.',
    );
  return report;
}

export function readCaseContainmentInput(
  raw: unknown,
  generatedAt: string,
): CaseContainmentHandoff {
  const input = exact(
    raw,
    ['schema', 'version', 'caseExport', 'caseId', 'selection', 'disclosureReviewed'],
    'Containment handoff input',
  );
  if (input.schema !== CASE_CONTAINMENT_INPUT_SCHEMA || input.version !== CASE_CONTAINMENT_VERSION)
    throw new TypeError('Unsupported containment handoff input version.');
  const caseId = text(input.caseId, 'Selected Case ID', 240);
  const selected = readEditableCaseExport(JSON.stringify(input.caseExport)).filter(
    (record) => record.id === caseId,
  );
  if (selected.length !== 1)
    throw new TypeError('Select one unambiguous Case from the supported export.');
  if (input.disclosureReviewed !== true)
    throw new TypeError('The selected handoff requires an explicit audience-disclosure review.');
  return buildCaseContainmentHandoff(
    selected[0]!,
    readContainmentSelection(input.selection),
    generatedAt,
    true,
  );
}

export function formatCaseContainmentHandoff(report: CaseContainmentHandoff): string {
  const escape = escapeCaseMarkdownInline;
  const lines = [
    `# Internal containment handoff`,
    '',
    `Audience: ${report.audience} · ${report.recipientRole.replaceAll('_', ' ')}`,
    `Case: ${escape(report.case.domain)} · ${escape(report.case.id)} · recorded status ${escape(report.case.status)}`,
    `Generated: ${report.generatedAt} · coverage ${report.state} · no actions performed`,
    '',
    '## Selected retained requests',
    '',
  ];
  for (const item of report.assertions) {
    lines.push(`- ${escape(item.statement)} — ${item.state} (${escape(item.id)})`);
    if (item.rationale) lines.push(`  Rationale: ${escape(item.rationale)}`);
    lines.push(`  Recorded ${escape(item.createdAt)}; updated ${escape(item.updatedAt)}.`);
    for (const link of item.evidence)
      lines.push(
        `  Evidence ${escape(link.evidencePinId)}: ${link.stance}; ${link.state.replaceAll('_', ' ')}.`,
      );
    if (!item.evidence.length) lines.push('  No supporting context was linked.');
  }
  lines.push('', '## Selected supporting evidence', '');
  for (const pin of report.evidencePins)
    lines.push(
      `- ${escape(pin.label)} (${escape(pin.id)}): ${escape(pin.value)}`,
      `  Source: ${escape(pin.source)}; observed ${escape(pin.observedAt ?? 'unknown')}; ${pin.completeness}${pin.truncated ? '; truncated' : ''}.`,
      ...pin.limitations.map((value) => `  Limitation: ${escape(value)}`),
    );
  lines.push(
    '',
    '## Recipient review',
    '',
    ...report.nextSteps.map((value) => `- ${value}`),
    '',
    '## Boundaries',
    '',
    ...report.limitations.map((value) => `- ${value}`),
  );
  return `${lines.join('\n')}\n`;
}
