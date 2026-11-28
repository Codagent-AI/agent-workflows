---
title: Documentation Authoring Guide
group: Development
order: 99
description: Format and structure for docs that sync to codagent.dev.
---

# Documentation Authoring Guide

These instructions apply to Markdown files in this `docs/` directory. The docs sync workflow copies most of these files into the codagent.dev docs site, where the site generator renders them into the Agent Workflows documentation.

## File Structure

- Use one public topic per Markdown file.
- Use lowercase kebab-case filenames, such as `quickstart.md` or `workflow-reference.md`.
- Keep repo-facing indexes in `README.md`; the docs site skips `README.md` and uses `introduction.md` as the product landing page.
- Put images under `docs/images/` and reference them with relative paths like `images/workflow.png`.
- Keep `CLAUDE.md` as a symlink to `AGENTS.md`; edit `AGENTS.md` directly.

## Pages that do not sync

Two pages stay in the repository and never reach the site:

- `development.md`, for people who change this repository.
- `coming-from-agent-runner.md`, the comparison with the older engine.

The sync script (`scripts/sync-docs.sh`, run by `.github/workflows/sync-docs.yml`) drops them, along with `README.md`, `AGENTS.md` and `CLAUDE.md`. If you add a page that must stay private, add it to that list.

A synced page never links to one of these two pages.

## Names

Only `coming-from-agent-runner.md` may name Agent Runner or Agent Factory. Every synced page describes Agent Workflows as it is, without reference to the tools it replaced.

## Page Metadata

Public docs start with simple YAML frontmatter:

```yaml
---
title: Page Title
group: Getting Started
order: 1
description: One sentence summary for previews and metadata.
---
```

The groups in use are `Getting Started`, `Guides`, `Configuration`, `Reference`, `Operations` and `Development`. Pages inside a group are sorted by `order`; use larger numbers for less prominent pages.

## Markdown Style

- Start the page body with exactly one `#` heading that matches the page title.
- Use `##` headings for the table of contents; lower headings are fine inside a section.
- Use relative links to other docs pages, such as `[Quickstart](quickstart.md)`. The site generator turns every relative `.md` link into a docs route, so do not use a relative `.md` link for a file that is not a docs page.
- Link to files elsewhere in the repository with a full GitHub URL, such as `https://github.com/Codagent-AI/agent-workflows/blob/main/factory-workflows/archon/PROVENANCE.md`.
- Use fenced code blocks with a language tag, such as `bash`, `yaml`, `json`, or `text`.
- Prefer tables for compact reference material and ordered lists for procedures.
- Do not use raw HTML; the docs site Markdown renderer disables embedded HTML.
- Do not use em dashes.
- Do not link to the private design documents.

## Content Expectations

- Write for people using the tools first, then for contributors.
- Keep current behavior sourced from code first, then current OpenSpec specs, then docs.
- Avoid documenting historical or archived behavior as current behavior.
- Mention platform or install prerequisites before commands that depend on them.
- When adding a page that should be easy to find, give it frontmatter with the right group and order instead of relying on filename order.

## Shared text

`introduction.md` and the root `README.md` share their opening text: the intro paragraph, Deterministic workflows, Opinions and Features. When you change one, change the other.
