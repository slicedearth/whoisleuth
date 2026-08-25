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
      Object.freeze({ id: 'save', label: 'Save', href: '#tool-monitor-input' }),
      Object.freeze({ id: 'monitor', label: 'Monitor', href: '#tool-monitor-result' }),
      Object.freeze({ id: 'review-changes', label: 'Review changes', href: '#tool-monitor-next' }),
    ]),
  }),
]);

export const toolGuides: readonly GuideEntry[] = Object.freeze([
  Object.freeze({ id: 'lookup', name: 'Lookup', useWhen: 'You have one domain, IP address or ASN to investigate.', input: 'Enter one target and choose Fast or Deep. Optional security.txt and external intelligence sources run only when selected.', result: 'At a glance summarises source completeness and disagreements before the detailed evidence. Partial and unavailable sources remain visible.', next: 'Choose a Focus, review the relevant sources, and retain only the facts you need. Risk is an explainable triage aid; acquisition Opportunity describes readiness, not price or availability.' }),
  Object.freeze({ id: 'brands', name: 'Brands', useWhen: 'You want a reviewed baseline for an official brand or owned domains.', input: 'Add official domains, product names, preferred domain endings, trusted infrastructure and any reviewed defensive-mail or domain-control context.', result: 'The browser-local profile supports candidate comparison, public posture review, dependency review and owned-domain controls.', next: 'Review gaps in the baseline, or open Discover to generate related candidates.' }),
  Object.freeze({ id: 'discover', name: 'Discover', useWhen: 'You want possible lookalikes, names from public certificate logs or a registry-scoped nameserver search.', input: 'Choose a Brand Profile or enter a focused keyword. Select a preset or exact mutation families; the separate Nameservers action accepts one hostname and one registry suffix.', result: 'Every candidate keeps its source and limits. Internationalised names show both DNS-safe ASCII and readable Unicode forms.', next: 'Review the cues, then send a focused shortlist to Bulk.' }),
  Object.freeze({ id: 'bulk', name: 'Bulk', useWhen: 'You need to compare several candidate domains consistently.', input: 'Paste domains or accept a Discover shortlist. A job accepts up to 500 Fast or 50 Deep targets, with explicit request pacing.', result: 'Bulk presents per-domain source states, Risk triage, relationships and two-domain comparison. Bulk Deep is compact and does not contain every single-domain field.', next: 'Act on an explicit selection, or open the strongest and most uncertain leads in Lookup.' }),
  Object.freeze({ id: 'monitor', name: 'Monitor', useWhen: 'You want to retain evidence, document a decision, prepare a response or compare later observations.', input: 'Save selected cases, watchlists, evidence, snapshots, sessions or reviewed relationships from Lookup and Bulk.', result: 'Respond contains cases, campaigns and relationship work. Assure contains timelines, watchlists and local controls. Evidence gaps keep unavailable and partial sources visible.', next: 'Continue the relevant Respond or Assure work. Collection, response submission and control changes remain separate actions.' }),
]);

export const referenceGuides: readonly GuideEntry[] = Object.freeze([
  Object.freeze({ id: 'registry-support', name: 'Registry support', useWhen: 'You need to check how a domain ending or lookup field is handled.', input: 'Filter the field matrix by target type, or search for a domain ending.', result: 'The page compares Fast, Bulk Deep and single Deep collection, then lists tested WHOIS rules and known RDAP limits.', next: 'Use conditional and limited states as collection constraints. Official registry links open only when selected.' }),
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
  Object.freeze({ term: 'Authoritative nameserver', definition: 'A nameserver that publishes DNS records for a zone. A failed direct query can reflect reachability or collection limits and does not prove that a record is absent.' }),
  Object.freeze({ term: 'BIMI', definition: 'A DNS-published brand indicator for participating mail systems. Its presence does not authenticate a message or establish that a sender is trustworthy.' }),
  Object.freeze({ term: 'Browser-library advisory match', definition: 'A passive match between an already-observed script indicator and a pinned local advisory catalogue. It is a review lead, not proof that a component is reachable, vulnerable in context, or exploitable.' }),
  Object.freeze({ term: 'Browser-local', definition: 'Saved data remains in this browser profile unless you deliberately export or configure a hosted feature.' }),
  Object.freeze({ term: 'CAA', definition: 'A DNS record that states which certificate authorities may issue certificates for a domain.' }),
  Object.freeze({ term: 'Case', definition: 'A browser-local analyst record containing compact collected evidence, notes, evidence pins, decisions, reviewed actions, status and observation history.' }),
  Object.freeze({ term: 'Certificate Transparency', definition: 'Public logs of issued TLS certificates. A log timestamp records certificate observation, not website activation or maliciousness.' }),
  Object.freeze({ term: 'Confusable', definition: 'A character or label that can look similar to another, including internationalised domain characters.' }),
  Object.freeze({ term: 'Console', definition: 'The complete signed-in area containing the Dashboard, investigation tools, and reference pages.' }),
  Object.freeze({ term: 'Credential collection surface', definition: 'Fixed counts of semantic password, email, username, one-time-code, or payment-related inputs and form action relationships observed in captured static HTML. It is not a vulnerability or phishing finding.' }),
  Object.freeze({ term: 'DANE', definition: 'A method for using DNSSEC-protected TLSA records to authenticate a service certificate or public key. Only validated DNSSEC supports a DANE authentication claim.' }),
  Object.freeze({ term: 'Dashboard', definition: 'The signed-in starting page for Investigate, Respond and Assure work.' }),
  Object.freeze({ term: 'Deep lookup', definition: 'A broader lookup that can add WHOIS, DNS, website, TLS, platform indicators, observed network context and optional enrichment checks to RDAP.' }),
  Object.freeze({ term: 'DKIM', definition: 'A mail authentication method that lets a domain sign outgoing messages.' }),
  Object.freeze({ term: 'DMARC', definition: 'A mail policy that builds on SPF and DKIM and can tell receivers how to handle failures.' }),
  Object.freeze({ term: 'DNS', definition: 'The system that maps domain names to addresses and other records such as mail servers and nameservers.' }),
  Object.freeze({ term: 'DNSSEC', definition: 'Cryptographic DNS signatures that help resolvers verify that answers have not been altered.' }),
  Object.freeze({ term: 'EPP status', definition: 'A registry lifecycle or control status such as redemption period, pending delete, hold, or transfer prohibited. It describes a point-in-time registration condition and does not guarantee deletion, release timing, eligibility, or acquisition success.' }),
  Object.freeze({ term: 'Evidence checkpoint', definition: 'An analyst-selected set of normalised domain facts retained in a case with source, time, completeness, truncation, schema and limitations. Later comparisons keep unavailable, conflicting, missing and not-recorded states distinct from a material change.' }),
  Object.freeze({ term: 'Fast lookup', definition: 'A lower-request lookup intended for quick triage. It keeps the authoritative RDAP path and omits deeper collection.' }),
  Object.freeze({ term: 'Favicon', definition: 'A small website icon. Exact or similar icons can be a useful lead, but do not prove common ownership.' }),
  Object.freeze({ term: 'Glue record', definition: 'An address published with a nameserver delegation when resolvers need that address to reach an in-bailiwick nameserver.' }),
  Object.freeze({ term: 'Hosted monitoring', definition: 'An optional scheduled service that stores compact encrypted watchlist evidence outside the browser.' }),
  Object.freeze({ term: 'HTTPS service binding', definition: 'A DNS HTTPS record that can publish service priority, alternate targets, protocol support, ports, and address hints. WHOISleuth reports the publication but does not follow it or connect to its targets.' }),
  Object.freeze({ term: 'IDN and Punycode', definition: 'Internationalised domain names can contain non-ASCII characters. Punycode is the DNS-safe ASCII form beginning with xn--. Review both forms together.' }),
  Object.freeze({ term: 'IP address', definition: 'A numeric network address used by an internet-connected host.' }),
  Object.freeze({ term: 'MTA-STS', definition: 'An HTTPS-published policy that can tell sending mail servers to require trusted TLS when delivering mail to the domain\'s listed MX hosts.' }),
  Object.freeze({ term: 'MX', definition: 'A DNS record that identifies the servers expected to receive email for a domain.' }),
  Object.freeze({ term: 'Nameserver', definition: 'A DNS server responsible for publishing records for a domain.' }),
  Object.freeze({ term: 'Observed network context', definition: 'Registration details for one public IP address observed during a deep lookup. Shared infrastructure means it may not identify the origin host.' }),
  Object.freeze({ term: 'Opportunity score', definition: 'An explainable prioritisation aid for apparently available generated candidates. It is not a valuation or purchase recommendation.' }),
  Object.freeze({ term: 'Page identity', definition: 'Bounded static page characteristics such as titles, forms, resource hosts, tracking identifiers, and fingerprints used for comparison.' }),
  Object.freeze({ term: 'Page role and behaviour profile', definition: 'Fixed heuristic role labels and static client-side behaviour indicators derived from an already-captured page. Referenced scripts are not fetched or executed, and the profile does not prove purpose, vulnerability, tracking, or maliciousness.' }),
  Object.freeze({ term: 'Passive security posture', definition: 'Review signals derived from already-collected HTTP, page, TLS, DNSSEC, and CAA evidence. They are not confirmed vulnerabilities.' }),
  Object.freeze({ term: 'Provenance', definition: 'The source, collection time, method, completeness, and limitations attached to an observation or derived finding.' }),
  Object.freeze({ term: 'PTR', definition: 'A reverse-DNS record that can publish a hostname for an IP address. It is operator-provided routing context, not proof of hosting control or ownership.' }),
  Object.freeze({ term: 'RDAP', definition: 'A structured registration-data protocol used by registries and some registrars.' }),
  Object.freeze({ term: 'Registrant', definition: 'The person or organisation recorded as holding the domain registration. Public data may be redacted or privacy-protected.' }),
  Object.freeze({ term: 'Registrar', definition: 'The company through which a registrant manages a domain registration.' }),
  Object.freeze({ term: 'Registration disclosure', definition: 'How a point-in-time RDAP or WHOIS publication presents registrant fields: public, privacy proxy, redacted, withheld, absent in a complete response, or unavailable. It does not infer identity or reachability.' }),
  Object.freeze({ term: 'Registry', definition: 'The operator responsible for the registration database for a domain ending.' }),
  Object.freeze({ term: 'Retained relationship observation', definition: 'A bounded relationship pivot that an analyst explicitly saves from a Bulk result. It keeps normalised evidence and provenance, not the complete scan or raw lookup responses.' }),
  Object.freeze({ term: 'Risk score', definition: 'An explainable prioritisation aid based on observed signals. It is not a verdict of maliciousness.' }),
  Object.freeze({ term: 'SAN', definition: 'A certificate Subject Alternative Name listing a hostname or other identity covered by that certificate.' }),
  Object.freeze({ term: 'security.txt', definition: 'An optional website file that can publish security contacts and policies. Its presence does not authorise testing or prove that a contact is monitored.' }),
  Object.freeze({ term: 'SOA', definition: 'A DNS Start of Authority record containing a zone primary nameserver and maintenance timing values.' }),
  Object.freeze({ term: 'SPF', definition: 'A DNS-based mail policy that lists systems allowed to send mail for a domain.' }),
  Object.freeze({ term: 'Structured identity metadata', definition: 'Publisher-declared JSON-LD reduced to curated schema types, labels, origins, and sameAs hostnames. It is a review clue, not verified identity or ownership.' }),
  Object.freeze({ term: 'Technology indicator', definition: 'A curated, evidence-backed hint about software or delivery services derived from captured headers, metadata, resources, or static HTML.' }),
  Object.freeze({ term: 'TLS certificate', definition: 'A certificate used to authenticate an encrypted connection. Its presence does not prove that a website is safe or active.' }),
  Object.freeze({ term: 'TLS-RPT', definition: 'A DNS record that publishes where aggregate reports about SMTP TLS delivery failures may be sent.' }),
  Object.freeze({ term: 'TLSA', definition: 'A DNS record associating a service and port with a certificate or public key. Without validated DNSSEC it remains observed publication data rather than a validated DANE match.' }),
  Object.freeze({ term: 'Unicode confusable', definition: 'A Unicode character or label that resembles another string. Similarity is a review lead, not proof of impersonation, ownership, activity, or harm.' }),
  Object.freeze({ term: 'Watchlist', definition: 'A saved set of domains whose compact evidence can be compared across later checks.' }),
  Object.freeze({ term: 'Website profile snapshot', definition: 'An analyst-saved compact record of curated technology, posture, identity-digest, source-health, completeness and, when available, normalised observed leaf-certificate evidence from a completed Deep Lookup. A difference or shared fingerprint is a review lead, not proof of compromise or common control.' }),
  Object.freeze({ term: 'WHOIS', definition: 'A text-based registration-data service whose format and availability vary between registries.' }),
  Object.freeze({ term: 'Workspace archive', definition: 'A versioned local backup that combines supported browser-saved records. Dashboard recommends a passphrase-encrypted download, while a separately labelled unencrypted download remains available for compatibility. It is a file format, not a separate area of the interface.' }),
]);

export const guideFaqs: readonly GuideFaq[] = Object.freeze([
  Object.freeze({ question: 'Can I review a Lookup evidence export without scanning again?', answer: 'Yes. Lookup validates and replays public schema 26 or current schema 27 evidence locally without contacting the target. Schema 26 may contain public contact fields, so review it before sharing.' }),
  Object.freeze({ question: 'Does WHOISleuth decide whether a domain is malicious?', answer: 'No. It organises observed evidence and provides an explainable Risk score for prioritisation. An analyst must review the sources and context.' }),
  Object.freeze({ question: 'Should I use Fast or Deep lookup?', answer: 'Use Fast for registration-first triage. Deep adds DNS, website, certificate and network context, including SOA, HTTPS service bindings, effective CAA and separately attributed PTR names where relevant.' }),
  Object.freeze({ question: 'Does a lookup contact the website?', answer: 'A Deep domain lookup can make bounded requests to public registration, DNS, homepage, favicon, certificate, and IP RDAP endpoints. security.txt and external intelligence sources run only when selected. Fast collection avoids website and certificate checks.' }),
  Object.freeze({ question: 'Does WHOISleuth scan for vulnerabilities?', answer: 'No. It interprets already-collected public evidence and can compare observed script indicators with a pinned advisory catalogue. It does not fetch those scripts, exploit the target or authenticate to it.' }),
  Object.freeze({ question: 'Where are cases and watchlists saved?', answer: 'They are plaintext records in the current browser profile by default. A passphrase-encrypted workspace archive can move supported records; optional hosted monitoring is separate.' }),
  Object.freeze({ question: 'Can another person using the shared login see my saved browser work?', answer: 'Browser-local cases, profiles, and watchlists remain in the browser profile where they were saved. If optional hosted monitoring is configured, its encrypted compact watchlist is deployment-wide and available to signed-in users.' }),
  Object.freeze({ question: 'How do I export or delete saved work?', answer: 'Monitor exports cases and response packets; Dashboard exports workspace archives. Delete records in the relevant tool or clear WHOISleuth site data. Downloaded files must be deleted separately.' }),
]);

export const commonMistakes: readonly string[] = Object.freeze([
  'Treating a missing or failed source as proof that evidence does not exist.',
  'Treating the Risk score as a malicious or safe verdict.',
  'Assuming shared nameservers, IP addresses, certificates or favicons prove common ownership.',
  'Reading a Certificate Transparency timestamp as the date a website became active.',
  'Confusing a registrar contact with the registrant or current website operator.',
]);
