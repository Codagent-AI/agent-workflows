---
title: Defining a change
group: Guides
order: 1
description: The five steps of a define, how to start and resume one, what is checked before each step advances, and how a define finishes.
---

# Defining a change

A define takes an OpenSpec change from an idea to committed documents. It runs in your own Claude Code or Codex session, with you in the loop at every step. Requirements are on the [Setup](setup.md#requirements) page.

## The five steps

| Step | What you write | Reviewed by a crosscheck |
|---|---|---|
| `proposal` | `proposal.md`: why, what changes, impact | Yes |
| `specs` | One `spec.md` per capability, under `specs/` | No |
| `design` | `design.md`: approach and trade-offs | No |
| `test-plan` | `test-plan.md`: a risk-based plan for testing the change | No |
| `approach-review` | Nothing new. The reviewers read the proposal, specs, design and test plan together. | Yes |

Your agent works through each step with you. Code, not the agent, decides the order. The agent asks for the next step with a tool called `next_step`, and the tool returns the next prompt in the same conversation. Nothing restarts.

All files go in `openspec/changes/<name>/`.

## Start a define

| CLI | Start or resume a define |
|---|---|
| Claude Code | `/define-openspec-change:define [change-name] [what you want]` |
| Codex | `$define [change-name] [what you want]` |

The change name is optional. Without one, the agent names the change from what you want, without asking. A name uses lowercase letters, digits and hyphens, and starts with a letter or digit, for example `add-dark-mode`.

The first `next_step` creates the change with `openspec new change`. It refuses to start over a change folder that exists without a state file, so pick another name if the folder is already there. It also refuses outside a git repository.

The session you start is the lead. You choose its CLI, model and effort as usual. The plugin never launches or switches the lead, and the same model works all five steps.

## What is checked before a step advances

A step is done when its file has content, not only when it exists.

| Step | Done when |
|---|---|
| `proposal` | `openspec status` says the proposal is done, and `proposal.md` is not empty |
| `specs` | `openspec status` says specs are done, and at least one `spec.md` is not empty |
| `design` | `openspec status` says design is done, and `design.md` is not empty |
| `test-plan` | `test-plan.md` is not empty. It is not an OpenSpec artifact, so only the file is checked. |
| `approach-review` | Nothing to check |

When a check fails, `next_step` refuses and names what is missing.

`next_step` also refuses while a crosscheck is running. Collect the crosscheck or cancel it first. See [Crosschecks](crosschecks.md).

## Resume a define

Progress is saved in `.define-openspec-change.json` in the change folder. To pick up a define in a new session, on either CLI, start it again with the same name. The agent gets the current step and a list of the completed steps with their files. A define one CLI started can be resumed on the other.

If only one define is in progress, the agent can leave the name out of later calls. With two in progress it must give the name.

A finished define can't be restarted. The call is refused and gives the completion time.

## How a define finishes

When the agent completes `approach-review`, the plugin finishes the define:

1. It runs `openspec validate --type change <name>` and checks every step's file again. If either fails, nothing is committed and you get the output.
2. It marks the state file complete and commits only `openspec/changes/<name>/`, with the message `chore: add change documents for <name>`. The state file goes in the same commit. Your other staged and unstaged work is left as it was. The result lists up to ten of the paths it left out, and a count of the rest.
3. On the default branch it stops. You push when ready.
4. On any other branch it pushes the branch to `origin`, then opens a pull request against the default branch, titled `Define OpenSpec change <name>`. This needs `gh`.

It never pushes the default branch, and never pushes from a detached HEAD or when the default branch can't be found. It reports a failed push or a failed pull request once and does not retry. If the commit fails, the state file and your staged entries are put back, and you can complete the step again. A change folder with merge conflicts is refused before anything is staged.

## Skills

| Skill | Claude Code | Codex | Who starts it |
|---|---|---|---|
| `define` | `/define-openspec-change:define` | `$define` | You |
| `crosscheck` | `/define-openspec-change:crosscheck` | `$crosscheck` | You |
| `setup` | `/define-openspec-change:setup` | `$setup` | You, or the agent when a crosscheck is not configured |

The step skills (`propose`, `spec`, `design`, `test-plan`) and `ask-questions` are used by the steps. You don't start them.

On Claude Code, only you can start a define. Codex ignores that setting, so there the agent can start one when you ask it to define a change.

## Logs

The plugin logs to `$TMPDIR/define-openspec-change-<uid>/`, outside the repository. [Troubleshooting](troubleshooting.md) covers the common problems.
