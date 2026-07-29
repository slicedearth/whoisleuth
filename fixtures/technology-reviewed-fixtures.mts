// Contributor-reviewed, minimized observations derived from real pages.
// Raw pages, target domains, URLs, contacts, and response bodies never belong
// in this corpus. New entries must be produced by the local review tool and
// receive a separate licensing and privacy review.

import type { TechnologyInput } from '../lib/website-technology.mts';
import { TECHNOLOGY_PROFILE_VERSION } from '../lib/website-technology.mts';

export const TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA = 'whoisleuth.technology-reviewed-fixture';
export const TECHNOLOGY_REVIEWED_FIXTURE_VERSION = 1;

export type TechnologyReviewedFixture = Readonly<{
  schema: typeof TECHNOLOGY_REVIEWED_FIXTURE_SCHEMA;
  version: typeof TECHNOLOGY_REVIEWED_FIXTURE_VERSION;
  catalogueVersion: typeof TECHNOLOGY_PROFILE_VERSION;
  id: string;
  label: string;
  reviewedAt: string;
  observedAt: string;
  licenseBasis: 'factual-observation' | 'minimized-with-permission' | 'public-domain';
  expectedIds: readonly string[];
  input: TechnologyInput;
  privacy: Readonly<{
    rawPageRetained: false;
    sourceTargetRetained: false;
    contactsRetained: false;
  }>;
}>;

export const TECHNOLOGY_REVIEWED_FIXTURES: readonly TechnologyReviewedFixture[] = Object.freeze([]);
