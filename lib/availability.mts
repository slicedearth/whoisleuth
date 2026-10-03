// Composition boundary shared by the server and serverless handlers.
// Registration authority and optional website enrichment retain separate owners.
import { featureDecision, networkFeaturePolicy } from './feature-policy.mts';
import { canonicalRegistrableDomain } from '../packages/analysis/registrable-domain.mts';
import { isValidAsciiHostname } from '../packages/contracts/domain-name.mts';
import { prepareSelectedLookupUrl } from '../packages/evidence/lookup-target.mts';
import { resolveDomainRegistration, type RegistrationOptions, type RegistrationAssessment } from './domain-registration.mts';
import { enrichWebsite, type WebsiteEnrichmentOptions } from './website-enrichment.mts';

type AvailabilityOptions = RegistrationOptions & WebsiteEnrichmentOptions;
type AvailabilityResult = RegistrationAssessment['registration'] | Awaited<ReturnType<typeof enrichWebsite>>;

async function checkDomainAvailability(domain: string, options: AvailabilityOptions = {}): Promise<AvailabilityResult> {
  options.signal?.throwIfAborted();
  const fast = options.fast === true;
  const observationHostname = fast ? domain : options.observationHostname ?? domain;
  if (options.observationHostname !== undefined && (!isValidAsciiHostname(options.observationHostname)
    || options.observationHostname !== options.observationHostname.toLowerCase()
    || canonicalRegistrableDomain(options.observationHostname) !== domain)) {
    throw new TypeError('The observation hostname must belong to the registration target.');
  }
  const selectedUrl = options.selectedUrl === undefined ? undefined : prepareSelectedLookupUrl(options.selectedUrl, observationHostname);
  const featurePolicy = options.featurePolicy || networkFeaturePolicy();
  const websiteProbeEnabled = featureDecision('website_probe', featurePolicy).enabled;
  if (selectedUrl && (fast || !websiteProbeEnabled)) throw new TypeError('Selected URL collection requires an enabled Deep website observation.');
  const assessment = await resolveDomainRegistration(domain, options, featurePolicy);
  const { registration } = assessment;
  if (fast || registration.state !== 'registered' && !selectedUrl) return registration;
  return enrichWebsite({ domain, observationHostname, selectedUrl, ...assessment }, options, featurePolicy);
}

export { checkDomainAvailability };
export { checkDnsDelegation, isPrivacyProtected } from './domain-registration.mts';
export { fetchHomepage, deriveWebsiteActivity, forSaleRedirectSignal } from './website-enrichment.mts';
export { parseRegistryDate as parseWhoisDate } from './registry-dates.mts';
