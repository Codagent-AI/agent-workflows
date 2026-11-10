#!/bin/sh
# Runner's verify-checklist command (implement-change-v2.0.yaml), unchanged
# except that change_dir and session_dir come from the environment.
# No errexit, as in Runner: each check exits explicitly, and the final cp's
# status is the script's.
list="$INPUTS_CHANGE_DIR/checklist.md"
if [ ! -s "$list" ]; then
  echo "$list is missing or empty" >&2
  exit 1
fi
# Empty for a change directory outside the repository, which stays uncommitted.
if [ -n "$(git status --porcelain -- "$list" 2>/dev/null)" ]; then
  echo "$list has uncommitted changes" >&2
  exit 1
fi
# A planned row cannot change later, so a row that splits into the wrong
# number of cells (an unescaped | inside a cell) must be fixed now.
LIST="$list" python3 - <<'PY'
import os, re, sys

def cells(line):
    return re.sub(r"^\||\|$", "", line.strip().replace("\\|", "\x01")).split("|")

width, bad, found = None, [], False
for line in open(os.environ["LIST"], encoding="utf-8", errors="replace").read().splitlines():
    if not line.lstrip().startswith("|"):
        if width:
            break
        width = None
        continue
    if width is None:
        names = [c.strip().lower() for c in cells(line)]
        width = len(names) if any(re.match(r"id(?![a-z0-9_-])", n) for n in names) else 0
        found = found or width > 0
    elif width and not re.fullmatch(r"[\s:|-]*", line) and len(cells(line)) != width:
        bad.append(cells(line)[0].strip() or "a row")
if not found:
    print("checklist has no table with an ID column", file=sys.stderr)
for row in bad:
    print(f"checklist row {row} does not have {width} cells; escape any | inside a cell as \\|", file=sys.stderr)
sys.exit(1 if bad or not found else 0)
PY
cp "$list" "$INPUTS_SESSION_DIR/output/planned-checklist.md"
