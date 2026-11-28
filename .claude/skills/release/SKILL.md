---
name: release
description: >-
  Creates a release PR for agent-workflows from the PRs merged since the previous
  release tag, plus the current branch PR when run from a feature branch. Use
  when the user says "release", "cut a release", "create a release PR",
  "prepare a release", or "bump version".
---

Create a release PR by gathering release candidates, calculating the semver
bump, writing a changelog section, and opening or updating the release PR.

The repository has one version, in the root `VERSION` file. It covers both
plugins and the Archon pack, so the pack tarball and the plugins that download
it always match. Merging the release PR runs `.github/workflows/release.yml`,
which tags `v<version>` and creates the GitHub release. Nobody tags by hand.

## Steps

### 1. Gather release info

Run:

```bash
bash .claude/skills/release/scripts/release-info.sh
```

Capture the JSON output. If the output contains `"error"`, stop and report the
message to the user. In particular, do not continue from a feature branch whose
associated PR is already merged/closed or does not target `main`; switch to or
create the open PR for the current unreleased changes first.

### 2. Reclassify internal-only changes

The `major`/`minor` buckets from the script are based only on conventional-commit
prefixes (`feat:`, `!:`, a `breaking` label). They say nothing about whether the
change is visible to someone who installs the plugins or runs the pack. Before
showing the summary, review every PR in the `major` and `minor` buckets and
downgrade any that are purely internal or development-facing to `patch`.

A PR is internal if a user of the released plugins and pack would never notice
it: CI and workflow changes, release tooling, docs, OpenSpec change documents,
test infrastructure, or refactors with no behavior change. Do not downgrade PRs
that change what a plugin or the pack does, what its skills or workflows say,
the files a run writes, or that fix a user-facing bug.

Never move a PR up a category. This step only corrects false positives in
`major`/`minor`.

After reclassifying, recompute `new_version` from `current_version`: major bump
if any PR remains in `major`, else minor if any remains in `minor`, else patch.
Note each downgrade in the summary so the user can override it.

### 3. Show the release summary

Display:

- Version bump: `current_version` -> `new_version`
- Number of PRs by category, after reclassification
- Each PR number and title, grouped by Major / Minor / Patch
- Any PRs downgraded in step 2, with a one-line reason
- When a current branch PR is included, confirm it is the open PR for the
  current branch, not an already-merged predecessor.

### 4. Write changelog descriptions

For each PR in the JSON output, write a one-sentence description that is more
informative than the raw PR title. Strip the conventional commit prefix from
the title and keep enough context to understand the change without clicking
through.

### 5. Format the changelog section

Build the changelog section for the new version. Only include sections that
have entries. Sort entries by PR number ascending within each section. The
release workflow uses this section, as written, for the GitHub release notes.

```markdown
## <new_version>

### Major Changes

- [#<number>](https://github.com/Codagent-AI/agent-workflows/pull/<number>) <description>

### Minor Changes

- [#<number>](https://github.com/Codagent-AI/agent-workflows/pull/<number>) <description>

### Patch Changes

- [#<number>](https://github.com/Codagent-AI/agent-workflows/pull/<number>) <description>
```

### 6. Write the changelog section to a temp file

```bash
TMPFILE=$(mktemp)
cat <<'CHANGELOG_EOF' > "$TMPFILE"
<paste the formatted changelog section here>
CHANGELOG_EOF
echo "$TMPFILE"
```

### 7. Create the release PR

Run:

```bash
bash .claude/skills/release/scripts/create-release-pr.sh <new_version> <tmpfile_path>
```

The script writes `VERSION`, prepends the changelog section, runs
`node scripts/sync-versions.mjs` to update every manifest, `server/package.json`,
its lockfile and the marketplace entries, and rebuilds the define plugin's
`server.mjs` (it carries the version). It then commits and pushes.

When run on `main`, it creates `release/v<new_version>` and opens a release PR.
When run on another branch, it commits the release changes directly to that
branch and prints its PR URL.

### 8. Report

Print the PR URL returned by the script, then clean up:

```bash
rm -f "$TMPFILE"
```
