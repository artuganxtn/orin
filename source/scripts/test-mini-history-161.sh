#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild tests/mini-history-161-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=tests/mini-history-161-bundle.mjs
node --test tests/mini-history-161.test.mjs
