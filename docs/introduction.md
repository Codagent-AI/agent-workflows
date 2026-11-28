---
title: Introduction
group: Getting Started
order: 1
description: What Agent Workflows is, the opinions behind it, and the three parts it is made of.
---

# Introduction

Agent Workflows is an opinionated toolkit for spec-driven development that just works out of the box. You write each spec with an agent. Then a software factory builds, reviews and tests the change, and hands back a pull request with the key decisions and results highlighted.

## Deterministic workflows

You and an agent write a spec by following a pre-defined workflow, one step at a time. Then the factory implements and verifies the change via a deterministic sequence of steps of its own. In neither phase does the model decide which steps to follow or which shortcuts to take. Code controls the order of the steps and checks that each step's documents exist before the next one starts.

## Opinions

- **Spec-driven development, with OpenSpec.** Every change starts as an OpenSpec change: a proposal, specs, a design, and a test plan. A spec is not a ticket. You still do the thinking. The tasks are not defined up front, the factory figures out how to break down the work.
- **Archon is the factory:** You hand off a finished spec, and Archon implements it, verifies it, and opens a pull request.
- **One spec at a time.** While the factory builds one, you are free to write the next with an agent.
- **The factory doesn't interrupt you.** Your work happens at the beginning and the end, not in the middle. You give the factory a well-defined spec, and it records the assumptions and decisions it made for you to review.
- **Humans make the judgment calls.** You review the spec, the agents' decisions and unsettled disagreements, and the results. Agents review the diff and fix CI failures before a person sees the pull request.
- **Claude Code and Codex, on the subscription you already have.** An API key works too, and you don't need both. The factory can also run Pi, or any other agent Archon supports.

## Features

Agent Workflows builds on OpenSpec and Archon. This is what each one provides, and what Agent Workflows adds.

| Feature | OpenSpec | Archon | Agent Workflows |
|---|:-:|:-:|:-:|
| Change documents: a proposal, spec deltas, and a design | ✓ | | |
| Validate a change, and archive it into the living specs | ✓ | | |
| Define a change one step at a time, in an order code enforces | | | ✓ |
| A test plan for each change | | | ✓ |
| An agent from the other vendor reviews the proposal and the approach | | | ✓ |
| YAML workflows that run their steps in a fixed order, with loops and gates | | ✓ | |
| An isolated worktree for each run | | ✓ | |
| Claude Code, Codex, and Pi, on your own subscription | | ✓ | |
| Resume a failed run | | ✓ | |
| An event log, transcript, and cost for every run, and a web UI | | ✓ | |
| Implement a spec against a checklist of how each behavior is verified | | | ✓ |
| Acceptance testing by an independent agent, in rounds | | | ✓ |
| Log the agents' decisions and unsettled disagreements, and rank them with the results in a review package | | | ✓ |
| Archive the change when the build finishes, so the living specs stay current | | | ✓ |

## The three parts

Agent Workflows is three pieces that live in one repository.

| Part | What it is | Where you use it |
|---|---|---|
| `define-openspec-change` | A Claude Code and Codex plugin. It takes you through the five steps of defining a change and has agents from other vendors review it. | In your own session. See [Defining a change](defining-a-change.md). |
| `codagent-archon` | A Claude Code and Codex plugin. It launches the implementation on Archon, follows the run, and brings you its questions. | In your own session. See [Implementing a change](implementing-a-change.md). |
| The Codagent pack | The workflows Archon runs: `codagent-implement-change` and the two definition workflows it includes. | In Archon. You rarely touch it directly. See [Workflow reference](workflow-reference.md). |

The repository root is a plugin marketplace for both CLIs, so you install the two plugins from it. Archon reads the pack from a clone of the repository.

## How they fit

1. **You define the change.** In Claude Code or Codex, you run the define skill. It walks you through the proposal, specs, design, test plan and an approach review. It commits the change's documents.
2. **Archon implements it.** You ask for the change to be implemented. The pack builds it on its own branch in an isolated worktree, checks it, tests it as a user would, archives the change, and opens a pull request. It never merges on its own.
3. **You review and decide.** The run publishes a review page and waits. The page lists what needs your call, ranked. You answer its questions and send feedback, which runs another round, or you merge.

While step 2 runs, you can define the next change.

## Where to go next

- [Quickstart](quickstart.md): install both plugins and take one small change through all three steps.
- [Setup](setup.md): what each part needs.
- [Glossary](glossary.md): the terms used across these docs.
