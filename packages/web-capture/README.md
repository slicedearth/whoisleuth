# WHOISleuth local rendered capture

This private, optional package captures one explicitly authorised public web
page with the Playwright installation used by the repository. It is separate
from the distributable WHOISleuth CLI and is never enabled by the hosted
application.

From the repository root:

```sh
npm run capture:local -- https://example.test --output-dir ./capture-example --authorize-rendered-capture
npm run capture:compare -- ./official/manifest.json ./candidate/manifest.json --json
```

The destination must not already exist. The package writes a fixed-size PNG,
a sanitised DOM digest containing hashes and element counts rather than page
text or HTML, and a version 2 `whoisleuth.web-capture-manifest` that can be
reviewed before import into Cases. File permissions are private where the
platform supports POSIX modes.

The offline `compare` command accepts two selected version-2 manifests. Before
comparing them it verifies the declared artefact sizes, SHA-256 digests, and
screenshot perceptual hashes against the local files. It then reports exact
rendered DOM and visible-text equality, screenshot dHash distance, bounded
count changes, page identity, and request-domain overlap as separate
components. It makes no request, prints no input paths, and produces no
combined similarity or maliciousness score.

Collection executes page JavaScript and sends the target plus its public
subresource hostnames to their operators. It accepts at most 100 HTTP(S)
requests and 30 request hostnames, blocks credentials, non-default ports,
service workers, downloads, WebSockets, WebRTC, WebTransport, non-HTTP
protocols, and hosts resolving to private or reserved addresses. The hostname
bound applies to browser-requested hosts even when resolution or response
collection fails, and those admitted hosts remain visible in the manifest.
Every allowed request uses the shared connection-pinned
transport before its bounded response is supplied to the disposable browser.
Cookies, authorisation headers, and request bodies are not forwarded. Each
response body is read up to 4 MiB, with concurrent reads reserving from one
shared 24 MiB application-level response-body budget. Lower-level transport
buffering is outside that byte budget. Run this package only for targets you
are authorised to render, inside a disposable and network-restricted
environment when the target is untrusted.
