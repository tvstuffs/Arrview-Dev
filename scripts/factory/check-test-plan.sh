#!/usr/bin/env bash
# Deterministic test-plan gate (no model call).
#
#   check-test-plan.sh <test-plan.md>   check one file; exit 0 ok, exit 2 with reasons
#   check-test-plan.sh                  Stop-hook mode (hook JSON on stdin): check every
#                                       job of this repo touched in the last 24 hours whose
#                                       stage is approve/ready, or needs-human with a plan.
#
# A plan passes when all nine rule-11 headings exist (Arrview-Common CLAUDE.md, "Test plans"),
# every section has a body, and "Not verified" is not empty or a bare "none"/"n/a".
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

SECTIONS=(
  "What changed"
  "Builds verified"
  "Automated tests run"
  "Manual checks"
  "Both connection modes"
  "What the Simulator cannot prove"
  "Upgrade path"
  "Regressions to watch"
  "Not verified"
)

# Print the body of section $2 in file $1: lines after its heading up to the next heading.
section_body() {
  awk -v want="$2" '
    function norm(s) { s = tolower(s); sub(/^#+[ \t]+/, "", s); sub(/^[0-9]+[.)][ \t]+/, "", s); return s }
    /^#{1,6}[ \t]/ { if (inside) exit; if (index(norm($0), tolower(want)) == 1) { inside = 1; next } }
    inside { print }
  ' "$1"
}

has_heading() {
  awk -v want="$2" '
    function norm(s) { s = tolower(s); sub(/^#+[ \t]+/, "", s); sub(/^[0-9]+[.)][ \t]+/, "", s); return s }
    /^#{1,6}[ \t]/ && index(norm($0), tolower(want)) == 1 { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$1"
}

# Echo problems for one plan; return 0 when there are none.
check_plan() {
  local plan=$1 problems=0 s body
  if [ ! -s "$plan" ]; then echo "  missing or empty: $plan"; return 1; fi
  for s in "${SECTIONS[@]}"; do
    if ! has_heading "$plan" "$s"; then
      echo "  missing heading: \"$s\""; problems=1; continue
    fi
    body=$(section_body "$plan" "$s" | grep -v '^[[:space:]]*$' || true)
    if [ -z "$body" ]; then
      echo "  empty section: \"$s\" (write 'Not applicable: <why>' if it does not apply)"; problems=1
    elif [ "$s" = "Not verified" ] &&
         printf '%s\n' "$body" | grep -qviE '^[[:space:]]*([-*][[:space:]]*)?(none|n/?a|nothing|-)[.!]?[[:space:]]*$'; then
      :
    elif [ "$s" = "Not verified" ]; then
      echo "  \"Not verified\" only says none/n/a: list what was not tested and why"; problems=1
    fi
  done
  return $problems
}

if [ $# -ge 1 ]; then
  out=$(check_plan "$1")
  if [ -n "$out" ]; then
    printf 'check-test-plan: %s is incomplete:\n%s\n' "$1" "$out" >&2
    exit 2
  fi
  echo "check-test-plan: OK $1"
  exit 0
fi

# ---- Stop-hook mode ----
cat >/dev/null || true   # hook input is not needed; drain stdin
project=${CLAUDE_PROJECT_DIR:-$PWD}
repo_state=$(factory_repo_state "$project" 2>/dev/null) || exit 0   # factory not configured here
[ -d "$repo_state/jobs" ] || exit 0

fail=""
while IFS= read -r jobjson; do
  jobdir=$(dirname "$jobjson")
  stage=$(jq -r '.stage // ""' "$jobjson" 2>/dev/null || echo "")
  plan="$jobdir/test-plan.md"
  case "$stage" in
    approve|ready) ;;
    needs-human) [ -e "$plan" ] || continue ;;
    *) continue ;;
  esac
  if ! out=$(check_plan "$plan"); then
    fail+="job $(basename "$jobdir") (stage $stage):"$'\n'"$out"$'\n'
  fi
done < <(find "$repo_state/jobs" -mindepth 2 -maxdepth 2 -name job.json -mmin -1440 2>/dev/null)

if [ -n "$fail" ]; then
  printf 'Factory test-plan gate: not finished. Fix the test plan (re-run test-plan-writer) before stopping.\n%s' "$fail" >&2
  exit 2
fi
exit 0
