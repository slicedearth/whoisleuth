import {
  PUBLIC_RESOURCE_SLUGS,
  type PublicResourceSlug,
} from '../../../lib/public-resource-routes.mts';

export type PublicResourceSection = Readonly<{
  title: string;
  body: string;
}>;

export type PublicResourceEvidence = Readonly<{
  source: string;
  usefulFor: string;
  limitation: string;
}>;

export type PublicResource = Readonly<{
  slug: PublicResourceSlug;
  shortTitle: string;
  title: string;
  description: string;
  eyebrow: string;
  summary: readonly string[];
  steps: readonly PublicResourceSection[];
  evidence: readonly PublicResourceEvidence[];
  questions: readonly string[];
  demoHref: string;
  demoLabel: string;
  guideHref: string;
  guideLabel: string;
  repositoryDoc: string;
}>;

export const PUBLIC_RESOURCES: readonly PublicResource[] = Object.freeze([
  Object.freeze({
    slug: 'open-source-domain-intelligence',
    shortTitle: 'Domain investigation evidence',
    title: 'How WHOISleuth handles domain investigation evidence',
    description: 'See how WHOISleuth combines WHOIS, RDAP, DNS, certificates, website and network evidence while keeping every source and limitation visible.',
    eyebrow: 'Domain investigation',
    summary: Object.freeze([
      'A useful domain investigation rarely comes from one database. Registration records describe the domain, DNS shows current publication, certificates show issued identities, and website observations describe one captured response.',
      'WHOISleuth keeps those evidence classes separate. It uses authoritative registry evidence for registration decisions, then adds supporting context without converting a failed or missing source into a claim of absence or safety.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Start with the question', body: 'Decide whether you are checking existence, identity, infrastructure, acquisition signals, brand similarity, or a material change. The question determines whether a Fast or Deep collection is proportionate.' }),
      Object.freeze({ title: 'Collect within explicit bounds', body: 'Requests, redirects, response bytes, source counts, timeouts and concurrency are capped. Optional providers remain off unless configured and selected.' }),
      Object.freeze({ title: 'Retain only reviewed evidence', body: 'Cases, website snapshots, watchlists and relationship observations are browser-local by default. Analysts choose what to save and what to export.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Registry RDAP and WHOIS', usefulFor: 'Registration status, dates, registrar and lifecycle controls.', limitation: 'Publication can be redacted, delayed, unavailable or internally inconsistent.' }),
      Object.freeze({ source: 'DNS, TLS and HTTP', usefulFor: 'Current service publication, certificates, redirects and page context.', limitation: 'Shared infrastructure and one captured response do not establish ownership or intent.' }),
      Object.freeze({ source: 'Analyst review', usefulFor: 'Separating facts, hypotheses, unknowns, decisions and next actions.', limitation: 'A review record does not turn incomplete evidence into a verified conclusion.' }),
    ]),
    questions: Object.freeze([
      'Which source is authoritative for the question being asked?',
      'Which checks were skipped, unavailable, partial or truncated?',
      'What can be saved without retaining raw or unnecessary personal data?',
    ]),
    demoHref: '/demo',
    demoLabel: 'See the evidence map',
    guideHref: '/resources#results',
    guideLabel: 'Learn how to read result states',
    repositoryDoc: 'docs/architecture.md',
  }),
  Object.freeze({
    slug: 'rdap-vs-whois',
    shortTitle: 'RDAP versus WHOIS',
    title: 'RDAP versus WHOIS: why registration sources disagree',
    description: 'Understand the different formats, authorities and failure modes of RDAP and WHOIS, and how to review conflicts without losing provenance.',
    eyebrow: 'Registration evidence',
    summary: Object.freeze([
      'RDAP is structured JSON with bootstrap-based service discovery. WHOIS is text returned through registry or registrar-specific query rules. They can describe the same registration at different times and with different redaction policies.',
      'A disagreement is not automatically an error. It is a review prompt. WHOISleuth preserves the source, authority, time, query path and normalised field used in each comparison.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Identify authority', body: 'Registry evidence controls domain-existence decisions. Registrar RDAP can enrich the record, but it cannot silently override the authoritative registry result.' }),
      Object.freeze({ title: 'Compare normalised fields', body: 'Review status values, lifecycle dates, registrar identity and nameservers after normalisation while keeping the original source labels available.' }),
      Object.freeze({ title: 'Explain the conflict', body: 'Check collection time, redaction, referral path, source completeness and parsing limitations before treating different values as a material change.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Registry RDAP', usefulFor: 'Structured authoritative registration evidence where supported.', limitation: 'Some registries limit access, omit fields or use extensions.' }),
      Object.freeze({ source: 'Registry WHOIS', usefulFor: 'Registry text publication and referral context.', limitation: 'Formats and query rules vary by domain ending and can change without notice.' }),
      Object.freeze({ source: 'Registrar publication', usefulFor: 'Additional customer-facing registration context.', limitation: 'It is not authoritative for whether the registry currently contains the domain.' }),
    ]),
    questions: Object.freeze([
      'Did both sources answer for the same canonical domain?',
      'Were both responses complete and collected at comparable times?',
      'Does the difference affect the investigation question, or only presentation?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Inspect synthetic registration evidence',
    guideHref: '/resources#glossary',
    guideLabel: 'Review registry terminology',
    repositoryDoc: 'docs/registry-data-contract.md',
  }),
  Object.freeze({
    slug: 'lookalike-domain-checker',
    shortTitle: 'Lookalike domain review',
    title: 'Find and review lookalike domains without treating similarity as abuse',
    description: 'Generate bounded typo, homoglyph and impersonation candidates, add certificate-log observations, and review the strongest leads with explainable evidence.',
    eyebrow: 'Brand protection',
    summary: Object.freeze([
      'A useful lookalike review needs both coverage and restraint. Character substitutions, omissions, keyboard proximity, homoglyphs, word combinations and alternate domain endings can produce plausible candidates, but also many benign names.',
      'WHOISleuth generates candidates locally, records the mutation family and scope, then lets analysts add registration and public certificate observations before deciding which domains deserve deeper review.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Define the protected identity', body: 'Create a browser-local Brand Profile with official domains, product terms, trusted partners and preferred domain endings.' }),
      Object.freeze({ title: 'Generate a bounded candidate set', body: 'Choose a preset, keyboard layout, domain endings and optional reviewed terms. Generation is deterministic and capped before any lookup runs.' }),
      Object.freeze({ title: 'Validate before escalating', body: 'Review registration, mail, certificate, website and identity evidence. Similar spelling alone does not prove impersonation, control, intent or harm.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Local mutation generator', usefulFor: 'Transparent typo, homoglyph and brand-term coverage.', limitation: 'Candidate generation is not evidence that a domain exists or is harmful.' }),
      Object.freeze({ source: 'Certificate Transparency', usefulFor: 'Publicly logged certificate names and first or last observation context.', limitation: 'A logged certificate does not prove website activity, ownership or maliciousness.' }),
      Object.freeze({ source: 'Deep Lookup', usefulFor: 'Registration, mail, TLS, page identity and network review.', limitation: 'Unavailable or shared evidence must remain inconclusive.' }),
    ]),
    questions: Object.freeze([
      'Which mutation or observed source produced this candidate?',
      'Is the domain registered, active, mail-capable or only similar in spelling?',
      'Does page or infrastructure evidence match a reviewed official baseline?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Try the brand example',
    guideHref: '/resources#tool-discover',
    guideLabel: 'Read about Discover',
    repositoryDoc: 'docs/idn-confusables.md',
  }),
  Object.freeze({
    slug: 'certificate-transparency-brand-protection',
    shortTitle: 'Certificate transparency',
    title: 'Use Certificate Transparency as a brand-protection lead',
    description: 'Learn what public certificate logs can reveal about domain names, and why certificate observations need registration and website context.',
    eyebrow: 'Certificate evidence',
    summary: Object.freeze([
      'Certificate Transparency logs can expose hostnames included in publicly logged certificates. This makes them useful for finding brand-related names and reviewing certificate reuse before a domain appears elsewhere.',
      'Log presence is only an observation. It does not establish that a site is active, that the certificate is still deployed, or that a hostname is controlled by the party suggested by its name.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Search reviewed terms', body: 'Use a bounded brand or domain query and retain the log source plus first and last observation context.' }),
      Object.freeze({ title: 'Normalise certificate names', body: 'Remove invalid, wildcard-only and out-of-scope names before comparing exact canonical hostnames.' }),
      Object.freeze({ title: 'Pivot deliberately', body: 'Open selected names in Lookup, compare the observed leaf certificate or public key, and keep provider and deployment observations separately attributed.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Public CT logs', usefulFor: 'Finding certificate names and observation timing.', limitation: 'Coverage and ingestion timing vary, and log entries are not current service checks.' }),
      Object.freeze({ source: 'Observed TLS handshake', usefulFor: 'Reviewing the leaf certificate currently presented to one bounded connection.', limitation: 'The endpoint can be shared, proxied or different from the historical log entry.' }),
      Object.freeze({ source: 'Browser-local certificate inventory', usefulFor: 'Comparing explicitly saved Deep observations across domains.', limitation: 'It is deployment-observed history, not comprehensive internet-wide certificate history.' }),
    ]),
    questions: Object.freeze([
      'Was the name found in a log or observed on a live TLS connection?',
      'Are the certificate fingerprint, public key and hostname coverage comparable?',
      'Could a shared certificate, platform or edge explain the relationship?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Review synthetic TLS evidence',
    guideHref: '/resources#glossary',
    guideLabel: 'Read the certificate glossary',
    repositoryDoc: 'docs/application-guide.md',
  }),
  Object.freeze({
    slug: 'domain-investigation-workflow',
    shortTitle: 'Domain investigation guide',
    title: 'A practical domain investigation guide',
    description: 'Move from one domain question to registration, DNS, certificate, website, relationship and case evidence without losing source health or scope.',
    eyebrow: 'Analyst guide',
    summary: Object.freeze([
      'The fastest route through a domain investigation is not always the deepest scan. Start with the decision you need to make, collect only the evidence needed for that decision, and retain the facts that another reviewer must be able to reproduce.',
      'WHOISleuth supports single-domain review, brand sweeps and infrastructure pivots. Network collection and report submission remain explicit actions.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Frame the decision', body: 'State whether you are checking registration, possible impersonation, infrastructure overlap, acquisition readiness, service change or an abuse-reporting lead.' }),
      Object.freeze({ title: 'Collect and compare', body: 'Use Fast for registration-first triage, Deep for richer evidence, and Bulk for consistent peer comparison. In Lookup, choose the Focus that matches the decision, start from At a glance, and open only the Registration, Web and DNS, Relationships and history, Source quality, Case and response, or Advanced evidence families you need. Keep partial sources visible.' }),
      Object.freeze({ title: 'Record facts and actions', body: 'Pin individual evidence, separate analyst assertions, note contradictions, set reviewed case actions and export a response packet only after preflight.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Lookup', usefulFor: 'One target with source-level registration and supporting evidence.', limitation: 'A broad Deep result still represents bounded observations at specific times.' }),
      Object.freeze({ source: 'Bulk', usefulFor: 'Consistent comparison and review queues across a selected set.', limitation: 'Compact Deep does not contain every single-domain evidence field.' }),
      Object.freeze({ source: 'Monitor and cases', usefulFor: 'Retaining decisions, evidence pins, relationships, actions and later changes.', limitation: 'Browser-local history begins only when the analyst deliberately saves it.' }),
    ]),
    questions: Object.freeze([
      'What decision will this collection support?',
      'Which evidence is observed, derived, imported or analyst-authored?',
      'What unknown or contradiction should be carried into the next step?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Try the investigation example',
    guideHref: '/resources#start',
    guideLabel: 'Choose an investigation path',
    repositoryDoc: 'docs/application-guide.md',
  }),
  Object.freeze({
    slug: 'bulk-domain-comparison',
    shortTitle: 'Bulk domain comparison',
    title: 'Compare multiple domains without flattening incomplete evidence',
    description: 'Use Bulk Fast or Bulk Deep collection, source-state filters and two-domain comparisons to prioritise a review queue.',
    eyebrow: 'Bulk triage',
    summary: Object.freeze([
      'Bulk review is most useful when every row follows the same collection contract and incomplete sources stay visible. A failed domain request must not look like a low-risk result, and a missing field must not be treated as observed absence.',
      'WHOISleuth applies explicit pacing and concurrency limits, retains row-level source states, and offers filters, saved views, review queues, relationships and a two-domain comparison over the compact evidence.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Choose a focused set', body: 'Paste a bounded domain list or carry a reviewed shortlist from Discover. Remove unrelated names before collection.' }),
      Object.freeze({ title: 'Select depth and pacing', body: 'Fast emphasizes registration. Bulk Deep adds compact DNS, mail, website, TLS, technology and certificate comparison fields without becoming a full single-domain Deep response.' }),
      Object.freeze({ title: 'Review before acting', body: 'Sort and filter by source state, compare two domains, retain useful relationships, and act only on an explicit selection.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'Per-domain collection state', usefulFor: 'Separating complete, partial, failed and unsettled rows.', limitation: 'A completed request can still contain unavailable individual sources.' }),
      Object.freeze({ source: 'Peer outliers and groups', usefulFor: 'Finding unusual differences and exact shared observations.', limitation: 'The comparison describes only the selected local cohort.' }),
      Object.freeze({ source: 'Saved Bulk sessions', usefulFor: 'Resuming unsettled rows and comparing later bounded sessions.', limitation: 'Sessions are compact browser-local records, not raw response archives.' }),
    ]),
    questions: Object.freeze([
      'Are the rows comparable by scan depth and source completeness?',
      'Is a shared value rare in this set, or common infrastructure?',
      'Which rows need a full Deep Lookup before a decision?',
    ]),
    demoHref: '/demo',
    demoLabel: 'See synthetic Bulk triage',
    guideHref: '/resources#tool-bulk',
    guideLabel: 'Read about Bulk',
    repositoryDoc: 'docs/application-guide.md',
  }),
  Object.freeze({
    slug: 'ip-asn-investigation',
    shortTitle: 'IP and ASN context',
    title: 'Add IP and ASN context without claiming the origin host',
    description: 'Interpret public IP registration, prefixes, routing identifiers and shared infrastructure as bounded investigation pivots.',
    eyebrow: 'Network context',
    summary: Object.freeze([
      'A domain can resolve to a proxy, content-delivery edge, load balancer or shared hosting platform. The registered network and ASN help describe where the observed address sits, but usually do not identify the underlying customer or origin server.',
      'WHOISleuth keeps domain DNS observations, IP RDAP registration and analyst-controlled routing pivots separately attributed. Known shared ranges are qualified locally rather than discarded.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Start from an observed address', body: 'Deep Lookup selects one bounded public endpoint address from collected DNS or TLS evidence and performs one logical IP RDAP enrichment.' }),
      Object.freeze({ title: 'Read the network registration', body: 'Review the holder label, handle, prefixes, country, network type and database freshness as registration context, not hosting attribution.' }),
      Object.freeze({ title: 'Use controlled pivots', body: 'Open a reviewed prefix or ASN in external routing tools only when useful. WHOISleuth does not prefetch those destinations or retain their response.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'DNS and TLS address observation', usefulFor: 'Identifying the public endpoint used by the bounded collection.', limitation: 'The address can differ by location, time, resolver or edge network.' }),
      Object.freeze({ source: 'IP RDAP', usefulFor: 'Registered network, prefix, holder and published abuse-role routes.', limitation: 'Registration does not prove that the holder operates the observed website.' }),
      Object.freeze({ source: 'Common-infrastructure snapshot', usefulFor: 'Qualifying exact reviewed cloud, delivery and resolver ranges.', limitation: 'Coverage is bounded, and a match does not identify a tenant or origin.' }),
    ]),
    questions: Object.freeze([
      'Was the address observed from DNS, TLS, a redirect or imported evidence?',
      'Could a shared edge or platform explain the relationship?',
      'Does a routing pivot add evidence, or only another shared neighbour?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Inspect synthetic network context',
    guideHref: '/resources#glossary',
    guideLabel: 'Review IP and ASN terminology',
    repositoryDoc: 'docs/registry-data-contract.md',
  }),
  Object.freeze({
    slug: 'local-first-osint',
    shortTitle: 'Local-first investigation',
    title: 'Why local-first storage matters for domain investigations',
    description: 'Understand what WHOISleuth keeps in the browser, what reaches public sources, and how deliberate exports preserve portability without hosted custody.',
    eyebrow: 'Privacy and storage',
    summary: Object.freeze([
      'Domain investigations can contain sensitive notes, internal decisions, selected contacts and links between otherwise public observations. Sending every record to a hosted workspace is not always necessary for a solo or small trusted deployment.',
      'WHOISleuth keeps core saved work in IndexedDB under the current browser origin. Network collection still reaches the relevant public sources, but browser-local cases and notes are not automatically synchronised or uploaded.',
    ]),
    steps: Object.freeze([
      Object.freeze({ title: 'Keep collection and retention separate', body: 'Opening a tool does not save its result. The analyst must choose a case, snapshot, watchlist, relationship or export action.' }),
      Object.freeze({ title: 'Back up deliberately', body: 'A versioned workspace archive can be downloaded in encrypted or clearly labelled unencrypted form. The encrypted passphrase is never sent or recoverable.' }),
      Object.freeze({ title: 'Know the durability boundary', body: 'Browser storage can be cleared and does not synchronise across devices. A reviewed encrypted archive remains the portability and recovery boundary.' }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ source: 'IndexedDB workspace', usefulFor: 'Bounded cases, profiles, watchlists, rules, sessions and reviewed observations.', limitation: 'The active unlocked browser workspace is plaintext and same-origin code can access it.' }),
      Object.freeze({ source: 'Workspace archive', usefulFor: 'Backup, transfer, integrity checks and reviewed non-destructive import.', limitation: 'Recipients can read unencrypted exports, and passphrases cannot be recovered.' }),
      Object.freeze({ source: 'Optional hosted monitoring', usefulFor: 'Scheduled compact watchlist checks when explicitly configured.', limitation: 'It is a separate encrypted, shared-workspace capability and not the default storage model.' }),
    ]),
    questions: Object.freeze([
      'Does this fact need to be retained, or only viewed temporarily?',
      'Which fields would an export recipient actually need?',
      'Is an encrypted archive recent enough to recover this workspace?',
    ]),
    demoHref: '/demo',
    demoLabel: 'Explore the storage-safe demo',
    guideHref: '/resources#faq',
    guideLabel: 'Read privacy and export answers',
    repositoryDoc: 'docs/browser-local-data.md',
  }),
]);

export function publicResource(slug: unknown): PublicResource | null {
  return typeof slug === 'string'
    ? PUBLIC_RESOURCES.find((resource) => resource.slug === slug) ?? null
    : null;
}

export { PUBLIC_RESOURCE_SLUGS };
