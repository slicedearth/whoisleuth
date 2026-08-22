export const PRIVACY_DATA_FLOW_SUMMARY = Object.freeze({
  version: 1,
  capabilityCount: 32,
  cliOperationCount: 47,
  cliVariantCount: 16,
  schemaFamilyCount: 17,
  schemaContractCount: 84,
  privacyProfileCount: 44,
  consumerFlowCount: 139,
  principalBoundaries: Object.freeze([
    "Transient processing",
    "Browser-local retention",
    "Deliberate local-file export",
    "Hosted bounded processing",
    "Configured worker storage",
    "Third-party disclosure",
    "Offline processing with no request"
  ]),
  summary: "Contract whoisleuth.privacy-data-flow-catalogue version 1 covers 32 capability families, 47 CLI operations, 16 conditional CLI variants, 84 registered compatibility entries, 44 privacy profiles and 139 consumer flows. It distinguishes transient processing, browser-local retention, deliberate local-file export, hosted bounded processing, configured worker storage, third-party disclosure and offline processing with no request.",
  limitations: Object.freeze([
    "The catalogue contains fixed contract metadata only; it contains no target, evidence value, personal data, raw contact, credential, cookie, authorisation value, runtime secret, complete query-bearing URL, unnecessary path or local filesystem detail.",
    "Retention and export are independent: a transient projection can be deliberately exported, and retained state is not exported unless a separate deliberate path is declared.",
    "Offline operations make no request and do not inherit a capability family's possible network disclosure.",
    "Missing, unavailable, unsupported, stale, blocked, partial or unobserved evidence never establishes absence, safety, ownership, control, activity or maliciousness.",
    "A normalised outcome marked not_declared_for_boundary is outside that boundary's current output vocabulary; it is not evidence that the state cannot occur upstream or that evidence is absent.",
    "The catalogue describes current checked-in contracts. It does not enable a capability, make a request, grant authorisation, inspect a deployment or create a legal conclusion."
  ]),
});
