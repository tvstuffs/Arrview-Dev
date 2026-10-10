#!/usr/bin/env bash
# Check that the first line of a handoff file is one of the allowed verdicts.
#
#   check-verdict.sh <file> <allowed first line>...
#   e.g. check-verdict.sh round-1/review-code.md "VERDICT: PASS" "VERDICT: CHANGES"
#
# Prints the matched first line and exits 0; otherwise exits 1 with a message.
set -uo pipefail
[ $# -ge 2 ] || { echo "usage: check-verdict.sh <file> <allowed>..." >&2; exit 64; }
file=$1; shift
if [ ! -s "$file" ]; then
  echo "check-verdict: FAIL $file is missing or empty" >&2; exit 1
fi
first=$(head -n1 "$file" | tr -d '\r' | sed 's/[[:space:]]*$//')
for allowed in "$@"; do
  if [ "$first" = "$allowed" ]; then printf '%s\n' "$first"; exit 0; fi
done
printf 'check-verdict: FAIL %s first line is "%s"; expected one of:' "$file" "$first" >&2
printf ' "%s"' "$@" >&2
printf '\n' >&2
exit 1
