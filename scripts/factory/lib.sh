# shellcheck shell=bash
# Shared helpers for scripts/factory/*. Source it; do not execute it.
#
# Machine-specific values never live in committed files. The job-state root is
# read from $FACTORY_STATE, or from a line `FACTORY_STATE=<absolute path>` in the
# gitignored CLAUDE.local.md of the current tree or of the main checkout.

factory_die() { echo "factory: $*" >&2; exit 1; }

# Absolute path of the main checkout (parent of the shared .git dir), from any worktree.
factory_main_checkout() {
  local common
  common=$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  dirname "$common"
}

factory_repo_name() {
  local main
  main=$(factory_main_checkout "${1:-.}") || return 1
  basename "$main"
}

# Directory that holds job worktrees: a sibling of the main checkout, <repo>-factory/.
factory_worktree_root() {
  local main
  main=$(factory_main_checkout "${1:-.}") || return 1
  printf '%s/%s-factory\n' "$(dirname "$main")" "$(basename "$main")"
}

factory_state() {
  if [ -n "${FACTORY_STATE:-}" ]; then printf '%s\n' "$FACTORY_STATE"; return 0; fi
  local top main f v
  top=$(git -C "${1:-.}" rev-parse --show-toplevel 2>/dev/null) || top=""
  main=$(factory_main_checkout "${1:-.}") || main=""
  for f in "$top/CLAUDE.local.md" "$main/CLAUDE.local.md"; do
    [ -f "$f" ] || continue
    v=$(sed -n 's/^[[:space:]]*FACTORY_STATE=\(.*\)$/\1/p' "$f" | head -n1)
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    case "$v" in "~"/*) v="$HOME/${v#\~/}" ;; esac
    if [ -n "$v" ]; then printf '%s\n' "$v"; return 0; fi
  done
  return 1
}

# $FACTORY_STATE/<repo>
factory_repo_state() {
  local state repo
  state=$(factory_state "${1:-.}") || return 1
  repo=$(factory_repo_name "${1:-.}") || return 1
  printf '%s/%s\n' "$state" "$repo"
}
