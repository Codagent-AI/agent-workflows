---
description: Define an OpenSpec change step by step, from proposal to approach review
argument-hint: "[change-name]"
---

# Define an OpenSpec change

The define-openspec-change `next_step` tool runs this workflow. The tool decides the order of the
steps and returns each step's instructions; do not run the steps from memory.

The change name the user gave: `$ARGUMENTS`

1. Use that change name. If it is empty, ask for a short name that uses lowercase letters, digits,
   and hyphens. Do not invent one.
2. Call `next_step` with `change_name` set to that name and `start` set to `true`. This creates the
   change, or picks up one that is already in progress, and returns the current step's instructions.
3. Carry out each result as if the user had typed it, in this conversation. When a step is complete,
   call `next_step` again with the same `change_name` and without `start`. If it refuses, do what the
   refusal says, then call it again.
4. Stop when `next_step` reports that the change is defined, and tell the user what it reported.

If `next_step` is not available, tell the user that the define-openspec-change tools are not loaded,
and stop.
