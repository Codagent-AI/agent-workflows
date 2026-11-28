---
title: Development
group: Development
order: 1
description: How the repository is laid out, how to change each project, how CI runs, and how a change is made.
---

# Development

This page is for people who change this repository. It does not sync to the docs site.

## Layout

Top-level folders are named by purpose. The folders under them are named by what they depend on.

| Folder | What it holds |
|---|---|
| `human-workflows/openspec/` | `define-openspec-change`, a Claude Code and Codex plugin, and its TypeScript tool server |
| `human-workflows/archon/` | `codagent-archon`, a Claude Code and Codex plugin that runs the pack on Archon and follows each run |
| `factory-workflows/archon/` | The Codagent pack: the workflows Archon runs |
| `openspec/` | The OpenSpec changes and specs for every project in the repository |
| `docs/` | The user docs |
| `scripts/` | Repository scripts, such as the docs sync |

The rule, from the root [AGENTS.md](../AGENTS.md):

- `human-workflows/` is for plugins where a person and an agent work together. `factory-workflows/` is for workflows an agent runs without a person.
- Folders under them are named by what they depend on.
- New work goes under the purpose folder it serves. Add a dependency folder when the dependency differs.
- Keep the root README's layout table current when you add a folder.
- Each project folder keeps the rules for changing it in its own `AGENTS.md`.
- Every OpenSpec change lives in the one OpenSpec project at the repository root. Don't add an `openspec/` folder inside a project.

## Marketplaces

The repository root is a plugin marketplace for both CLIs: `.claude-plugin/marketplace.json` for Claude Code, and `.agents/plugins/marketplace.json` for Codex. Both list the plugins under `human-workflows/`. Keep each plugin's name the same in both manifests and both marketplace files, and its version the same in both manifests.

The CLIs copy only a plugin's `plugin/` folder into their cache. So a skill reaches only files inside it. The pack is read from a clone, not from a plugin.

## Rules for each project

Read the project's `AGENTS.md` before you change it.

- [`human-workflows/openspec/AGENTS.md`](../human-workflows/openspec/AGENTS.md): the plugin, its server, the committed bundle, lint limits, and how Codex runs the server.
- [`human-workflows/archon/AGENTS.md`](../human-workflows/archon/AGENTS.md): the plugin, and what a skill here may cover.
- [`factory-workflows/archon/AGENTS.md`](../factory-workflows/archon/AGENTS.md): the pack, its layout, the files a run writes, tests, and live trials.

## The committed server bundle

`human-workflows/openspec/plugin/server.mjs` is the esbuild bundle of the TypeScript in `server/src`. After you change the source, run `npm run build` in `server/` and commit the bundle with it. CI checks that the bundle matches a fresh build.

## Hard rule: don't test static content

Never write a test that reads or checks the words of a skill, a prompt file, markdown, a workflow's YAML prompts, or a tool description. Test code, and test text only where code chooses it by branch or builds it from data. The root [AGENTS.md](../AGENTS.md) has the full rule. This applies to `docs/` too: there are no tests of these pages.

## CI and Agent Validator

CI is one job for each sub-project, run when a pull request changes its folder:

| Job | Runs |
|---|---|
| `archon` | Lint, the script tests, and the dry-run fixtures, on Archon from source at a pinned commit of the fork |
| `openspec` | Lint, typecheck, the bundle check and the server tests, on Node 26 |

Agent Validator runs the same checks locally, with cross-agent reviews. Run it before you push. `.validator/config.yml` sets one entry point for each project.

## How changes are made

1. **Define.** Write the change with the `define` skill. It lands in `openspec/changes/<name>`.
2. **Implement.** Run it with the `codagent-archon` plugin's `implement-change` skill, with your clone as the pack. The pack builds the change on its own branch, archives it, and publishes the review page.
3. **Review.** You review the pull request from its review page, and merge it.

Every pull request merges to `main` on its own. Bring `main` into a branch with a merge, not a rebase.

## PROVENANCE files

Two files name where code was copied from: `human-workflows/openspec/plugin/PROVENANCE.md` and `factory-workflows/archon/PROVENANCE.md`. They are the only places that name the projects the workflows were ported from. Don't name those projects anywhere else in those folders.

## The docs sync

`.github/workflows/sync-docs.yml` runs when a change to `docs/` lands on `main`. It checks out this repository and `pacaplan/codagent-dot-dev`, runs `scripts/sync-docs.sh docs <dot-dev content folder>` to copy the pages, and runs `scripts/open-docs-sync-pr.sh` to open a pull request in dot-dev, which builds and merges automatically. It needs a `DOCS_SYNC_PAT` secret on this repository: a fine-grained token with contents and pull requests access to that repository.

`scripts/sync-docs.sh` drops this page, `coming-from-agent-runner.md`, `README.md`, `AGENTS.md` and `CLAUDE.md`, and copies only the images the pages reference. You can run it into a temporary folder to see what would sync. See [docs/AGENTS.md](AGENTS.md) for the page format.
