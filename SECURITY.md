# Security policy

## Supported versions

Security fixes are applied to the latest released WHOISleuth application and
CLI version. Older releases are not maintained as separate security branches.
Upgrade to the latest release before reporting a problem that may already have
been corrected.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/slicedearth/whoisleuth/security/advisories/new)
for suspected vulnerabilities in the application, CLI, release process, or
deployment defaults. Do not open a public issue for an undisclosed security
problem.

Include the affected version, the smallest reproducible example, expected and
observed behaviour, and the likely impact. Use reserved or synthetic domains
and remove credentials, session material, personal information, private case
data, and raw registration records before submitting evidence.

Ordinary defects, feature requests, and questions that do not expose a security
weakness can use the public issue tracker.

## Scope and response

Reports are assessed against WHOISleuth's documented trust boundaries,
including its local-first workspace, bounded network collection, shared
deployment password, and optional hosted monitoring. The accepted
[product boundary](https://github.com/slicedearth/whoisleuth/blob/main/docs/product-boundary.md) and
[threat model](https://github.com/slicedearth/whoisleuth/blob/main/docs/threat-model.md) describe those boundaries, principal abuse
cases, controls, residual risks, and deliberate non-goals. A source outage,
partial registry response, or heuristic disagreement is not by itself a
security vulnerability, but unsafe handling of those states may be.

Confirmed reports will be handled through a private advisory until a fix and
coordinated disclosure are ready. No bounty or guaranteed response time is
offered.
