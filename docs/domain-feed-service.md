# Optional domain feed service

The application works without this service. Manual offline feed review stays available; neither opening the application nor building the website downloads a feed. Hosted feed search is disconnected by default. The standalone service maintains an operator-selected cache independently of website builds.

## Prepare the service

Use the repository's supported Node 24 runtime with its built-in SQLite support and the existing application dependencies. Run the service from a reviewed checkout; it is not part of the installed CLI package. Choose a dedicated, private cache directory owned by the service account. Do not reuse an application workspace or a directory containing unrelated files.

Generate a random bearer token locally, for example with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`. Keep the token in protected runtime configuration, never source control, browser settings, URLs or access logs. Accepted tokens contain 43–128 base64url characters; token equality is checked using a constant-time comparison.

Create an ignored, mode-0600 environment file outside the public checkout with these service settings, replacing the placeholders:

```dotenv
WHOISLEUTH_DOMAIN_FEED_SERVICE_TOKEN=replace-me
WHOISLEUTH_DOMAIN_FEED_CACHE_DIRECTORY=/srv/domain-feed-cache
WHOISLEUTH_DOMAIN_FEED_SERVICE_PORT=8787
WHOISLEUTH_DOMAIN_FEED_SERVICE_FEEDS=tif-mini,nrd7
```

Feed IDs must come from the shared catalogue: `tif-full`, `tif-medium`, `tif-mini`, `nrd7`, `nrd14-8`, `nrd21-15`, `nrd28-22`, `nrd35-29`, `entropy7`, `entropy14`, `entropy30`. These refer only to the catalogue's fixed plain-domain source URLs. No request can supply a URL, trigger a refresh, scan a target or select an unconfigured feed. Review the catalogue's source licence and attribution before hosting or redistributing its data; current entries identify GPL-3.0 source data. Membership is candidate nomination, not an abuse or availability verdict. Recent-domain cohorts and entropy subsets have different meanings and incomplete coverage.

Start the service explicitly:

```sh
node --env-file=/etc/domain-feed-service.env tools/domain-feed-service.mts --serve
```

This command starts the selected feeds' first refresh and then refreshes them sequentially every six hours. It listens only on `127.0.0.1`, with no public refresh endpoint. Each cache directory has one exclusive service lock; a second process fails closed. Use the host's process supervisor to manage restarts. A crash can leave the lock or provisional files behind: confirm the previous process is stopped before manually removing its lock or provisional files. Do not automate removal of another process's files.

For a remote host, place an independently configured HTTPS reverse proxy in front of the loopback listener. The proxy must replace the upstream Host with the exact loopback host and port, must not forward browser Origin or cookies, and must preserve the backend's bearer authentication. Requests with a different Host, a cross-site Origin, duplicate authentication headers or a missing/invalid token are rejected. Limit access to the application's backend; do not expose the loopback listener publicly. TLS, proxy and firewall activation remain deployment decisions and are not performed by the setup command.

## Connect the application's backend

Once the service is reachable, configure the application's server-side environment with the same bearer token as the service:

```dotenv
WHOISLEUTH_DOMAIN_FEED_ENABLED=1
WHOISLEUTH_DOMAIN_FEED_URL=https://feed-service.example
WHOISLEUTH_DOMAIN_FEED_TOKEN=replace-me
```

The service URL must be a fixed root origin with no credentials, query or fragment. Remote connections require HTTPS on its default port and use the existing public-address validation and pinned connection. A same-host deployment may instead use `http://127.0.0.1:8787`; this narrow numeric-loopback transport does not alter the shared public-fetch protections. Redirects are never followed with credentials.

An optional access gateway can use `WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_ID` and `WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_SECRET` as a complete pair. They become server-to-service headers only. Do not put these values in public/frontend environment variables. Source-feed refresh requests do not receive service credentials or analyst selections.

The browser sends an explicit query to its own authenticated `POST /api/domain-feed` endpoint. Existing login, same-origin admission, rate and bounded-search concurrency checks apply in both server adapters. The endpoint accepts `{ "operation": "status" }` or `{ "operation": "query", "feedIds": ["tif-mini"], "selection": { "hosts": ["exact.example"], "terms": ["brand"] } }`. Only selected literal terms, canonical exact hosts and feed IDs reach the service. Brand profile identifiers, login cookies and target scan options do not. Local Brand context is applied after reply validation. A status request checks configuration/cache health; it does not download source data.

When disabled or incompletely configured, status returns `enabled: false` without a request and queries report disconnected. The ordinary Lookup, Bulk and monitoring paths do not contact this service. Never enable it merely to remove a disconnected message.

## Bounds, cache and freshness

- Feed acquisition is streaming and worker-isolated: at most 256 MiB, 10 million rows, 1,024 bytes per line and ten minutes per refresh. Awaited batches contain at most 256 hostnames; there is no complete-feed JavaScript array.
- SQLite caches store distinct canonical hostnames, the full raw-file SHA-256, original row/byte counts, acquisition/import time, publisher-declared metadata and bounded HTTP validators. The current cache adds an immutable sequence of edition metadata and bounded prior membership; the previous cache is read and upgraded only after a successful refresh. Raw downloaded files and analyst queries are not retained. Unknown/future cache versions fail closed.
- A database is limited to 512 MiB; the dedicated directory, including old snapshots and provisional output, is limited to 5 GiB and 32 regular private files. SQLite staging receives only the remaining page budget before ingestion. A roughly three-million-row, 80 MiB source needs additional database page/row overhead; these ceilings provide headroom, not a guarantee that every source variant fits. A too-large or malformed refresh leaves the previous snapshot untouched.
- One refresh runs at a time. A valid complete staged database atomically replaces that feed's last-good database. Failed, interrupted, redirected or compressed source responses do not publish provisional rows. Shutdown cancels workers, joins refresh work and removes only files whose recorded ownership still matches.
- Conditional requests use retained ETag/Last-Modified values after the cache supports edition history. A legacy cache requests one complete response so repeated 304s cannot prevent its staged migration. A 304 updates `checkedAt`, not the digest, `acquiredAt`, `importedAt` or publisher time. A snapshot is stale if the last successful source check, or a known declared publication time, is older than 36 hours; future clocks are also stale. An undeclared publisher time remains unknown even after a recent 304. `stale: false` is not proof that the publisher is current or coverage is complete.
- Service requests have a 64 KiB uncompressed JSON body ceiling, a 4 KiB header ceiling, at most eight connections, 60 requests/minute after host/origin admission and two concurrent queries. Up to 200 exact hosts, 20 positive literals and 20 negative literals are accepted within the transfer budget. Canonicalise IDN hosts before transmission; terms match canonical lowercased ASCII/punycode text, not an expanded Unicode spelling or a regular expression.
- Queries execute in separately terminable workers with a five-second deadline for requesting termination, 128 MiB old-generation heap and a 64 MiB SQLite heap ceiling. An unanswered service connection is closed after six seconds. Neither timer is a hard CPU-preemption guarantee for native SQLite work; the query slot remains occupied until the worker exits. Literal substring searches can scan the index and may time out on a larger/slower host; a timeout is unavailable evidence, not zero matches. The result ceiling is 200 distinct candidates shared equally across selected feeds. Replies are capped at 512 KiB. Truncation is explicit; original matching-row totals remain unknown because the index aggregates duplicate hostnames.

Operational errors are fixed, bounded descriptions, not upstream bodies or exception messages. Up to 64 dated refresh outcomes per source persist across restarts: updated, unchanged, failed, interrupted or cleanup failed. The separate private history database contains no matching inputs, target hostnames, credentials or exception text. The service does not log queries, source bodies, tokens or gateway credentials. Configure the proxy, supervisor and host logging to preserve those limits; their policies are separate from this implementation. Disabling the website connection or deselecting a feed does not delete its databases. Cache backups and source redistribution require their own retention/licence decision; include the source's applicable licence and attribution with redistributed data.

## Review retained editions

An explicit history request reviews one selected feed and one matching rule set. It uses the same authentication, request bounds, worker deadline and literal matching as a current query. The request adds `"operation": "history"` and `"cursor": null`; later pages send the returned cursor. Positive terms use OR matching; optional `negativeTerms` exclude matching hostnames before the result limit. Brand identifiers and campaign details remain browser-local.

The cache retains metadata for up to eight distinct successive editions. A repeated 200 response with the same complete-file digest, or a 304 response, does not create an edition or replace the original acquisition clock. Reappearance of an earlier digest after a different edition is a new local edition. A backwards declared publication clock is rejected rather than replacing last-good data.

Prior membership is retained newest first within the existing disk budget. Metadata explicitly records when a complete older membership does not fit; a partial copy is discarded. Eight metadata records do not promise eight complete feeds. The current edition remains available even when older membership is pruned.

Each page returns at most 200 matches from one immutable edition. Cursors bind the feed, cache identity and exact matching inputs, and hold the upper edition fixed while paging. Changing rules requires a new review; replacing the cache invalidates its cursors. Pruned editions return a gap and the next available position, not an empty successful search. A finished cursor can request later local editions explicitly. There is no automatic catch-up, admission to a Watchlist or target collection.

Local edition history is not the publisher's complete history. Missed rolling cohorts cannot be reconstructed from a later snapshot. Failed refresh intervals, pruned memberships and absent upstream publication clocks remain visible limitations. A successful query means the retained edition was searched, not that the Brand or internet is fully covered.

An unreadable refresh-outcome database does not hide an independently valid
source snapshot. Status and current queries warn that the latest refresh could
not be confirmed; history returns `attempts: null` for unavailable outcomes,
distinct from an empty retained outcome list. Edition data is still validated.

## Roll back or remove

Unset `WHOISLEUTH_DOMAIN_FEED_ENABLED` first and restart/redeploy the application's backend. Manual offline review remains available. Stop the service with SIGINT or SIGTERM and confirm its process has ended before removing cache files, credentials or proxy configuration. Normal shutdown joins outstanding workers and removes its lock/provisional output; it deliberately retains last-good databases. Remove those databases only when retention is no longer needed.

## Local verification

`node --test test/domain-feed-service.test.mts test/domain-feed-api.test.mts test/domain-feed-history.test.mts` uses synthetic domain rows, real temporary SQLite databases, worker deadlines, injected source responses and loopback HTTP only. It covers disconnection, authentication/origin admission, bounded selections, malformed input, credential redirects, interruption, conditional checks, stale publication clocks, atomic replacement, owned cleanup, retained editions, cursor binding and explicit gaps.

For an already downloaded, licence-reviewed source, replay the full local file without network access:

```sh
node tools/domain-feed-qualification.mts tif-mini /data/source.txt /data/private-cache
```

The report contains source identity, full bytes/rows, duplicates, database bytes, ingestion/query durations and sampled memory—not hostnames. These are measurements on that machine, not deployment promises or universal timing gates. The tool never downloads a source, enables a service or contacts listed domains.
