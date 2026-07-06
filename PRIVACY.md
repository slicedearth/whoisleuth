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
- **Shortlist / Watchlist**: saved in your own browser's `localStorage`,
  not on the server - only visible to whoever is using that browser.
  Cleared via each entry's **Remove**/**Delete** button, the **Clear all**
  button in either panel, or by clearing the browser's site data.
- **CSV exports**: downloaded directly to your device. From that point on,
  the file is yours to manage - delete it once you no longer need it.
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
you personally exported (CSV files) or saved (shortlist/watchlist entries)
about them, and not re-querying afterward - use the **Clear all** buttons
above for the latter. Direct any such request to: `[operator contact]`.

## Hosting / sub-processors

- Self-hosted: data stays on whatever server you run `server.js` on.
- Netlify: request handling runs on Netlify's infrastructure. Check
  Netlify's own Data Processing Addendum if you're operating this beyond a
  personal/internal scale.
- Upstream RDAP/WHOIS servers and `crt.sh` (Certificate Transparency search)
  are queried live, on demand, per lookup - they're the data source, not a
  sub-processor this tool shares stored data with.

## Security measures

Shared-password session auth (`lib/auth.js`), per-IP rate limiting
(`lib/rate-limit.js`), and SSRF-guarded outbound fetches (`lib/safe-fetch.js`)
are the technical measures in place. See [LICENSE](LICENSE) - provided as is,
with no warranty.
