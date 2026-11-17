# human-workflows/archon

The codagent-archon plugin. The README is for people who use it; this file is for people who change it.

## Layout

```
human-workflows/archon/
  plugin/                         the installable plugin root
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json     names the skills folder
    skills/implement-change/      runs codagent-implement-change and follows the run
      wait-run.sh                 waits on one run without model time
```

## Rules

- `plugin/` is the installable plugin root. Codex, and Claude Code for a Git marketplace, copy only that folder into the plugin cache, so a skill reaches only files inside it, such as the script next to it. The pack itself is read from the user's clone of this repository.
- A skill here covers only what is specific to the pack. General Archon CLI use belongs to Archon's `archon-cli` skill, which users install with `archon skill add`: point to it rather than repeating it. It is not a plugin, so the manifests cannot declare it as a dependency.
- Write skills for both CLIs and for any user. Name a CLI-specific tool only as an option ("if your CLI has one"), and keep a user's machine, paths, and habits out of them.
- Keep a skill in step with the pack: when the pack's workflow names, inputs, settings, roles, or the artifacts the skill reads change, update the skill in the same change.
- The plugin's version is set in `plugin/.claude-plugin/plugin.json`. Keep it the same in `plugin/.codex-plugin/plugin.json`, and keep the plugin name the same in both manifests and both marketplace files.
- Check the manifests with `claude plugin validate human-workflows/archon/plugin` from the repository root.
