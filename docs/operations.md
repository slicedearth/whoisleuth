# Operations and deployment

This guide covers the shared-login boundary, reverse-proxy trust, feature
policy, optional integrations, request controls, scheduled monitoring, Netlify
deployment, and the public deployment self-check.

## Authentication boundary

WHOISleuth uses one deployment-wide password rather than individual accounts.
Set:

- `SITE_PASSWORD` to the shared Console password; and
- `SESSION_SECRET` to a separate random signing secret, such as 32 random bytes
  encoded as hex.

Every investigation API route validates the signed session independently. The
login and boolean session-status routes are the narrow anonymous API exceptions
needed to enter the Console and render public navigation. Direct anonymous
navigation to protected pages returns to sign-in.

Sessions are stateless and valid for up to 30 days. Signing out clears the
cookie in that browser but cannot revoke a copied token. Rotate
`SESSION_SECRET` to invalidate all outstanding sessions. If an older deployment
omits it, the application derives a slower signing key from `SITE_PASSWORD`,
but an independent secret is recommended.

The shared login provides no individual identity, role, per-user audit trail,
or selective revocation. Every signed-in user can manage the same optional
hosted scheduled-watchlist state. Ordinary cases, profiles, and watchlists stay
in each browser profile.

## Reverse proxies

When Express runs behind a trusted reverse proxy, set `TRUST_PROXY=1` only if:

1. the proxy overwrites forwarded client headers; and
2. clients cannot connect directly to the Node process.

This lets per-IP limits use the trusted last-hop client address and lets
proxied HTTPS requests receive the appropriate transport handling. Other
forwarded values remain ignored. Without the setting, proxied users share the
proxy socket's request-limit bucket.

Do not enable proxy trust on a directly internet-facing Node process, where a
client could forge forwarded headers.

## Emergency feature switches

Set a switch to `1`, `true`, `yes`, or `on` to disable that hosted feature:

| Environment variable | Effect |
| --- | --- |
| `WHOISLEUTH_DISABLE_LOOKUP` | Blocks unified Lookup and Bulk submissions. |
| `WHOISLEUTH_DISABLE_RDAP` | Blocks direct RDAP and omits it from unified Lookup and availability. |
| `WHOISLEUTH_DISABLE_WHOIS` | Blocks direct WHOIS and omits it from Deep Lookup and availability. |
| `WHOISLEUTH_DISABLE_AVAILABILITY` | Blocks direct availability and omits it from unified Lookup. |
| `WHOISLEUTH_DISABLE_DNS_INTELLIGENCE` | Stops evidence and posture DNS queries while retaining transport DNS needed by enabled endpoints. |
| `WHOISLEUTH_DISABLE_WEBSITE_PROBE` | Stops homepage and favicon requests while retaining registration analysis. |
| `WHOISLEUTH_DISABLE_TLS_INTELLIGENCE` | Stops the one-connection TLS profile. |
| `WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY` | Blocks Certificate Transparency search. |
| `WHOISLEUTH_DISABLE_DOMAIN_POSTURE` | Blocks official-domain posture audits. |

The authenticated capability report comes from the same policy enforced by
Express and direct functions. A disabled endpoint returns HTTP 503 with
`errorCode: FEATURE_DISABLED`. Unified Lookup keeps disabled optional sources
explicit instead of treating them as absent evidence.

If a requested Deep source is disabled, the observation is marked incomplete
for persistence comparisons. Existing Deep-only case and watchlist fields are
not erased by a skipped source.

Express reads these values for each request. A serverless platform may require
an environment update or a new function instance before a changed value takes
effect.

## Optional external intelligence

External adapters are disabled by default and run only for a Deep,
non-compact single-domain Lookup when the analyst selects them.

| Adapter | Enablement | Target disclosed | Important boundary |
| --- | --- | --- | --- |
| Archived public scan verdicts | `WHOISLEUTH_ENABLE_URLSCAN=1` and `URLSCAN_API_KEY` | Canonical registrable domain | Searches existing records only. It never submits a scan. |
| Archived malware-host records | `WHOISLEUTH_ENABLE_URLHAUS=1` and `ABUSECH_AUTH_KEY` | Canonical registrable domain | Performs one fixed host lookup. It never submits a URL, sample, or report. |
| Retained malware indicators | `WHOISLEUTH_ENABLE_THREATFOX=1` and `ABUSECH_AUTH_KEY` | Canonical registrable domain | Performs one exact-match search. It never submits an indicator or sample. |

The legacy `URLHAUS_AUTH_KEY` remains accepted for the malware-host adapter.

Each adapter has bounded response size, result count, timeout, concurrency, and
fair-use counters. It follows no credential-bearing redirect and keeps no
provider cache. Normalized results stay transient and outside browser-local
stores and structured Lookup exports.

Provider terms, privacy, commercial-use, attribution, retention, caching, and
redistribution decisions are declared in the versioned provider contract.
Review them again before enabling an adapter for a different deployment or use
case. A miss, outage, expired record, quota response, or unsupported target is
never evidence of safety.

The connector contract under `lib/threat-intelligence-contract.mts` defines a
bounded future integration boundary. It does not load arbitrary plugin code or
enable a provider on its own.

## Request limits and operation admission

Express and functions share fixed-window request controls:

| Route family | Default ceiling |
| --- | ---: |
| Login | 10 attempts per 5 minutes per client IP |
| Lookup, RDAP, WHOIS, availability, Certificate Transparency, and posture | 1,000 requests per minute per client IP |
| Scheduled-monitor management | 60 authenticated requests per minute per warm runtime and signed session, plus the general API limit |

An exceeded limit returns HTTP 429 with `Retry-After`. The in-memory limiter is
global to one Express process but local to each warm serverless instance. It is
a burst control, not a distributed-abuse boundary or an upstream allowance.

Netlify adds code-based per-IP rules for login and the main Lookup route. Check
the deploy log to confirm that both rules were applied. Direct function paths
still enforce function-level authentication, policy, rate, and concurrency
checks.

Network-heavy authenticated operations also acquire an immediate lease:

| Operation class | Included work | Per session | Per runtime instance |
| --- | --- | ---: | ---: |
| `registry_light` | Fast Lookup, RDAP, Fast availability | 12 | 36 |
| `registry_deep` | Deep Lookup, WHOIS, Deep availability | 4 | 12 |
| `certificate_search` | Certificate Transparency | 2 | 4 |
| `posture_audit` | Official-domain posture audit | 3 | 8 |

Exhausted concurrency returns HTTP 429 with
`NETWORK_CONCURRENCY_LIMITED`. Leases are released after success or failure and
use irreversible session fingerprints rather than bearer tokens.

### Optional distributed operation controls

Set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to enforce the
same concurrency limits across runtime instances. An optional
`WHOISLEUTH_BUDGET_NAMESPACE` provides a 1 to 64 character deployment prefix.
No additional package is required.

The provider stores only an operation class, opaque lease identifier, expiry,
and one-way session fingerprint. It never receives query targets, responses,
evidence, notes, profiles, or session tokens. Provider failure returns HTTP 503
with `NETWORK_BUDGET_UNAVAILABLE` rather than silently reverting to local-only
limits.

`WHOISLEUTH_OPERATION_USAGE_LIMITS` can add global and feature-specific daily
and fixed 30-day ceilings:

```json
{
  "daily": 2000,
  "monthly": 20000,
  "features": {
    "bulk_deep": { "daily": 250, "monthly": 2500 },
    "certificate_transparency": { "daily": 100, "monthly": 1000 }
  }
}
```

The figures are examples, not plan recommendations. Choose them from measured
deployment costs and provider allowances. Usage policy requires both
distributed credentials; missing credentials or malformed policy fail closed.

Usage uses provider server time and fixed UTC-epoch-aligned 24-hour and 30-day
buckets. The 30-day bucket is not a calendar month or provider billing total.
An admitted operation is counted even when downstream collection later fails.
Exhaustion returns `NETWORK_USAGE_LIMITED` with its global or feature scope and
window.

## Optional hosted monitoring

The Netlify scheduled function runs every five minutes but remains a no-op
unless all required production values are configured:

- `WHOISLEUTH_SCHEDULED_MONITORING=1`;
- `WHOISLEUTH_SCHEDULED_MONITOR_KEY`, a valid 32-byte Base64 key; and
- `WHOISLEUTH_SCHEDULED_MONITOR_NAMESPACE`, a bounded namespace.

Set these for the Production deploy context only. Preview or branch deploys are
rejected before Blob access even if configuration is inherited.

The worker opens one site-wide Blob store, decrypts one bounded compact state
envelope in memory, and processes at most two existing Fast compact lookups and
eight internal deliveries within a 24-second soft budget. Its encrypted cursor
resumes bounded work after delays. Provider failures, conflicts, inconclusive
observations, and deadlines cannot erase an earlier conclusive baseline.

Ordinary browser watchlists are not uploaded automatically. A signed-in analyst
must deliberately schedule one through Monitor and can replace, restore, pause,
resume, or delete the hosted compact copy.

Capacity admission reserves part of the fixed schedule for delayed or resumed
work. The five-minute schedule can invoke the function 8,640 times in a 30-day
month or 8,928 times in a 31-day month, including no-op runs. Measure actual
usage against the deployment's plan before enabling it.

To stop Blob reads, writes, and lookups, set
`WHOISLEUTH_SCHEDULED_MONITORING=0` or remove it and redeploy. This does not
delete the encrypted Blob. Delete retained state deliberately only when it is
no longer required. Remove the schedule itself if no-op invocations must also
stop.

## Netlify deployment

1. Connect the repository to Netlify or deploy it with the Netlify CLI.
2. Keep the repository root as the build base. `netlify.toml` runs
   `npm run build`, publishes `frontend/build`, and packages
   `netlify/functions/`.
3. Set `SITE_PASSWORD` and a separate `SESSION_SECRET` before the first
   production deployment.
4. Add optional provider, distributed-budget, or scheduled-monitor values only
   after reviewing their boundaries above.
5. Confirm the deploy log reports the code-based login and Lookup rate rules as
   applied.
6. Run the public deployment self-check and complete an authenticated browser
   smoke test.

Static routes such as `/lookup`, `/bulk`, and `/monitor` are independent
prerendered entries. API routes are rewrites to thin functions that call the
same shared modules as Express.

Bulk makes one compact `/api/lookup` call per domain with bounded browser
concurrency. It does not hold one serverless invocation open for the complete
list.

## Deployment self-check

Run:

```bash
npm run deployment:self-check -- https://your-deployment.example
```

Add `--json` for the versioned machine-readable report.

The command accepts one explicit HTTPS hostname origin and probes only seven
fixed same-origin paths. It makes at most ten requests, follows at most one
same-origin redirect without a query or fragment per GET probe, inspects at
most 64 KiB per response, allows five seconds per request, and has a 20-second
overall deadline. It uses the same public-address and DNS-rebinding controls as
other outbound requests.

The check verifies:

- the public homepage;
- anonymous session state;
- the bounded invalid-login response;
- the unpublished direct login-function path;
- protected capability and scheduled-monitor management boundaries;
- browser security headers; and
- `Cache-Control: no-store` on API responses.

It sends one fixed non-secret invalid value only to the configured same-origin
login route. It never accepts a real password, session cookie, API credential,
arbitrary path, or extra target. Network failure or capped output remains
inconclusive rather than becoming a pass or a deployment defect.

Complete an authenticated browser smoke test separately. The public self-check
cannot verify protected navigation or the effective signed-in capability view.

## Privacy and retention checklist

Before making a deployment available to others:

- adapt [the privacy notice](../PRIVACY.md) to the deployment operator;
- document any optional provider that is enabled;
- confirm that protected-route inputs and activity are outside any audience
  measurement;
- decide whether encrypted scheduled monitoring is required and affordable;
- verify browser and hosted deletion procedures;
- rotate secrets that may have been exposed; and
- keep raw registration contacts and analyst notes out of compact stores,
  telemetry, and unnecessary exports.
