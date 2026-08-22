import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';

import fc from 'fast-check';

import { buildInvestigationPlan, INVESTIGATION_PLAN_RECIPES } from '../cli/investigation-plan.mts';
import { runInvestigationRecipe } from '../cli/investigation-run.mts';
import { requestLookup, type LookupRequestOptions } from '../lib/lookup-request.mts';
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_OUTCOME_STATES,
  type CapabilityOutcomeState,
} from '../packages/contracts/capability-manifest.mts';
import {
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  mergeBrandProfiles,
  normalizeBrandProfileStore,
} from '../packages/workspace/brand-profile-model.mts';
import { CASE_STATUSES } from '../packages/cases/case-record-contracts.mts';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import {
  appendCaseDecision,
  CASE_ACTION_STATES,
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  isLegalCaseActionTransition,
  type CaseActionEventSourceClass,
  type CaseActionState,
} from '../packages/cases/case-response-model.mts';
import { fastCheckParameters, fastCheckReplayDetails } from './helpers/fast-check-config.mts';

const NOW = '2026-08-22T00:00:00.000Z';
const PROPERTY_PARAMETERS = fastCheckParameters(80, 0x0051_a7e);

function replay(context: TestContext, label: string): void {
  context.diagnostic(`${label}. ${fastCheckReplayDetails(PROPERTY_PARAMETERS)}`);
}

function profile(index: number) {
  return {
    id: `profile-${index}`,
    name: `Example Profile ${index}`,
    officialDomains: [`profile-${index}.example`],
    productNames: [],
    tlds: ['example'],
    approvedPartnerDomains: [],
    allowlistedDomains: [],
    allowlistedRegistrars: [],
    dkimSelectors: [],
    retiredDkimSelectors: [],
    mailProtectionProfile: 'standard',
    protectionAttestations: [],
    desiredPostureBaselines: [],
    trademarkOwner: '',
    trademarkRegistration: '',
    officialFaviconHash: '',
    officialFaviconPHash: '',
    pageBaseline: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('bounded verification state machines', () => {
  test('migrates browser-local profiles while refusing every future import without mutation', (context) => {
    replay(context, 'browser-local migration');
    fc.assert(fc.property(
      fc.array(fc.constantFrom('load_legacy', 'merge_current', 'reject_future'), { minLength: 1, maxLength: 24 }),
      (actions) => {
        let store = normalizeBrandProfileStore([]);
        actions.forEach((action, index) => {
          if (action === 'load_legacy') {
            store = normalizeBrandProfileStore([profile(index)]);
          } else if (action === 'merge_current') {
            store = {
              version: BRAND_PROFILE_SCHEMA_VERSION,
              profiles: mergeBrandProfiles(store, {
                schema: BRAND_PROFILE_SCHEMA,
                version: BRAND_PROFILE_SCHEMA_VERSION,
                profiles: [profile(index)],
              }, { nowIso: NOW, makeId: () => `generated-${index}` }).profiles,
            };
          } else {
            const before = structuredClone(store);
            assert.throws(() => mergeBrandProfiles(store, {
              schema: BRAND_PROFILE_SCHEMA,
              version: BRAND_PROFILE_SCHEMA_VERSION + 1,
              profiles: [profile(index)],
            }, { nowIso: NOW }), /newer schema/u);
            assert.deepEqual(store, before);
          }
          assert.equal(store.version, BRAND_PROFILE_SCHEMA_VERSION);
          assert.deepEqual(normalizeBrandProfileStore(store), store);
          assert.equal(new Set(store.profiles.map((item) => item.id)).size, store.profiles.length);
        });
      },
    ), PROPERTY_PARAMETERS);
  });

  test('keeps Case status, decision, and response transitions legal and append-only', (context) => {
    replay(context, 'Case lifecycle');
    const statuses = CASE_STATUSES.map((item) => item.value);
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...statuses), { minLength: 1, maxLength: 16 }),
      fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 12 }),
      fc.array(fc.record({
        previous: fc.option(fc.constantFrom(...CASE_ACTION_STATES), { nil: null }),
        next: fc.constantFrom(...CASE_ACTION_STATES),
        source: fc.constantFrom(...CASE_ACTION_EVENT_SOURCE_CLASSES),
      }), { maxLength: 40 }),
      (statusSequence, rationales, transitions) => {
        let record = createCase({ domain: 'case-state.example', source: 'manual' }, NOW);
        let cases = [record];
        for (const status of statusSequence) {
          if (status === 'resolved') {
            assert.throws(() => updateCase(cases, record.id, { status }, NOW), /deliberate closure review/u);
          } else {
            ({ cases, record } = updateCase(cases, record.id, { status }, NOW));
            assert.equal(record.status, status);
          }
        }
        let decisions = record.decisions;
        rationales.forEach((rationale, index) => {
          const before = [...decisions];
          decisions = appendCaseDecision(decisions, {
            summary: `Decision ${index}`,
            rationale,
          }, new Date(Date.parse(NOW) + index * 1_000).toISOString());
          assert.deepEqual(decisions.slice(0, before.length), before);
          assert.equal(decisions.length, before.length + 1);
        });
        for (const transition of transitions) {
          const expected = referenceCaseTransition(transition.previous, transition.next, transition.source);
          assert.equal(isLegalCaseActionTransition(transition.previous, transition.next, transition.source), expected);
          if (transition.previous === 'terminal') assert.equal(expected, false);
        }
      },
    ), PROPERTY_PARAMETERS);
  });

  test('distinguishes completed requests, analyst cancellation, and timeouts', async (context) => {
    replay(context, 'request completion');
    type FetchImplementation = NonNullable<LookupRequestOptions['fetchImpl']>;
    const pendingFetch: FetchImplementation = (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom('complete', 'cancel', 'timeout'), { minLength: 1, maxLength: 12 }),
      async (actions) => {
        for (const action of actions) {
          if (action === 'complete') {
            const outcome = await requestLookup('/api/lookup?q=request-state.example', {
              fetchImpl: async () => Response.json({
                query: 'request-state.example',
                type: 'domain',
                registrableDomain: 'request-state.example',
                rdap: {}, whois: {}, availability: { applicable: true, state: 'unknown' },
                diagnostics: { version: 8, rdap: { status: 'unsupported' }, whois: { status: 'partial' }, availability: { status: 'complete' } },
              }),
            });
            assert.equal(outcome.ok, true);
          } else if (action === 'cancel') {
            const controller = new AbortController();
            controller.abort('analyst_cancelled');
            const outcome = await requestLookup('/api/lookup?q=request-state.example', { fetchImpl: pendingFetch, signal: controller.signal });
            assert.deepEqual(outcome.ok ? 'unexpected' : outcome.kind, 'cancelled');
          } else {
            const outcome = await requestLookup('/api/lookup?q=request-state.example', { fetchImpl: pendingFetch, timeoutMs: 1 });
            assert.deepEqual(outcome.ok ? 'unexpected' : outcome.kind, 'timeout');
          }
        }
      },
    ), { ...PROPERTY_PARAMETERS, numRuns: Math.min(PROPERTY_PARAMETERS.numRuns, 30) });
  });

  test('preserves partial, blocked, unavailable, unsupported, and stale source identities', (context) => {
    replay(context, 'evidence source states');
    const requiredStates = ['partial', 'blocked', 'unavailable', 'unsupported', 'stale'] as const;
    const declaredOutcomes = CAPABILITY_MANIFEST.capabilities.flatMap((item) => item.outcomes);
    for (const state of requiredStates) {
      assert.ok(CAPABILITY_OUTCOME_STATES.includes(state));
      assert.ok(declaredOutcomes.includes(state));
    }
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...requiredStates), { minLength: 1, maxLength: 40 }),
      (sequence) => {
        const retained = new Map<string, CapabilityOutcomeState>();
        sequence.forEach((state, index) => retained.set(`source-${index % 8}`, state));
        for (const [source, state] of retained) {
          assert.match(source, /^source-\d$/u);
          assert.equal(CAPABILITY_OUTCOME_STATES.find((candidate) => candidate === state), state);
          assert.notEqual(state, 'complete');
        }
      },
    ), PROPERTY_PARAMETERS);
  });

  test('runs only fixed workflow prefixes and pauses at network or analyst approval boundaries', async (context) => {
    replay(context, 'fixed workflow lifecycle');
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(...INVESTIGATION_PLAN_RECIPES),
      fc.boolean(),
      async (recipe, approveNetwork) => {
        const subject = recipe === 'lookalike-review' ? 'Example Organisation' : 'workflow-state.example';
        const plan = buildInvestigationPlan(recipe, subject, NOW);
        const calls: Array<{ command: string; arguments: readonly string[]; mode: string }> = [];
        const result = await runInvestigationRecipe(recipe, subject, {
          approveNetwork,
          resumeInput: null,
          generatedAt: NOW,
          execute: async (command, args) => {
            const step = plan.steps.find((item) => item.command === command
              && item.arguments.length === args.length
              && item.arguments.every((argument, index) => argument === args[index]));
            assert.ok(step);
            calls.push({ command, arguments: args, mode: step.mode });
            return { exitCode: 0, stdout: JSON.stringify({ schema: step.produces }) };
          },
        });
        assert.deepEqual(result.completedSteps.map((item) => item.id), plan.steps.slice(0, result.completedSteps.length).map((item) => item.id));
        assert.equal(result.currentStep?.id, plan.steps[result.completedSteps.length]?.id);
        assert.ok(result.state === 'awaiting_network_approval' || result.state === 'awaiting_analyst_selection');
        assert.equal(calls.some((call) => call.mode === 'network') && !approveNetwork, false);
        assert.equal(result.networkApprovedForThisRun, approveNetwork);
        if (result.state === 'awaiting_network_approval') assert.equal(result.currentStep?.mode, 'network');
        else assert.ok(result.currentStep?.arguments.some((argument) => /^<[^>]+>$/u.test(argument)));
      },
    ), PROPERTY_PARAMETERS);
  });
});

function referenceCaseTransition(
  previous: CaseActionState | null,
  next: CaseActionState,
  source: CaseActionEventSourceClass,
): boolean {
  if (previous === null) return source === 'migration' || next === 'drafting' && (source === 'analyst' || source === 'browser_local');
  const transitions: Readonly<Record<CaseActionState, readonly CaseActionState[]>> = {
    drafting: ['ready_for_review', 'terminal'],
    ready_for_review: ['drafting', 'reviewed', 'terminal'],
    reviewed: ['drafting', 'authorised', 'terminal'],
    authorised: ['drafting', 'submitted', 'terminal'],
    submitted: ['submitted', 'acknowledged', 'terminal'],
    acknowledged: ['acknowledged', 'terminal'],
    terminal: [],
  };
  if (!transitions[previous].includes(next)) return false;
  if (source === 'provider' || source === 'import') {
    return (previous === 'submitted' || previous === 'acknowledged')
      && (next === 'submitted' || next === 'acknowledged' || next === 'terminal');
  }
  if (source === 'browser_local') return next === 'drafting' && ['ready_for_review', 'reviewed', 'authorised'].includes(previous);
  return source === 'analyst';
}
