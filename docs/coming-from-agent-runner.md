---
title: Coming from Agent Runner
group: Development
order: 2
description: Where Agent Runner's pieces went, what define and the change workflow do now, and what was left out or changed on purpose.
---

# Coming from Agent Runner

This page is for people who used Agent Runner's `openspec:change` workflow and the Codagent skills. It does not sync to the docs site. Agent Runner, Agent Skills and Agent Factory are deprecated. Agent Runner and Agent Skills are intact, so nothing that uses them breaks. Agent Workflows is where the work goes on.

## Where the old pieces went

| Old piece | Now |
|---|---|
| Agent Runner's define workflow | The `define-openspec-change` plugin, in `human-workflows/openspec/` |
| Agent Runner's implement, verify, accept, archive and finalize workflows | The Codagent pack for Archon, in `factory-workflows/archon/`. The pack folds verification into one workflow. Your review moved to a page after the run. |
| Agent Skills (`codagent:*`) | Copied into the plugin, which is now their source of truth. Changes are logged in its `PROVENANCE.md`. |
| Agent Runner's engine: sessions, profiles, handoff code | Archon provides the engine |
| Agent Validator | Stays standalone. The pack has its own code review and relies on the repository's CI. |
| OpenSpec | Stays, on 1.17.0 |
| `plan-tasks` and `review-tasks` | Not ported. The change workflow no longer uses them. The implementor plans a checklist of how each behavior is verified instead. |
| Agent Factory | Retired. Archon plus the pack is the factory now. |

## Define

| What | Before | Now |
|---|---|---|
| Starting it | `agent-runner run openspec:change change_name=...`, or the terminal UI. Define was one step of the full change run. | Start Claude Code or Codex as usual, then run `/define-openspec-change:define <name>` or `$define <name>`. |
| Step order | A `steps:` list in YAML, in a hidden sub-workflow | The same five steps, in `plugin/workflow.yaml`, loaded by the plugin's server. `next_step` hands out one step at a time. |
| Step prompts | An inline prompt for each step, with parameters filled in | A prompt for each step in the same `workflow.yaml`, with OpenSpec's values written in. Only the change name and the review instructions (the text of files in the plugin's `reviews/` folder) are filled in. |
| Next step | The agent ran `agent-runner step complete`. Runner ended the CLI and resumed the session with the next prompt. | The agent calls `next_step`, and the reply is the next prompt, in the same conversation. Nothing restarts. |
| Checks between steps | None. Define ran without the OpenSpec engine. | `next_step` won't advance until the step's file exists and isn't empty. |
| Before step 1 | A branch check that refused `main`, then a script that checked the name and created the change | No branch check. The first `next_step` checks the name, refuses a change folder it didn't start, and creates the change. |
| After the last step | The same run went on to implement, accept, archive and finalize | Define ends. It validates, then commits only the change folder. On a branch it pushes and opens a pull request. |
| Lead agent | The lead profile in `~/.agent-runner/config.yaml` | Whatever session you start. You pick the CLI, model and effort. The plugin never launches or switches the lead. |
| Crosscheck agent | The crosscheck profile in the same file, one agent | A `human-workflows.crosscheck` list in `~/.agent-workflows/config.yaml`, one entry for each reviewer, run through acpx |
| Calling it | The `call_agent` tool. It could reach any profile, a named session, or a follow-up. The child was told not to write. | `crosscheck`, `get_crosscheck` and `cancel_crosscheck`. Every chosen reviewer runs at once. A crosscheck works at any time, not only in the review steps. |
| Skills | `codagent:*` from Agent Skills | `define-openspec-change:*` |
| Progress and resume | A run record kept by Runner, resumed with `agent-runner --resume <run-id>` | A state file in the change folder, committed with the change. To resume, run the skill again in any session. |
| Watching it | Runner's terminal UI and run logs | The conversation itself, since each step announces itself. There's no UI. |

What was lost: Runner could put different steps on different profiles. The plugin can't. Define never used it.

### Parameters became text

Runner's define served both OpenSpec and spec-driven changes, so the change directory, label and location text were parameters. The plugin is OpenSpec only, so they are fixed text. Another spec system would get its own folder under `human-workflows/`.

## The change workflow, step by step

Runner's change workflow ran define, then implement, verify, accept, archive and finalize. The pack starts where define ends, from a definition you approved, and ends at a review page with a pull request.

| Runner step | In the pack | What differs |
|---|---|---|
| Check definition (script) | Same | The implementor repairs problems, not the lead. |
| Commit definition (script) | Same | The implementor repairs, not the lead. |
| Checklist (`@implementor`) | Same | |
| Implement (`@implementor`) | Same | |
| Completion loop, added to Runner after the port | Completion loop | In the pack it replaces the evidence check and its two repairs. |
| Audit (`@crosscheck`) | Audit (`@reviewer`) | Same prompt and place, on `@reviewer`, so the pack has no `@crosscheck` role to bind. |
| Resolve findings (`@implementor`) | Same | A finding the implementor holds isn't a violation goes unfixed to the dispute log. |
| Check lead decisions (script) | Dropped | With no `call_agent`, agents decide their own questions and record each decision in the decision log. |
| Session report (`@implementor`) | Same | |
| Review assumptions (`@lead`) | Removed | It ran only when verification was launched on its own. |
| Agent Validator, `@implementor` fixes | Built-in code review | A review of code quality, security and error handling replaces Validator. The implementor can decline a finding or answer a contest, up to three rounds. Leftover findings go to the decision or dispute log, and the pull request opens. |
| Open draft PR (`@lead`) | Open draft PR (`@implementor`) | The implementor writes it in a fresh session, and a script opens the draft. |
| Acceptance rounds | Acceptance rounds | The implementor fixes, not the lead, and the review checks each fix. A fix that stops on a decision only you can make ends the rounds as not converged, and the run goes on. So does a push that still fails after its repair, but the push after the rounds then retries, and the run fails if that fails too. |
| Resolve assumptions (`@lead`, with you) | Not ported | The run doesn't stop to ask you. Each unresolved assumption goes into the decision log, and each review finding left unfixed into the dispute log. The page ranks them. |
| Review and refine (`@lead`, with you) | Review rounds | You review after the run, from the page. Send feedback runs a round inside the run: merge the base branch, address each answer, review, push, retest, finalize, publish again. |
| Offer re-acceptance, re-acceptance (`@lead`, with you) | Retest | A Late commit concern lists the journeys the new commits could affect and offers Retest. A failed retest is a High concern, and the round doesn't fix it. |
| Agent Validator, `@lead` fixes | Not ported | It checked the changes made with you in accept. The run makes none. |
| Archive (script, `@lead` repairs) | Archive (script, `@implementor` repairs) | It runs whether or not acceptance converged. When it still fails after its repairs, the run keeps what it left and goes on. The Validator baseline step is gone. |
| Mark PR ready (`@lead`) | Mark ready (script) | The pack, not an agent, owns the pull request's draft state. |
| CI and review fixes (`@lead`) | CI and review fixes (`@implementor`) | Runs even after a failed archive. A failed final check becomes a High concern. A comment the fixer doesn't fix goes to the dispute log. Comments count whoever wrote them, except the run's own marked replies. |
| (none) | Recheck unverified rows | New. Reruns, once, the checks of rows still not verified. |
| (none) | Decision and dispute logs, committed | New. Runner's lead took assumptions to you in accept. |
| (none) | Review package and page | New. A fresh reviewer ranks what needs you, and a script writes the page. |
| (none) | Wait for you, Merge | New. The run merges only when you choose Merge. Runner never merged. |

The pack runs archive and finalize in its implement workflow, so their repairs can continue the implementor's session.

## Roles and settings that went away

| Removed | Why |
|---|---|
| `@lead` | The pack's steps with a lead moved to `@implementor`, and the steps with you were dropped or moved to the review page. |
| `@crosscheck` | The audit moved to `@reviewer`. |
| `skip_validator` input | Agent Validator steps are left out of the port. |
| `skip_implementation_review`, `stop_unchanged_acceptance` | Dropped with the assumption review and the lead-driven acceptance. |
| `change_kind`, `changes_root`, `change_label`, `artifact_validation_instruction` | They served Runner's spec-driven kind. The pack supports only OpenSpec changes. It derives the change folder, `openspec/changes/<name>`, from the change name. |

Settings the pack adds: `review_strategy`, `acceptance_rounds`, `acceptance_fix_scope`, `stop_after`, `review_wait` and `archon_url`. See [Roles and settings](roles-and-settings.md).

## Left out

- Agent Validator steps, and `audit.log`.
- A file for each response.
- `ask_lead`, which is undecided.

Archon keeps the audit's findings under `nodes/audit.md`.
