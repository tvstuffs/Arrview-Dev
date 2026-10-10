# Escalation triggers

The approver MUST answer `ESCALATE` (and both risk reviews, `reviewer-risk` on Opus and
`codex-run.sh risk` on gpt-6-astra, MUST run) when the diff touches any of:

- storage or Keychain, config shape, UserDefaults keys, or anything affecting upgrade from shipped 1.0
- an `ArrViewCore` version bump or tag
- proxy vs Direct backend behaviour (they are separate implementations)
- `.github/workflows/*`, Dockerfile, publish/release steps
- dependencies added, removed or upgraded
- auth, CORS, Host/Origin handling, CSP, or anything web-exposed
- anything bound for a public repo that adds a path, name, address or identifier (PII rule)
- product decisions the spec didn't settle

`scripts/factory/escalation-scan.sh <worktree>` is a deterministic first pass over the diff. A hit
means "escalate"; a clean scan does not clear a job. The orchestrator appends every hit, and every
trigger a reviewer or the approver names, to `job.json.escalations`.

Escalating is not failure. It means: the branch, test plan and reviews are ready, and a human
decision is required before anyone tests on devices. The job ends in stage `needs-human`.
