import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { changeDirFor, firstStepId, isStepId, type StepId, stepIds, type Workflow } from "./steps.js";

export const STATE_FILE = ".define-openspec-change.json";

export interface StepTimes {
  started_at: string;
  completed_at?: string;
}

export interface StartRecord {
  at: string;
  lead: string;
  mode: "new" | "resume";
  step: StepId;
}

export interface CallRecord {
  call_id: string;
  step: StepId;
  cli: string;
  model?: string;
  effort: string;
  status: string;
  working_tree?: string;
  started_at: string;
  ended_at: string;
}

export interface DefineState {
  schema: 1;
  workflow: "define-openspec-change";
  change_name: string;
  change_dir: string;
  status: "in_progress" | "complete";
  current_step: StepId | null;
  steps: Partial<Record<StepId, StepTimes>>;
  starts: StartRecord[];
  calls: CallRecord[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class StateError extends Error {}

export function statePath(root: string, changeName: string): string {
  return join(root, changeDirFor(changeName), STATE_FILE);
}

export function newState(workflow: Workflow, changeName: string, at: string, lead: string): DefineState {
  const first = firstStepId(workflow);
  return {
    schema: 1,
    workflow: "define-openspec-change",
    change_name: changeName,
    change_dir: changeDirFor(changeName),
    status: "in_progress",
    current_step: first,
    steps: { [first]: { started_at: at } },
    starts: [{ at, lead, mode: "new", step: first }],
    calls: [],
    created_at: at,
    updated_at: at,
    completed_at: null,
  };
}

/** Reads a change's state file, or returns undefined when it has none. Its step ids must be in the workflow. */
export function readState(workflow: Workflow, root: string, changeName: string): DefineState | undefined {
  const path = statePath(root, changeName);
  if (!existsSync(path)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new StateError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const state = parsed as Partial<DefineState>;
  const validStep = state.current_step === null || isStepId(workflow, state.current_step);
  const knownSteps = Object.keys(state.steps ?? {}).every((id) => isStepId(workflow, id));
  if (
    state.schema !== 1 ||
    state.change_name !== changeName ||
    (state.status !== "in_progress" && state.status !== "complete") ||
    !validStep ||
    !knownSteps ||
    (state.status === "in_progress" && state.current_step === null)
  ) {
    throw new StateError(`${path} is not a define-openspec-change state file this version understands.`);
  }
  state.steps ??= {};
  state.starts ??= [];
  state.calls ??= [];
  return state as DefineState;
}

export function readStateText(root: string, changeName: string): string | undefined {
  const path = statePath(root, changeName);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function writeStateText(root: string, changeName: string, text: string): void {
  const path = statePath(root, changeName);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

export function writeState(root: string, state: DefineState, at: string): void {
  state.updated_at = at;
  writeStateText(root, state.change_name, `${JSON.stringify(state, null, 2)}\n`);
}

/** Names of changes under openspec/changes/ whose define is in progress. */
export function inProgressChanges(workflow: Workflow, root: string): string[] {
  const changes = join(root, "openspec", "changes");
  if (!existsSync(changes)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of readdirSync(changes, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "archive") {
      continue;
    }
    try {
      const state = readState(workflow, root, entry.name);
      if (state?.status === "in_progress") {
        names.push(entry.name);
      }
    } catch {
      // A broken state file is reported when that change is named directly.
    }
  }
  return names.sort();
}

export function completedSteps(workflow: Workflow, state: DefineState): StepId[] {
  return stepIds(workflow).filter((step) => state.steps[step]?.completed_at !== undefined);
}
