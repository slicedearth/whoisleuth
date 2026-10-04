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
- SQLite cache format 1 stores distinct canonical hostnames, the full raw-file SHA-256, original row/byte counts, acquisition/import time, publisher-declared metadata and bounded HTTP validators. Raw downloaded files and analyst queries are not retained. Unknown/future cache versions fail closed.
- A database is limited to 512 MiB; the dedicated directory, including old snapshots and provisional output, is limited to 5 GiB and 32 regular private files. SQLite staging receives only the remaining page budget before ingestion. A roughly three-million-row, 80 MiB source needs additional database page/row overhead; these ceilings provide headroom, not a guarantee that every source variant fits. A too-large or malformed refresh leaves the previous snapshot untouched.
- One refresh runs at a time. A valid complete staged database atomically replaces that feed's last-good database. Failed, interrupted, redirected or compressed source responses do not publish provisional rows. Shutdown cancels workers, joins refresh work and removes only files whose recorded ownership still matches.
- Conditional requests use retained ETag/Last-Modified values. A 304 updates `checkedAt`, not the digest, `acquiredAt`, `importedAt` or publisher time. A snapshot is stale if the last successful source check, or a known declared publication time, is older than 36 hours; future clocks are also stale. An undeclared publisher time remains unknown even after a recent 304. `stale: false` is not proof that the publisher is current or coverage is complete.
- Service requests have a 64 KiB uncompressed JSON body ceiling, a 4 KiB header ceiling, at most eight connections, 60 requests/minute after host/origin admission and two concurrent queries. Up to 200 exact hosts and 20 literal terms are accepted within the transfer budget. Canonicalise IDN hosts before transmission; terms match canonical lowercased ASCII/punycode text, not an expanded Unicode spelling or a regular expression.
- Queries execute in separately terminable workers with a five-second deadline, 128 MiB old-generation heap and a 64 MiB SQLite heap ceiling. Literal substring searches can scan the index and may time out on a larger/slower host; a timeout is unavailable evidence, not zero matches. The result ceiling is 200 distinct candidates shared equally across selected feeds. Replies are capped at 512 KiB. Truncation is explicit; original matching-row totals remain unknown because the index aggregates duplicate hostnames.

Operational errors are fixed, bounded descriptions, not upstream bodies or exception messages. Latest-refresh failures are current-process status, not a durable error history; persisted snapshot/check clocks still disclose age after restart. The service does not log queries, source bodies, tokens or gateway credentials. Configure the proxy, supervisor and host logging to preserve those limits; their policies are separate from this implementation. At most one last-good snapshot per feed persists until replaced or explicitly removed by the operator. Disabling the website connection or deselecting a feed does not delete its database. Cache backups and any source redistribution require their own retention/licence decision.

## Roll back or remove

Unset `WHOISLEUTH_DOMAIN_FEED_ENABLED` first and restart/redeploy the application's backend. Manual offline review remains available. Stop the service with SIGINT or SIGTERM and confirm its process has ended before removing cache files, credentials or proxy configuration. Normal shutdown joins outstanding workers and removes its lock/provisional output; it deliberately retains last-good databases. Remove those databases only when retention is no longer needed.

## Local verification

`node --test test/domain-feed-service.test.mts test/domain-feed-api.test.mts` uses synthetic domain rows, real temporary SQLite databases, worker deadlines, injected source responses and loopback HTTP only. It covers default disconnection, authentication/origin admission, maximum selections, malformed/oversized input, credential redirects, interruption, conditional checks, stale publisher metadata, atomic last-good preservation and owned cleanup. It does not measure a full live feed, prove production proxy/TLS configuration or activate an external host.
