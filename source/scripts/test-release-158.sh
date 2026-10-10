#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild tests/release-158-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/release-158-bundle.mjs
node --test tests/release-158.test.mjs
./node_modules/.bin/tsc --noEmit --incremental false
