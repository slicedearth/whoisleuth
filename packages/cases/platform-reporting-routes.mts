// Reviewed official reporting routes for exact platform incident URLs. This
// catalogue is static, freshness-bounded and never makes a request or submits
// a complaint. Analysts must open, verify and complete each provider process.

import type { CaseTypeId } from './case-workflow-metadata.mts';

export type IncidentPlatformId = 'facebook' | 'instagram' | 'linkedin' | 'telegram' | 'tiktok' | 'x' | 'youtube' | 'shopify' | 'google_play' | 'google_drive' | 'google_ads';
export type PlatformReportingChannel = 'email' | 'url';

export type PlatformReportingRoute = Readonly<{
  id: string;
  platformId: IncidentPlatformId;
  platformLabel: string;
  label: string;
  channel: PlatformReportingChannel;
  contact: string;
  guidanceUrl: string;
  caseTypes: readonly CaseTypeId[];
  reviewedAt: string;
  reviewAfter: string;
  preparation: readonly string[];
  privacyNote: string;
}>;

export type IncidentPlatform = Readonly<{
  id: IncidentPlatformId;
  label: string;
  hosts: readonly string[];
}>;

export type PlatformReportingResolution = Readonly<{
  platform: IncidentPlatform | null;
  state: 'found' | 'stale' | 'unsupported' | 'unavailable';
  routes: readonly PlatformReportingRoute[];
  limitation: string;
}>;

const REVIEWED_AT = '2026-09-04';
const REVIEW_AFTER = '2027-03-04';
const REVIEW_WARNING_DAYS = 30;
const GENERAL_TYPES: readonly CaseTypeId[] = Object.freeze([]);
const IP_TYPES: readonly CaseTypeId[] = Object.freeze(['trademark_infringement', 'copyright_infringement', 'counterfeit_goods']);

export const INCIDENT_PLATFORMS: readonly IncidentPlatform[] = Object.freeze([
  Object.freeze({ id: 'facebook', label: 'Facebook', hosts: Object.freeze(['facebook.com', 'fb.com']) }),
  Object.freeze({ id: 'instagram', label: 'Instagram', hosts: Object.freeze(['instagram.com']) }),
  Object.freeze({ id: 'tiktok', label: 'TikTok', hosts: Object.freeze(['tiktok.com']) }),
  Object.freeze({ id: 'x', label: 'X', hosts: Object.freeze(['x.com', 'twitter.com']) }),
  Object.freeze({ id: 'telegram', label: 'Telegram', hosts: Object.freeze(['t.me', 'telegram.me', 'telegram.org']) }),
  Object.freeze({ id: 'youtube', label: 'YouTube', hosts: Object.freeze(['youtube.com', 'youtu.be']) }),
  Object.freeze({ id: 'linkedin', label: 'LinkedIn', hosts: Object.freeze(['linkedin.com']) }),
  Object.freeze({ id: 'shopify', label: 'Shopify storefront', hosts: Object.freeze(['myshopify.com']) }),
  // Match product hosts, never all Google properties or custom storefronts.
  Object.freeze({ id: 'google_play', label: 'Google Play listing', hosts: Object.freeze(['play.google.com']) }),
  Object.freeze({ id: 'google_drive', label: 'Google hosted file or form', hosts: Object.freeze(['docs.google.com', 'drive.google.com', 'forms.gle']) }),
  Object.freeze({ id: 'google_ads', label: 'Google advertisement', hosts: Object.freeze([]) }),
]);

function route(input: Omit<PlatformReportingRoute, 'reviewedAt' | 'reviewAfter'> & Partial<Pick<PlatformReportingRoute, 'reviewedAt' | 'reviewAfter'>>): PlatformReportingRoute {
  return Object.freeze({ reviewedAt: REVIEWED_AT, reviewAfter: REVIEW_AFTER, ...input });
}

const ADDITIONAL_REVIEW = Object.freeze({ reviewedAt: '2026-10-03', reviewAfter: '2027-04-03' });

export const PLATFORM_REPORTING_ROUTES: readonly PlatformReportingRoute[] = Object.freeze([
  route({
    id: 'facebook-safety-report', platformId: 'facebook', platformLabel: 'Facebook', label: 'Review scam and content reporting', channel: 'url',
    contact: 'https://www.meta.com/safety/scam-protection-center/', guidanceUrl: 'https://www.meta.com/safety/scam-protection-center/', caseTypes: GENERAL_TYPES,
    preparation: ['Exact Facebook profile, Page, post or message URL', 'Screenshots and observation time', 'Reason the content may breach the selected policy'],
    privacyNote: 'The provider may require sign-in and may collect reporter, identity or complaint details under its own process.',
  }),
  route({
    id: 'facebook-rights-report', platformId: 'facebook', platformLabel: 'Facebook', label: 'Review intellectual-property reporting', channel: 'url',
    contact: 'https://www.facebook.com/help/399224883474207', guidanceUrl: 'https://www.facebook.com/help/399224883474207', caseTypes: IP_TYPES,
    preparation: ['Exact infringing content URL', 'Rights-owner and representative details', 'Trademark registration or identification of the copyrighted work'],
    privacyNote: 'Rights complaints can be legal notices. The provider may share reporter details with the affected account or publisher.',
  }),
  route({
    id: 'instagram-safety-report', platformId: 'instagram', platformLabel: 'Instagram', label: 'Review scam and content reporting', channel: 'url',
    contact: 'https://www.meta.com/safety/scam-protection-center/', guidanceUrl: 'https://www.meta.com/safety/scam-protection-center/', caseTypes: GENERAL_TYPES,
    preparation: ['Exact Instagram profile, post, reel or message URL', 'Screenshots and observation time', 'Reason the content may breach the selected policy'],
    privacyNote: 'The provider may require sign-in and may collect reporter, identity or complaint details under its own process.',
  }),
  route({
    id: 'instagram-rights-report', platformId: 'instagram', platformLabel: 'Instagram', label: 'Review intellectual-property reporting', channel: 'url',
    contact: 'https://www.facebook.com/help/354736791367645/', guidanceUrl: 'https://www.facebook.com/help/354736791367645/', caseTypes: IP_TYPES,
    preparation: ['Exact infringing content URL', 'Rights-owner and representative details', 'Trademark registration or identification of the copyrighted work'],
    privacyNote: 'Rights complaints can be legal notices. The provider may share reporter details with the affected account or publisher.',
  }),
  route({
    id: 'tiktok-report', platformId: 'tiktok', platformLabel: 'TikTok', label: 'Report an account or content', channel: 'url',
    contact: 'https://www.tiktok.com/legal/report/feedback', guidanceUrl: 'https://support.tiktok.com/en/safety-hc/report-a-problem/report-an-impersonation-account', caseTypes: GENERAL_TYPES,
    preparation: ['Exact TikTok profile or content URL', 'Username and observation time', 'Screenshots and a concise policy explanation'],
    privacyNote: 'The form asks for contact information and may request identity evidence for an impersonation complaint.',
  }),
  route({
    id: 'tiktok-trademark', platformId: 'tiktok', platformLabel: 'TikTok', label: 'Submit a trademark or counterfeit report', channel: 'url',
    contact: 'https://www.tiktok.com/legal/report/Trademark', guidanceUrl: 'https://www.tiktok.com/legal/page/global/copyright-policy/en', caseTypes: Object.freeze(['trademark_infringement', 'counterfeit_goods']),
    preparation: ['Exact infringing content URL', 'Trademark owner, registration and jurisdiction', 'Explanation of confusing use or counterfeit activity'],
    privacyNote: 'Only a rights holder or authorised representative should submit a rights complaint; supplied details may be disclosed as part of the process.',
  }),
  route({
    id: 'tiktok-copyright', platformId: 'tiktok', platformLabel: 'TikTok', label: 'Submit a copyright report', channel: 'url',
    contact: 'https://www.tiktok.com/legal/report/Copyright', guidanceUrl: 'https://www.tiktok.com/legal/page/global/copyright-policy/en', caseTypes: Object.freeze(['copyright_infringement']),
    preparation: ['Exact infringing content URL', 'Identification and location of the original work', 'Rights-owner or authorised representative details'],
    privacyNote: 'A copyright complaint is a legal process. Review the provider notice before sharing personal or rights-owner information.',
  }),
  route({
    id: 'x-reporting-hub', platformId: 'x', platformLabel: 'X', label: 'Choose an official report form', channel: 'url',
    contact: 'https://help.x.com/en/forms', guidanceUrl: 'https://help.x.com/en/rules-and-policies/x-report-violation', caseTypes: GENERAL_TYPES,
    preparation: ['Exact profile or post URL', 'Issue type and observation time', 'Supporting evidence and the reporter’s authority'],
    privacyNote: 'X states that parts of a report may be shared with third parties, including the affected account.',
  }),
  route({
    id: 'telegram-abuse', platformId: 'telegram', platformLabel: 'Telegram', label: 'Report public illegal or abusive content', channel: 'email',
    contact: 'abuse@telegram.org', guidanceUrl: 'https://telegram.org/faq#q-theres-illegal-content-on-telegram-how-do-i-take-it-down', caseTypes: GENERAL_TYPES,
    preparation: ['Exact public t.me link or public username', 'Reason for the report', 'Observation time and concise supporting material'],
    privacyNote: 'Telegram distinguishes public content from private chats and groups. Review the FAQ before sending complaint details by email.',
  }),
  route({
    id: 'telegram-copyright', platformId: 'telegram', platformLabel: 'Telegram', label: 'Report public copyright infringement', channel: 'email',
    contact: 'dmca@telegram.org', guidanceUrl: 'https://telegram.org/faq#q-a-bot-or-channel-is-infringing-on-my-copyright-what-do-i-do', caseTypes: Object.freeze(['copyright_infringement']),
    preparation: ['Exact public bot, channel, group, sticker or content link', 'Identification of the original work', 'Rights-owner or authorised representative details'],
    privacyNote: 'Telegram says this route is for public content and should be used by the copyright owner or an authorised representative.',
  }),
  route({
    id: 'youtube-report', platformId: 'youtube', platformLabel: 'YouTube', label: 'Report a channel or content', channel: 'url',
    contact: 'https://support.google.com/youtube/answer/2802027?hl=en', guidanceUrl: 'https://support.google.com/youtube/answer/2801947?hl=en', caseTypes: GENERAL_TYPES,
    preparation: ['Exact channel, video, Short, post or comment URL', 'Specific policy concern', 'Timestamps or supporting details where relevant'],
    privacyNote: 'Community reports and legal removal requests are different processes. Select the route that matches the evidence and your authority.',
  }),
  route({
    id: 'youtube-trademark', platformId: 'youtube', platformLabel: 'YouTube', label: 'Review trademark reporting', channel: 'url',
    contact: 'https://support.google.com/youtube/answer/6154218?hl=en', guidanceUrl: 'https://support.google.com/youtube/answer/6154218?hl=en', caseTypes: Object.freeze(['trademark_infringement', 'counterfeit_goods']),
    preparation: ['Exact channel or video URL', 'Trademark registration and jurisdiction', 'Explanation of likely confusion or counterfeit activity'],
    privacyNote: 'YouTube may forward a trademark complaint to the uploader. Review the official notice before submitting personal details.',
  }),
  route({
    id: 'linkedin-report', platformId: 'linkedin', platformLabel: 'LinkedIn', label: 'Report a profile, Page or content', channel: 'url',
    contact: 'https://www.linkedin.com/help/linkedin/answer/a1339420', guidanceUrl: 'https://www.linkedin.com/help/linkedin/answer/a1338436', caseTypes: GENERAL_TYPES,
    preparation: ['Exact profile, Page, post or message URL', 'Reason for the report', 'Supporting evidence and reporter authority'],
    privacyNote: 'LinkedIn may forward a rights notice, including claimant contact information, to the affected member.',
  }),
  route({ ...ADDITIONAL_REVIEW,
    id: 'shopify-merchant', platformId: 'shopify', platformLabel: 'Shopify', label: 'Choose a merchant abuse route', channel: 'url',
    contact: 'https://www.shopify.com/legal/tools/report-an-issue/report-a-merchant', guidanceUrl: 'https://www.shopify.com/legal/tools/report-an-issue/report-a-merchant', caseTypes: GENERAL_TYPES,
    preparation: ['Exact store and listing URLs with evidence of Shopify involvement', 'Dated observations supporting fraud or malicious practices, not resemblance alone', 'Choose fraud, malicious practices or an order complaint separately; an order process is not an abuse waiting period'],
    privacyNote: 'Review the selected form before sharing reporter details. Do not buy an item or make a test payment. Reporting does not guarantee suspension, refund or removal.',
  }),
  route({ ...ADDITIONAL_REVIEW,
    id: 'shopify-rights', platformId: 'shopify', platformLabel: 'Shopify', label: 'Review copyright or trademark grounds', channel: 'url',
    contact: 'https://www.shopify.com/legal/tools/report-an-issue/intellectual-property', guidanceUrl: 'https://www.shopify.com/legal/tools/report-an-issue/intellectual-property', caseTypes: IP_TYPES,
    preparation: ['Exact allegedly infringing listing or page and the original work or mark', 'Rights-owner or authorised representative review of the relevant copyright, trademark or trade-dress basis', 'Select the applicable rights process separately from fraud; copied material does not establish legal entitlement'],
    privacyNote: 'Rights notices can require legal declarations and disclosure of claimant details. Verify the current notice and your authority; WHOISleuth neither makes declarations nor submits it.',
  }),
  route({ ...ADDITIONAL_REVIEW,
    id: 'google-play-report', platformId: 'google_play', platformLabel: 'Google Play', label: 'Review app or developer reporting', channel: 'url',
    contact: 'https://support.google.com/googleplay/answer/2853570?hl=en', guidanceUrl: 'https://support.google.com/googleplay/answer/2853570?hl=en', caseTypes: GENERAL_TYPES,
    preparation: ['Exact app listing, package identifier and developer identity as displayed', 'Dated listing evidence and the specific policy concern; do not install or authenticate to reproduce it', 'Keep the download website and backend separate; use the linked legal process only with the required rights or legal authority'],
    privacyNote: 'Flagging, a public review and a legal request are different processes. Review account/contact disclosure in the chosen route. A listing action does not establish backend remediation.',
  }),
  route({ ...ADDITIONAL_REVIEW,
    id: 'google-drive-report', platformId: 'google_drive', platformLabel: 'Google hosted content', label: 'Review file or form abuse reporting', channel: 'url',
    contact: 'https://support.google.com/legal/answer/2463296?hl=en', guidanceUrl: 'https://support.google.com/legal/answer/2463296?hl=en', caseTypes: GENERAL_TYPES,
    preparation: ['Exact file, document, form or tenant object, not the entire shared platform domain', 'Dated supplied evidence and relevant viewing conditions; do not submit credentials or form responses', 'Use the official object-report instructions for your viewer/editor role; legal rights requests are separate'],
    privacyNote: 'The provider process may collect account, reporter and complaint details. Do not share private access tokens. Google states that reporting does not guarantee removal or other action.',
  }),
  route({ ...ADDITIONAL_REVIEW,
    id: 'google-ad-report', platformId: 'google_ads', platformLabel: 'Google advertising', label: 'Review an exact advertisement', channel: 'url',
    contact: 'https://support.google.com/My-Ad-Center-Help/answer/13861201?hl=en', guidanceUrl: 'https://support.google.com/My-Ad-Center-Help/answer/13861201?hl=en', caseTypes: GENERAL_TYPES,
    preparation: ['Identify the particular ad from its supplied More/Info or AdChoices context', 'Dated creative, displayed advertiser and observed redirect/landing evidence; retain unknown hops as unknown', 'Choose the exact ad in the official process; a changed landing page does not close the distribution object'],
    privacyNote: 'Google says signed-out reporters need an email address. Reporting an ad does not block it. Review the form before sharing details; search visibility and source hosting are separate scopes.',
  }),
]);

export const PLATFORM_REPORTING_RESOURCE_REFERENCES = Object.freeze([
  Object.freeze({ label: 'Meta scam reporting guidance', href: 'https://www.meta.com/safety/scam-protection-center/', description: 'Official preparation and reporting guidance for scams affecting Facebook and Instagram.' }),
  Object.freeze({ label: 'TikTok report form', href: 'https://www.tiktok.com/legal/report/feedback', description: 'Official route for reporting a TikTok account or item of content.' }),
  Object.freeze({ label: 'X report forms', href: 'https://help.x.com/en/forms', description: 'Official hub for choosing an X safety, impersonation or rights-reporting form.' }),
  Object.freeze({ label: 'Telegram reporting guidance', href: 'https://telegram.org/faq#q-theres-illegal-content-on-telegram-how-do-i-take-it-down', description: 'Official FAQ covering public-content abuse and copyright reporting routes.' }),
  Object.freeze({ label: 'YouTube reporting guidance', href: 'https://support.google.com/youtube/answer/2802027?hl=en', description: 'Official instructions for reporting a channel, video or other YouTube content.' }),
  Object.freeze({ label: 'LinkedIn content reporting guidance', href: 'https://www.linkedin.com/help/linkedin/answer/a1339420', description: 'Official instructions for reporting profiles, Pages, messages and content.' }),
  ...PLATFORM_REPORTING_ROUTES.filter(item => item.reviewedAt === ADDITIONAL_REVIEW.reviewedAt).map(item => Object.freeze({
    label: `${item.platformLabel}: ${item.label}`, href: item.guidanceUrl,
    description: `Reviewed ${item.reviewedAt}; recheck before ${item.reviewAfter}. ${item.preparation[0]}`,
  })),
]);

export function platformReportingCatalogueHealth(now: Date = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Platform reporting-route health requires a valid review time.');
  }
  const reviewedAt = `${PLATFORM_REPORTING_ROUTES.map(item => item.reviewedAt).sort()[0]}T00:00:00.000Z`;
  const reviewAfter = `${PLATFORM_REPORTING_ROUTES.map(item => item.reviewAfter).sort()[0]}T00:00:00.000Z`;
  const unavailableRouteCount = PLATFORM_REPORTING_ROUTES.filter(item => now.getTime() < Date.parse(item.reviewedAt)).length;
  const staleRouteCount = PLATFORM_REPORTING_ROUTES.filter(item => now.getTime() >= Date.parse(item.reviewAfter)).length;
  const reviewedMs = Date.parse(reviewedAt);
  const reviewAfterMs = Date.parse(reviewAfter);
  const warningMs = reviewAfterMs - (REVIEW_WARNING_DAYS * 86_400_000);
  const state = now.getTime() < reviewedMs
    ? 'unavailable'
    : now.getTime() >= reviewAfterMs
      ? 'stale'
      : unavailableRouteCount || now.getTime() >= warningMs
        ? 'limited'
        : 'current';
  return Object.freeze({
    state,
    reviewedAt,
    reviewAfter,
    ageDays: now.getTime() < reviewedMs ? null : Math.floor((now.getTime() - reviewedMs) / 86_400_000),
    reviewDueInDays: Math.ceil((reviewAfterMs - now.getTime()) / 86_400_000),
    routeCount: PLATFORM_REPORTING_ROUTES.length,
    unavailableRouteCount,
    staleRouteCount,
    currentRouteCount: PLATFORM_REPORTING_ROUTES.length - unavailableRouteCount - staleRouteCount,
    latestReviewedAt: `${PLATFORM_REPORTING_ROUTES.map(item => item.reviewedAt).sort().at(-1)}T00:00:00.000Z`,
  });
}

function matchesHost(hostname: string, roots: readonly string[]): boolean {
  return roots.some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

export function incidentPlatformForUrl(value: unknown): IncidentPlatform | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    return INCIDENT_PLATFORMS.find((platform) => matchesHost(hostname, platform.hosts)) ?? null;
  } catch {
    return null;
  }
}

export function resolvePlatformReportingRoutes(
  value: unknown,
  selectedCaseTypes: readonly string[],
  now: Date = new Date(),
  explicitPlatformId?: IncidentPlatformId,
): PlatformReportingResolution {
  let validUrl = false;
  try { const parsed = new URL(typeof value === 'string' ? value : ''); validUrl = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { /* no route for invalid incident material */ }
  const platform = validUrl && explicitPlatformId
    ? INCIDENT_PLATFORMS.find(item => item.id === explicitPlatformId) ?? null
    : incidentPlatformForUrl(value);
  if (!platform) return {
    platform: null,
    state: 'unsupported',
    routes: [],
    limitation: 'No reviewed platform route matches this exact hostname. Use the provider’s current official help centre and verify the route before acting.',
  };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return {
    platform,
    state: 'unavailable',
    routes: [],
    limitation: 'The review clock is unavailable. Platform reporting-route freshness could not be evaluated.',
  };
  const candidates = PLATFORM_REPORTING_ROUTES.filter((candidate) => candidate.platformId === platform.id);
  const selected = new Set(selectedCaseTypes);
  const routes = candidates.filter((candidate) => !candidate.caseTypes.length || candidate.caseTypes.some((type) => selected.has(type)));
  const futureReview = routes.some((candidate) => now.getTime() < Date.parse(`${candidate.reviewedAt}T00:00:00Z`));
  const fresh = routes.filter((candidate) => now.getTime() >= Date.parse(`${candidate.reviewedAt}T00:00:00Z`)
    && now.getTime() < Date.parse(`${candidate.reviewAfter}T00:00:00Z`));
  if (!fresh.length && (futureReview || !routes.length)) return {
    platform,
    state: 'unavailable',
    routes: [],
    limitation: `No reviewed ${platform.label} route matches the selected Case types within its review window at this time.`,
  };
  if (!fresh.length) return {
    platform,
    state: 'stale',
    routes: [],
    limitation: `The reviewed ${platform.label} routes reached their recheck date. Verify current official guidance before using a contact or form.`,
  };
  return {
    platform,
    state: 'found',
    routes: fresh,
    limitation: `${platform.label} ${explicitPlatformId ? 'was selected by the analyst for this incident; provider involvement must be evidenced' : 'matched the exact incident hostname'}. This identifies a possible platform reporting route, not policy breach, account ownership, legal standing or likely removal.`,
  };
}
