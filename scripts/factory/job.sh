#!/usr/bin/env bash
# Job bookkeeping for the /factory orchestrator. The orchestrator is the only caller, which
# keeps it the only writer of job.json. Run from the main checkout.
#
#   job.sh state                         print $FACTORY_STATE/<repo>
#   job.sh new <slug> <feature...>       preconditions, claim NNN, worktree + branch, setup, job.json
#   job.sh brainstorm <slug> <topic...>  claim NNN under brainstorms/ (no worktree)
#   job.sh dir <job-id>                  print the job directory
#   job.sh get <job-id> [jq-filter]      read job.json
#   job.sh set <job-id> <jq-filter>      update job.json atomically (validated, see below)
#   job.sh diff <job-id> <round>         write round-N/diff.patch (main...branch), print its path
#   job.sh list                          id, stage, round, updated
#
# `set` rejects: an unknown stage; stage approve/ready/needs-human-with-plan while test-plan.md
# fails check-test-plan.sh; opus_runs > 3 (budget guard).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

STAGES='brainstorm spec plan-check build review test-plan approve ready needs-human'
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

repo_state=$(factory_repo_state .) ||
  factory_die "job-state root unknown: export FACTORY_STATE or add 'FACTORY_STATE=<abs path>' to CLAUDE.local.md"

claim() {  # $1 = parent dir, $2 = slug -> prints NNN-slug; the number is claimed by mkdir (no -p)
  local parent=$1 slug=$2 n last
  mkdir -p "$parent/.claims"
  last=$(ls "$parent/.claims" 2>/dev/null | grep -E '^[0-9]{3}$' | sort -n | tail -n1 || true)
  n=$((10#${last:-0}))
  for _ in $(seq 1 20); do
    n=$((n + 1))
    if mkdir "$parent/.claims/$(printf %03d "$n")" 2>/dev/null; then
      printf '%03d-%s\n' "$n" "$slug"; return 0
    fi
  done
  factory_die "could not claim a job number under $parent"
}

check_slug() { [[ $1 =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || factory_die "slug must be 1-40 chars of a-z, 0-9, '-'"; }

jobdir() {
  local d="$repo_state/jobs/$1"
  [ -f "$d/job.json" ] || d="$repo_state/brainstorms/$1"
  [ -f "$d/job.json" ] || factory_die "no job '$1'"
  printf '%s\n' "$d"
}

cmd=${1:-}; shift || true
case "$cmd" in
  state) printf '%s\n' "$repo_state" ;;

  new)
    [ $# -ge 2 ] || factory_die "usage: job.sh new <slug> <feature...>"
    slug=$1; shift; feature="$*"; check_slug "$slug"
    main=$(factory_main_checkout .)
    [ "$(git -C "$main" branch --show-current)" = main ] || factory_die "main checkout is not on main; stop"
    [ -z "$(git -C "$main" status --porcelain)" ] || factory_die "main checkout has uncommitted changes; stop"
    mkdir -p "$repo_state/jobs"
    id=$(claim "$repo_state/jobs" "$slug")
    d="$repo_state/jobs/$id"
    mkdir "$d"
    wt="$(factory_worktree_root .)/$id"
    mkdir -p "$(dirname "$wt")"
    t=$(now)
    jq -n --arg id "$id" --arg feature "$feature" --arg repo "$(basename "$main")" \
          --arg branch "factory/$id" --arg wt "$wt" --arg t "$t" '
      {id:$id, feature:$feature, repo:$repo, branch:$branch, worktree:$wt, stage:"spec", round:0,
       builder:{vendor:null, model:null}, plan_check:{vendor:null, model:null, verdict:null},
       reviewers:{}, escalations:[], routing_reasons:{}, opus_runs:0, created:$t, updated:$t}' >"$d/job.json"
    if ! git -C "$main" worktree add -b "factory/$id" "$wt" main >"$d/setup.log" 2>&1; then
      jq '.stage="needs-human" | .escalations += ["worktree creation failed (setup.log)"]' "$d/job.json" >"$d/job.json.tmp" && mv "$d/job.json.tmp" "$d/job.json"
      factory_die "git worktree add failed; see $d/setup.log"
    fi
    if [ -f "$wt/package-lock.json" ]; then
      if ! (cd "$wt" && npm ci) >>"$d/setup.log" 2>&1; then
        jq '.stage="needs-human" | .escalations += ["setup (npm ci) failed (setup.log)"]' "$d/job.json" >"$d/job.json.tmp" && mv "$d/job.json.tmp" "$d/job.json"
        factory_die "setup failed (npm ci); see $d/setup.log"
      fi
    fi
    printf '%s\n' "$d" ;;

  brainstorm)
    [ $# -ge 2 ] || factory_die "usage: job.sh brainstorm <slug> <topic...>"
    slug=$1; shift; check_slug "$slug"
    mkdir -p "$repo_state/brainstorms"
    id=$(claim "$repo_state/brainstorms" "$slug"); d="$repo_state/brainstorms/$id"; mkdir "$d"
    t=$(now)
    jq -n --arg id "$id" --arg topic "$*" --arg repo "$(factory_repo_name .)" --arg t "$t" '
      {id:$id, feature:$topic, repo:$repo, branch:null, worktree:null, stage:"brainstorm", round:0,
       builder:null, reviewers:{}, escalations:[], routing_reasons:{}, opus_runs:0, created:$t, updated:$t}' >"$d/job.json"
    printf '%s\n' "$d" ;;

  dir) jobdir "${1:?job id}" ;;

  get)
    d=$(jobdir "${1:?job id}"); jq -r "${2:-.}" "$d/job.json" ;;

  set)
    d=$(jobdir "${1:?job id}"); filter=${2:?jq filter}
    new=$(jq --arg t "$(now)" "($filter) | .updated = \$t" "$d/job.json") || factory_die "jq filter failed"
    stage=$(jq -r .stage <<<"$new")
    case " $STAGES " in *" $stage "*) ;; *) factory_die "unknown stage '$stage' (allowed: $STAGES)" ;; esac
    opus=$(jq -r '.opus_runs // 0' <<<"$new")
    [ "$opus" -le 3 ] || factory_die "budget guard: opus_runs would be $opus (max 3 per job outside brainstorm); set stage needs-human instead"
    if [ "$stage" = approve ] || [ "$stage" = ready ] || { [ "$stage" = needs-human ] && [ -e "$d/test-plan.md" ]; }; then
      "$here/check-test-plan.sh" "$d/test-plan.md" >/dev/null || factory_die "test-plan gate failed; not setting stage '$stage'"
    fi
    printf '%s\n' "$new" >"$d/job.json.tmp" && mv "$d/job.json.tmp" "$d/job.json"
    jq -c '{id, stage, round}' "$d/job.json" ;;

  diff)
    d=$(jobdir "${1:?job id}"); r=${2:?round}
    wt=$(jq -r .worktree "$d/job.json"); mkdir -p "$d/round-$r"
    git -C "$wt" diff main...HEAD >"$d/round-$r/diff.patch"
    [ -s "$d/round-$r/diff.patch" ] || factory_die "empty diff main...HEAD in $wt"
    printf '%s\n' "$d/round-$r/diff.patch" ;;

  list)
    for f in "$repo_state"/jobs/*/job.json "$repo_state"/brainstorms/*/job.json; do
      if [ -f "$f" ]; then jq -r '[.id, .stage, (.round|tostring), .updated] | @tsv' "$f"; fi
    done | sort ;;

  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
esac
