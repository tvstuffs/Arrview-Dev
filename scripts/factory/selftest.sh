#!/usr/bin/env bash
# Offline self-test for scripts/factory/*: no model calls, no network, nothing outside a temp dir.
# Uses a throwaway git repo, a throwaway FACTORY_STATE and a stub `codex` binary.
#   scripts/factory/selftest.sh        -> prints PASS/FAIL per case, exits non-zero on any FAIL
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/factory-selftest.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
pass=0 fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; fail=$((fail + 1)); }
expect() {  # expect <exit-code> <name> <cmd...>
  local want=$1 name=$2; shift 2
  "$@" >"$tmp/out" 2>&1; local got=$?
  if [ "$got" = "$want" ]; then ok "$name (exit $got)"; else bad "$name (exit $got, want $want)"; sed 's/^/      /' "$tmp/out"; fi
}

# ---------- check-test-plan.sh ----------
good="$tmp/good-plan.md"
cat >"$good" <<'EOF'
## 1. What changed
One-line change to the publish workflow.
## 2. Builds verified
npm run build ok.
## 3. Automated tests run
node --test: 35 pass, 0 fail; vitest: 27 passed.
## 4. Manual checks
1. Push a branch with a failing test; expect no image published.
## 5. Both connection modes
Not applicable: CI only, no backend behaviour changed.
## 6. What the Simulator cannot prove
Not applicable: no app change.
## 7. Upgrade path
Not applicable: no storage change.
## 8. Regressions to watch
Publishing on main still works when tests pass.
## 9. Not verified
- The workflow has not run on GitHub Actions (nothing pushed).
EOF
expect 0 "test plan: complete plan passes" "$here/check-test-plan.sh" "$good"
grep -v 'Upgrade path' "$good" | sed '/Not applicable: no storage change./d' >"$tmp/missing.md"
expect 2 "test plan: missing heading blocks" "$here/check-test-plan.sh" "$tmp/missing.md"
sed '$d' "$good" >"$tmp/empty-nv.md"
expect 2 "test plan: empty 'Not verified' blocks" "$here/check-test-plan.sh" "$tmp/empty-nv.md"
{ sed '$d' "$good"; echo "None."; } >"$tmp/none-nv.md"
expect 2 "test plan: 'Not verified: None.' blocks" "$here/check-test-plan.sh" "$tmp/none-nv.md"
expect 2 "test plan: missing file blocks" "$here/check-test-plan.sh" "$tmp/nope.md"

# ---------- check-verdict.sh ----------
printf 'VERDICT: PASS\nfine\n' >"$tmp/v-ok.md"
printf 'Looks good to me\nVERDICT: PASS\n' >"$tmp/v-bad.md"
expect 0 "verdict: valid first line" "$here/check-verdict.sh" "$tmp/v-ok.md" "VERDICT: PASS" "VERDICT: CHANGES"
expect 1 "verdict: verdict not on first line" "$here/check-verdict.sh" "$tmp/v-bad.md" "VERDICT: PASS" "VERDICT: CHANGES"
expect 1 "verdict: missing file" "$here/check-verdict.sh" "$tmp/none.md" "VERDICT: PASS"

# ---------- job.sh on a throwaway repo ----------
repo="$tmp/demo"; mkdir -p "$repo"
git -C "$repo" init -q -b main
git -C "$repo" config user.name selftest; git -C "$repo" config user.email selftest@example.invalid
echo hello >"$repo/README.md"; git -C "$repo" add -A; git -C "$repo" commit -qm init
export FACTORY_STATE="$tmp/state"
cd "$repo" || exit 1
expect 0 "job.sh new: creates job + worktree" "$here/job.sh" new pilot "Gate publish on tests"
jobdir="$FACTORY_STATE/demo/jobs/001-pilot"; wt="$tmp/demo-factory/001-pilot"
if [ -f "$jobdir/job.json" ] && [ "$(git -C "$wt" branch --show-current)" = factory/001-pilot ]; then
  ok "job.sh new: job.json + branch factory/001-pilot"; else bad "job.sh new: job.json/branch"; fi
expect 0 "job.sh new: second job claims 002" "$here/job.sh" new other "Second"
[ -d "$FACTORY_STATE/demo/jobs/002-other" ] && ok "job.sh new: numbering" || bad "job.sh new: numbering"
echo dirty >"$repo/dirty.txt"
expect 1 "job.sh new: refuses a dirty main checkout" "$here/job.sh" new dirty "x"
rm -f "$repo/dirty.txt"
expect 1 "job.sh set: unknown stage refused" "$here/job.sh" set 001-pilot '.stage="merged"'
expect 1 "job.sh set: 4th Opus run refused" "$here/job.sh" set 001-pilot '.opus_runs=4'
expect 1 "job.sh set: approve refused without a test plan" "$here/job.sh" set 001-pilot '.stage="approve"'
cp "$good" "$jobdir/test-plan.md"
expect 0 "job.sh set: approve allowed with a complete plan" "$here/job.sh" set 001-pilot '.stage="approve"'

# Stop-hook mode sees the job: break the plan, the hook must block.
echo '## 1. What changed' >"$jobdir/test-plan.md"
expect 2 "stop hook: blocks while an approve-stage plan is incomplete" \
  env CLAUDE_PROJECT_DIR="$repo" "$here/check-test-plan.sh" </dev/null
cp "$good" "$jobdir/test-plan.md"
expect 0 "stop hook: allows once the plan is complete" \
  env CLAUDE_PROJECT_DIR="$repo" "$here/check-test-plan.sh" </dev/null

# ---------- escalation-scan.sh ----------
mkdir -p "$wt/.github/workflows"; echo "on: push" >"$wt/.github/workflows/ci.yml"
git -C "$wt" add -A; git -C "$wt" commit -qm "touch workflow"
if "$here/escalation-scan.sh" "$wt" | grep -q 'TRIGGER: ci-or-release'; then ok "escalation-scan: workflow change flagged"
else bad "escalation-scan: workflow change not flagged"; fi

# ---------- codex-run.sh with a stub codex ----------
echo "SPEC: test" >"$jobdir/spec.md"
stub="$tmp/codex-stub"
cat >"$stub" <<'EOF'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out=$2; shift; }; shift; done
cat >"$LASTPROMPT"
case "$STUB" in
  nofile) exit 0 ;;
  noverdict) printf 'Looks fine overall.\n' >"$out" ;;
  pass) printf 'VERDICT: PASS' >"$out" ;;   # no trailing newline, as real codex writes it
  crash) echo "boom" >&2; exit 3 ;;
esac
EOF
chmod +x "$stub"
export CODEX_BIN="$stub" LASTPROMPT="$tmp/last-prompt"
mkdir -p "$jobdir/round-1"
echo "BUILD-EVIDENCE-MARKER actionlint exit 0" >"$jobdir/build.md"
echo "VERIFY-EVIDENCE-MARKER" >"$jobdir/round-1/verify-actionlint.txt"
export STUB=nofile; expect 1 "codex-run: missing output file fails" "$here/codex-run.sh" review gpt-5.6-sol "$jobdir" 1
export STUB=noverdict; expect 1 "codex-run: output without verdict fails" "$here/codex-run.sh" review gpt-5.6-sol "$jobdir" 1
export STUB=crash; expect 1 "codex-run: codex non-zero exit fails" "$here/codex-run.sh" review gpt-5.6-sol "$jobdir" 1
export STUB=pass; expect 0 "codex-run: valid verdict passes" "$here/codex-run.sh" review gpt-5.6-sol "$jobdir" 1
if grep -q BUILD-EVIDENCE-MARKER "$LASTPROMPT" && grep -q VERIFY-EVIDENCE-MARKER "$LASTPROMPT" && grep -q "cannot run tools" "$LASTPROMPT"; then
  ok "codex-run: review prompt carries builder evidence, verify file and tool-limit rule"
else bad "codex-run: review prompt missing evidence or tool-limit rule"; fi
export STUB=pass; expect 1 "codex-run: model outside roster refused" "$here/codex-run.sh" review gpt-4o "$jobdir" 1
unset CODEX_BIN LASTPROMPT

# ---------- guard-bash.py ----------
# Evaluate against the real checkout this script lives in (paths are only inspected, never run).
. "$here/lib.sh"
main=$(factory_main_checkout "$here"); froot=$(factory_worktree_root "$here")
guard() {
  printf '{"tool_input":{"command":%s},"cwd":%s}' "$(jq -Rn --arg c "$1" '$c')" "$(jq -Rn --arg c "$main" '$c')" |
    CLAUDE_PROJECT_DIR="$main" python3 "$here/guard-bash.py"
}
expect 2 "guard: git push"                       guard 'git push'
expect 2 "guard: git -C dir push origin main"    guard 'git -C "/some/dir" push origin main'
expect 2 "guard: compound cd && git push"        guard 'cd /tmp && git push --force'
expect 2 "guard: env-prefixed push"              guard 'GIT_TRACE=1 git push'
expect 2 "guard: push inside bash -c"            guard "bash -c 'git push origin HEAD'"
expect 2 "guard: gh pr merge"                    guard 'gh pr merge 12 --squash'
expect 2 "guard: gh release create"              guard 'gh release create v9'
expect 2 "guard: codex bypass flag"              guard 'codex exec --dangerously-bypass-approvals-and-sandbox hi'
expect 2 "guard: rm -rf home"                    guard 'rm -rf ~/'
expect 2 "guard: rm -rf main checkout dir"       guard "rm -rf \"$main/src\""
expect 2 "guard: rm -fr with variable"           guard 'rm -fr "$SOMEDIR"'
expect 0 "guard: rm -rf in factory worktree"     guard "rm -rf \"$froot/001-x/dist\""
expect 0 "guard: rm -rf under /tmp"              guard 'rm -rf /tmp/scratch-dir'
expect 0 "guard: commit message mentioning push" guard 'git commit -m "do not push yet"'
expect 0 "guard: git status"                     guard 'git status --porcelain'
expect 0 "guard: npm test"                       guard 'npm test'

echo "selftest: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
