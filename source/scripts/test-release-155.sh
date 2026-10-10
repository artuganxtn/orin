#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-release-153.sh
./node_modules/.bin/esbuild tests/release-154-entry.ts --bundle --platform=node --format=esm --outfile=tests/release-154-bundle.mjs
./node_modules/.bin/esbuild tests/release-155-entry.ts --bundle --platform=node --format=esm --outfile=tests/release-155-bundle.mjs
node --test tests/release-154.test.mjs tests/release-155.test.mjs
