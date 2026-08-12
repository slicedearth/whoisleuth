# WHOISleuth local rendered capture

This private, optional package captures one explicitly authorised public,
domain-hosted web page with the Playwright installation used by the repository.
IP-literal targets are rejected so every successful manifest remains compatible
with the domain-only Cases importer. It is separate
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
reviewed before import into Cases. The manifest also retains one
control-sanitised page title of up to 300 characters. File permissions are private where the
platform supports POSIX modes.
The structured manifest and DOM-digest fields exclude resource paths, queries,
raw DOM, and body text. The screenshot necessarily preserves visible rendered
content and may include page text or a page-reflected path or query until the
operator deletes the output directory.
Rendered DOM counts are capped at 20,000 and the body text-node sequence is
hashed only through a valid UTF-8 boundary within 256 KiB. Reaching either bound marks the
capture partial so the resulting version-2 artefact remains accepted by the
offline comparator without implying that the omitted page content was absent.

The offline `compare` command accepts two selected version-2 manifests. Before
comparing them it verifies the declared artefact sizes, SHA-256 digests, and
screenshot perceptual hashes against the local files. It then reports exact
equality for the bounded preorder element-tag sequence and body text-node
sequence, screenshot dHash distance, bounded count changes, page identity,
and request-domain overlap as separate components. The tag sequence does not
encode nesting or attributes, and the legacy `visibleText` field includes body
text nodes that CSS or non-rendered containers may hide; neither field proves
exact DOM or visual equality. The comparator makes no request, prints no input
paths, reports only the page-title equality state rather than either title in
version 2 output, and produces no combined similarity or maliciousness score.

Collection executes page JavaScript. Each admitted resource operator receives
the exact requested URL, including path and query, and ordinary allowlisted
request headers. Structured manifest and digest fields keep only the target
hostname, final HTTP(S) origin, one control-sanitised page title of up to 300
characters, and admitted public resource hostnames, never those paths or queries. It accepts at most 100 HTTP(S)
requests and 30 request hostnames, blocks credentials, non-default ports,
service workers, dedicated and shared workers, downloads, WebSockets, WebRTC, WebTransport, non-HTTP
protocols, and hosts resolving to private or reserved addresses. The hostname
bound applies to browser-requested hosts even when resolution or response
collection fails. Only hosts that successfully pass public-address resolution
are retained in the manifest.
Every allowed request uses the shared connection-pinned
transport before its bounded response is supplied to the disposable browser.
Cookies, authorisation headers, and request bodies are not forwarded. Each
response body is read up to 4 MiB, with concurrent reads reserving from one
shared 24 MiB application-level response-body budget. Lower-level transport
buffering is outside that byte budget. Run this package only for targets you
are authorised to render, inside a disposable and network-restricted
environment when the target is untrusted.
