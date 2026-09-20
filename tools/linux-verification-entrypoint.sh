#!/bin/sh
set -eu

# Only the committed bundle enters the container; no host dependencies or
# credentials are mounted. All checkout writes stay in its disposable layer.
git clone --quiet /input/source.bundle checkout
cd checkout
git checkout --quiet --detach "$WHOISLEUTH_VERIFY_REVISION"
git update-ref refs/remotes/origin/main "$WHOISLEUTH_VERIFY_BASE"
exec npm run verification:ci
