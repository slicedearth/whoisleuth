import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { parseInvestigationGuide } from '../frontend/src/lib/analysis/investigation-guide.ts';
import { mergeInvestigationTemplates } from '../frontend/src/lib/analysis/investigation-template-model.ts';
import { parseCacaoInvestigationPlaybook } from '../frontend/src/lib/analysis/investigation-playbook-interchange.ts';

const FIXTURES = Object.freeze({
  'investigation-guide-v1.json': '785619a684904f7638aab4d68979ee20f1f6f2f7329de7818d1a3ed6f0efa38a',
  'investigation-guide-v2.json': '55b96b46090bff4ab72962cef4f84ba45907cf9db1ae74d192c73098476c1367',
  'investigation-guide-v3.json': '7ea8f8daf96cfcf4a06b0a05e6c9660b6ccb35bff86b19551919db0c8e3b1939',
  'investigation-guide-v4.json': 'faeedadb7707dde4afde037300abf0c9cb6bb2f8902ed20f9b623fa96fe1f2d2',
  'investigation-template-v1.json': '75623ce9e06506fc621aee4b4b4c35ad0ec2151703aa0306e77f1b97c51d5f79',
  'investigation-cacao-profile-v1.json': '5f7b0d7a4ecaf3902b86099cb14dc70c7c45f521d045caa632ffa19aeade036b',
});

async function fixture(filename: keyof typeof FIXTURES) {
  const bytes = await readFile(new URL(`./fixtures/${filename}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURES[filename]);
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

const CREATED_AT = '2026-07-20T01:00:00.000Z';
const UPDATED_AT = '2026-07-20T02:00:00.000Z';
const PENDING_STAGE = Object.freeze({
  outcome: 'pending', approvedAt: null, openedAt: null, reviewNote: null, updatedAt: CREATED_AT,
});

function expectedGuide(version: 1 | 2 | 3 | 4) {
  const domain = `legacy-${['one', 'two', 'three', 'four'][version - 1]}.example`;
  const lookup = version === 1
    ? { id: 'lookup', outcome: 'pending', approvedAt: null, openedAt: UPDATED_AT, reviewNote: null, updatedAt: UPDATED_AT }
    : {
        id: 'lookup',
        outcome: version === 3 ? 'complete' : 'partial',
        approvedAt: '2026-07-20T01:10:00.000Z',
        openedAt: '2026-07-20T01:11:00.000Z',
        reviewNote: version === 4 ? 'Historical source remained partial.' : null,
        updatedAt: '2026-07-20T01:12:00.000Z',
      };
  return {
    version: 5,
    recipeId: 'new_domain_triage',
    template: null,
    domain,
    focusDomain: null,
    reviewDomains: [domain],
    reviewDomainsTruncated: false,
    status: 'active',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    stages: [
      lookup,
      { id: 'bulk', ...PENDING_STAGE, updatedAt: version === 1 ? UPDATED_AT : CREATED_AT },
      { id: 'monitor', ...PENDING_STAGE, openedAt: version === 1 ? UPDATED_AT : null, updatedAt: version === 1 ? UPDATED_AT : CREATED_AT },
    ],
  };
}

const EXPECTED_TEMPLATE = Object.freeze({
  id: 'frozen-template',
  label: 'Frozen triage template',
  summary: 'Reviewed legacy template fixture.',
  recipeId: 'new_domain_triage',
  stages: [
    {
      id: 'lookup', workspace: 'lookup', label: 'Collect domain evidence', path: '/lookup',
      detail: 'Start with separately attributed registry and network evidence for the domain under review.',
      expectedEvidence: 'Authority-aware availability plus supported registry, DNS, certificate, HTTP, page, and threat-source observations.',
      requestImpact: 'Fast and deep Lookup have different request budgets. Collection starts only from the tool action you choose.',
      prerequisite: 'Confirm the domain is in scope and select the appropriate lookup depth.',
      completionCriteria: 'Available evidence and explicit source failures are reviewed without treating a miss as safety.',
      instructions: [
        'Confirm the pre-filled domain and choose Fast or Deep.',
        'Run the lookup and review source states before interpreting the result.',
        'Mark the step reviewed, or partial if important evidence did not settle.',
      ],
      requiresApproval: true,
    },
    {
      id: 'monitor', workspace: 'monitor', label: 'Record disposition', path: '/monitor',
      detail: 'Review the bounded domain set carried from Bulk and create or update only the cases that need an analyst decision or follow-up plan.',
      expectedEvidence: 'A bounded review queue plus case records with dispositions, notes, evidence history, and optional monitoring intent.',
      requestImpact: 'Local case editing makes no request. Rescans and hosted-monitor changes remain separate explicit actions.',
      prerequisite: 'Review source provenance, limitations, and any scoring explanation before deciding.',
      completionCriteria: 'The analyst records the required dispositions or explicitly skips retention; the recipe never decides automatically.',
      instructions: [
        'Review the domains carried from Bulk and open only the cases that need retention.',
        'Record a disposition and any concise evidence-based follow-up for each retained case.',
        'Mark the step reviewed when the retained cases reflect your decision.',
      ],
      requiresApproval: false,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

const EXPECTED_CACAO_TEMPLATE = Object.freeze({
  ...EXPECTED_TEMPLATE,
  stages: [
    {
      id: 'lookup', workspace: 'lookup', label: 'Collect domain evidence', path: '/lookup',
      detail: 'Collect separately attributed evidence.',
      expectedEvidence: 'Authority-aware evidence.',
      requestImpact: 'Fast and deep Lookup have different request budgets. Collection starts only from the tool action you choose.',
      prerequisite: 'Confirm the domain is in scope and select the appropriate lookup depth.',
      completionCriteria: 'Source states were reviewed.',
      instructions: ['Confirm scope.', 'Start collection explicitly.'],
      requiresApproval: true,
    },
    {
      id: 'monitor', workspace: 'monitor', label: 'Record disposition', path: '/monitor',
      detail: 'Record an analyst decision.',
      expectedEvidence: 'A bounded case decision.',
      requestImpact: 'Local case editing makes no request. Rescans and hosted-monitor changes remain separate explicit actions.',
      prerequisite: 'Review source provenance, limitations, and any scoring explanation before deciding.',
      completionCriteria: 'The decision is retained.',
      instructions: ['Open the case.', 'Record a reviewed conclusion.'],
      requiresApproval: false,
    },
  ],
});

describe('frozen investigation compatibility fixtures', () => {
  test('normalizes authentic guide versions 1 through 4 without inventing later fields', async () => {
    for (const version of [1, 2, 3, 4] as const) {
      const parsed = parseInvestigationGuide(await fixture(`investigation-guide-v${version}.json`));
      assert.deepEqual(parsed, expectedGuide(version));
    }
  });

  test('imports the authentic version-1 template export through the current bounded reader', async () => {
    const result = mergeInvestigationTemplates([], await fixture('investigation-template-v1.json'));
    assert.equal(result.added, 1);
    assert.deepEqual(result.templates, [EXPECTED_TEMPLATE]);
  });

  test('imports the authentic manual-only CACAO profile version 1 through the current reader', async () => {
    const result = parseCacaoInvestigationPlaybook(await fixture('investigation-cacao-profile-v1.json'));
    assert.deepEqual(result, EXPECTED_CACAO_TEMPLATE);
  });
});
