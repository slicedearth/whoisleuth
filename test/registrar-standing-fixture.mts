import { buildRegistrarStanding } from '../lib/registrar-standing.mts';
import { buildRegistrarStandingSnapshot } from '../tools/registrar-standing-catalogue.mts';

// Fixed synthetic source observations keep historical presentation and export
// scenarios independent of the periodically refreshed production catalogue.
const OBSERVED_AT = '2026-09-03T08:19:03.000Z';
const CATALOGUE = buildRegistrarStandingSnapshot({
  registrarRows: [
    { id: 2, status: 'Accredited' },
    { id: 999, status: 'Terminated' },
    { id: 4318, status: 'Accredited' },
  ],
  notices: [
    {
      noticeId: 'notice-1367', ianaId: 4318, type: 'termination', issuedOn: '2026-08-27',
      sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/1367/fixture.pdf',
      indexOutcome: null,
    },
    {
      noticeId: 'notice-1365', ianaId: 4318, type: 'breach', issuedOn: '2026-08-26',
      sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/1365/fixture.pdf',
      indexOutcome: 'Escalated to Termination',
    },
  ],
}, { generatedAt: OBSERVED_AT, ianaObservedAt: OBSERVED_AT, catalogueYear: 2026 });

export function buildFixtureRegistrarStanding(options: Parameters<typeof buildRegistrarStanding>[0]) {
  return buildRegistrarStanding({ catalogue: CATALOGUE, ...options });
}
