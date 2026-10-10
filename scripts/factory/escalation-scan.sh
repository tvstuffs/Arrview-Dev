#!/usr/bin/env bash
# Deterministic first pass over a job's diff for the triggers in .claude/factory/escalation.md.
# Prints one "TRIGGER: <name>: <evidence>" line per hit; prints nothing when clean. Always exits 0
# unless the arguments are wrong. Heuristic: a clean scan does NOT clear a job; the risk reviewers
# and the approver still read escalation.md.
#
#   escalation-scan.sh <worktree> [base=main]
#
# Optional: extra private terms (names, handles, hostnames) one per line in
# $FACTORY_STATE/pii-terms.txt. That file lives outside the repo on purpose.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
wt=${1:?usage: escalation-scan.sh <worktree> [base]}
base=${2:-main}

files=$(git -C "$wt" diff --name-only "$base"...HEAD)
added=$(git -C "$wt" diff -U0 "$base"...HEAD | grep -E '^\+[^+]' | cut -c2- || true)

hit() { printf 'TRIGGER: %s: %s\n' "$1" "$2"; }
file_hits() {  # $1 name, $2 ERE over paths
  local m; m=$(printf '%s\n' "$files" | grep -E "$2" | tr '\n' ' ' || true)
  [ -n "$m" ] && hit "$1" "$m"
  return 0
}
line_hits() {  # $1 name, $2 ERE over added lines (case-insensitive)
  local m; m=$(printf '%s\n' "$added" | grep -inE "$2" | head -n 3 | tr '\n' ' ' || true)
  [ -n "$m" ] && hit "$1" "added lines match: $m"
  return 0
}

file_hits "ci-or-release" '^\.github/workflows/|(^|/)Dockerfile$|^docker-compose[^/]*\.ya?ml$|^\.dockerignore$'
file_hits "dependencies" '(^|/)package(-lock)?\.json$|(^|/)Package\.(swift|resolved)$'
file_hits "core-version" '(^|/)ArrViewCore/|(^|/)Package\.swift$'
line_hits "web-exposed" 'cors|access-control-allow|origin|\bhost\b.*header|content-security-policy|helmet|authorization|x-api-key|set-cookie'
line_hits "storage-or-config" 'config\.json|CONFIG_DIR|writeFile|localStorage|UserDefaults|Keychain|suiteName'
line_hits "pii-path-or-address" '/Users/[^/ ]+|/home/[^/ ]+|\b(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]+\.[0-9]+|\.local\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

state=$(factory_state "$wt" 2>/dev/null || true)
if [ -n "$state" ] && [ -s "$state/pii-terms.txt" ]; then
  m=$(printf '%s\n' "$added" | grep -inFf <(grep -v '^[[:space:]]*$' "$state/pii-terms.txt") | head -n 3 | tr '\n' ' ' || true)
  [ -n "$m" ] && hit "pii-private-term" "added lines match a term from pii-terms.txt: $m"
fi
exit 0
