#!/bin/sh

set -eu

profile="${1:-}"
case "$profile" in
  beta)
    suffix="-beta"
    ;;
  production)
    suffix=""
    ;;
  *)
    echo "Usage: $0 beta|production" >&2
    exit 1
    ;;
esac

app_version=$(bun -p "require('./app.json').expo.version")

bunx expo prebuild --clean --platform ios
mkdir -p dist
NPM_CONFIG_MIN_RELEASE_AGE=0 bunx eas build \
  --platform ios \
  --profile "$profile" \
  --local \
  --clear-cache \
  --output "./dist/tomeio-$app_version$suffix.ipa"
