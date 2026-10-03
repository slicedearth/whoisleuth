#!/bin/sh
set -eu

# The host validates paths and groups through their existing owners. Keep each
# argument separate when forwarding; never interpret a selection as shell code.
case "${1-}" in
  --full|--group=*) [ "$#" -eq 1 ] || exit 2 ;;
  --focused) [ "$#" -gt 1 ] || exit 2 ;;
  *) exit 2 ;;
esac

# Only the committed bundle enters the container; no host dependencies or
# credentials are mounted. All checkout writes stay in its disposable layer.
git clone --quiet /input/source.bundle checkout
cd checkout
git checkout --quiet --detach "$WHOISLEUTH_VERIFY_REVISION"
git update-ref refs/remotes/origin/main "$WHOISLEUTH_VERIFY_BASE"
if [ "$1" = --full ]; then
  # The complete owner already performs its locked install and prerequisites.
  exec npm run verification:ci
fi

npm ci --include=optional --ignore-scripts --audit=false
if [ "$1" = --focused ]; then
  shift
  exec npm run verification:focused -- "$@"
fi

# Package lanes consume a verified frontend build. In an isolated checkout it
# must be prepared here, using the same build group as hosted verification.
if [ "$1" = --group=cli-runtime ]; then
  npm run verification:ci -- --group=browser-build
fi
exec npm run verification:ci -- "$@"
