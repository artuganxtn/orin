#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./node_modules/.bin/esbuild lib/quote-stream.ts --bundle --platform=node --format=esm --outfile=tests/release-153-stream-bundle.mjs
./node_modules/.bin/esbuild lib/market-quote.ts --bundle --platform=node --format=esm --outfile=tests/release-152-quote-bundle.mjs
./node_modules/.bin/esbuild firebase-app/reference-test-entry.ts --bundle --platform=node --format=esm --packages=external --outfile=firebase-app/reference-test.mjs
node --test --test-concurrency=1 tests/release-153-quotes.test.mjs tests/release-152-quote.test.mjs tests/reference-ui.test.mjs tests/trading-accounts-ui.test.mjs
./node_modules/.bin/tsc --noEmit --incremental false
