#!/usr/bin/env bash
# Server-only secret rotation. This script never writes a key to the repository.
set -euo pipefail
cd "$(dirname "$0")/.."
secret_file="$(mktemp /tmp/orin-support-secret.XXXXXX)"
chmod 600 "$secret_file"
trap 'rm -f "$secret_file"; unset orin_support_key' EXIT
read -r -s -p 'ORIN support provider key (hidden): ' orin_support_key
printf '\n'
if [[ -z "$orin_support_key" ]]; then
  printf 'No credential supplied. Nothing changed.\n' >&2
  exit 1
fi
printf '%s' "$orin_support_key" > "$secret_file"
unset orin_support_key
./node_modules/.bin/firebase functions:secrets:set ORIN_SUPPORT_AI_API_KEY --project orin-99951 --data-file "$secret_file"
printf 'Secret stored. Deploy the reviewed orinApi function to bind this version.\n'
printf 'Do not publish a customer build using the exposed test credential.\n'
