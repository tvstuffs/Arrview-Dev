#!/usr/bin/env bash
# Wrapper for every Codex call the factory makes. Fails loudly (non-zero) when Codex
# fails, the output file is missing, or its first line is not the expected verdict.
#
#   codex-run.sh plan-check <model> <job-dir>            -> <job>/plan-check.md        VERDICT: PASS|CHANGES
#   codex-run.sh review     <model> <job-dir> <round>    -> <job>/round-N/review-xvendor.md
#   codex-run.sh risk       <model> <job-dir> <round>    -> <job>/round-N/review-codex-risk.md
#   codex-run.sh brainstorm <model> <job-dir>            -> <job>/brainstorm-codex.md  RECOMMENDATION: ...
#   codex-run.sh build      <model> <job-dir> [round]    -> <job>/build.md             STATUS: READY|BLOCKED
#
# Models are limited to the OpenAI rows of .claude/factory/models.md.
# Review modes run --sandbox read-only with cwd = the job worktree.
# build runs --sandbox workspace-write with cwd = the job worktree (EXPERIMENTAL, see models.md).
# The Codex sandbox keeps .git read-only, so on STATUS: READY this wrapper makes the commit.
# Never passes --dangerously-bypass-approvals-and-sandbox.
#
# Env: CODEX_BIN (default: codex), CODEX_TIMEOUT seconds (default 1200).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

die() { echo "codex-run: FAIL $*" >&2; exit 1; }

[ $# -ge 3 ] || die "usage: codex-run.sh <plan-check|review|risk|brainstorm|build> <model> <job-dir> [round]"
mode=$1 model=$2 job=$3 round=${4:-}

case "$model" in
  gpt-6-astra|gpt-5.6-sol) ;;
  *) die "model '$model' is not in the roster (gpt-6-astra, gpt-5.6-sol)" ;;
esac
[ -f "$job/job.json" ] || die "no job.json in '$job'"
job=$(cd "$job" && pwd)
id=$(jq -r .id "$job/job.json")
wt=$(jq -r '.worktree // empty' "$job/job.json")
codex=${CODEX_BIN:-codex}
command -v "$codex" >/dev/null || die "codex binary '$codex' not found"

need_round() { [[ $round =~ ^[0-9]+$ ]] || die "$mode needs a round number"; mkdir -p "$job/round-$round"; }
need_worktree() {
  [ -n "$wt" ] && [ -d "$wt" ] || die "job worktree '$wt' does not exist"
  case "$(git -C "$wt" branch --show-current)" in factory/*) ;; *) die "worktree is not on a factory/* branch" ;; esac
}
need_file() { [ -s "$1" ] || die "required input missing or empty: $1"; }

suffix=${round:+-r$round}
prompt="$job/.codex-$mode$suffix.prompt.txt"
log="$job/codex-$mode$suffix.log"

common_rules="You are a reviewer in an automated software factory. Be concrete: cite file:line, say what is wrong and what to change. Do not edit files. Your FINAL message is saved verbatim as the review file."

review_body() {   # $1 = focus text
  need_worktree; need_file "$job/spec.md"
  local diff
  diff=$(git -C "$wt" diff main...HEAD)
  [ -n "$diff" ] || die "empty diff main...HEAD in $wt: nothing to review"
  [ ${#diff} -lt 400000 ] || die "diff is ${#diff} bytes; too large for one review, split the job"
  {
    echo "$common_rules"
    echo
    echo "Focus: $1"
    echo
    echo "The FIRST line of your final message must be exactly 'VERDICT: PASS' or 'VERDICT: CHANGES' and nothing else."
    echo "Use CHANGES only for issues that must be fixed before a human tests this; list nits under a 'Nits' heading."
    echo "The repository (job worktree, read-only) is your current directory; read any file you need."
    echo
    echo "===== spec.md ====="; cat "$job/spec.md"
    echo; echo "===== git diff main...HEAD ====="; printf '%s\n' "$diff"
  } >"$prompt"
}

expect=()
sandbox=(--sandbox read-only)
cwd=$wt
case "$mode" in
  plan-check)
    need_file "$job/spec.md"; out="$job/plan-check.md"
    {
      echo "$common_rules"
      echo
      echo "Task: check this implementation spec BEFORE anyone builds it. Is it complete, testable, consistent with the code in the current directory, and free of unsettled product decisions? Flag missing acceptance criteria, wrong file references, and risky assumptions."
      echo "The FIRST line of your final message must be exactly 'VERDICT: PASS' or 'VERDICT: CHANGES'."
      echo; echo "===== spec.md ====="; cat "$job/spec.md"
    } >"$prompt"
    expect=("VERDICT: PASS" "VERDICT: CHANGES") ;;
  review)
    need_round; out="$job/round-$round/review-xvendor.md"
    review_body "cross-vendor code review: correctness against the spec's acceptance criteria, missing tests, simplicity, regressions in nearby code."
    expect=("VERDICT: PASS" "VERDICT: CHANGES") ;;
  risk)
    need_round; out="$job/round-$round/review-codex-risk.md"
    esc="$here/../../.claude/factory/escalation.md"
    review_body "adversarial risk review: security, auth/CORS/Host/Origin/CSP, data loss, config/storage upgrade path, proxy vs Direct behaviour, CI/Docker/publish changes, dependency changes, and anything that leaks a personal path, name, address or identifier into this PUBLIC repo. Escalation triggers: $(tr '\n' ' ' <"$esc" 2>/dev/null || true)"
    expect=("VERDICT: PASS" "VERDICT: CHANGES") ;;
  brainstorm)
    need_file "$job/brief.md"; out="$job/brainstorm-codex.md"; cwd=""
    {
      echo "You are giving an independent second opinion for a product/engineering brainstorm. Nobody else's proposal is shown to you."
      echo "The FIRST line of your final message must be 'RECOMMENDATION: <one sentence>'. Then: options considered, trade-offs, risks, open questions."
      echo; echo "===== brief.md ====="; cat "$job/brief.md"
    } >"$prompt" ;;
  build)
    need_worktree; need_file "$job/spec.md"; out="$job/build.md"
    [ -z "$(git -C "$wt" status --porcelain)" ] || die "worktree $wt is not clean before the build"
    sandbox=(--sandbox workspace-write
      -c sandbox_workspace_write.network_access=true
      -c sandbox_workspace_write.exclude_slash_tmp=true
      -c sandbox_workspace_write.exclude_tmpdir_env_var=true)
    {
      echo "You are the builder in an automated software factory. Implement the spec below in the current directory (a git worktree)."
      echo "Rules: change only files in this directory; keep the change minimal; add or update tests for the acceptance criteria;"
      echo "do NOT run git commit, git push or any network command (the factory commits for you); do not add dependencies unless the spec says so."
      echo "Run 'npm test' and paste the node test runner and vitest pass/fail counts."
      echo "The FIRST line of your final message must be exactly 'STATUS: READY' (tests pass, spec done) or 'STATUS: BLOCKED' (say why). Then: summary, files changed, test counts, open questions."
      echo; echo "===== spec.md ====="; cat "$job/spec.md"
      if [[ $round =~ ^[0-9]+$ ]]; then
        for r in "$job/round-$round"/review-*.md; do
          [ -f "$r" ] || continue
          echo; echo "===== reviewer feedback to address: $(basename "$r") ====="; cat "$r"
        done
      fi
    } >"$prompt"
    expect=("STATUS: READY" "STATUS: BLOCKED") ;;
  *) die "unknown mode '$mode'" ;;
esac

rm -f "$out"
args=(exec -m "$model" "${sandbox[@]}" --skip-git-repo-check -o "$out")
[ -n "$cwd" ] && args+=(-C "$cwd")
args+=(-)

echo "codex-run: $mode with $model (log: $log)" >&2
rc=0
if [ "$mode" = build ]; then
  mkdir -p "$wt/.factory-tmp"
  (cd "$wt" && TMPDIR="$wt/.factory-tmp" timeout "${CODEX_TIMEOUT:-1200}" "$codex" "${args[@]}" <"$prompt") >"$log" 2>&1 || rc=$?
  rm -rf "$wt/.factory-tmp"
else
  (cd "${cwd:-$job}" && timeout "${CODEX_TIMEOUT:-1200}" "$codex" "${args[@]}" <"$prompt") >"$log" 2>&1 || rc=$?
fi

if [ "$rc" -ne 0 ]; then
  tail -n 20 "$log" >&2 || true
  die "codex exited $rc"
fi
[ -s "$out" ] || die "codex produced no output file ($out); see $log"

if [ "$mode" = brainstorm ]; then
  head -n1 "$out" | grep -q '^RECOMMENDATION: .' || die "$out first line is not 'RECOMMENDATION: ...'"
  verdict=$(head -n1 "$out")
else
  verdict=$("$here/check-verdict.sh" "$out" "${expect[@]}") || die "invalid verdict in $out"
fi

if [ "$mode" = build ] && [ "$verdict" = "STATUS: READY" ]; then
  if [ -z "$(git -C "$wt" status --porcelain)" ]; then
    die "Codex reported READY but changed nothing in $wt"
  fi
  git -C "$wt" add -A
  git -C "$wt" commit -q -m "factory($id): build by codex $model${round:+ (rework round $round)}"
  printf '\nCommit (made by codex-run.sh): %s\n' "$(git -C "$wt" rev-parse HEAD)" >>"$out"
fi

echo "codex-run: OK $verdict -> $out"
