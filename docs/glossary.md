---
title: Glossary
group: Reference
order: 2
description: The terms used across the Agent Workflows docs, grouped by define, implement and review.
---

# Glossary

## Define

- **Change, change folder.** One proposed piece of work. Its proposal, specs, design and test plan sit in `openspec/changes/<name>/`. Define writes it, and Archon implements it.
- **`define-openspec-change`.** The plugin that runs a define inside Claude Code or Codex. You start it with a slash command in Claude Code, or a skill in Codex.
- **Step.** One of define's five stages: proposal, specs, design, test-plan and approach-review.
- **Lead.** The agent in your own session that works through the steps with you.
- **Tool server.** The plugin's small Node program, which the CLI talks to over MCP. Its `next_step` tool checks the current step and returns the next step's prompt. Its `crosscheck`, `get_crosscheck` and `cancel_crosscheck` tools run and follow reviews.
- **Crosscheck.** A review by one or more agents, often on other vendors' CLIs, of your proposal and approach, or of anything else you ask, through acpx. See [Crosschecks](crosschecks.md).
- **Reviewer (crosscheck).** One agent in a crosscheck. Each is an entry in `~/.agent-workflows/config.yaml`.
- **acpx.** A command-line client for the Agent Client Protocol. It starts other agents' CLIs, such as Claude, Codex and agy, with a chosen model and permission policy.
- **Marketplace.** A catalog file that lets Claude Code or Codex install plugins from a repository. The root of this repository has one for each CLI.
- **State file.** `.define-openspec-change.json` in the change folder. It records the current step, the times, and each crosscheck.

## Archon and the pack

- **Archon.** An open-source factory builder for coding agents. It runs YAML workflows of agents and scripts, opens pull requests, and has a web console.
- **Workflow, node.** A YAML file of nodes, each an agent prompt, a script or a loop, run in dependency order.
- **Pack.** A folder of workflows shipped as one unit. Here, the Codagent pack: `codagent-implement-change` and the two definition workflows it includes, in `factory-workflows/archon/`.
- **Workflow source.** The `--workflow-source` flag, which tells Archon to read the pack from a folder.
- **The factory.** Archon running the pack. It turns an approved change into a pull request on its own branch, and never merges on its own.
- **The fork.** The Codagent-AI fork of Archon: upstream `dev` plus the named resume and the review page's answer path. See [Setup](setup.md#install-archon).
- **Role, alias.** A name such as `@implementor` that a node uses in place of a model. Archon's config binds it to a provider, model and effort. See [Roles and settings](roles-and-settings.md#roles).
- **Pack settings.** The pack's constants, declared with defaults for an OpenSpec repository. A project overrides them, and a run can override them with `--input`.
- **Forge.** Archon's plugin for a code host. The pack reaches pull requests through `archon forge`, except for reading comments, which stays on `gh`.

## Implement

- **Checklist.** `checklist.md` in the change folder. One `CHECK-n` row for each spec behavior, with how it is verified, the evidence, and a status of `verified`, `failed` or `not verified`.
- **Repair.** One agent attempt to fix a failed check, followed by a recheck.
- **Completion loop.** After implement, a script checks that the change is complete. When it isn't, a fresh tester session judges why.
- **Audit.** A fresh reviewer's inspection of the work against the definition.
- **Fix round.** One implementor turn on the review's open findings, then a re-review in the same reviewer session. The review before the pull request gets three at most, and the review in an acceptance round gets one.
- **Decline.** The implementor's answer to a review finding it won't fix, with its reason. The reviewer accepts it, which closes the finding, or contests it once.
- **Acceptance round.** One pass of acceptance: a fresh tester explores the change as a user, CI is awaited, the tester hands off, and the gate decides whether the change has converged.
- **Journey.** A scenario in the test plan that acceptance tests live, with an ID such as `JOURNEY-3`.
- **Human check.** A check the test plan leaves to a person, with an ID such as `HUMAN-1`.
- **Gate.** A script that calls a round ready or not. It reads the tester's status file and the git state.
- **Converged.** Acceptance ended ready, at the pull request's final head.

## Review

- **Decision.** An agent's own answer to a question the definition doesn't settle, where the answer could change behavior, scope or integration.
- **Dispute.** A finding or comment left unfixed without both sides agreeing.
- **Decision log, dispute log.** `decision-log.md` and `dispute-log.md`, with entries numbered `DECIDE-n` and `DISPUTE-n`. See [Reviewing a run](reviewing-a-run.md#the-two-logs).
- **Review package.** What the run writes for your review: the ranked concerns, the key evidence, and the logs.
- **Review page.** An HTML page, served by Archon, that shows one review round's package. Each concern has a question, and the page has Send feedback and Merge buttons.
- **Concern.** One ranked item on the page, in the tier High, Medium or Low.
- **Review round.** One pass of the review loop: the run publishes a page and waits, and on your feedback it merges in the base branch, addresses each answer, and publishes the next page.
- **Late commit.** A commit made after the accepted head. Its concern offers Retest and a review round.
- **Occurrence.** Archon's id for one pause at a wait. An answer must carry it.
- **Run states.** A run ends as succeeded, needs attention, or failed. See [Workflow reference](workflow-reference.md#run-outcomes).
