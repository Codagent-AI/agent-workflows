#!/bin/sh
# Installs the Codagent skills from an Agent Skills checkout into a target
# checkout, where codagent-implement-change's agents load them:
#   .agents/skills/codagent-<name>/  for Codex, invoked as $codagent-<name>
#   .claude/skills/codagent-<name>/  for Claude
# Each copy is renamed codagent-<name> so it cannot collide with a user-level
# skill of the same name; only the SKILL.md frontmatter `name:` changes. The copies
# are listed in the target's git exclude file, so no agent commits them.
#
# Usage: install-skills.sh <agent-skills-checkout> <target-checkout>
# Prints the Agent Skills commit it installed. Refuses a dirty checkout, so the
# commit names exactly what was installed.
set -eu

skills_repo=$1
target=$2

if [ -n "$(git -C "$skills_repo" status --porcelain)" ]; then
  echo "install-skills: $skills_repo has uncommitted changes" >&2
  exit 1
fi
commit=$(git -C "$skills_repo" rev-parse HEAD)
exclude=$(git -C "$target" rev-parse --path-format=absolute --git-path info/exclude)
mkdir -p "$(dirname "$exclude")"
touch "$exclude"

for root in .agents/skills .claude/skills; do
  mkdir -p "$target/$root"
  for dir in "$skills_repo"/skills/*/; do
    name=$(basename "$dir")
    [ -f "$dir/SKILL.md" ] || continue
    dest="$target/$root/codagent-$name"
    rm -rf "$dest"
    cp -R "$dir" "$dest"
    # Rename the skill in its frontmatter: replace a `name:` line, or add one
    # after the opening `---` when the name comes from the folder.
    awk -v name="$name" '
      NR == 1 && $0 == "---" { print; infront = 1; next }
      infront && $0 == "---" { if (!named) print "name: codagent-" name; infront = 0; print; next }
      infront && $0 ~ "^name:" { print "name: codagent-" name; named = 1; next }
      { print }
    ' "$dir/SKILL.md" > "$dest/SKILL.md"
    if [ "$(grep -c "^name: codagent-$name\$" "$dest/SKILL.md")" != 1 ]; then
      echo "install-skills: could not rename $dir/SKILL.md (no frontmatter?)" >&2
      exit 1
    fi
  done
  line="/$root/codagent-*/"
  grep -qxF "$line" "$exclude" || printf '%s\n' "$line" >> "$exclude"
done

printf '%s\n' "$commit"
