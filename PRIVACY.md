# Privacy Notice

This is a template for whoever operates a deployment of this tool
(self-hosted or on Netlify) to adapt - fill in `[operator contact]` below
and adjust anything that doesn't match your actual deployment before
publishing it to anyone you share `SITE_PASSWORD` with.

## What personal data this tool processes

Looking up a domain returns whatever registrant contact data (name,
organisation, email, phone, address) the domain's registry chooses to
expose in its public RDAP/WHOIS response. This tool doesn't collect
anything beyond that - it's a client for data the registry already
publishes, not a separate data-gathering system. Most registries redact
this by default (see the README), so many lookups return no personal data
at all.

## Where that data goes

- **Single and bulk lookups**: proxied through the server per-request, held
  in memory only for the duration of that request, never written to a
  database or disk server-side.
- **Brand Profiles / Shortlist / Watchlist**: saved in your own browser's
  `localStorage`, not on the server - only visible to whoever is using that browser.
  Watchlists retain a bounded timeline of material scan changes alongside
  their latest results; older timeline events are automatically discarded.
  Cleared via each entry's **Remove**/**Delete** button, the **Clear all**
  button in either panel, or by clearing the browser's site data.
- **CSV/JSON exports**: downloaded directly to your device. Single-lookup
  evidence JSON includes the raw RDAP and WHOIS responses, so it may contain
  registry-published contact data. Nothing is uploaded or retained by the
  server when you export. From that point on, the file is yours to manage -
  store it appropriately and delete it once you no longer need it.
- **Official-domain posture audits**: handled per request and discarded. The
  server queries public DNS, the domain registry's RDAP service for DNSSEC
  delegation status, and (only when advertised) the official domain's own
  `mta-sts` HTTPS policy host. DKIM selector names saved in a Brand Profile
  are included in the request so those exact public DNS records can be checked.
- **Outreach / abuse-report drafts**: build a `mailto:` link and copy
  pre-filled text to your clipboard. Nothing is sent automatically; a
  human reviews and sends each one from their own mail client.

## Legal basis for processing

Using this tool to monitor domains/brands you have a legitimate interest in
(the **Report abuse** flow, watchlist monitoring) is generally supported by
"legitimate interest." Using the **outreach** (acquisition) flow to contact
a registrant is closer to direct marketing and a weaker legitimate-interest
case - keep it low-volume, human-reviewed (already enforced by the
mailto-link pattern), and honor any request to stop being contacted.

## Data subject rights

Since there's no server-side account or database, a request from a
registrant to access/delete their data is fulfilled by deleting whatever
you personally exported (CSV/JSON files) or saved (shortlist/watchlist entries and history)
about them, and not re-querying afterward - use the **Clear all** buttons
above for the latter. Direct any such request to: `[operator contact]`.

## Hosting / sub-processors

- Self-hosted: data stays on whatever server you run `server.js` on.
- Netlify: request handling runs on Netlify's infrastructure. Check
  Netlify's own Data Processing Addendum if you're operating this beyond a
  personal/internal scale.
- Upstream RDAP/WHOIS servers, public DNS, `crt.sh` (Certificate Transparency
  search), and an audited domain's own MTA-STS policy host are queried live,
  on demand - they're the data sources, not sub-processors this tool shares
  stored data with.

## Security measures

Shared-password session auth (`lib/auth.js`), per-IP rate limiting
(`lib/rate-limit.js`), and SSRF-guarded outbound fetches (`lib/safe-fetch.js`)
are the technical measures in place. See [LICENSE](LICENSE) - provided as is,
with no warranty.
