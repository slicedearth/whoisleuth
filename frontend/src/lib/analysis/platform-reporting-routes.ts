// Reviewed official reporting routes for exact platform incident URLs. This
// catalogue is static, freshness-bounded and never makes a request or submits
// a complaint. Analysts must open, verify and complete each provider process.

import type { CaseTypeId } from '../../../../packages/cases/case-workflow-metadata.mts';

export type IncidentPlatformId = 'facebook' | 'instagram' | 'linkedin' | 'telegram' | 'tiktok' | 'x' | 'youtube';
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
  state: 'found' | 'stale' | 'unsupported';
  routes: readonly PlatformReportingRoute[];
  limitation: string;
}>;

const REVIEWED_AT = '2026-09-04';
const REVIEW_AFTER = '2027-03-04';
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
]);

function route(input: Omit<PlatformReportingRoute, 'reviewedAt' | 'reviewAfter'>): PlatformReportingRoute {
  return Object.freeze({ ...input, reviewedAt: REVIEWED_AT, reviewAfter: REVIEW_AFTER });
}

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
]);

export const PLATFORM_REPORTING_RESOURCE_REFERENCES = Object.freeze([
  Object.freeze({ label: 'Meta scam reporting guidance', href: 'https://www.meta.com/safety/scam-protection-center/', description: 'Official preparation and reporting guidance for scams affecting Facebook and Instagram.' }),
  Object.freeze({ label: 'TikTok report form', href: 'https://www.tiktok.com/legal/report/feedback', description: 'Official route for reporting a TikTok account or item of content.' }),
  Object.freeze({ label: 'X report forms', href: 'https://help.x.com/en/forms', description: 'Official hub for choosing an X safety, impersonation or rights-reporting form.' }),
  Object.freeze({ label: 'Telegram reporting guidance', href: 'https://telegram.org/faq#q-theres-illegal-content-on-telegram-how-do-i-take-it-down', description: 'Official FAQ covering public-content abuse and copyright reporting routes.' }),
  Object.freeze({ label: 'YouTube reporting guidance', href: 'https://support.google.com/youtube/answer/2802027?hl=en', description: 'Official instructions for reporting a channel, video or other YouTube content.' }),
  Object.freeze({ label: 'LinkedIn content reporting guidance', href: 'https://www.linkedin.com/help/linkedin/answer/a1339420', description: 'Official instructions for reporting profiles, Pages, messages and content.' }),
]);

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
): PlatformReportingResolution {
  const platform = incidentPlatformForUrl(value);
  if (!platform) return {
    platform: null,
    state: 'unsupported',
    routes: [],
    limitation: 'No reviewed platform route matches this exact hostname. Use the provider’s current official help centre and verify the route before acting.',
  };
  const candidates = PLATFORM_REPORTING_ROUTES.filter((candidate) => candidate.platformId === platform.id);
  const selected = new Set(selectedCaseTypes);
  const routes = candidates.filter((candidate) => !candidate.caseTypes.length || candidate.caseTypes.some((type) => selected.has(type)));
  const fresh = routes.filter((candidate) => now.getTime() < Date.parse(`${candidate.reviewAfter}T00:00:00Z`));
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
    limitation: `${platform.label} matched the exact incident hostname. This identifies a possible platform reporting route, not policy breach, account ownership, legal standing or likely removal.`,
  };
}
