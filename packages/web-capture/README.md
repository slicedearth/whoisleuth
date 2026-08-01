# WHOISleuth local rendered capture

This private, optional package captures one explicitly authorised public web
page with the Playwright installation used by the repository. It is separate
from the distributable WHOISleuth CLI and is never enabled by the hosted
application.

From the repository root:

```sh
npm run capture:local -- https://example.test --output-dir ./capture-example --authorize-rendered-capture
```

The destination must not already exist. The package writes a fixed-size PNG,
a sanitised DOM digest containing hashes and element counts rather than page
text or HTML, and a version 2 `whoisleuth.web-capture-manifest` that can be
reviewed before import into Cases. File permissions are private where the
platform supports POSIX modes.

Collection executes page JavaScript and sends the target plus its public
subresource hostnames to their operators. It accepts at most 100 HTTP(S)
requests and 30 request hostnames, blocks credentials, non-default ports,
service workers, downloads, non-HTTP protocols, and hosts resolving to
private or reserved addresses. Each hostname is checked before its first
request, but Playwright controls the browser connection and does not expose
WHOISleuth's normal IP-pinned transport. DNS rebinding therefore remains a
documented residual risk. Run this package only for targets you are authorised
to render, inside a disposable and network-restricted environment when the
target is untrusted.
