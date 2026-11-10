#!/bin/sh
# Runner's check-implementor-checklist command (implement-change-v2.0.yaml);
# the definition head arrives in DEFINITION_HEAD.

dir=$INPUTS_CHANGE_DIR
if [ "$(git rev-parse HEAD)" != "$DEFINITION_HEAD" ]; then
  echo "implementor-checklist committed work; it may only write $dir/checklist.md" >&2
  exit 1
fi
other=$(git status --porcelain --untracked-files=all | grep -v -F "$dir/checklist.md" | grep -v -x -F -f "$INPUTS_SESSION_DIR/output/pre-list-status.txt" || true)
if [ -n "$other" ]; then
  echo "implementor-checklist changed files other than $dir/checklist.md:" >&2
  echo "$other" >&2
  exit 1
fi
if [ ! -s "$dir/checklist.md" ]; then
  echo "implementor-checklist did not write $dir/checklist.md" >&2
  exit 1
fi
# Empty for a change directory outside the repository, which stays uncommitted.
if [ -n "$(git status --porcelain -- "$dir/checklist.md" 2>/dev/null)" ]; then
  git add -- "$dir/checklist.md"
  git commit -m "[check-implementor-checklist] docs: add verification checklist for $INPUTS_CHANGE_NAME" -- "$dir/checklist.md"
fi
