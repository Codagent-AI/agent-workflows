---
name: define
disable-model-invocation: true
description: Defines an OpenSpec change step by step (proposal, specifications, design, test plan, approach review) with a cross-vendor review, then validates and commits the change documents. Use when the user asks to define an OpenSpec change with define-openspec-change, invokes $define or define-openspec-change:define, or wants to continue a define that is in progress.
---

# Define an OpenSpec change

The define-openspec-change `next_step` tool runs this workflow. The tool decides the order of the
steps and returns each step's instructions; do not run the steps from memory.

1. Find the change name. Never ask the user for a name, and never ask them to confirm one.
   - If the request names the change, for example `add-dark-mode`, use that name.
   - If the user wants to continue a define that is in progress, use that change's name. Each one has
     a `.define-openspec-change.json` file in its folder under `openspec/changes/`.
   - Otherwise name the change yourself from what the user said it is about. Use a short name that
     starts with a verb, in lowercase letters, digits, and hyphens, such as `add-dark-mode` or
     `fix-login-timeout`. No change under `openspec/changes/`, archived ones included, may already
     use it. Say the name in passing and go on.
   - Only if the user has not said what the change is about, ask what it is about, then name it from
     the answer.
2. Call `next_step` with `change_name` set to that name and `start` set to `true`. This creates the
   change, or picks up one that is already in progress, and returns the current step's instructions.
   If it refuses because the name is taken, choose another name the same way and call it again. If it
   refuses because the crosscheck agent is not configured, use the define-openspec-change:setup
   skill with the user, then call it again.
3. Carry out each result as if the user had typed it, in this conversation. When a step is complete,
   call `next_step` again with the same `change_name` and without `start`. If it refuses, do what the
   refusal says, then call it again.
4. Stop when `next_step` reports that the change is defined, and tell the user what it reported.

If `next_step` is not available, tell the user that the define-openspec-change tools are not loaded,
and stop.
