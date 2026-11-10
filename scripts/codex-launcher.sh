#!/bin/bash
# Writes a Codex launcher that starts every Codex app-server thread at one
# reasoning effort. Point Archon's `assistants.codex.codexBinaryPath` at it.
#
# Why: Archon starts each Codex thread at the effort in the user's
# ~/.codex/config.toml, then sets the node's effort on the turn. When the two
# differ, Codex records a mid-session effort change, and the acceptance tester
# (gpt-6-luna, medium) ends its turn right after planning. Starting the thread
# at the role's effort avoids the change. Archon takes one Codex binary per run,
# so the launcher has one effort: use the one most Codex roles share.
#
# Usage: codex-launcher.sh <codex-binary> <effort> <output>
# Only `app-server` invocations get the effort; other commands (version and
# login checks) pass through unchanged.
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: codex-launcher.sh <codex-binary> <effort> <output>" >&2
  exit 2
fi
codex=$1
effort=$2
output=$3

case "$effort" in
  minimal|low|medium|high|xhigh|max|ultra|persistent) ;;
  *) echo "codex-launcher: unknown effort '$effort'" >&2; exit 2 ;;
esac

{
  echo '#!/bin/bash'
  echo '# Written by agent-workflows scripts/codex-launcher.sh.'
  printf 'codex=%q\n' "$codex"
  echo 'if [ "${1:-}" = app-server ]; then'
  printf '  exec "$codex" "$@" -c %q\n' "model_reasoning_effort=\"$effort\""
  echo 'fi'
  echo 'exec "$codex" "$@"'
} > "$output"
chmod +x "$output"
