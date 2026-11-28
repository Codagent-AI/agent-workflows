#!/usr/bin/env bash
# Commits the synced docs in a dot-dev checkout and opens the sync pull request.
# Usage: scripts/open-docs-sync-pr.sh <dot-dev-dir> <content-path-in-dot-dev>
# Needs GH_TOKEN, and GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT from the Actions runner.
# Run from the agent-workflows checkout that was synced.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <dot-dev-dir> <content-path>" >&2
  exit 2
fi

DOTDEV="$1"
CONTENT="$2"
SHORT_SHA="$(git rev-parse --short HEAD)"
BRANCH="docs-sync/agent-workflows-${SHORT_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"

git -C "$DOTDEV" add -A "$CONTENT"
if git -C "$DOTDEV" diff --cached --quiet; then
  echo "no docs changes to sync"
  exit 0
fi

git -C "$DOTDEV" config user.name "docs-sync-bot"
git -C "$DOTDEV" config user.email "actions@users.noreply.github.com"
git -C "$DOTDEV" checkout -b "$BRANCH"
git -C "$DOTDEV" commit -m "docs: sync agent-workflows docs from ${SHORT_SHA}"
git -C "$DOTDEV" push origin "$BRANCH"
(cd "$DOTDEV" && gh pr create --repo pacaplan/codagent-dot-dev \
  --title "docs: sync agent-workflows docs (${SHORT_SHA})" \
  --body "Automated sync of \`docs/\` from Codagent-AI/agent-workflows@${SHORT_SHA}. Merges automatically once the build check passes." \
  --base main --head "$BRANCH")
