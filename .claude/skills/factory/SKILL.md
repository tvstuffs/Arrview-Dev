---
name: factory
description: ArrView software factory orchestrator. Turns a feature request into a reviewed factory/<id> branch with a human test plan; never merges, pushes or promotes. Use for /factory <feature>, /factory brainstorm <topic>, /factory next, /factory ready <job-id>, /factory rework <job-id> <note>.
argument-hint: "<feature> | brainstorm <topic> | next | ready <job-id> | rework <job-id> <note>"
disable-model-invocation: true
---

# /factory - orchestrator

Arguments: `$ARGUMENTS`

You (this session) are the orchestrator. You spawn agents, read their first lines, run the
`scripts/factory/*` tools, and are the only writer of `job.json` (always through
`scripts/factory/job.sh set`). You never write code, specs, reviews, test plans or decisions.
When an agent returns its output as its final message, you save that message **verbatim** to the
named file with the Write tool (no edits, no summarising) and then check its first line.

**Never** `git push`, merge, tag, release, or touch the release repos (ArrView, Arrview-iOS,
Arrview-tvOS). "READY" means "ready for the maintainer to test on devices". Hooks enforce the push/merge ban;
do not try to work around a blocked command - report it.

Read first: `.claude/factory/models.md` (the only models you may use, hard routing rules) and
`.claude/factory/escalation.md`. Work from the main checkout (the session's project dir) and call
scripts with relative paths, e.g. `scripts/factory/job.sh list`.

## Job state

`scripts/factory/job.sh state` prints `$FACTORY_STATE/<repo>` (from the env or the gitignored
`CLAUDE.local.md`). If it fails, stop and tell the maintainer to set `FACTORY_STATE`. Never commit state.

```
$FACTORY_STATE/<repo>/jobs/NNN-slug/
  job.json  setup.log  spec.md  plan-check.md  build.md  build-rN.md
  round-N/diff.patch  round-N/review-{code,risk,xvendor,codex-risk}.md
  test-plan.md  decision.md  rework-N.md  codex-*.log
```

`job.json` fields: id, feature, repo, branch, worktree, stage
(`brainstorm|spec|plan-check|build|review|test-plan|approve|ready|needs-human`), round,
builder `{vendor, model, agent_id}`, plan_check `{vendor, model, verdict}`,
reviewers `{<name>: {vendor, model, verdict}}`, escalations[], routing_reasons{}, opus_runs.
Update with jq filters, e.g.
`scripts/factory/job.sh set 001-x '.stage="build" | .routing_reasons.build="Node CI change; Sonnet is enough"'`.
Increment `.opus_runs` every time you spawn an agent on `opus`; `job.sh set` refuses a fourth
(budget guard) - then set stage `needs-human` with the reason in `escalations`.

## Dispatch on `$ARGUMENTS`

- `brainstorm <topic>` -> Brainstorm.
- `next` -> `scripts/factory/job.sh list`; pick the oldest job whose stage is not `ready` or
  `needs-human` and continue it from its recorded stage. If none, say so.
- `ready <job-id>` -> the maintainer has reviewed it. `job.sh set <id> '.stage="ready" | .human_reviewed=(now|todate)'`.
  Does NOT merge. Print the branch and worktree so the maintainer can merge.
- `rework <job-id> <note>` -> save the note verbatim to `rework-N.md`, then run Build (rework) with
  the note, then Review, Test plan, Approve. A human rework starts a fresh 2-rework budget.
- anything else -> a feature request: Start a job.

## Start a job

1. **Preconditions + setup.** Pick a short slug (a-z, 0-9, -). Run
   `scripts/factory/job.sh new <slug> "<feature text>"`. It refuses unless the main checkout is
   clean and on `main`, claims `NNN` with `mkdir` (no `-p`), creates the worktree
   `../<repo>-factory/NNN-slug` on branch `factory/NNN-slug` from `main`, and runs `npm ci`.
   Any failure: stop and report it (setup failure sets `needs-human`). The last line of output is the job dir.
2. **Route.** Choose builder vendor/model per models.md and record it with a reason before the spec:
   `.builder={vendor:"anthropic", model:"sonnet-5.5"} | .routing_reasons.builder="..."`.
   The Codex builder is provisional (verified on one trivial job, see models.md): prefer Claude
   unless you have a reason, and never use Codex for Swift jobs.
3. **Spec.** Stage `spec`. Spawn `spec-writer` with the feature, job dir and worktree path.
   Save its final message to `spec.md`; check the first line starts with `SPEC: `.
4. **Plan check** by the vendor that is NOT the builder. Stage `plan-check`.
   - Claude builder: spawn `reviewer-xvendor` (MODE codex) with the call
     `plan-check gpt-5.6-sol <job-dir>`; the wrapper writes `plan-check.md`.
   - Codex builder: spawn `reviewer-code` in plan-check mode; save its message to `plan-check.md`.
   Run `scripts/factory/check-verdict.sh <job>/plan-check.md "VERDICT: PASS" "VERDICT: CHANGES"`.
   On CHANGES: spawn `spec-writer` once more with `plan-check.md` to revise `spec.md` (one round only,
   no second plan check). Record `.plan_check`.
5. **Build.** Stage `build`, `.round=1`.
   - Claude builder: spawn `builder` (with the routed `model`) giving job id, worktree, branch,
     spec path. Record its agent id in `.builder.agent_id`. Save its message to `build.md`.
   - Codex builder (only when models.md allows it): `scripts/factory/codex-run.sh build <model> <job-dir>`.
   Check `STATUS: READY|BLOCKED` with check-verdict.sh. BLOCKED -> stage `needs-human`, stop.
6. **Review round N.** Stage `review`. Run `scripts/factory/job.sh diff <id> <N>` and
   `scripts/factory/escalation-scan.sh "<worktree>"`; append every TRIGGER line to `.escalations`.
   Then spawn in ONE message (parallel) and wait for ALL:
   - `reviewer-code` -> save to `round-N/review-code.md`
   - `reviewer-risk` (Opus; count it) -> save to `round-N/review-risk.md`
   - `reviewer-xvendor`: if Claude built, MODE codex with `review gpt-5.6-sol <job-dir> <N>`, plus
     `risk gpt-6-astra <job-dir> <N>` when there is any escalation trigger (rule 3); the wrapper
     writes `round-N/review-xvendor.md` / `round-N/review-codex-risk.md`. If Codex built, MODE claude
     with `model: sonnet`; save its message to `round-N/review-xvendor.md`.
   Codex reviewers cannot run Docker or network tools. If you re-run a tool the spec requires
   (for example actionlint), save the exact command, version, exit code and output to
   `round-N/verify-<tool>.txt` before the review; the wrapper passes it to Codex as evidence.
   Check every file with check-verdict.sh (`VERDICT: PASS|CHANGES`). An invalid or missing verdict:
   re-ask that agent once; still invalid -> `needs-human`. Record each reviewer's
   `{vendor, model, verdict}` under `.reviewers`, and any `TRIGGERS:` from review-risk.md in `.escalations`.
7. **Rework.** Any CHANGES and N < 3: resume the builder (SendMessage to `.builder.agent_id`; if it
   cannot be resumed, spawn `builder` again) with the CHANGES review files. Save its message to
   `build-rN.md`, set `.round=N+1`, repeat step 6 (re-run reviewer-code and xvendor always,
   reviewer-risk only if it said CHANGES). Max **2** rework rounds (3 review rounds). Still CHANGES
   after round 3 -> stage `needs-human`, then continue to steps 8-9 so the maintainer gets a test plan.
8. **Test plan.** Stage `test-plan`. Spawn `test-plan-writer`; save to `test-plan.md`; run
   `scripts/factory/check-test-plan.sh "<job>/test-plan.md"`. On failure send the errors back to the
   same agent once; still failing -> `needs-human`.
9. **Approve.** `job.sh set <id> '.stage="approve"'` (refused unless the test plan passes). Spawn
   `approver` (Opus; count it) with the job dir and the escalation-scan output. Save to
   `decision.md`; check with `check-verdict.sh <job>/decision.md READY ESCALATE`.
   READY -> stage `ready`. ESCALATE -> stage `needs-human`.
10. **Stop and report**: job id, branch, worktree path, decision (+ first reasons), test-plan path,
    escalations, and every model used per stage (builder, plan check, each reviewer). The maintainer merges.

A Stop hook (`check-test-plan.sh`) blocks the end of the session while any recent job in
`approve`/`ready` (or `needs-human` with a test plan) has an incomplete test plan.

## Brainstorm

1. `scripts/factory/job.sh brainstorm <slug> "<topic>"`; write the topic and any context the maintainer
   gave verbatim to `<dir>/brief.md`.
2. In ONE message spawn `brainstormer` (Opus) AND `reviewer-xvendor` (MODE codex, call
   `brainstorm gpt-6-astra <dir>`). Neither sees the other's output. Save the brainstormer's message
   to `brainstorm-claude.md`. At most one Astra call; no repeat rounds.
3. Spawn `brainstormer` again (consolidation) with both files: it returns `brainstorm.md` with
   sections Agree / Only one raised / Conflict / Recommendation. Save verbatim.
4. Show the maintainer `brainstorm.md`. It does not feed a build unless they start one.

## Not in this phase

`reviewer-ui` (iOS layout size matrix) and `scripts/factory/xcode-lock.sh` (mkdir-based Xcode lock
as a PreToolUse hook on `xcodebuild`) belong to the iOS/tvOS repos and are deliberately absent here.
There is no dashboard. Offline check of the scripts and hooks: `scripts/factory/selftest.sh`.
