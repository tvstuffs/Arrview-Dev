# Factory model roster

The orchestrator may choose ONLY these models. For every stage it records the choice and a
one-line reason in `job.json.routing_reasons`.

| Alias | Provider | Invocation | Strength | Cost note | Use for |
|---|---|---|---|---|---|
| opus-5.5 | Anthropic | subagent `model: opus` | deepest reasoning, best at judgement calls | highest Claude cost; max 3 Opus runs per job outside brainstorm | brainstorm, specs, risk review, approver, hard builds |
| sonnet-5.5 | Anthropic | subagent `model: sonnet` | fast, solid coding and review | mid | code review, test plans, routine builds |
| haiku-5.5 | Anthropic | subagent `model: haiku` | cheap and quick | lowest | CHANGELOG/doc amendments |
| gpt-6-astra | OpenAI | `scripts/factory/codex-run.sh <mode> gpt-6-astra ...` | strong independent/adversarial reasoning | ChatGPT plan usage; one call per brainstorm | brainstorm second opinion, adversarial/risk review |
| gpt-5.6-sol | OpenAI | `scripts/factory/codex-run.sh <mode> gpt-5.6-sol ...` | fast cross-vendor code reader | ChatGPT plan usage | cross-vendor code review, plan check, Codex builds |

**Excluded:** Fable (bills usage credits). Do not add it.

To override an agent file's default model for one run, pass `model` when spawning the agent
(for example `builder` with `sonnet` for a routine Node change, `opus` for a hard one).

## Hard routing rules (the orchestrator cannot override these)

1. **Builder vendor != cross-vendor reviewer vendor.** Claude builds -> Codex (`gpt-5.6-sol`)
   fills the `reviewer-xvendor` slot and does the plan check. Codex builds -> `reviewer-xvendor`
   reviews itself as Claude, and `plan-check` is done by `reviewer-code` (Claude) on the spec.
2. Default builder is Claude for Swift (Core/iOS/tvOS). For server/Node/CI jobs it may choose Codex
   or Sonnet. Alternate where there is no strong reason, and record who built each job.
3. Any job matching `escalation.md` (or with a hit from `scripts/factory/escalation-scan.sh`) gets
   `reviewer-risk` (Opus) AND a `gpt-6-astra` risk review (`codex-run.sh risk`).
4. At most **3 Opus-level agent runs per job** outside brainstorm. `job.sh set` refuses
   `opus_runs > 3`; when the next stage would need a fourth, set stage `needs-human` instead.

## Verification status of the Codex invocations

Checked on the build machine on 2026-10-10 with codex-cli 0.162.1 on a ChatGPT login (no API key):

- `codex exec -m gpt-6-astra --sandbox read-only --skip-git-repo-check -o <file>`: works.
- `codex exec -m gpt-5.6-sol --sandbox read-only ...`: works (one-line prompt, verdict line returned).
- `codex-run.sh review gpt-5.6-sol ...` (prompt on stdin, read-only, cwd = worktree): works;
  returned `VERDICT: PASS` on a one-line diff.
- **Codex as builder (`codex-run.sh build`): works on ONE trivial throwaway job; treat as
  provisional.** Findings from throwaway copies of this repo under /tmp:
  - It edits files in the workdir and runs the tests. A sentinel file outside the workdir was untouched.
  - It cannot commit: the sandbox keeps `.git` read-only (`index.lock` permission error).
    `codex-run.sh build` therefore commits on Codex's behalf after `STATUS: READY`.
  - Default workspace-write also makes `/tmp` and `$TMPDIR` writable; the wrapper excludes both
    and points `TMPDIR` at `<worktree>/.factory-tmp` (removed afterwards).
  - `npm test` needs loopback sockets: without network access the server tests fail with
    `listen EPERM 127.0.0.1`, so the wrapper sets `network_access=true`. With that plus the
    in-worktree `TMPDIR`, a one-line change passed `npm test` (node 35/35, vitest 27/27, re-run
    independently outside Codex) and the wrapper committed it.
  - `network_access=true` also gives Codex outbound network. Codex commands do not pass through
    Claude Code hooks, so the guard does not apply to them; the prompt forbids push/network use.
  - Read-only reviews cannot run `npm test` (loopback and mkdtemp are blocked); reviewers rely on
    the builder's counts plus reading the code.
  Use the Codex builder only for server/Node/CI jobs (rule 2). Swift jobs stay on Claude.
