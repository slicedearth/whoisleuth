import { createCase, updateCase } from '../../../../packages/cases/case-record-operations.mts';
import type { CasePatch, CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import { emptyCaseDraftStore, normalizeCaseDraftStore, removeCaseDraft } from '../../../../packages/cases/case-drafts.mts';
import type { CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';
import type { DraftStorage } from '../controllers/case-draft-recovery.ts';
import { appendCaseAction, appendCaseActionTransition } from '../../../../packages/cases/case-response-actions.mts';
import { countEvidenceLinkedCaseDecisions } from '../../../../packages/cases/case-response-model.mts';
import { buildCaseResponseReviewInputs } from '../../../../packages/cases/case-response-packet.mts';
import { caseIncidentTargets } from '../../../../packages/cases/case-workflow-metadata.mts';
import { caseRecheckAnswerContext } from '../../../../packages/cases/case-recheck-model.mts';
import { PLATFORM_REPORTING_ROUTES } from '../../../../packages/cases/platform-reporting-routes.mts';
import { readIncidentStages, reviewIncidentSequence } from '../../../../packages/investigation/incident-sequence-review.mts';

export const CASE_PRACTICE_OBSERVED_AT = '2026-09-01T12:00:00.000Z';
export const CASE_PRACTICE_LATER_AT = '2026-09-02T12:00:00.000Z';
export const CASE_PRACTICE_JOURNEY_AT = '2026-09-03T12:00:00.000Z';
export const CASE_PRACTICE_INTAKE_TEXT = `Reported destination: https://case-practice.example/offer?campaign=fictional
Literal address: 192.0.2.17
SHA256: ${'a'.repeat(64)}`;

/** Fixed supplied text; these reviews never read the saved workspace or collect a target. */
export async function reviewCasePracticeInput(record: CaseRecord) {
  const source = record.evidencePins[0];
  if (record.domain !== 'case-practice.example' || !source) throw new TypeError('Use the supplied offer-page practice record.');
  const [{ reviewMessageInput }, { withIntakeDistributionContext }, { reviewDomainHistory }] = await Promise.all([
    import('../../../../packages/investigation/message-intake.mts'),
    import('../../../../packages/investigation/intake-context.mts'),
    import('../../../../packages/investigation/domain-history-review.mts'),
  ]);
  const reviewed = await reviewMessageInput(new TextEncoder().encode(CASE_PRACTICE_INTAKE_TEXT), 'text', CASE_PRACTICE_LATER_AT);
  const intake = withIntakeDistributionContext(reviewed.report, { channel: 'advertisement', observedAt: CASE_PRACTICE_OBSERVED_AT,
    sourceLabel: 'Fictional reporter account', reference: 'PRACTICE-7', observerLabel: 'Fictional reviewer', vantageLabel: 'Reported mobile viewport' });
  const history = reviewDomainHistory(record, { expectedChanges: [], retiredDependencies: [], registrationBoundaries: [{
    kind: 'review_boundary', occurredAt: CASE_PRACTICE_LATER_AT, source: 'Fictional relevance review',
    rationale: 'Reassess earlier relevance without asserting a deletion, re-registration or new owner.', snapshotIds: [], evidencePinIds: [source.id],
  }] }, CASE_PRACTICE_LATER_AT, 2);
  return { intake, history };
}

export async function previewCasePracticeContainment(record: CaseRecord, audience: 'internal' | 'trusted' | 'public', includeSupportingPin: boolean) {
  const source = record.evidencePins[0];
  const followUp = record.assertions.find(item => item.kind === 'next_step' && item.recheck?.baselinePinId === source?.id);
  if (!source || !followUp) throw new TypeError('The supplied practice follow-up is unavailable.');
  const { previewCaseContainmentHandoff } = await import('../../../../packages/cases/case-containment-handoff.mts');
  return previewCaseContainmentHandoff(record, { audience, recipientRole: 'security_operations', assertionIds: [followUp.id],
    evidencePinIds: includeSupportingPin ? [source.id] : [] }, CASE_PRACTICE_JOURNEY_AT);
}

export const CASE_PRACTICE_SCENARIOS = [
  { id: 'credential-form', title: 'An ordinary-looking sign-in page',
    observation: 'A supplied lookalike page repeats a reference page’s original offer text, without a logo or brand name, then asks for an email address and password. The supplied form action points to https://case-practice.example/collect; no credentials were entered.',
    assessment: 'Separate copied-content allegations from the observed credential request. Neither name resemblance nor shared text establishes ownership, intent or rights to submit a copyright notice.',
    recheck: 'The later capture timed out. Record what it establishes, not the outcome expected.',
    question: 'Is the credential form still present?', conditions: 'Same unauthenticated page and viewport; require a complete later capture.',
    source: 'Fictional supplied capture', urls: ['https://case-practice.example/offer', 'https://distribution.example/ad/7'], routes: ['google-ad-report'],
    adequate: 'Identify the offer and form separately, cite the dated supplied observation and form action, explain the missing authority and prepare separate page and ad recipient copies.',
    inadequate: '“The name looks wrong: delete everything.” This lacks behaviour evidence, exact scope, authority and a distinct distribution object.' },
  { id: 'compromised-page', title: 'An unexpected page on a legitimate site',
    observation: 'A supplied capture of https://publisher.example/old-guide requests account credentials. A separate reviewed baseline shows ordinary articles elsewhere on that legitimate site. Compromise is suspected, not established.',
    assessment: 'Use the exact old-guide page and published security/hosting scope. Registration age, valid TLS and provider reputation do not establish that this URL is safe. Control remains unknown unless an analyst records an evidence-supported assessment; one page does not justify accusing every service on the domain.',
    recheck: 'A later review failed before the exact path could be checked; the rest of the site was not reviewed.',
    question: 'Does the old-guide page still request credentials?', conditions: 'Exact old-guide path, same unauthenticated desktop viewport.',
    source: 'Fictional exact-page capture', urls: ['https://publisher.example/old-guide'], routes: [],
    adequate: 'Describe the exact path, time, credential request and unaffected baseline; ask the scoped security contact to review possible compromise.',
    inadequate: '“The entire publisher is malicious.” This overstates actor attribution and can cause unnecessary domain-wide harm.' },
  { id: 'unobserved-lookalike', title: 'A new lookalike with no observed page',
    observation: 'Supplied registration evidence shows a newly registered similar name. Web collection was unavailable and no mail exchange was observed. A reported MX record is only mail-routing context.',
    assessment: 'Record a watch decision and evidence gaps. Registration and possible mail capability do not establish credential theft, active mail use or maliciousness.',
    recheck: 'The later page capture also failed; this does not convert unobserved content into absence.',
    question: 'Is relevant web behaviour observable?', conditions: 'A complete public page observation would be needed; do not send mail or test recipients.',
    source: 'Fictional registration and DNS summary', urls: [], routes: [],
    adequate: 'Keep registration, mail capability and unavailable web evidence separate; record why watching is proportionate.',
    inadequate: '“New domain plus MX proves phishing.” Neither signal shows a sent message or a credential lure.' },
  { id: 'related-hosts', title: 'Related hosts with different affected identities',
    observation: 'Supplied captures show accounts.parent.example/service-a and jobs.parent.example/service-b making different identity claims. They share a parent domain and an edge address; each affected identity and page is distinct.',
    assessment: 'Retain exact incident links and separate Brand Profile associations or related Cases. Shared infrastructure is a lead, not common ownership or one universal incident.',
    recheck: 'The service-a recheck failed. It says nothing about service-b.',
    question: 'Is the service-a claim still observable?', conditions: 'Exact service-a page and claimed identity, not any sibling hostname.',
    source: 'Fictional separately scoped page captures', urls: ['https://accounts.parent.example/service-a', 'https://jobs.parent.example/service-b'], routes: [],
    adequate: 'List each host, affected identity, observation and source link separately, with the shared-parent relationship qualified.',
    inadequate: '“One IP, one actor, one brand.” This collapses distinct incidents and overstates infrastructure evidence.' },
  { id: 'fake-shop', title: 'A storefront promise and copied listing',
    observation: 'A supplied shop listing uses copied product prose and an unusually strong delivery promise. A customer alleges non-delivery; no purchase, counterfeit inspection or test payment occurred.',
    assessment: 'Keep observed listing content separate from the customer allegation. Fraud, copyright, trademark and trade-dress grounds need different evidence and authority.',
    recheck: 'The listing review failed; the order allegation remains unverified.',
    question: 'Is the exact listing content still present?', conditions: 'Same public product URL; do not order or test payment.',
    source: 'Fictional listing capture and attributed allegation', urls: ['https://shop.example/products/item-seven'], routes: ['shopify-merchant', 'shopify-rights'],
    adequate: 'Identify the listing and allegation, confirm platform involvement, choose fraud or the supported rights route and minimise customer details.',
    inadequate: '“A cheap item proves counterfeiting; use copyright for a refund.” This conflates evidence, rights authority and consumer remedies.' },
  { id: 'ad-redirect', title: 'An ad whose landing page changes',
    observation: 'A supplied advertisement has creative identifier seven and leads through one observed redirect to an offer page. One intermediate hop was not captured. The destination later changes.',
    assessment: 'Retain the exact ad, displayed advertiser, redirect observations and landing page separately. Unknown hops remain unknown; disappearance of the destination does not resolve distribution. Report counts, suspension and provider closure do not measure campaign elimination or reduced harm.',
    recheck: 'The later ad review did not complete; the distribution object is unresolved.',
    question: 'Does the same ad still lead to the offer?', conditions: 'Same supplied ad context and device; no automated ad clicking.',
    source: 'Fictional ad creative and navigation record', urls: ['https://distribution.example/ad/7', 'https://landing.example/offer', 'https://replacement.example/offer'], routes: ['google-ad-report'],
    adequate: 'Identify the actual ad in the platform process and include only observed hops; retain a separate unresolved ad follow-up.',
    inadequate: '“The destination is gone, so the ad is fixed.” This does not establish the ad’s later state.' },
  { id: 'social-payment', title: 'A profile leading to a payment lure',
    observation: 'A supplied profile capture links to a public messaging invitation that asks for a deposit. The account claim, invitation and payment instructions are separately observed; no payment was made.',
    assessment: 'Keep the social account, message object and destination distinct. Do not enter a private chat, contact a victim or make a test payment to strengthen evidence.',
    recheck: 'A later public profile review failed; it cannot decide the invitation or payment destination’s status.',
    question: 'Is the public invitation still shown?', conditions: 'Exact supplied public object, without joining or sending a message.',
    source: 'Fictional public profile and invitation captures', urls: ['https://social.example/profile/seven', 'https://messaging.example/invite/seven'], routes: ['telegram-abuse'],
    adequate: 'Attribute each supplied object, minimise unrelated message details and select only a supported platform scope.',
    inadequate: '“Send a deposit to prove the scam.” This creates harm and adds unsupported active interaction.' },
  { id: 'role-impersonation', title: 'An executive, support or recruitment claim',
    observation: 'A fictional recruiter claims to act for an executive and asks applicants to use an unofficial support channel. An approved official channel list contradicts that contact route; representative authority has not been verified.',
    assessment: 'Compare the precise claimed role and channel with the approved baseline. Verify who may report impersonation or exercise rights instead of assuming every employee has authority.',
    recheck: 'The later profile review failed; the claimed identity remains unresolved.',
    question: 'Is the same role and contact claim still displayed?', conditions: 'Exact profile and approved baseline at the recorded times.',
    source: 'Fictional role claim and approved channel list', urls: ['https://social.example/recruiter/seven'], routes: ['linkedin-report'],
    adequate: 'Quote the supplied role claim, identify the baseline mismatch and state the reviewer’s authority or its absence.',
    inadequate: '“They mention an executive, so I can file any rights notice.” The role claim does not grant reporting authority.' },
  { id: 'email-only', title: 'An email-only supplier claim',
    observation: 'A supplied sanitised message summary claims a supplier changed its payment instructions. SPF, DKIM and DMARC pass for the displayed sending domain; no website or payment destination was reviewed.',
    assessment: 'Authentication concerns the sending domain, not the legitimacy of the supplier claim. Confirm through a previously approved out-of-band channel; retain no raw message, headers, credentials or bank details here.',
    recheck: 'The later approved-channel confirmation is unavailable; payment authority remains unresolved.',
    question: 'Was the change confirmed through an approved channel?', conditions: 'Existing trusted contact route, not contact details supplied in the message.',
    source: 'Fictional minimised message and authentication summary', urls: [], routes: [],
    adequate: 'Separate authentication from identity and record an out-of-band review decision without repeating sensitive message data.',
    inadequate: '“DMARC passed: pay the new account.” Authentication is not payment authorisation or legitimacy.' },
  { id: 'conditional-presentation', title: 'A QR lure with conditional presentation',
    observation: 'A supplied QR destination capture shows an offer on a mobile viewport in one stated location. A desktop capture elsewhere shows an ordinary page. No new device, location or active vantage was collected.',
    assessment: 'Retain supplied viewport, location, time and navigation conditions. Different presentations are not necessarily contradictory; a desktop result cannot erase a mobile observation.',
    recheck: 'The matching mobile-condition capture failed; non-reproduction cannot be inferred from the desktop page.',
    question: 'Is the offer reproduced under the supplied mobile conditions?', conditions: 'Same supplied mobile viewport, location context and exact QR destination; additional active vantage collection is outside this exercise.',
    source: 'Fictional QR and conditional viewport captures', urls: ['https://conditional.example/offer'], routes: [],
    adequate: 'State the conditions of each capture and leave the matching-condition recheck unavailable.',
    inadequate: '“Desktop is clean, so the QR report is false.” It compares different conditions.' },
  { id: 'hosted-object', title: 'A credential request in a shared hosted form',
    observation: 'A supplied shared-form object asks for a password. Its tenant and object identifier are known; the rest of the platform was not reviewed and no form response was submitted.',
    assessment: 'Identify the exact file, form or tenant object, not the provider’s entire domain. Unrelated tenants can share an IP, nameserver, certificate and page template. A platform or redirect is not automatically the registrant, final destination or responsible origin. Use scoped reporting instructions only after verifying the platform.',
    recheck: 'The exact object could not be reviewed later; platform availability does not answer the object question.',
    question: 'Does the exact hosted object still request credentials?', conditions: 'Same supplied object and access role without signing in or submitting responses.',
    source: 'Fictional shared-form capture', urls: ['https://hosted.example/forms/object-seven'], routes: ['google-drive-report'],
    adequate: 'Record the object identifier, behaviour, access conditions and scoped platform route.',
    inadequate: '“Block the entire hosted-file domain.” This affects unrelated tenants and exceeds the observed scope.' },
  { id: 'app-listing', title: 'An app listing, download site and backend',
    observation: 'A supplied app listing claims an official service relationship and links to a download site. A separate supplied record mentions a backend hostname; the application was not installed and the backend behaviour is unobserved.',
    assessment: 'Track the listing/package, distribution site and backend separately. A store policy action affects distribution, not necessarily the downloaded artefact or backend.',
    recheck: 'The later listing review failed; do not infer that the download or backend was removed.',
    question: 'Does the exact listing still make the official-service claim?', conditions: 'Same listing/package and locale; no installation, download execution or authentication.',
    source: 'Fictional listing and separate distribution summary', urls: ['https://app-store.example/listing/package-seven', 'https://download.example/app-seven'], routes: ['google-play-report'],
    adequate: 'Identify the listing/package and displayed developer, qualify the backend gap and route the listing separately.',
    inadequate: '“The store removed it, so every backend is safe.” Distribution is not backend remediation.' },
  { id: 'requested-amendment', title: 'A recipient asks for more evidence',
    observation: 'A fictional recipient requests the dated exact-page evidence for an already delivered packet. The original delivery reference and packet digest are retained; the requested evidence has not yet been prepared.',
    assessment: 'Preserve original delivery and request provenance. Link a new preparation and amendment to the exact original digest and current request event instead of silently regenerating the original.',
    recheck: 'The later capture failed; that gap belongs in the amendment, not in an invented complete observation.',
    question: 'Is a complete later exact-page observation available?', conditions: 'Exact requested page and time scope; do not claim unavailable evidence was supplied.',
    source: 'Fictional recipient request and delivery record', urls: ['https://case-practice.example/offer'], routes: [],
    adequate: 'Use Requested evidence in a real Case to select retained references, state limitations and create a separately reviewed drafting amendment.',
    inadequate: '“Overwrite the first packet with the latest evidence.” This loses the original recipient-material lineage.' },
  { id: 'restored-dispute', title: 'A disputed report and a restored page',
    observation: 'A fictional provider reports that content was restored after a dispute. The procedure is attributed to the provider; no independent later page capture completed.',
    assessment: 'Retain the dispute or counter-notice context. Restoration alone is not evidence of evasion, recurrence, legal entitlement or a false original complaint.',
    recheck: 'A failed later capture cannot establish whether the restored page reproduces the originally reported behaviour.',
    question: 'Does restored content reproduce the specific earlier condition?', conditions: 'Exact page and earlier reported condition, with dispute context retained.',
    source: 'Fictional provider procedural statement', urls: ['https://restored.example/page-seven'], routes: [],
    adequate: 'Record procedural status separately from an independent observed-effect review and consult the applicable official process.',
    inadequate: '“Restoration proves evasion.” A procedural outcome does not establish intent or current behaviour.' },
  { id: 'infrastructure-move', title: 'Related objects move infrastructure',
    observation: 'Two supplied time-scoped observations show a page moving between edge addresses and nameservers. Shared content persists in the earlier snapshots; no actor identity was established.',
    assessment: 'Compare field scope, source, model version and observation time. Migration, shared infrastructure and copied content do not identify a common actor.',
    recheck: 'The later page capture failed; routing change is not page removal.',
    question: 'Does the page condition persist after the observed infrastructure change?', conditions: 'Exact page and comparable source conditions; keep routing and content evidence separate.',
    source: 'Fictional dated routing and page summaries', urls: ['https://moved.example/page-seven'], routes: [],
    adequate: 'Describe the time-scoped infrastructure changes with limitations and keep the page outcome unknown.',
    inadequate: '“New IP proves the operator escaped.” This substitutes actor attribution for deployment observations.' },
  { id: 'unexpected-notice', title: 'An unexpected complaint or provider notice',
    observation: 'A supplied notice claims to be from a provider and asks for urgent payment and account verification. Its reference and claimed sender are analyst-supplied; no instruction, link or attachment was followed.',
    assessment: 'Verify the route out of band using a previously trusted or independently reviewed official channel. Minimise notice details and keep provenance; appearance is not verified provider authority.',
    recheck: 'The independent route check is unavailable; the notice must not be promoted to a verified provider outcome.',
    question: 'Was the notice independently verified through the official route?', conditions: 'Independently obtained official contact, never the payment or credential route in the notice.',
    source: 'Fictional minimised incoming notice', urls: [], routes: [],
    adequate: 'Record an unverified analyst-supplied notice, its reference and an out-of-band review task without retaining message data.',
    inadequate: '“Pay or sign in to avoid removal.” This acts on unverified authority and risks exposing credentials.' },
  { id: 'identity-actions', title: 'Reported account and device actions',
    observation: 'Supplied fictional accounts describe a password entry, repeated approval prompts, device-code entry, alleged session theft, application consent, installation and a support call. These are separate mechanisms with different evidence gaps; no credentials, tokens or account identifiers are retained.',
    assessment: 'Separate a displayed instruction, a reported action and an observed account result. A page without a password form is not necessarily safe. Account exposure and recovery remain unconfirmed unless supported by separately reviewed evidence.',
    recheck: 'The requested account-event review is unavailable; page removal does not establish revoked sessions, grants or completed device recovery.',
    question: 'Are the reported account effects supported by authorised evidence?', conditions: 'Review the supplied account and device timeline through an independently known route; no authentication or live interaction in this exercise.',
    source: 'Fictional minimised incident accounts', urls: ['https://identity.example/instruction'], routes: [],
    adequate: 'Retain each mechanism, evidence basis, source and missing result; record conditional recovery follow-ups without recording sensitive authentication material.',
    inadequate: '“No password field means no exposure.” This overlooks approval, device-code, consent, session and local-execution mechanisms.' },
  { id: 'trust-claim', title: 'An existing organisation and an unsupported campaign claim',
    observation: 'A supplied directory entry records an organisation. A separate offer page claims a partnership; its supplied text and image describe different organisers. No authority for the offer or partnership has been established.',
    assessment: 'Organisation existence, campaign authority and text/image agreement are different questions. Keep the supplied claims and their sources separate. A contradiction calls for review, not an automatic fraud finding.',
    recheck: 'The independent partnership confirmation is unavailable; neither the directory entry nor a repeated logo answers that question.',
    question: 'Does an authorised source confirm this exact campaign relationship?', conditions: 'Exact claimed campaign and reference period; use supplied evidence only and leave missing authority unresolved.',
    source: 'Fictional supplied offer-page text', urls: ['https://offer.example/campaign'], routes: [],
    adequate: 'Cite the directory entry only for its stated scope, retain the conflicting page accounts and record the unconfirmed relationship explicitly.',
    inadequate: '“The organisation exists, so the campaign must be official.” Existence does not establish authority for a separate offer or partnership.' },
  { id: 'dependent-sources', title: 'A submitted report and a later provider result',
    observation: 'An analyst supplied a report. A later provider response explicitly says it reused that report. A separately documented page observation has its own source and time; another provider result does not explain its method.',
    assessment: 'Retain known reuse without calling it independent corroboration. Separately documented observations keep their own attribution, while unknown provider methods remain unknown. Who submitted material alone establishes neither dependence nor independence.',
    recheck: 'A later exact-page capture failed. A missing provider verdict establishes neither safety nor a prohibition on preparing a qualified draft.',
    question: 'Is a complete later exact-page observation available?', conditions: 'Exact supplied page and comparable conditions; repeating the report is not another observation.',
    source: 'Fictional original analyst report', urls: ['https://reported.example/offer'], routes: [],
    adequate: 'Record the provider’s stated reuse, retain the distinct observation separately and carry source qualifications into any selected handoff.',
    inadequate: '“My report and the response are two independent confirmations.” This counts a documented reuse as new support.' },
  { id: 'contradictory-sources', title: 'Two sources disagree',
    observation: 'A complete fictional capture shows a credential form. A separate supplied review says no form was seen; its path and viewport were not recorded.',
    assessment: 'Link both sources to the conclusion. Their scope differs, so do not silently pick a winner or count them as independent corroboration.',
    recheck: 'The next capture timed out. It cannot resolve the earlier disagreement.', question: 'Is the credential form still present?', conditions: 'Same exact page and viewport for both source accounts.',
    source: 'Fictional supplied capture', urls: ['https://case-practice.example/offer'], routes: [],
    adequate: 'Link both attributed accounts and explain the difference in scope.', inadequate: '“Pick the account that supports the conclusion.” This hides contradictory evidence.' },
  { id: 'provider-resolved', title: 'A provider says the report is resolved',
    observation: 'A fictional provider acknowledged the earlier complaint and reported resolution. The only later capture timed out.',
    assessment: 'Keep the provider statement separate from the independent technical observation. A provider outcome is not evidence that the page was removed.',
    recheck: 'Review whether the original page condition was independently observed again. An incomplete capture cannot establish removal.', question: 'Is the reported page condition still observable?', conditions: 'Exact reported page with a complete comparable capture.',
    source: 'Fictional provider statement and page summary', urls: ['https://case-practice.example/offer'], routes: [],
    adequate: 'Keep the provider statement and unavailable independent review separate.', inadequate: '“Closed ticket proves removal.” A provider workflow status is not an independent observation.' },
] as const;
export type CasePracticeScenario = typeof CASE_PRACTICE_SCENARIOS[number]['id'];
export function casePracticeDefinition(scenario: CasePracticeScenario) {
  const definition = CASE_PRACTICE_SCENARIOS.find(item => item.id === scenario);
  if (!definition) throw new TypeError('Unknown practice scenario.');
  return definition;
}
export function casePracticeRoutes(scenario: CasePracticeScenario) {
  const definition = casePracticeDefinition(scenario);
  return PLATFORM_REPORTING_ROUTES.filter(route => (definition.routes as readonly string[]).includes(route.id));
}

export function casePracticeFeedback(record: CaseRecord, initialPinIds: readonly string[], scenario: CasePracticeScenario) {
  const decision = record.decisions.at(-1);
  return [
    { label: 'A new fact has a source and observation time', complete: record.evidencePins.some(pin => !initialPinIds.includes(pin.id) && pin.observedAt !== null && pin.source.trim().length > 0) },
    { label: scenario === 'contradictory-sources' ? 'The decision links both supplied source accounts' : 'The decision links retained evidence',
      complete: !!decision && (scenario === 'contradictory-sources'
        ? [initialPinIds[0], initialPinIds[2]].every(id => id && decision.evidencePinIds.includes(id))
        : countEvidenceLinkedCaseDecisions([decision], record.evidencePins) > 0) },
    { label: 'The incomplete later capture is recorded as unavailable', complete: record.observedEffects.reviews.some(review => review.evidencePinId === initialPinIds[1] && review.state === 'unavailable' && review.recheck != null) },
  ];
}

/** Small supplied incident examples, not collected events or a mechanism classifier. */
export function casePracticeIdentityReview() {
  const examples = [
    ['password', 'credential_entry', 'reported_action', 'A reporter says a password was entered; the account result is unconfirmed.'],
    ['approval', 'identity_prompt', 'retained_observation', 'A supplied screen requests repeated sign-in approvals; no completed approval event is retained.'],
    ['device-code', 'identity_prompt', 'reported_action', 'A reporter says a device code was entered; authorisation and account effects are unknown.'],
    ['session', 'other', 'imported_record', 'A supplied incident note alleges session theft; no account telemetry establishes that allegation.'],
    ['consent', 'consent', 'reported_action', 'A reporter says application consent was granted; the granted scope and later access are unconfirmed.'],
    ['installation', 'local_execution', 'reported_action', 'A reporter says software was installed; execution and device effects have not been independently observed.'],
    ['support-call', 'other', 'reported_action', 'A reporter says a support call requested installation; the caller’s authority and any resulting action are unknown.'],
  ] as const;
  const stages = readIncidentStages(examples.map(([id, kind, basis, description]) => ({
    id, kind, basis, description, occurredAt: id === 'approval' ? CASE_PRACTICE_OBSERVED_AT : null,
    hostname: id === 'approval' ? 'identity.example' : null, source: `Fictional supplied ${id} account`,
    reference: `practice-${id}`, referenceSha256: null, completeness: 'partial',
    limitations: ['Supplied minimised context only. No credentials, codes, tokens, authentication traces or personal account identifiers are retained.'],
  })));
  return { stages, review: reviewIncidentSequence(stages, CASE_PRACTICE_LATER_AT) };
}

function addPracticeScopeEvidence(record: CaseRecord, scenario: CasePracticeScenario): CaseRecord {
  type Fact = { label: string; value: string; source: string; hostname?: string; observedAt?: string | null; limitation: string };
  const facts: Partial<Record<CasePracticeScenario, Fact[]>> = {
    'compromised-page': [{ label: 'Separate ordinary root-page capture', value: 'The supplied https://publisher.example/ root shows ordinary articles. No old-guide path was examined in this root capture.', source: 'Fictional root-page capture', hostname: 'publisher.example', limitation: 'Root content, age and TLS do not establish the exact affected path’s safety or who controls it.' },
      { label: 'Control assessment remains unresolved', value: 'The analyst suspects an unauthorised page change but has no verified site-control evidence.', source: 'Fictional analyst assessment', observedAt: null, limitation: 'A hypothesis, not verified compromise, ownership or origin responsibility.' }],
    'hosted-object': [{ label: 'Unrelated tenant with shared infrastructure', value: 'A supplied unrelated tenant shows ordinary content on the same platform. Both tenants share an edge address, nameserver, certificate and template.', source: 'Fictional unrelated tenant capture', hostname: 'hosted.example', limitation: 'Shared platform context does not establish common control; the unrelated tenant is outside the affected response scope.' },
      { label: 'Redirect and destination remain distinct', value: 'The supplied hosted object points through a redirect service to a landing page. Registrant identity and origin responsibility are not established.', source: 'Fictional supplied navigation summary', limitation: 'No live navigation occurred; an intermediate service is not automatically the final destination or responsible origin.' }],
    'related-hosts': [{ label: 'Service A identity claim', value: 'The supplied accounts.parent.example/service-a capture claims to represent fictional Service A.', source: 'Fictional Service A capture', hostname: 'accounts.parent.example', limitation: 'Association records the supplied affected identity, not common control of sibling hosts.' },
      { label: 'Service B identity claim', value: 'The later supplied jobs.parent.example/service-b capture claims to represent fictional Service B.', source: 'Fictional Service B capture', hostname: 'jobs.parent.example', observedAt: CASE_PRACTICE_LATER_AT, limitation: 'A separate affected identity and time; the Service A evidence remains unchanged.' }],
    'ad-redirect': [{ label: 'Earlier landing page no longer reproduced', value: 'A supplied complete later capture of the earlier landing URL shows ordinary text under the stated comparable conditions.', source: 'Fictional later landing-page capture', hostname: 'landing.example', observedAt: CASE_PRACTICE_LATER_AT, limitation: 'This observation concerns only the earlier landing page, not the advertisement, replacement or harm reduction.' },
      { label: 'Replacement and advertisement remain unresolved', value: 'A supplied report names https://replacement.example/offer. Neither that replacement nor the advertisement was independently rechecked.', source: 'Fictional replacement report', observedAt: null, limitation: 'A reported replacement is not a verified navigation event, removal finding or campaign outcome.' }],
    'conditional-presentation': [{ label: 'Supplied mobile exact-path capture', value: 'The supplied mobile capture shows an offer at https://conditional.example/offer in the declared location context.', source: 'Fictional mobile exact-path capture', hostname: 'conditional.example', limitation: 'Supplied viewport, location and path conditions are declared, not independently verified.' },
      { label: 'Different desktop root capture', value: 'A supplied desktop capture at https://conditional.example/ shows ordinary text in another location.', source: 'Fictional desktop root capture', hostname: 'conditional.example', observedAt: CASE_PRACTICE_LATER_AT, limitation: 'Different path, viewport and location: this cannot refute the earlier exact-path mobile observation.' }],
    'requested-amendment': [{ label: 'Logo-only supplied image account', value: 'A supplied image shows a logo but no observed credential request or submission.', source: 'Fictional minimised image account', limitation: 'A logo alone does not establish credential collection, authority or wrongdoing. The original and any annotation must remain separate.' },
      { label: 'Observed edge, origin not established', value: 'The supplied network summary names an edge address; no origin host or responsible operator was established.', source: 'Fictional network summary', limitation: 'An edge or CDN address does not establish origin responsibility. Provider evidence requests remain distinct from prepared or delivered evidence.' }],
    'trust-claim': [{ label: 'Organisation-existence scope', value: 'A supplied directory entry records fictional organisation A. It does not mention the offer or a partnership.', source: 'Fictional directory excerpt', limitation: 'A record of organisation existence is not confirmation of this campaign or relationship.' },
      { label: 'Supplied campaign text claim', value: 'The supplied page text describes fictional organisation A as the organiser.', source: 'Fictional page text capture', hostname: 'offer.example', limitation: 'Publisher-authored campaign claim; authority has not been independently verified.' },
      { label: 'Different organiser in supplied image', value: 'The supplied image account names fictional organisation B as the organiser of the same offer.', source: 'Fictional image account', hostname: 'offer.example', limitation: 'Keep the conflicting account; textual or visual disagreement is not an automatic fraud finding.' }],
    'dependent-sources': [{ label: 'Provider explicitly reused the report', value: 'The supplied provider response states that it used the original analyst report without a new page observation.', source: 'Fictional provider response', observedAt: CASE_PRACTICE_LATER_AT, limitation: 'Documented report reuse, not a separately collected observation.' },
      { label: 'Separately documented page observation', value: 'A separately supplied capture describes the exact offer page at its stated observation time.', source: 'Fictional separate page capture', hostname: 'reported.example', limitation: 'Its separate source and time are retained; submission history alone does not verify independence.' },
      { label: 'Provider collection method unknown', value: 'Another supplied provider result does not describe how it obtained its finding.', source: 'Fictional opaque-method provider result', observedAt: null, limitation: 'Neither dependence nor independence can be inferred from the provider name or submitter.' }],
  };
  const selected = facts[scenario] ?? [];
  if (selected.length) record = updateCase([record], record.id, { evidencePins: selected.map(fact => ({
    label: fact.label, value: fact.value, source: fact.source, observedAt: fact.observedAt === undefined ? CASE_PRACTICE_OBSERVED_AT : fact.observedAt,
    ...(fact.hostname ? { observationHostname: fact.hostname } : {}), completeness: 'partial', sourceState: 'reviewed', limitations: [fact.limitation],
  })) }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'identity-actions') record = updateCase([record], record.id, { evidencePins: casePracticeIdentityReview().stages.map(stage => ({
    label: `${stage.id} context`, value: stage.description, source: stage.source, observedAt: stage.occurredAt,
    completeness: stage.completeness, sourceState: 'reviewed', limitations: [...stage.limitations],
  })) }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'related-hosts') record = updateCase([record], record.id, { brandProfileIds: ['practice-service-a', 'practice-service-b'] }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'trust-claim') {
    const textPin = record.evidencePins.find(pin => pin.label === 'Supplied campaign text claim')!;
    const imagePin = record.evidencePins.find(pin => pin.label === 'Different organiser in supplied image')!;
    for (const [statement, textStance, imageStance] of [
      ['The displayed campaign relationship may be authorised.', 'supports', 'unresolved'],
      ['The displayed campaign relationship may be misattributed.', 'unresolved', 'supports'],
    ] as const) record = updateCase([record], record.id, { assertion: { kind: 'hypothesis', statement, state: 'open',
      rationale: 'These are competing analyst explanations. The supplied claims and organisation-existence record do not decide campaign authority or fraud.',
      evidenceRelations: [{ evidencePinId: textPin.id, stance: textStance }, { evidencePinId: imagePin.id, stance: imageStance }],
    } }, CASE_PRACTICE_LATER_AT).record;
  }
  if (scenario === 'dependent-sources') record = updateCase([record], record.id, { evidenceLink: {
    fromPinId: record.evidencePins.find(pin => pin.label === 'Provider explicitly reused the report')!.id,
    toPinId: record.evidencePins[0]!.id, kind: 'derived_from', basis: 'The supplied provider response explicitly describes reuse of the original report; no new observation was claimed.',
  } }, CASE_PRACTICE_LATER_AT).record;
  return record;
}

/** Fixed fictional material, never loaded from a saved workspace or target. */
export function createCasePracticeRecord(scenario: CasePracticeScenario = 'credential-form'): CaseRecord {
  const definition = casePracticeDefinition(scenario);
  const domain = definition.urls.length ? new URL(definition.urls[0]!).hostname : 'case-practice.example';
  const initial = createCase({ domain, title: definition.title,
    note: 'Practice material only. No domain was contacted and no external report was submitted.' }, CASE_PRACTICE_OBSERVED_AT);
  const primaryLabel = scenario === 'requested-amendment' ? 'Original request and delivery context'
    : scenario === 'identity-actions' ? 'Supplied incident accounts'
      : scenario === 'dependent-sources' ? 'Original supplied report'
        : scenario === 'trust-claim' ? 'Supplied campaign claim summary' : 'Earlier page';
  const observed = updateCase([initial], initial.id, { evidencePins: [
    { label: primaryLabel, value: definition.observation,
      source: definition.source, observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: initial.domain,
      completeness: 'complete', sourceState: 'complete', limitations: [definition.assessment, 'Complete supplied summary, not comprehensive collection or proof of an allegation.'] },
    { label: 'Later capture did not complete', value: definition.recheck,
      source: 'Fictional later capture', observedAt: CASE_PRACTICE_LATER_AT, observationHostname: initial.domain,
      completeness: 'partial', sourceState: 'unavailable', limitations: ['No later page content is available. This cannot establish absence.'] },
  ] }, CASE_PRACTICE_LATER_AT);
  let result = updateCase(observed.cases, initial.id, { assertion: { kind: 'next_step',
      statement: definition.question, state: 'open',
    ...(scenario === 'credential-form' ? { evidenceRelations: [{ evidencePinId: observed.record.evidencePins[0]!.id, stance: 'unresolved' }] } : {}),
    recheck: { targetHostname: initial.domain, baselinePinId: observed.record.evidencePins[0]!.id,
      conditions: definition.conditions },
  } }, CASE_PRACTICE_LATER_AT).record;
  for (const url of definition.urls) result = updateCase([result], result.id, { incidentTarget: url }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'credential-form') {
    result = updateCase([result], result.id, { evidencePins: [
      { label: 'Reference offer text', value: 'The original fictional reference says “Review your account tools before the offer expires”. The candidate repeats this prose without a logo or brand name.',
        source: 'Fictional supplied reference page', observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: 'reference.example',
        completeness: 'complete', sourceState: 'complete', limitations: ['Text correspondence is analyst supplied, not an automated similarity score or proof of copyright entitlement.'] },
      { label: 'Advertisement distribution object', value: 'Supplied ad creative seven leads to the candidate offer; one intermediate hop is unobserved.',
        source: 'Fictional supplied advertisement', observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: 'distribution.example',
        completeness: 'partial', sourceState: 'complete', limitations: ['Later distribution has not been reviewed; unknown hops and advertiser control remain unestablished.'] },
    ] }, CASE_PRACTICE_LATER_AT).record;
  }
  if (scenario === 'contradictory-sources') result = updateCase([result], result.id, { evidencePin: {
    label: 'Separate review reported no credential form', value: 'The supplied review says no credential form was seen; its path and viewport are not recorded.',
    source: 'Fictional external review', observedAt: CASE_PRACTICE_OBSERVED_AT, completeness: 'partial',
    limitations: ['Observation scope differs or is unknown. This is not evidence that the complete capture is wrong.'],
  } }, CASE_PRACTICE_LATER_AT).record;
  if (scenario === 'provider-resolved') {
    let actions = appendCaseAction([], { type: 'platform_report', recipient: 'Fictional provider review desk' }, CASE_PRACTICE_OBSERVED_AT);
    const actionId = actions[0]!.id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst', provenance: 'fictional_practice' },
        new Date(Date.parse(CASE_PRACTICE_OBSERVED_AT) + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, { nextState: 'acknowledged', sourceClass: 'provider', provenance: 'fictional_provider_statement',
      providerOutcome: 'provider_reports_resolved', outcomeDetail: 'The fictional provider reported resolution; independent effects were not checked.' }, CASE_PRACTICE_LATER_AT);
    result = { ...result, actions };
  }
  if (scenario === 'requested-amendment') {
    result = updateCase([result], result.id, { evidencePin: {
      label: 'Requested exact-page evidence', value: 'The supplied earlier offer-page capture requests an email address and password. No credentials were entered.',
      source: 'Fictional supplied capture', observedAt: CASE_PRACTICE_OBSERVED_AT, observationHostname: result.domain,
      completeness: 'complete', sourceState: 'complete', limitations: ['Dated supplied exact-page capture only; the later capture remains unavailable and reporter authority is unverified.'],
    } }, CASE_PRACTICE_LATER_AT).record;
    result = updateCase([result], result.id, { action: { type: 'security_contact_report', recipient: 'review@example.invalid',
      contactSource: 'Fictional practice recipient; no live contact', routeObservedAt: CASE_PRACTICE_OBSERVED_AT,
      contactLimitations: ['Synthetic delivery and request only. The digest does not identify a real exported packet.'] } }, CASE_PRACTICE_OBSERVED_AT).record;
    const actionId = result.actions[0]!.id;
    for (const nextState of ['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const) result = updateCase([result], result.id, {
      actionUpdate: { id: actionId, transition: { nextState, sourceClass: 'analyst', provenance: 'fictional_practice',
        reference: nextState === 'submitted' ? `response-packet-sha256:${'a'.repeat(64)}` : null } },
    }, CASE_PRACTICE_OBSERVED_AT).record;
    result = updateCase([result], result.id, { actionUpdate: { id: actionId, transition: {
      nextState: 'acknowledged', sourceClass: 'provider', provenance: 'fictional_provider_request', providerOutcome: 'more_information_requested',
      evidenceRequest: { id: 'practice-request', packetDigestSha256: 'a'.repeat(64), summary: 'Supply the dated exact-page evidence with its limitations.',
        dueAt: null, state: 'requested', evidencePinIds: [], rationale: '', previousEventIds: [] },
    } } }, CASE_PRACTICE_LATER_AT).record;
  }
  return addPracticeScopeEvidence(result, scenario);
}

const JOURNEY_SOURCE = 'Fictional practice recipient';
export function casePracticeJourneyActions(record: CaseRecord) {
  return record.actions.filter(action => action.contactSource === JOURNEY_SOURCE)
    .sort((left, right) => Number(left.type !== 'security_contact_report') - Number(right.type !== 'security_contact_report'));
}
/** The exercise projects the same metadata-only material as the packet writer. */
export function casePracticeJourneyMaterials(record: CaseRecord) {
  return casePracticeJourneyActions(record).map((action, index) => buildCaseResponseReviewInputs(record, {
    profile: index === 0 ? 'security_contact' : 'application_platform', actionId: action.id,
    category: index === 0 ? 'Observed credential request; copied-content allegation separate' : 'Advertisement distributing the supplied offer',
    affectedParty: 'Fictional example service', abusiveUrls: [index === 0 ? 'https://case-practice.example/offer' : 'https://distribution.example/ad/7'],
    observedHarm: index === 0 ? 'The supplied exact page requested credentials; no credentials were entered. Rights authority is unverified.' : 'The supplied advertisement led to the offer; its later distribution state is unresolved.',
    observedAt: CASE_PRACTICE_OBSERVED_AT, selectedEvidencePinIds: index === 0 ? [record.evidencePins[0]!.id, record.evidencePins[2]!.id] : [record.evidencePins[3]!.id],
  }, CASE_PRACTICE_JOURNEY_AT));
}

function advancePracticeJourney(record: CaseRecord, operation: 'prepare' | 'deliver' | 'close-page', reviewed?: string): CaseRecord {
  const apply = (patch: CasePatch) => { record = updateCase([record], record.id, patch, CASE_PRACTICE_JOURNEY_AT).record; };
  const actions = casePracticeJourneyActions(record);
  if (operation === 'prepare') {
    if (actions.length) throw new Error('The fictional recipient actions are already prepared.');
    if (!countEvidenceLinkedCaseDecisions(record.decisions, record.evidencePins)) throw new Error('Record an evidence-linked conclusion before preparing the fictional copies.');
    for (const [type, recipient] of [['security_contact_report', 'page-review@example.invalid'], ['platform_report', 'ad-review@example.invalid']] as const) apply({ action: {
      type, recipient, contactSource: JOURNEY_SOURCE, routeObservedAt: CASE_PRACTICE_OBSERVED_AT,
      contactLimitations: ['Reserved fictional recipient, not a verified official route. No external authority or submission is claimed.'],
    } });
  } else if (operation === 'deliver') {
    if (actions.length !== 2 || actions.some(action => action.state !== 'drafting')) throw new Error('Prepare both fictional recipient copies before simulated delivery.');
    if (!reviewed || reviewed !== JSON.stringify(casePracticeJourneyMaterials(record))) throw new Error('The fictional recipient material changed. Review both current copies again.');
    for (const [index, action] of actions.entries()) for (const nextState of ['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const) apply({ actionUpdate: {
      id: action.id, transition: { nextState, sourceClass: 'analyst', provenance: 'fictional_practice_only',
        reference: nextState === 'submitted' ? `Practice-only ${index === 0 ? 'page' : 'ad'} delivery reference` : null,
        outcomeDetail: 'Simulated exercise event only. No packet was exported, no legal authority established and no report submitted.' },
    } });
    apply({ actionUpdate: { id: actions[0]!.id, transition: { nextState: 'acknowledged', sourceClass: 'provider',
      provenance: 'fictional_provider_statement', providerOutcome: 'accepted_for_review', reference: 'Practice-only page acknowledgement',
      outcomeDetail: 'Fictional acknowledgement, not evidence of removal.' } } });
  } else {
    if (actions.length !== 2 || actions[0]!.state !== 'acknowledged' || actions[1]!.state !== 'submitted') throw new Error('Record the separate fictional deliveries before reviewing page closure.');
    const existingPinIds = new Set(record.evidencePins.map(pin => pin.id));
    apply({ evidencePin: { label: 'Complete later exact-page review', value: 'The supplied later offer page contains ordinary text and no credential form under the same unauthenticated viewport. The advertisement was not reviewed.',
      source: record.evidencePins[0]!.source, observedAt: CASE_PRACTICE_JOURNEY_AT, observationHostname: record.domain,
      completeness: 'complete', sourceState: 'complete', limitations: ['One exact page under supplied comparable conditions; no inference about ads, mail, ownership or safety.'] } });
    const pin = record.evidencePins.find(pin => !existingPinIds.has(pin.id))!;
    apply({ observedEffectReview: { state: 'not_reproduced', observedAt: pin.observedAt!, sourceClass: 'analyst', source: pin.source,
      completeness: pin.completeness, evidencePinId: pin.id, limitations: pin.limitations,
      recheck: caseRecheckAnswerContext(record.assertions[0]!, 'comparable') } });
    apply({ actionUpdate: { id: actions[0]!.id, transition: { nextState: 'terminal', sourceClass: 'analyst', provenance: 'fictional_independent_page_review',
      rationale: 'Close only the page action after the supplied complete comparable review. Advertisement distribution remains unresolved.' } } });
    const target = caseIncidentTargets(record).find(item => item.url === 'https://case-practice.example/offer');
    if (!target) throw new Error('The exact fictional page scope is no longer active.');
    apply({ incidentTargetResolution: target.id });
  }
  return record;
}

/** One document owns the practice Case and its drafts as a single commit unit. */
export function createCasePracticeSession(scenario: CasePracticeScenario = 'credential-form') {
  let record: CaseRecord | null = createCasePracticeRecord(scenario);
  let drafts = emptyCaseDraftStore();
  const current = () => { if (!record) throw new Error('This practice session has closed.'); return record; };
  const storage: DraftStorage = {
    read: async () => { current(); return structuredClone(drafts); },
    update: async change => {
      const id = current().id;
      const next = normalizeCaseDraftStore(change(structuredClone(drafts)));
      if (next.records.some(draft => draft.caseId !== id)) throw new Error('Practice drafts belong only to the fictional Case.');
      drafts = next;
    },
  };
  return Object.freeze({
    storage,
    read: () => structuredClone(current()),
    edit(patch: CasePatch, receipt?: CaseDraftReceipt): CaseRecord {
      const before = current();
      const next = updateCase([before], before.id, patch, CASE_PRACTICE_JOURNEY_AT).record;
      const nextDrafts = receipt ? removeCaseDraft(drafts, receipt, before.id) : drafts;
      record = next; drafts = nextDrafts;
      return structuredClone(next);
    },
    journey(operation: 'prepare' | 'deliver' | 'close-page', reviewed?: string): CaseRecord {
      if (scenario !== 'credential-form') throw new Error('The connected journey belongs only to the credential-page exercise.');
      const next = advancePracticeJourney(current(), operation, reviewed);
      record = next; return structuredClone(next);
    },
    close() { record = null; drafts = emptyCaseDraftStore(); },
  });
}
