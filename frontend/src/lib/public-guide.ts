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
  Object.freeze({ id: 'lookup', name: 'Lookup', useWhen: 'You have one domain, IP address or ASN to investigate.', input: 'Enter one target and choose Fast or Deep. Deep is the default; optional security.txt and external intelligence sources run only when selected.', result: 'A source map and lifecycle organize attributed evidence. For domains, the authority trace separates the registry publication used for existence decisions from registrar RDAP and WHOIS context. Deep results interpret registration, disclosure, source agreement and escalation routes without treating partial data as absence. The acquisition workspace downloads a local review only; it makes no request or submission. Task and density affect reading only. Reports support domain, IP and ASN results.', next: 'Review conflicting, partial, unavailable and time-sensitive evidence. Choose a task view and increase density only when detail is needed. For a case, retain just the facts needed for comparison. A completed Deep result can produce a compact website-profile snapshot without another request. An acquisition packet is a checklist, not proof of eligibility, ownership, price or transfer. Check an external pivot destination and shared value before opening it.' }),
  Object.freeze({ id: 'brands', name: 'Brands', useWhen: 'You want searches and comparisons to reflect an official brand, or you want to review an owned domain defensively.', input: 'Add official domains, product names, preferred domain endings, trusted infrastructure, known active or retired DKIM selectors, and an optional defensive mail profile.', result: 'A browser-local profile provides a comparison boundary, bounded public posture audit, external-dependency inventory, and separately stored expiring analyst attestations.', next: 'Review the official-domain posture or open Discover to generate related candidates.' }),
  Object.freeze({ id: 'discover', name: 'Discover', useWhen: 'You want possible lookalikes or names observed in public certificate logs.', input: 'Choose a Brand Profile or enter a focused keyword. Use a preset or select exact mutation families; optional custom dictionary terms stay local to the current tab and can replace the first or last token of a hyphenated seed. Custom selection also offers an advanced, opt-in two-character Unicode family that is never enabled by a preset.', result: 'Generated and certificate-log candidates retain their source and limits. Internationalised candidates show both their DNS-safe ASCII form and readable Unicode form. Local results initially place visible review cues first, while certificate-log results initially place the newest retained observation first.', next: 'Use Has review cues or another complete-set filter to form a focused shortlist for Bulk. Sorting changes presentation only; it does not alter evidence, scoring or selection.' }),
  Object.freeze({ id: 'bulk', name: 'Bulk', useWhen: 'You need to compare several candidate domains consistently.', input: 'Paste domains or accept a shortlist from Discover. Choose Fast or Bulk Deep, then choose Gentle, Balanced, or Standard request pacing. Bulk Deep uses compact WHOIS, DNS, website, TLS, and mail evidence rather than the complete single-domain response.', result: 'Fast or Deep checks prioritise candidates and expose observed relationships. Live complete, limited, failed, and pending counts separate incomplete coverage from request failure. The review cockpit supports row review, disposition, shortlist, watchlist and Lookup handoffs. Two-domain comparison keeps source state, time, conflict and one-sided evidence distinct. Filters preserve unknown states. Saved compact sessions can be compared, exported or resumed only for domains that never settled.', next: 'Select only the rows you intend to act on, then export, rescan, create cases, set existing case states, or save that selection to Monitor. Open the strongest or most uncertain leads in Lookup, and retain a useful relationship only after reviewing its limitations.' }),
  Object.freeze({ id: 'monitor', name: 'Monitor', useWhen: 'You want to retain a finding, document a decision, prepare a reviewed response or compare later observations.', input: 'Save a case or watchlist from Lookup or Bulk, retain selected Lookup facts, save a website profile snapshot or Bulk session, or retain one reviewed relationship observation.', result: 'A browser-local timeline projects retained Lookup snapshots, Bulk sessions, watchlist checks, case evidence, pins and relationship observations without copying raw values. Campaigns summarize latest-case cues while keeping unavailable, limited and unreviewed records explicit; counts are not a score or attribution finding. Observation and storage times stay separate, freshness uses bounded thresholds, and each event links to its owner. Analyst reasoning remains separate from observed evidence.', next: 'Filter the timeline by area, freshness, entity, case, source, evidence or change, and time; then open the owning record for exact values and limitations. A stale record is a review cue, not a current finding. Review evidence and contact provenance before creating a local response packet. WHOISleuth does not submit the packet.' }),
]);

export const referenceGuides: readonly GuideEntry[] = Object.freeze([
  Object.freeze({ id: 'registry-support', name: 'Registry support', useWhen: 'You want to know how a domain ending is handled or which fields each lookup profile attempts before relying on a result.', input: 'Filter the field-level matrix by target type, or search for a domain ending such as com or au.', result: 'The matrix compares Fast, Bulk Deep, and single Deep field collection. The catalogue separately shows tested WHOIS parsing, query rules, and known RDAP access limits.', next: 'Treat a conditional or limited field as a source or collection constraint, not evidence that a value is absent or that a domain is available.' }),
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
  Object.freeze({ term: 'Browser-library advisory match', definition: 'A passive match between an already-observed script indicator and a pinned local advisory catalogue. It is a review lead, not proof that a component is reachable, vulnerable in context, or exploitable.' }),
  Object.freeze({ term: 'Browser-local', definition: 'Saved data remains in this browser profile unless you deliberately export or configure a hosted feature.' }),
  Object.freeze({ term: 'CAA', definition: 'A DNS record that states which certificate authorities may issue certificates for a domain.' }),
  Object.freeze({ term: 'Case', definition: 'A browser-local analyst record containing compact collected evidence, notes, evidence pins, decisions, reviewed actions, status and observation history.' }),
  Object.freeze({ term: 'Certificate Transparency', definition: 'Public logs of issued TLS certificates. A log timestamp records certificate observation, not website activation or maliciousness.' }),
  Object.freeze({ term: 'Confusable', definition: 'A character or label that can look similar to another, including internationalised domain characters.' }),
  Object.freeze({ term: 'Console', definition: 'The complete signed-in area containing the Dashboard, investigation tools, and reference pages.' }),
  Object.freeze({ term: 'Credential collection surface', definition: 'Fixed counts of semantic password, email, username, one-time-code, or payment-related inputs and form action relationships observed in captured static HTML. It is not a vulnerability or phishing finding.' }),
  Object.freeze({ term: 'Dashboard', definition: 'The signed-in starting page for choosing an investigation, owned-domain protection, candidate review, acquisition assessment, or case-work lane; loading an explicit two-domain comparison; continuing saved work; or opening a guide.' }),
  Object.freeze({ term: 'Deep lookup', definition: 'A broader lookup that can add WHOIS, DNS, website, TLS, platform indicators, observed network context and optional enrichment checks to RDAP.' }),
  Object.freeze({ term: 'DKIM', definition: 'A mail authentication method that lets a domain sign outgoing messages.' }),
  Object.freeze({ term: 'DMARC', definition: 'A mail policy that builds on SPF and DKIM and can tell receivers how to handle failures.' }),
  Object.freeze({ term: 'DNS', definition: 'The system that maps domain names to addresses and other records such as mail servers and nameservers.' }),
  Object.freeze({ term: 'DNSSEC', definition: 'Cryptographic DNS signatures that help resolvers verify that answers have not been altered.' }),
  Object.freeze({ term: 'EPP status', definition: 'A registry lifecycle or control status such as redemption period, pending delete, hold, or transfer prohibited. It describes a point-in-time registration condition and does not guarantee deletion, release timing, eligibility, or acquisition success.' }),
  Object.freeze({ term: 'Evidence checkpoint', definition: 'An analyst-selected set of normalized domain facts retained in a case with source, time, completeness, truncation, schema and limitations. Later comparisons keep unavailable, conflicting, missing and not-recorded states distinct from a material change.' }),
  Object.freeze({ term: 'Fast lookup', definition: 'A lower-request lookup intended for quick triage. It keeps the authoritative RDAP path and omits deeper collection.' }),
  Object.freeze({ term: 'Favicon', definition: 'A small website icon. Exact or similar icons can be a useful lead, but do not prove common ownership.' }),
  Object.freeze({ term: 'Hosted monitoring', definition: 'An optional scheduled service that stores compact encrypted watchlist evidence outside the browser.' }),
  Object.freeze({ term: 'HTTPS service binding', definition: 'A DNS HTTPS record that can publish service priority, alternate targets, protocol support, ports, and address hints. WHOISleuth reports the publication but does not follow it or connect to its targets.' }),
  Object.freeze({ term: 'IDN and Punycode', definition: 'Internationalised domain names can contain non-ASCII characters. Punycode is the DNS-safe ASCII form beginning with xn--. Review both forms together.' }),
  Object.freeze({ term: 'IP address', definition: 'A numeric network address used by an internet-connected host.' }),
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
  Object.freeze({ term: 'Retained relationship observation', definition: 'A bounded relationship pivot that an analyst explicitly saves from a Bulk result. It keeps normalized evidence and provenance, not the complete scan or raw lookup responses.' }),
  Object.freeze({ term: 'Risk score', definition: 'An explainable prioritisation aid based on observed signals. It is not a verdict of maliciousness.' }),
  Object.freeze({ term: 'SAN', definition: 'A certificate Subject Alternative Name listing a hostname or other identity covered by that certificate.' }),
  Object.freeze({ term: 'security.txt', definition: 'An optional website file that can publish security contacts and policies. Its presence does not authorize testing or prove that a contact is monitored.' }),
  Object.freeze({ term: 'SOA', definition: 'A DNS Start of Authority record containing a zone primary nameserver and maintenance timing values.' }),
  Object.freeze({ term: 'SPF', definition: 'A DNS-based mail policy that lists systems allowed to send mail for a domain.' }),
  Object.freeze({ term: 'Structured identity metadata', definition: 'Publisher-declared JSON-LD reduced to curated schema types, labels, origins, and sameAs hostnames. It is a review clue, not verified identity or ownership.' }),
  Object.freeze({ term: 'Technology indicator', definition: 'A curated, evidence-backed hint about software or delivery services derived from captured headers, metadata, resources, or static HTML.' }),
  Object.freeze({ term: 'TLS certificate', definition: 'A certificate used to authenticate an encrypted connection. Its presence does not prove that a website is safe or active.' }),
  Object.freeze({ term: 'Unicode confusable', definition: 'A Unicode character or label that resembles another string. Similarity is a review lead, not proof of impersonation, ownership, activity, or harm.' }),
  Object.freeze({ term: 'Watchlist', definition: 'A saved set of domains whose compact evidence can be compared across later checks.' }),
  Object.freeze({ term: 'Website profile snapshot', definition: 'An analyst-saved compact record of curated technology, posture, identity-digest, source-health, and completeness evidence from a completed Deep Lookup. A difference is a review lead, not proof of compromise.' }),
  Object.freeze({ term: 'WHOIS', definition: 'A text-based registration-data service whose format and availability vary between registries.' }),
  Object.freeze({ term: 'Workspace archive', definition: 'A versioned local backup that combines supported browser-saved records. Dashboard recommends a passphrase-encrypted download, while a separately labelled unencrypted download remains available for compatibility. It is a file format, not a separate area of the interface.' }),
]);

export const guideFaqs: readonly GuideFaq[] = Object.freeze([
  Object.freeze({ question: 'Can WHOISleuth identify a website platform or hosting provider?', answer: 'Deep Lookup can show curated indicators for common content, commerce, site-building, framework, web-server, and delivery technologies from the response it already captured. It separately maps one observed public address to its registered network. Proxies, delivery networks, shared infrastructure, and concealed software mean neither view necessarily identifies the origin host or hosting account.' }),
  Object.freeze({ question: 'Does WHOISleuth decide whether a domain is malicious?', answer: 'No. It organises observed evidence and provides an explainable Risk score for prioritisation. An analyst must review the sources and context.' }),
  Object.freeze({ question: 'Why are owner details sometimes missing?', answer: 'Registries and registrars often redact personal or organisation details. A missing public field can reflect policy or privacy protection rather than a lookup failure.' }),
  Object.freeze({ question: 'Why can WHOIS and RDAP disagree?', answer: 'They can be updated at different times, apply different redaction rules or come from different registry and registrar systems. WHOISleuth keeps them separate and highlights material differences.' }),
  Object.freeze({ question: 'What is the difference between a registry, registrar and registrant?', answer: 'The registry operates the database for a domain ending, the registrar manages registrations for customers, and the registrant is the recorded holder of a domain.' }),
  Object.freeze({ question: 'Should I use Fast or Deep lookup?', answer: 'Lookup defaults to Deep when a target merits richer registration, DNS, website, certificate, and network context. Deep adds SOA and HTTPS service-binding context for domains and can add PTR context for public IP addresses. Select Fast for lower-request registration-first triage. Bulk and the CLI retain their own explicit Fast and Deep controls.' }),
  Object.freeze({ question: 'How do guided investigations work?', answer: 'Start a standard guide from Dashboard or choose a browser-local template derived from one. A template can tailor guidance, omit allowlisted steps, and add approval gates, but cannot run code, start collection, submit evidence, or remove a required gate. The active guide keeps the target, Brand Profile, case, and next action visible and carries the relevant domain or bounded reviewed set between tools. You still start each check and mark the step reviewed, partial, or skipped.' }),
  Object.freeze({ question: 'Does a lookup contact the website?', answer: 'A Deep domain lookup can make bounded requests to public registration, DNS, homepage, favicon, certificate, and IP RDAP endpoints. security.txt and external intelligence sources run only when selected. Fast collection avoids website and certificate checks.' }),
  Object.freeze({ question: 'Does WHOISleuth scan for vulnerabilities?', answer: 'No. Passive security posture and technology indicators interpret already-collected public evidence. A bounded browser-library profile can compare already-observed script indicators with a pinned advisory catalogue, but it does not fetch scripts or prove that a reported component is loaded, reachable, vulnerable in context, or exploitable. WHOISleuth does not exploit, authenticate to, or actively test the target.' }),
  Object.freeze({ question: 'What does the security.txt option do?', answer: 'When selected for a domain lookup, it requests the standard disclosure file and shows bounded published contacts and policies. The file does not authorize testing or prove that a contact is monitored.' }),
  Object.freeze({ question: 'What does the Risk score mean?', answer: 'It ranks observed signals using a versioned heuristic model and lists every contributing factor. It does not establish intent, ownership, harm or safety.' }),
  Object.freeze({ question: 'What do partial, unavailable and inconclusive mean?', answer: 'They describe source health and collection limits. None of them means that the searched evidence is absent or that a target is safe.' }),
  Object.freeze({ question: 'Why are some Deep results collapsed?', answer: 'Long RDAP and WHOIS records and secondary DNS, HTTP, page, structured-identity, security-posture, technology, certificate, and network sections start collapsed to shorten the result page. Headings, source states, and bounded summaries remain visible. Expand relevant sections to review evidence, provenance, and limitations before drawing a conclusion. Material registry conflicts remain visible in the comparison summary.' }),
  Object.freeze({ question: 'Can I compare how a website changes over time?', answer: 'Yes, after reviewing a completed Deep Lookup you can explicitly save a compact website-profile snapshot and compare it with a later snapshot for the same domain. WHOISleuth keeps curated technology identifiers, posture states, identity digests, source health and completeness, not raw page or registration payloads. A difference is a lead for review, not evidence of compromise, ownership, intent or maliciousness.' }),
  Object.freeze({ question: 'Can I save a relationship found in Bulk?', answer: 'Yes. Choose Retain observation on a reviewed relationship group. WHOISleuth saves only the bounded normalized value, member domains, method, time, completeness and limitations in this browser. It does not retain the complete Bulk scan or raw responses. Review or delete it under Monitor Relationships.' }),
  Object.freeze({ question: 'Where are cases and watchlists saved?', answer: 'They are stored as plaintext records in the current browser profile by default. A passphrase-encrypted workspace archive can move supported records deliberately and protects the downloaded file while locked. Optional hosted monitoring is a separate configured feature.' }),
  Object.freeze({ question: 'Can another person using the shared login see my saved browser work?', answer: 'Browser-local cases, profiles, and watchlists remain in the browser profile where they were saved. If optional hosted monitoring is configured, its encrypted compact watchlist is deployment-wide and available to signed-in users.' }),
  Object.freeze({ question: 'What is sent to optional intelligence providers?', answer: 'Only enabled provider integrations run. Each states the target representation, privacy decision, request limits and result provenance. The separate external evidence pivots are ordinary links: WHOISleuth makes no request until you open one, and the panel shows the exact value the named destination will receive. Provider misses, neutral external results and outages do not imply safety.' }),
  Object.freeze({ question: 'How do I export or delete saved work?', answer: 'Monitor can export individual cases and reviewed response packets, while Dashboard can export an encrypted or unencrypted bounded workspace archive and review either format before import. A response packet is created locally and is never submitted by WHOISleuth. Encrypted passphrases cannot be recovered. Saved browser records can be removed from the tool that stores them or by clearing WHOISleuth site data in your browser.' }),
]);

export const commonMistakes: readonly string[] = Object.freeze([
  'Treating a missing or failed source as proof that evidence does not exist.',
  'Treating the Risk score as a malicious or safe verdict.',
  'Assuming shared nameservers, IP addresses, certificates or favicons prove common ownership.',
  'Reading a Certificate Transparency timestamp as the date a website became active.',
  'Confusing a registrar contact with the registrant or current website operator.',
]);
