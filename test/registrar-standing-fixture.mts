import { buildRegistrarStanding } from '../lib/registrar-standing.mts';
import { buildRegistrarStandingSnapshot } from '../tools/registrar-standing-catalogue.mts';

// Fixed synthetic source observations keep historical presentation and export
// scenarios independent of the periodically refreshed production catalogue.
// Large fixture-only IDs and notice numbers describe no retained registrar.
const OBSERVED_AT = '2026-09-03T08:19:03.000Z';
const CATALOGUE = buildRegistrarStandingSnapshot({
  registrarRows: [
    { id: 2, status: 'Accredited' },
    { id: 999, status: 'Terminated' },
    { id: 900003, status: 'Accredited' },
  ],
  notices: [
    {
      noticeId: 'notice-90000001', ianaId: 900003, type: 'termination', issuedOn: '2026-07-13',
      sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/90000001/fixture.pdf',
      indexOutcome: null,
    },
    {
      noticeId: 'notice-90000002', ianaId: 900003, type: 'breach', issuedOn: '2026-07-12',
      sourceUrl: 'https://www.icann.org/uploads/compliance_notice/attachment/90000002/fixture.pdf',
      indexOutcome: 'Escalated to Termination',
    },
  ],
}, { generatedAt: OBSERVED_AT, ianaObservedAt: OBSERVED_AT, catalogueYear: 2026 });

export function buildFixtureRegistrarStanding(options: Parameters<typeof buildRegistrarStanding>[0]) {
  return buildRegistrarStanding({ catalogue: CATALOGUE, ...options });
}
