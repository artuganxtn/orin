#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/test-release-156.sh
./node_modules/.bin/esbuild tests/release-157-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/release-157-bundle.mjs
node --test tests/release-157.test.mjs
