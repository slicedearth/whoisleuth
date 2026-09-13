# WHOISleuth rendered capture companion

This optional package captures one explicitly authorised public, domain-hosted
web page. Its browser runtime is independent of the main CLI and website.
IP-literal targets are rejected so every successful manifest remains compatible
with the domain-only Cases importer. It is separate
from the distributable WHOISleuth CLI and is never enabled by the hosted
application.

## Install a local candidate

The companion is not published to a package registry. From a repository checkout,
build and verify an installable archive into a new directory outside the checkout:

```sh
npm run capture:package:check -- --candidate ../capture-candidate
```

The candidate report identifies the archive, digest, pinned dependencies and
installed checks. It includes notices for its own runtime dependencies; the
repository advisory check also covers them without adding them to the application.
Install the generated archive in a separate directory:

```sh
npm install --offline --ignore-scripts --omit=optional /path/to/generated-archive.tgz
./node_modules/.bin/whoisleuth-capture --help
node ./node_modules/@slicedearth/whoisleuth-web-capture/node_modules/playwright/cli.js install chromium
./node_modules/.bin/whoisleuth-capture https://example.test --output-dir ./capture-example --authorize-rendered-capture
./node_modules/.bin/whoisleuth-capture compare ./official/manifest.json ./candidate/manifest.json --json
```

The archive bundles its reviewed runtime dependencies. Optional file-watching
dependencies are omitted; capture and comparison do not use them. Installation
can stay offline without selecting newer transitive versions.

Browser installation is explicit and downloads the matching browser; help and
offline comparison do not need it. The browser sandbox remains enabled. On
Linux, install the operating-system libraries required by the browser before
capture. The companion has its own version; it is not an additional main-CLI command.

Maintainers can add `--browser-smoke` before `--candidate` to exercise the installed
archive with an already installed browser and synthetic response fixtures.
It honours `PLAYWRIGHT_BROWSERS_PATH` and never downloads a browser automatically.

For an existing development checkout, the equivalent commands are:

```sh
npm run capture:local -- https://example.test --output-dir ./capture-example --authorize-rendered-capture
npm run capture:compare -- ./official/manifest.json ./candidate/manifest.json --json
```

## Output and collection boundaries

The destination must not already exist. The package writes a fixed-size PNG,
a sanitised DOM digest containing hashes and element counts rather than page
text or HTML, and a version 2 `whoisleuth.web-capture-manifest` that can be
reviewed before import into Cases. The manifest also retains one
control-sanitised page title of up to 300 characters. File permissions are
private where the platform supports POSIX modes.
Capture conditions record the browser version, 1024 × 768 viewport, scale 1,
`en-US` locale, UTC timezone and light colour scheme. Optional `--observer` and
`--vantage` labels are declarations, not verified identities or locations.
The structured manifest and DOM-digest fields exclude resource paths, queries,
raw DOM, and body text as dedicated fields, but the page-controlled title may
itself reproduce a path or query. The screenshot necessarily preserves visible
rendered content and may include page text or a page-reflected path or query
until the operator deletes the output directory.
Rendered DOM counts are capped at 20,000 and the body text-node sequence is
hashed only through a valid UTF-8 boundary within 256 KiB. Reaching either bound marks the
capture partial so the resulting version-2 artefact remains accepted by the
offline comparator without implying that the omitted page content was absent.

The offline `compare` command accepts two selected version-2 manifests. Before
comparing them it verifies the declared artefact sizes, SHA-256 digests, and
screenshot perceptual hashes against the local files. It then reports exact
equality for complete bounded preorder element-tag sequences and body text-node
sequences, screenshot dHash distance, bounded count changes, page identity,
and request-domain overlap as separate components. The tag sequence does not
encode nesting or attributes, and the legacy `visibleText` field includes body
text nodes that CSS or non-rendered containers may hide; neither field proves
exact DOM or visual equality. Equal truncated prefixes are reported as
unavailable rather than equal. If either capture is partial, request-domain and
technology set relationships are also unavailable because omitted activity can
change them; retained counts and shared observations remain visible for review.
The comparator makes no request, prints no input
paths, reports only the page-title equality state rather than either title,
emits `whoisleuth.web-capture-comparison` version 3, and produces no combined
similarity or maliciousness score. Version-2 comparison documents remain
listed as historical read-only output in the schema inventory.

The comparison also checks every decoded screenshot pixel on a white background,
reporting changed counts and a grid of source-pixel coordinates. It never resizes
different-sized images. Repeat `--mask left,top,width,height` to exclude up to 64
rectangles from both images; overlaps count once and original files stay unchanged.
Excluding every pixel produces no agreement result. Masks, capture times and
declared conditions appear in the report. Older captures without conditions remain
unknown. Browser, timing, locale and shared-cache differences can affect appearance;
neither matching pixels nor distinct labels establish independent collection or
worldwide takedown.

Collection executes page JavaScript. Each admitted resource operator receives
the exact requested URL, including path and query, and ordinary allowlisted
request headers. Structured manifest and digest fields keep only the target
hostname, final HTTP(S) origin, one control-sanitised page title of up to 300
characters, and admitted public resource hostnames. They contain no dedicated
request-path or query fields, but the title may itself reproduce a path or query.
It accepts at most 100 HTTP(S)
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
