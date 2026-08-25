# Current product boundaries

WHOISleuth is a free, privacy-conscious, local-first investigation tool for one
analyst. It collects or reviews bounded domain, registration, DNS, transport,
website, certificate, routing, relationship and analyst-supplied evidence while
keeping provenance, source health and limitations visible.

The product supports three jobs:

1. **Investigate** source-attributed evidence and identify what is established,
   incomplete, contradictory or worth checking next.
2. **Respond** by preparing and recording analyst-reviewed actions without
   automatically contacting a third party or applying a control.
3. **Assure** evidence, change, integrity, control or remediation under the
   limits of the relevant source or cryptographic family.

## Execution boundaries

Every operation belongs to a declared execution plane:

- **Browser-local:** derivation, review, bounded storage and deliberate export
  in the current browser profile.
- **Hosted bounded passive:** authenticated, budgeted collection through the
  shared Express or Netlify boundary.
- **Local CLI offline:** parsing, comparison, verification, reporting and
  planning without an external request.
- **Local CLI network:** explicit bounded collection whose help and plan state
  the target and disclosure boundary.
- **Local CLI authorised active:** an isolated, explicitly acknowledged action
  for an owned or authorised target.
- **Optional worker:** separately configured bounded monitoring that is not a
  general evidence-custody service.

Fast, Compact, Deep, monitoring, offline review and authorised active actions
remain separate contracts. Opening a page, guide, saved record or catalogue
does not silently start collection.

## Product and evidence rules

- The core remains useful without an individual account, hosted investigation
  database, cross-device synchronisation or paid intelligence provider.
- Registry, registrar, WHOIS, DNS, routing, certificate, TLS, HTTP, provider,
  imported, browser-local, analyst-supplied and derived evidence remain
  separately attributed.
- Missing, blocked, stale, malformed, partial or unsupported evidence never
  becomes absence, safety, ownership, control, intent or remediation.
- Availability remains authority-aware. Supporting website, registrar or
  analyst signals cannot decide whether a domain exists.
- Risk is explainable prioritisation, not a verdict. Opportunity is limited to
  acquisition review.
- DNSSEC, RPKI, DANE/TLSA, PKIX, signatures and timestamp evidence retain their
  own inputs, validation states and limitations.
- Response packets, defensive exports and other actions require deliberate
  human review. WHOISleuth does not submit, block, acquire or change external
  infrastructure automatically.

## Storage and collaboration

Ordinary workspace state remains in the current browser profile. Portable
reviewed evidence is the supported interoperability path. Optional encrypted
hosted monitoring stores only its documented compact projection under operator
control.

WHOISleuth does not provide multi-tenant accounts, shared case custody,
background workspace synchronisation, role-based collaboration or automated
enforcement. Those are outside the current product rather than partially
implemented features.

## Compatibility

Version 2 directly supports the exact durable formats written by the latest
public v1 release, 1.47.4, and the current v2 writers documented in the
[Case portability reference](case-contracts.md) and
[portable compatibility reference](portable-domain-contracts.md). Reader-only
historical formats and unreleased development checkpoints are not public
compatibility commitments.

Once v2 is public, its durable schemas, exports, browser stores and CLI
contracts become supported boundaries. A later release must preserve them or
provide an explicit, tested and non-destructive migration or export path.
Malformed and unsupported future data fails closed; browser-local future data
is preserved without rewrite where its storage contract promises that
behaviour.

## Architecture

WHOISleuth is a TypeScript modular monolith. Runtime-neutral contracts and
domain rules sit below browser, CLI, server, function and presentation
adapters. Architecture checks prevent runtime and presentation dependencies
from leaking back into shared contract packages.

See the [architecture orientation](architecture.md),
[threat model](threat-model.md), [browser-local data contract](browser-local-data.md)
and [privacy notice](../PRIVACY.md) for the current implementation and safety
boundaries.
