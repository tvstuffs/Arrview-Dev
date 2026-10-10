#!/usr/bin/env python3
"""PreToolUse guard for the Bash tool (second layer behind the deny rules in settings.json).

Reads the hook JSON on stdin. Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
Blocks, wherever they appear in a compound command or a `sh -c` / `eval` string:
  - git push (any global options), gh pr merge, gh release
  - codex/claude invoked with --dangerously-bypass-approvals-and-sandbox,
    --dangerously-skip-permissions or bypassPermissions
  - recursive forced rm whose target is outside the factory worktree root (<repo>-factory/),
    /tmp, $TMPDIR or $FACTORY_STATE, or cannot be resolved (variables, command substitution)

Self-test without the harness:
  echo '{"tool_input":{"command":"git push"},"cwd":"/tmp"}' | scripts/factory/guard-bash.py; echo $?
"""
import json
import os
import shlex
import subprocess
import sys

WRAPPERS = {"env", "command", "sudo", "nohup", "time", "nice", "exec", "xargs", "builtin"}
SHELLS = {"sh", "bash", "zsh", "dash"}
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
BYPASS_FLAGS = ("--dangerously-bypass-approvals-and-sandbox", "--dangerously-skip-permissions", "bypassPermissions")


def allowed_roots(cwd):
    roots = ["/tmp", "/private/tmp"]
    if os.environ.get("TMPDIR"):
        roots.append(os.environ["TMPDIR"])
    project = os.environ.get("CLAUDE_PROJECT_DIR") or cwd
    try:
        common = subprocess.run(
            ["git", "-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=5).stdout.strip()
        if common:
            main = os.path.dirname(common)
            roots.append(os.path.join(os.path.dirname(main), os.path.basename(main) + "-factory"))
    except Exception:
        pass
    if os.environ.get("FACTORY_STATE"):
        roots.append(os.environ["FACTORY_STATE"])
    return [os.path.realpath(r) for r in roots]


def split_segments(cmd):
    """Split a command line into simple commands (lists of words) on ; & | && || and newlines."""
    lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=";&|()")
    lex.whitespace_split = True
    lex.commenters = ""
    segs, cur = [], []
    try:
        for tok in lex:
            if tok and set(tok) <= set(";&|()"):
                if cur:
                    segs.append(cur)
                cur = []
            else:
                cur.append(tok)
    except ValueError:
        # Unbalanced quotes: fall back to whitespace split so we still see the words.
        return [cmd.split()]
    if cur:
        segs.append(cur)
    return segs


def strip_wrappers(words):
    while words:
        w = words[0]
        if "=" in w and not w.startswith("-") and w.split("=", 1)[0].replace("_", "").isalnum():
            words = words[1:]
        elif os.path.basename(w) in WRAPPERS:
            words = words[1:]
            while words and words[0].startswith("-"):
                words = words[1:]
        else:
            break
    return words


def git_subcommand(words):
    i = 1
    while i < len(words):
        w = words[i]
        if w in GIT_OPTS_WITH_ARG:
            i += 2
        elif w.startswith("-"):
            i += 1
        else:
            return w
    return None


def rm_targets_outside(words, cwd, roots):
    flags = [w for w in words[1:] if w.startswith("-")]
    letters = "".join(f[1:] for f in flags if not f.startswith("--"))
    recursive = "r" in letters or "R" in letters or "--recursive" in flags
    force = "f" in letters or "--force" in flags
    if not (recursive and force):
        return []
    bad = []
    for t in (w for w in words[1:] if not w.startswith("-")):
        raw = t
        t = os.path.expanduser(t.replace("${HOME}", "~").replace("$HOME", "~"))
        if "$" in t or "`" in t:
            bad.append(raw + " (unresolvable)")
            continue
        base = t.split("*")[0].split("?")[0].split("[")[0] or "."
        path = os.path.realpath(os.path.join(cwd, base))
        if not any(path == r or path.startswith(r + os.sep) for r in roots) or path in roots:
            bad.append(raw)
    return bad


def check(cmd, cwd, roots, depth=0):
    if depth > 3:
        return "command nesting too deep to verify"
    for words in split_segments(cmd):
        words = strip_wrappers(words)
        if not words:
            continue
        prog = os.path.basename(words[0])
        if prog in ("codex", "claude", "npx") and any(f in w for w in words for f in BYPASS_FLAGS):
            return "bypassing the sandbox/permissions is never allowed in the factory"
        if prog == "cd" and len(words) > 1:
            cwd = os.path.realpath(os.path.join(cwd, os.path.expanduser(words[1])))
            continue
        if prog in SHELLS and "-c" in words:
            idx = words.index("-c")
            if idx + 1 < len(words):
                why = check(words[idx + 1], cwd, roots, depth + 1)
                if why:
                    return why
            continue
        if prog == "eval":
            why = check(" ".join(words[1:]), cwd, roots, depth + 1)
            if why:
                return why
            continue
        if prog == "git" and git_subcommand(words) == "push":
            return "git push is denied: the factory never pushes. The maintainer pushes from their own terminal."
        if prog == "gh" and len(words) >= 3 and words[1] == "pr" and words[2] == "merge":
            return "gh pr merge is denied: the factory never merges."
        if prog == "gh" and len(words) >= 2 and words[1] == "release":
            return "gh release is denied: the factory never releases."
        if prog == "rm":
            bad = rm_targets_outside(words, cwd, roots)
            if bad:
                return ("rm -rf outside a factory job worktree/temp dir is denied: " + ", ".join(bad))
    return None


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or os.getcwd()
    why = check(cmd, cwd, allowed_roots(cwd))
    if why:
        print(f"factory guard: blocked. {why}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
