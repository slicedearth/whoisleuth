# Source-qualified infrastructure snapshots

The retained infrastructure inventory combines admitted browser-local evidence,
not all infrastructure belonging to an organisation. It makes no requests on
import, opening a view, filtering, selecting a host or comparing history.

Import a `whoisleuth.infrastructure-observation` version 1 document through the
existing external-findings import. The exact bounded snapshot is retained as one
Case evidence pin. Review the preview before confirming the mutation. The source
descriptions are supplied provenance, not authenticated source identities.
Legacy DNS and certificate imports remain readable: an old Case-domain DNS pin
does not acquire a precise queried hostname or complete collection scope.

The document records an explicit target, selected full hostnames and DNS types,
collection mode, observation time and coverage. Each DNS response retains its
queried name, response owner, type, outcome and source. An alias link uses its
record owner; an address returned after an alias belongs to the returned address
owner, not automatically to the initial query. Only retained alias links are
drawn. Links from different dates do not prove one contemporaneous alias chain.
No-data, NXDOMAIN, failed and not-checked outcomes remain different observations
and do not decide registration availability.

Certificate-log and TLS observations keep distinct sources and exact SHA-256
identities. Full names remain visible; `*.example.test` is a wildcard pattern,
not an enumerated hostname, and cannot be selected for Lookup or Bulk.
Certificate names alone do not establish current resolution or activity.

DNS operator, observed edge/CDN/proxy, application platform, runtime, embedded
dependency, address registration, routing origin and independently observed
origin are distinct source-qualified roles. Routing requires a routing source;
IP-registration data cannot substitute for it. Edge indicators cannot identify
a hidden origin. Multiple providers and conflicting observations remain separate.
The snapshot reader does not derive physical location, responsibility, ownership,
safety or maliciousness from these roles.

## Review and deliberately act

Open the inventory from saved-work search. Type, source and date filters apply to
the admitted set before pagination. Inspect one snapshot to review every retained
DNS outcome, certificate name and provider role, or select two snapshots in
chronological order to compare. Export preserves the exact snapshot format.
Topology search applies to the complete admitted one-hop relationship set, not
the current source page. Its diagram has a 50-relationship budget; the paginated
source list and exact snapshot review retain access to evidence beyond the diagram.

Lookup links fill the selected target for review without submitting it. Explicitly
selected hostnames can be prepared in existing Bulk. That handoff does not scan,
recursively expand targets, change a watchlist or enrol a host in monitoring.
Use the existing reviewed Lookup/Bulk/Monitor collection plans and explicit
save actions to collect or retain another observation.

## Historical comparison and CLI

Source, mode and exact selection scope must match, and the later snapshot must
have a strictly later observation time. Newly observed means newly present in
retained evidence, not newly created. A value not returned by a complete,
comparable selected collection is labelled **not returned**, never confirmed
absence or disappearance. Failed, partial, limited, changed-source and
incomparable snapshots cannot generate removal findings. Equal-time observations
have no temporal order. Provider-reported history stays labelled separately from
supplied local observations.

Comparison rows retain the exact DNS query, response owner and record type, or
the certificate SHA-256, alongside their source and observation clocks. Labels
are presentation only: relationship groups and graph exports use canonical
entity identities, including when long nameserver-set labels look identical.

Derived relationship-group, graph-node and cluster IDs can change when their
identity calculation changes, including for short labels. They are not durable
cross-export keys; use the canonical `entityId` where provided. Historical groups
without it use their complete retained value. Graph fields named `canonical`
and `value` are bounded display text, not a replacement for that identity. Inspect
the contributing Case evidence for full nameserver members. Component selections
and cluster adjustments are transient and are not persisted review history.

The existing offline command shares the website reader and comparison owner:

```sh
whoisleuth review-evidence infrastructure-observation.json --json
whoisleuth review-evidence infrastructure-comparison.json --json
```

The comparison input is exactly:

```json
{
  "schema": "whoisleuth.infrastructure-comparison.input",
  "version": 1,
  "earlier": { "...": "complete version-1 snapshot" },
  "later": { "...": "complete version-1 snapshot" }
}
```

The placeholders above are illustrative, not valid evidence. See the reserved
fixture in `test/fixtures/infrastructure-observations/` for an exact snapshot.
The CLI performs no DNS, registry, BGP, TLS, HTTP or provider request.

Changed or incomplete latest retained pairs surface as existing local Review
Items with supporting Case navigation. Complete earlier snapshots remain
available as stronger baselines; later failures do not rewrite them. There is no
new history store or scheduling engine.

## Resource and compatibility boundary

One snapshot is limited to 128 KiB, 128 selected hostnames, six DNS types, 16
source identities, 512 DNS response rows with at most 32 values each, 32
certificate observations with at most 128 exact names each, 128 role observations
and 12 bounded limitations. Bounds reject oversized documents rather than
silently prune accepted snapshot evidence. Existing Case/workspace quotas still
apply. Projection/diagram budgets may admit a smaller disposable view, with
incomplete coverage disclosed; exact snapshot review/export remains available.

Version 1 has exact keys and refuses future versions. Existing external-findings
version 4 and typed version-1 row imports preserve their historical meaning;
version 5 adds the optional exact infrastructure snapshot. No external discovery
API, new provider, dependency, collector or automatic request is required.
Current snapshot and version-5 findings exports use compact UTF-8 JSON with a
terminal line feed so the emitted representation stays within its parser ceiling.
An offline comparison input is bounded to two snapshot budgets plus 1 KiB of
framing. Historical version-4 fixture bytes and reader meaning remain unchanged;
new typed row conversions emit version 5.
