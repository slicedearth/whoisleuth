# Defensive domain exports

Bulk can export filtered, high-risk registered domains in four local text formats and two structured interchange formats:

- `domains`: one canonical domain per line;
- `hosts`: `0.0.0.0 domain` entries;
- `dnsmasq`: `address=/domain/0.0.0.0` rules;
- `rpz`: policy-zone-relative apex and optional wildcard owners with an absolute `CNAME .` response target.
- `STIX 2.1`: a JSON bundle with separate domain observations, heuristic Indicators, and `based-on` relationships.
- `MISP event JSON`: an unpublished, organisation-only event containing non-IDS domain attributes for analyst review.

An entry is eligible only when its Bulk result is registered, for sale, or expiring; has a Risk score of at least 70; is not trusted by the active Brand Profile; and did not fail its lookup. The active Bulk filters are applied before export. Domains are canonicalised, deduplicated, sorted, and capped at 2,000 text entries after inspecting at most 8,000 input records. STIX exports are capped at 1,000 domains, producing at most 4,001 objects.

Every file includes its generation time and a false-positive warning. These are heuristic candidate indicators, not declarations that a domain is malicious. WHOISleuth never applies, uploads, or submits the generated rules automatically. Review the domains and test the target resolver or blocking system before deployment.

The response-policy export uses a 60-second TTL and a bounded 32-bit serial derived from the generation time. Its QNAME owners are relative and are interpreted beneath the policy-zone origin selected by the receiving DNS configuration; the `CNAME .` response target remains absolute. The hosts and dnsmasq formats use the local IPv4 sink address `0.0.0.0`; environments requiring a different policy should transform the reviewed file after export.

STIX exports omit confidence and malicious-activity classifications. Risk scores are custom heuristic provenance. Version 2 uses Observed Data only when the source time is known; otherwise a Note preserves the candidate's context without inventing a sighting. Indicator validity begins at export creation, separately from source observation time.

MISP event JSON exports use undefined threat level, initial analysis state, organisation-only distribution, and `published: false`. Domain attributes set `to_ids: false` and disable correlation. Version 2 omits optional seen times when the source time is unknown. Importing does not publish the event or approve operational use.

The Cases view can also preview bounded STIX 2.1 bundles and MISP events as
external intelligence. A local import does not restore Bulk results or treat
the exported heuristic as confirmed maliciousness. It requires an existing
case and stores supported claims as separately attributed assertions. See
[External findings and intelligence import](external-findings-import.md).
