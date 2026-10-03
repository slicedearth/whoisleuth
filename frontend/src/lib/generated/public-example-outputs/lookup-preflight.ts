// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "lookup-preflight",
  "direction": "output",
  "title": "Deep Lookup preflight",
  "format": "terminal",
  "command": "whoisleuth lookup example.test --deep --plan",
  "summary": "A request-free plan naming intended source families and disclosures.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nWHOISleuth lookup preflight\nTarget: example.test\nType: domain\nMode: deep\nNetwork requests made: no\nCollection requires network: yes\n\nPlanned collection:\n  rdap\n    Collect authoritative registration or allocation evidence where supported.\n    Disclosure: The normalised target is sent to the applicable RDAP bootstrap and service endpoints.\n  whois\n    Collect separately attributed registry and referral publications.\n    Disclosure: The normalised target is sent over bounded TCP connections to applicable WHOIS services.\n  domain_evidence\n    Collect bounded DNS, HTTP, TLS, page-identity, technology, and security-posture evidence.\n    Disclosure: DNS, TLS and website probes use the submitted hostname. Registration-delegation queries use the registrable domain.\n  registrar_rdap (conditional)\n    Collect a separately attributed registrar RDAP publication when registry evidence advertises one.\n    Disclosure: The registrable domain is sent to the advertised registrar RDAP service.\n  network_context (conditional)\n    Add allocation and routing context for public addresses observed during domain collection.\n    Disclosure: Observed public addresses may be sent to applicable RDAP services.\n\nLimitation: This is a local preflight. It does not test source availability, feature configuration, cache state, redirects, referrals, or the exact number of requests a completed lookup may require.\n\nLimitation: Conditional sources may be skipped when prerequisite evidence is absent, unsupported, disabled, or unavailable.\n",
  "large": false,
  "downloadName": "synthetic-lookup-preflight.txt",
  "mediaType": "text/plain"
} as const;
