import type { InvestigationRecipeId } from './investigation-guide.ts';

export const OFFLINE_INVESTIGATION_SCENARIO_VERSION = 1;
export const MAX_OFFLINE_SCENARIO_STEPS = 4;
export const MAX_OFFLINE_SCENARIO_CHOICES = 4;

export type OfflineScenarioChoice = {
  id: string;
  label: string;
  correct: boolean;
  feedback: string;
};

export type OfflineScenarioStep = {
  id: string;
  title: string;
  prompt: string;
  evidence: Array<{
    source: string;
    state: 'success' | 'partial' | 'inconclusive' | 'not_observed';
    observation: string;
    limitation: string;
  }>;
  choices: OfflineScenarioChoice[];
};

export type OfflineInvestigationScenario = {
  id: string;
  recipeId: InvestigationRecipeId;
  label: string;
  summary: string;
  target: string;
  learningGoal: string;
  steps: OfflineScenarioStep[];
};

export type OfflineScenarioEvaluation = {
  correct: boolean;
  feedback: string;
};

export const OFFLINE_INVESTIGATION_SCENARIOS: readonly OfflineInvestigationScenario[] = Object.freeze([
  {
    id: 'brand-boundary-review',
    recipeId: 'brand_sweep',
    label: 'Review a possible brand lookalike',
    summary: 'Move from a trusted brand boundary to a small candidate set without treating similarity as maliciousness.',
    target: 'northstar.example.invalid',
    learningGoal: 'Separate candidate generation, public observations, authority checks, and analyst conclusions.',
    steps: [
      {
        id: 'brand-boundary',
        title: 'Confirm the trusted boundary',
        prompt: 'Which action should come first?',
        evidence: [
          { source: 'Brand profile', state: 'success', observation: 'northstar.example.invalid is analyst-marked as official.', limitation: 'The profile is analyst-owned context, not public proof of ownership.' },
          { source: 'Candidate generator', state: 'not_observed', observation: 'No candidates have been generated yet.', limitation: 'No candidate list is not evidence that lookalikes do not exist.' },
        ],
        choices: [
          { id: 'confirm-profile', label: 'Review the official domain and trusted allowlists before generating candidates.', correct: true, feedback: 'Correct. The official boundary determines what should be compared and suppressed.' },
          { id: 'scan-everything', label: 'Generate the largest possible list and assume every similar name is suspicious.', correct: false, feedback: 'Similarity creates review candidates only. Start with a bounded, reviewed brand boundary.' },
          { id: 'open-case', label: 'Open a malicious-domain case immediately.', correct: false, feedback: 'There is no candidate evidence yet and the workflow must not infer maliciousness from a brand name.' },
        ],
      },
      {
        id: 'candidate-source',
        title: 'Interpret candidate provenance',
        prompt: 'A candidate appears in local permutations and a CT result. What is the defensible conclusion?',
        evidence: [
          { source: 'Local generation', state: 'success', observation: 'northstarr.example.invalid is one edit from the official name.', limitation: 'A generated string is not evidence that a domain exists.' },
          { source: 'Certificate Transparency', state: 'success', observation: 'A certificate log reported the candidate name.', limitation: 'A CT observation is not authoritative registration status or evidence of current service.' },
        ],
        choices: [
          { id: 'triage', label: 'Shortlist it for authority-aware registration and network checks.', correct: true, feedback: 'Correct. The two sources justify review, not an ownership or intent claim.' },
          { id: 'registered', label: 'Mark it registered and active because CT observed it.', correct: false, feedback: 'CT is a public certificate observation, not authoritative registration or current activity.' },
          { id: 'malicious', label: 'Mark it malicious because it resembles the official domain.', correct: false, feedback: 'Name similarity alone cannot establish intent or maliciousness.' },
        ],
      },
      {
        id: 'retain-decision',
        title: 'Retain the reviewed outcome',
        prompt: 'The deep lookup is partial but shows a password form and a different registrant context. What should the case retain?',
        evidence: [
          { source: 'Registry RDAP', state: 'partial', observation: 'Registration exists; registrar enrichment timed out.', limitation: 'The missing registrar response must remain partial.' },
          { source: 'Page evidence', state: 'success', observation: 'A password form and copied identity cues were observed.', limitation: 'Page similarity and a form do not prove credential theft.' },
        ],
        choices: [
          { id: 'retain-evidence', label: 'Pin the observations and limitations, record a hypothesis, and schedule manual review.', correct: true, feedback: 'Correct. Evidence, uncertainty, and analyst reasoning remain separately typed.' },
          { id: 'safe', label: 'Close it as safe because registrar enrichment failed.', correct: false, feedback: 'An unavailable source is not evidence of safety.' },
          { id: 'attribution', label: 'Attribute it to the official brand because the page looks similar.', correct: false, feedback: 'Copied identity cues do not establish ownership or attribution.' },
        ],
      },
    ],
  } satisfies OfflineInvestigationScenario,
  {
    id: 'shared-infrastructure-review',
    recipeId: 'infrastructure_pivot',
    label: 'Review shared infrastructure',
    summary: 'Follow a bounded infrastructure lead while keeping observation, commonality, and attribution separate.',
    target: 'portal.example.invalid',
    learningGoal: 'Use shared DNS, certificate, and hosting evidence as pivots rather than proof of common control.',
    steps: [
      {
        id: 'collect-origin',
        title: 'Establish the starting observation',
        prompt: 'What should be reviewed before expanding to related domains?',
        evidence: [
          { source: 'DNS', state: 'success', observation: 'The domain resolves to a public address and two nameservers.', limitation: 'DNS records can change and shared services are common.' },
          { source: 'TLS', state: 'partial', observation: 'A leaf certificate was observed; chain retrieval was incomplete.', limitation: 'The incomplete chain cannot be treated as absent.' },
        ],
        choices: [
          { id: 'review-start', label: 'Review the starting domain’s source states, timestamps, and collection limits.', correct: true, feedback: 'Correct. A pivot needs a defensible starting observation.' },
          { id: 'reverse-all', label: 'Immediately enumerate every domain on the IP without a scope or result bound.', correct: false, feedback: 'Expansion should remain scoped and bounded, especially on high-degree shared infrastructure.' },
          { id: 'same-owner', label: 'Treat the address and nameservers as proof of ownership.', correct: false, feedback: 'Infrastructure reuse can reflect hosting, CDN, reseller, or provider commonality.' },
        ],
      },
      {
        id: 'compare-peers',
        title: 'Compare the relationship',
        prompt: 'Two domains share a nameserver set and certificate public-key digest. What is the useful next step?',
        evidence: [
          { source: 'Local relationship graph', state: 'success', observation: 'Two exact shared edges were derived from retained observations.', limitation: 'The graph covers only this browser workspace and is not internet-wide rarity.' },
          { source: 'Registration', state: 'inconclusive', observation: 'Registrant identity is redacted for both domains.', limitation: 'Redaction neither confirms nor disproves common control.' },
        ],
        choices: [
          { id: 'compare', label: 'Compare registration, redirect, page, and timing evidence before retaining the pivot.', correct: true, feedback: 'Correct. Multiple separately attributed observations can strengthen a lead without proving attribution.' },
          { id: 'cluster-owner', label: 'Assign both domains to one owner automatically.', correct: false, feedback: 'Shared edges are investigative context, not an ownership assertion.' },
          { id: 'ignore', label: 'Discard the relationship because registrant data is redacted.', correct: false, feedback: 'Redaction preserves uncertainty; it does not erase the observed infrastructure relationship.' },
        ],
      },
      {
        id: 'retain-pivot',
        title: 'Retain only defensible context',
        prompt: 'How should the reviewed relationship be recorded?',
        evidence: [
          { source: 'Evidence pins', state: 'success', observation: 'The exact nameserver set and public-key digest can be pinned with timestamps.', limitation: 'Pins are compact selected facts, not raw source payloads.' },
        ],
        choices: [
          { id: 'retain-context', label: 'Save the reviewed edge, supporting pins, local commonality, and explicit attribution limitation.', correct: true, feedback: 'Correct. The retained record explains why the pivot matters and what it cannot prove.' },
          { id: 'retain-verdict', label: 'Save “same operator” as an observed fact.', correct: false, feedback: 'That would convert an analyst hypothesis into source evidence.' },
          { id: 'retain-raw', label: 'Copy all raw WHOIS and page responses into the relationship.', correct: false, feedback: 'The bounded local model intentionally excludes raw payloads and unnecessary personal data.' },
        ],
      },
    ],
  } satisfies OfflineInvestigationScenario,
  {
    id: 'partial-domain-triage',
    recipeId: 'new_domain_triage',
    label: 'Triage an incomplete domain result',
    summary: 'Reach a reviewable disposition without turning source failures or missing observations into safety claims.',
    target: 'checkout.example.invalid',
    learningGoal: 'Preserve partial evidence, contradictory observations, and the next safe manual action.',
    steps: [
      {
        id: 'authority-first',
        title: 'Start with authority',
        prompt: 'The registry source succeeds, registrar RDAP fails, and the website responds. Which status is defensible?',
        evidence: [
          { source: 'Registry RDAP', state: 'success', observation: 'The authoritative registry reports an existing registration.', limitation: 'It does not describe current website intent.' },
          { source: 'Registrar RDAP', state: 'partial', observation: 'The registrar endpoint timed out.', limitation: 'Timeout is not evidence that registrar data is absent.' },
          { source: 'HTTP', state: 'success', observation: 'A public response was received.', limitation: 'Reachability does not establish safety or legitimacy.' },
        ],
        choices: [
          { id: 'registered-partial', label: 'Registered, with registrar enrichment still partial and web activity separately observed.', correct: true, feedback: 'Correct. Authority decides existence; enrichment and activity remain separate evidence.' },
          { id: 'unknown', label: 'Unknown registration because any source failure cancels the registry answer.', correct: false, feedback: 'A non-authoritative enrichment failure does not override an authoritative registry result.' },
          { id: 'safe-active', label: 'Safe and active because the site responds.', correct: false, feedback: 'An HTTP response is activity context, not a safety finding.' },
        ],
      },
      {
        id: 'contradiction',
        title: 'Handle contradictory identity evidence',
        prompt: 'Structured identity names one organisation, while page text resembles another. What should the analyst do?',
        evidence: [
          { source: 'Structured identity', state: 'success', observation: 'JSON-LD names Example Checkout Services.', limitation: 'Site-authored metadata is not independent verification.' },
          { source: 'Page identity', state: 'success', observation: 'Visible text resembles a different reviewed brand.', limitation: 'Similarity is heuristic and can be benign, copied, or misleading.' },
        ],
        choices: [
          { id: 'record-contradiction', label: 'Record both observations as a contradiction and review trusted external context.', correct: true, feedback: 'Correct. The contradiction is useful precisely because neither source silently wins.' },
          { id: 'json-wins', label: 'Accept the JSON-LD organisation as verified ownership.', correct: false, feedback: 'Site-authored structured data is evidence about what the page claims, not verified ownership.' },
          { id: 'page-wins', label: 'Treat page resemblance as proof of impersonation.', correct: false, feedback: 'Similarity can raise review priority but does not prove malicious intent.' },
        ],
      },
      {
        id: 'next-action',
        title: 'Choose the next safe action',
        prompt: 'The evidence is concerning but incomplete. What is the best handoff?',
        evidence: [
          { source: 'Decision brief', state: 'partial', observation: 'Registration and page observations are verified; ownership and intent remain unknown.', limitation: 'The brief is deterministic and does not make a verdict.' },
        ],
        choices: [
          { id: 'manual-review', label: 'Create a case with pinned facts, open unknowns, and a reviewed follow-up action.', correct: true, feedback: 'Correct. The handoff keeps facts, hypotheses, unknowns, and next actions distinct.' },
          { id: 'auto-report', label: 'Automatically send an abuse report.', correct: false, feedback: 'External reporting remains human-reviewed and is never triggered by a score or scenario.' },
          { id: 'dismiss', label: 'Dismiss it because some fields were not observed.', correct: false, feedback: 'Missing evidence cannot establish absence or safety.' },
        ],
      },
    ],
  } satisfies OfflineInvestigationScenario,
]);

export function offlineInvestigationScenario(value: unknown): OfflineInvestigationScenario | null {
  return typeof value === 'string'
    ? OFFLINE_INVESTIGATION_SCENARIOS.find((scenario) => scenario.id === value) ?? null
    : null;
}

export function evaluateOfflineScenarioChoice(
  scenarioId: unknown,
  stepId: unknown,
  choiceId: unknown,
): OfflineScenarioEvaluation | null {
  const scenario = offlineInvestigationScenario(scenarioId);
  const step = scenario?.steps.find((candidate) => candidate.id === stepId);
  const choice = step?.choices.find((candidate) => candidate.id === choiceId);
  return choice ? { correct: choice.correct, feedback: choice.feedback } : null;
}
