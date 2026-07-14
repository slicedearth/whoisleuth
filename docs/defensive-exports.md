# Defensive domain exports

Bulk analysis can export filtered, high-risk registered domains in four local text formats:

- `domains`: one canonical domain per line;
- `hosts`: `0.0.0.0 domain` entries;
- `dnsmasq`: `address=/domain/0.0.0.0` rules;
- `rpz`: absolute apex and wildcard `CNAME .` response-policy records.

An entry is eligible only when its Bulk result is registered, for sale, or expiring; has a Risk score of at least 70; is not trusted by the active Brand Profile; and did not fail its lookup. The active Bulk filters are applied before export. Domains are canonicalised, deduplicated, sorted, and capped at 2,000 entries after inspecting at most 8,000 input records.

Every file includes its generation time and a false-positive warning. These are heuristic candidate indicators, not declarations that a domain is malicious. WHOISleuth never applies, uploads, or submits the generated rules automatically. Review the domains and test the target resolver or blocking system before deployment.

The response-policy export uses a 60-second TTL and a bounded 32-bit serial derived from the generation time. Its zone origin remains the responsibility of the receiving DNS configuration. The hosts and dnsmasq formats use the local IPv4 sink address `0.0.0.0`; environments requiring a different policy should transform the reviewed file after export.
