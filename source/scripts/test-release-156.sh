#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-release-155.sh
./node_modules/.bin/esbuild tests/release-156-entry.ts --bundle --platform=node --format=esm --outfile=tests/release-156-bundle.mjs
node --test tests/release-156.test.mjs
