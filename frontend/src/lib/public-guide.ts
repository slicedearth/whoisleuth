export type PublicGuideStep = {
  id: string;
  label: string;
  href: string;
};

export type PublicGuideGoal = {
  id: string;
  title: string;
  summary: string;
  steps: readonly PublicGuideStep[];
};

export type GuideEntry = {
  id: string;
  name: string;
  useWhen: string;
  input: string;
  result: string;
  next: string;
};

export type GuideDefinition = {
  term: string;
  definition: string;
};

export type GuideFaq = {
  question: string;
  answer: string;
};

export const publicGuideGoals: readonly PublicGuideGoal[] = Object.freeze([
  Object.freeze({
    id: 'inspect-one-domain',
    title: 'Inspect one domain',
    summary: 'Check registration first, then review DNS, certificate and website context.',
    steps: Object.freeze([
      Object.freeze({ id: 'lookup', label: 'Lookup', href: '#tool-lookup' }),
      Object.freeze({ id: 'review-sources', label: 'Review sources', href: '#results' }),
      Object.freeze({ id: 'save-evidence', label: 'Save useful evidence', href: '#tool-monitor' }),
    ]),
  }),
  Object.freeze({
    id: 'find-brand-lookalikes',
    title: 'Find brand lookalikes',
    summary: 'Define the official brand, find candidates and focus deeper checks on the most useful leads.',
    steps: Object.freeze([
      Object.freeze({ id: 'brands', label: 'Brands', href: '#tool-brands' }),
      Object.freeze({ id: 'discover', label: 'Discover', href: '#tool-discover' }),
      Object.freeze({ id: 'bulk', label: 'Bulk', href: '#tool-bulk' }),
      Object.freeze({ id: 'lookup', label: 'Lookup', href: '#tool-lookup' }),
    ]),
  }),
  Object.freeze({
    id: 'track-important-findings',
    title: 'Track important findings',
    summary: 'Keep a case or watchlist and compare later observations without treating a failed check as absence.',
    steps: Object.freeze([
      Object.freeze({ id: 'save', label: 'Save', href: '#tool-monitor' }),
      Object.freeze({ id: 'monitor', label: 'Monitor', href: '#tool-monitor' }),
      Object.freeze({ id: 'review-changes', label: 'Review changes', href: '#tool-monitor' }),
    ]),
  }),
]);

export const toolGuides: readonly GuideEntry[] = Object.freeze([
  Object.freeze({ id: 'lookup', name: 'Lookup', useWhen: 'You have one domain, IP address or ASN to investigate.', input: 'Enter one target and choose Fast or Deep. Deep is the default; optional security.txt and external intelligence sources run only when selected.', result: 'A bounded evidence map links separately attributed sources to their detail, while an ordered lifecycle shows dated registry and certificate events. Long source records and secondary Deep evidence start collapsed while their headings, states, and summaries remain visible.', next: 'Use the source map and lifecycle to review conflicting, partial, unavailable, or time-sensitive evidence, then save a useful domain finding to Monitor.' }),
  Object.freeze({ id: 'brands', name: 'Brands', useWhen: 'You want searches and comparisons to reflect an official brand.', input: 'Add official domains, product names, preferred domain endings and known trusted infrastructure.', result: 'A browser-local profile provides a comparison boundary for discovery and analysis.', next: 'Open Discover to generate or find related candidates.' }),
  Object.freeze({ id: 'discover', name: 'Discover', useWhen: 'You want possible lookalikes or names observed in public certificate logs.', input: 'Choose a Brand Profile or enter a focused keyword. Use a preset or select exact mutation families; optional custom dictionary terms stay local to the current tab and can replace the first or last token of a hyphenated seed. Custom selection also offers an advanced, opt-in two-character Unicode family that is never enabled by a preset.', result: 'Generated and certificate-log candidates retain their source and limits. Internationalised candidates show both their DNS-safe ASCII form and readable Unicode form.', next: 'Filter and sort the bounded candidate set, then send a focused shortlist to Bulk rather than scanning every possible name.' }),
  Object.freeze({ id: 'bulk', name: 'Bulk', useWhen: 'You need to compare several candidate domains consistently.', input: 'Paste domains or accept a shortlist from Discover. Bulk Deep uses compact WHOIS, DNS, website, TLS, and mail evidence rather than the complete single-domain response.', result: 'Fast or Deep checks prioritise candidates and expose related infrastructure already observed in the scan. A bounded Risk/Opportunity matrix summarizes the current filters while the table retains every result.', next: 'Open the strongest or most uncertain leads in Lookup for complete source-level review and optional enrichments.' }),
  Object.freeze({ id: 'monitor', name: 'Monitor', useWhen: 'You want to retain a finding, document a decision or compare later observations.', input: 'Save a case or watchlist from Lookup or Bulk.', result: 'Browser-local timelines, notes, relationships and exports keep the review trail together. The activity heatmap covers retained watchlist checks only and does not imply uninterrupted monitoring.', next: 'Rescan deliberately or use optional hosted monitoring when it is configured.' }),
]);

export const referenceGuides: readonly GuideEntry[] = Object.freeze([
  Object.freeze({ id: 'registry-support', name: 'Registry support', useWhen: 'You want to know how a domain ending is handled before relying on a result.', input: 'Search for a domain ending such as com or au.', result: 'The catalogue shows tested WHOIS parsing, query rules and known RDAP access limits.', next: 'Treat a limitation as a source constraint, not evidence that a domain is available.' }),
]);

export const resultStates: readonly GuideDefinition[] = Object.freeze([
  Object.freeze({ term: 'Observed', definition: 'The named source returned usable evidence. Read the source label and collection time before interpreting it.' }),
  Object.freeze({ term: 'Partial', definition: 'Some usable evidence was collected, but a stated limit or failed step prevents a complete result.' }),
  Object.freeze({ term: 'Not found', definition: 'The named source authoritatively reported no matching record or file within its own scope. It does not establish overall absence or safety.' }),
  Object.freeze({ term: 'Skipped', definition: 'The selected mode or policy deliberately did not run this source. No negative conclusion should be drawn.' }),
  Object.freeze({ term: 'Disabled', definition: 'Deployment policy prevents this source from running. The state describes configuration, not the target.' }),
  Object.freeze({ term: 'Rate limited', definition: 'A source or hosted-operation budget temporarily refused the request. Retry guidance or source detail may be available.' }),
  Object.freeze({ term: 'Unsupported', definition: 'The source or operation is not available for this target. It is not a negative finding.' }),
  Object.freeze({ term: 'Unavailable', definition: 'A configured source could not be reached or used. Try again later or review the source detail.' }),
  Object.freeze({ term: 'Inconclusive', definition: 'The available evidence cannot support a reliable yes or no answer.' }),
]);

export const glossaryTerms: readonly GuideDefinition[] = Object.freeze([
  Object.freeze({ term: 'ASN', definition: 'An Autonomous System Number identifies a network that announces groups of IP addresses.' }),
  Object.freeze({ term: 'Authoritative evidence', definition: 'Evidence from the source responsible for a decision in its scope, such as a registry response used to assess domain existence.' }),
  Object.freeze({ term: 'Browser-local', definition: 'Saved data remains in this browser profile unless you deliberately export or configure a hosted feature.' }),
  Object.freeze({ term: 'CAA', definition: 'A DNS record that states which certificate authorities may issue certificates for a domain.' }),
  Object.freeze({ term: 'Case', definition: 'A saved analyst record containing selected evidence, notes, status and observation history.' }),
  Object.freeze({ term: 'Certificate Transparency', definition: 'Public logs of issued TLS certificates. A log timestamp records certificate observation, not website activation or maliciousness.' }),
  Object.freeze({ term: 'Confusable', definition: 'A character or label that can look similar to another, including internationalised domain characters.' }),
  Object.freeze({ term: 'Console', definition: 'The complete signed-in area containing the Dashboard, investigation tools, and reference pages.' }),
  Object.freeze({ term: 'Dashboard', definition: 'The signed-in starting page for beginning an investigation, continuing saved work, or opening a guide.' }),
  Object.freeze({ term: 'Deep lookup', definition: 'A broader lookup that can add WHOIS, DNS, website, TLS, platform indicators, observed network context and optional enrichment checks to RDAP.' }),
  Object.freeze({ term: 'DKIM', definition: 'A mail authentication method that lets a domain sign outgoing messages.' }),
  Object.freeze({ term: 'DMARC', definition: 'A mail policy that builds on SPF and DKIM and can tell receivers how to handle failures.' }),
  Object.freeze({ term: 'DNS', definition: 'The system that maps domain names to addresses and other records such as mail servers and nameservers.' }),
  Object.freeze({ term: 'DNSSEC', definition: 'Cryptographic DNS signatures that help resolvers verify that answers have not been altered.' }),
  Object.freeze({ term: 'Fast lookup', definition: 'A lower-request lookup intended for quick triage. It keeps the authoritative RDAP path and omits deeper collection.' }),
  Object.freeze({ term: 'Favicon', definition: 'A small website icon. Exact or similar icons can be a useful lead, but do not prove common ownership.' }),
  Object.freeze({ term: 'Hosted monitoring', definition: 'An optional scheduled service that stores compact encrypted watchlist evidence outside the browser.' }),
  Object.freeze({ term: 'IDN and Punycode', definition: 'Internationalised domain names can contain non-ASCII characters. Punycode is the DNS-safe ASCII form beginning with xn--. Review both forms together.' }),
  Object.freeze({ term: 'IP address', definition: 'A numeric network address used by an internet-connected host.' }),
  Object.freeze({ term: 'MX', definition: 'A DNS record that identifies the servers expected to receive email for a domain.' }),
  Object.freeze({ term: 'Nameserver', definition: 'A DNS server responsible for publishing records for a domain.' }),
  Object.freeze({ term: 'Observed network context', definition: 'Registration details for one public IP address observed during a deep lookup. Shared infrastructure means it may not identify the origin host.' }),
  Object.freeze({ term: 'Opportunity score', definition: 'An explainable prioritisation aid for apparently available generated candidates. It is not a valuation or purchase recommendation.' }),
  Object.freeze({ term: 'Page identity', definition: 'Bounded static page characteristics such as titles, forms, resource hosts, tracking identifiers, and fingerprints used for comparison.' }),
  Object.freeze({ term: 'Passive security posture', definition: 'Review signals derived from already-collected HTTP, page, TLS, DNSSEC, and CAA evidence. They are not confirmed vulnerabilities.' }),
  Object.freeze({ term: 'Provenance', definition: 'The source, collection time, method, completeness, and limitations attached to an observation or derived finding.' }),
  Object.freeze({ term: 'RDAP', definition: 'A structured registration-data protocol used by registries and some registrars.' }),
  Object.freeze({ term: 'Registrant', definition: 'The person or organisation recorded as holding the domain registration. Public data may be redacted or privacy-protected.' }),
  Object.freeze({ term: 'Registrar', definition: 'The company through which a registrant manages a domain registration.' }),
  Object.freeze({ term: 'Registry', definition: 'The operator responsible for the registration database for a domain ending.' }),
  Object.freeze({ term: 'Risk score', definition: 'An explainable prioritisation aid based on observed signals. It is not a verdict of maliciousness.' }),
  Object.freeze({ term: 'SAN', definition: 'A certificate Subject Alternative Name listing a hostname or other identity covered by that certificate.' }),
  Object.freeze({ term: 'security.txt', definition: 'An optional website file that can publish security contacts and policies. Its presence does not authorize testing or prove that a contact is monitored.' }),
  Object.freeze({ term: 'SPF', definition: 'A DNS-based mail policy that lists systems allowed to send mail for a domain.' }),
  Object.freeze({ term: 'Technology indicator', definition: 'A curated, evidence-backed hint about software or delivery services derived from captured headers, metadata, resources, or static HTML.' }),
  Object.freeze({ term: 'TLS certificate', definition: 'A certificate used to authenticate an encrypted connection. Its presence does not prove that a website is safe or active.' }),
  Object.freeze({ term: 'Unicode confusable', definition: 'A Unicode character or label that resembles another string. Similarity is a review lead, not proof of impersonation, ownership, activity, or harm.' }),
  Object.freeze({ term: 'Watchlist', definition: 'A saved set of domains whose compact evidence can be compared across later checks.' }),
  Object.freeze({ term: 'WHOIS', definition: 'A text-based registration-data service whose format and availability vary between registries.' }),
  Object.freeze({ term: 'Workspace archive', definition: 'A versioned local backup that combines supported browser-saved records. It is a file format, not a separate area of the interface.' }),
]);

export const guideFaqs: readonly GuideFaq[] = Object.freeze([
  Object.freeze({ question: 'Can WHOISleuth identify a website platform or hosting provider?', answer: 'Deep Lookup can show curated indicators for common content, commerce, site-building, framework, web-server, and delivery technologies from the response it already captured. It separately maps one observed public address to its registered network. Proxies, delivery networks, shared infrastructure, and concealed software mean neither view necessarily identifies the origin host or hosting account.' }),
  Object.freeze({ question: 'Does WHOISleuth decide whether a domain is malicious?', answer: 'No. It organises observed evidence and provides an explainable Risk score for prioritisation. An analyst must review the sources and context.' }),
  Object.freeze({ question: 'Why are owner details sometimes missing?', answer: 'Registries and registrars often redact personal or organisation details. A missing public field can reflect policy or privacy protection rather than a lookup failure.' }),
  Object.freeze({ question: 'Why can WHOIS and RDAP disagree?', answer: 'They can be updated at different times, apply different redaction rules or come from different registry and registrar systems. WHOISleuth keeps them separate and highlights material differences.' }),
  Object.freeze({ question: 'What is the difference between a registry, registrar and registrant?', answer: 'The registry operates the database for a domain ending, the registrar manages registrations for customers, and the registrant is the recorded holder of a domain.' }),
  Object.freeze({ question: 'Should I use Fast or Deep lookup?', answer: 'Lookup defaults to Deep when a target merits richer registration, DNS, website, certificate, and network context. Select Fast for lower-request registration-first triage. Bulk and the CLI retain their own explicit Fast and Deep controls.' }),
  Object.freeze({ question: 'How do guided investigations work?', answer: 'Start a guide from the Dashboard. It shows one step at a time, explains what to do and what a network step may request, and carries the relevant domain or bounded set of reviewed domains between tools. Bulk comparison results can enter a Monitor review queue, but cases are created only when you explicitly open them. You still start each check and mark the step reviewed, partial, or skipped.' }),
  Object.freeze({ question: 'Does a lookup contact the website?', answer: 'A Deep domain lookup can make bounded requests to public registration, DNS, homepage, favicon, certificate, and IP RDAP endpoints. security.txt and external intelligence sources run only when selected. Fast collection avoids website and certificate checks.' }),
  Object.freeze({ question: 'Does WHOISleuth scan for vulnerabilities?', answer: 'No. Passive security posture and technology indicators interpret already-collected public evidence. They do not exploit, authenticate to, or actively test the target for vulnerabilities.' }),
  Object.freeze({ question: 'What does the security.txt option do?', answer: 'When selected for a domain lookup, it requests the standard disclosure file and shows bounded published contacts and policies. The file does not authorize testing or prove that a contact is monitored.' }),
  Object.freeze({ question: 'What does the Risk score mean?', answer: 'It ranks observed signals using a versioned heuristic model and lists every contributing factor. It does not establish intent, ownership, harm or safety.' }),
  Object.freeze({ question: 'What do partial, unavailable and inconclusive mean?', answer: 'They describe source health and collection limits. None of them means that the searched evidence is absent or that a target is safe.' }),
  Object.freeze({ question: 'Why are some Deep results collapsed?', answer: 'Long RDAP and WHOIS records and secondary DNS, HTTP, page, security-posture, technology, certificate, and network sections start collapsed to shorten the result page. Headings, source states, and bounded summaries remain visible. Expand relevant sections to review evidence, provenance, and limitations before drawing a conclusion. Material registry conflicts remain visible in the comparison summary.' }),
  Object.freeze({ question: 'Where are cases and watchlists saved?', answer: 'They are stored in the current browser profile by default. A workspace archive can move supported records deliberately. Optional hosted monitoring is a separate configured feature.' }),
  Object.freeze({ question: 'Can another person using the shared login see my saved browser work?', answer: 'Browser-local cases, profiles, and watchlists remain in the browser profile where they were saved. If optional hosted monitoring is configured, its encrypted compact watchlist is deployment-wide and available to signed-in users.' }),
  Object.freeze({ question: 'What is sent to optional intelligence providers?', answer: 'Only enabled providers run. Each provider states the target representation, privacy decision, request limits and result provenance. A provider miss or outage does not imply safety.' }),
  Object.freeze({ question: 'How do I export or delete saved work?', answer: 'Monitor can export individual cases, and Dashboard can export or import a bounded workspace archive. Saved browser records can be removed from the tool that stores them or by clearing WHOISleuth site data in your browser.' }),
]);

export const commonMistakes: readonly string[] = Object.freeze([
  'Treating a missing or failed source as proof that evidence does not exist.',
  'Treating the Risk score as a malicious or safe verdict.',
  'Assuming shared nameservers, IP addresses, certificates or favicons prove common ownership.',
  'Reading a Certificate Transparency timestamp as the date a website became active.',
  'Confusing a registrar contact with the registrant or current website operator.',
]);
