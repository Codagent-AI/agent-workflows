import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CallManager } from "./agentcall.js";
import { isValidChangeName, missingForSteps, nameRuleMessage } from "./checks.js";
import { detectLead } from "./child.js";
import { resolveCrosscheck } from "./config.js";
import { type Context, logEvent, repoRoot } from "./context.js";
import { finishDefine, type ToolText } from "./finish.js";
import { output, run } from "./proc.js";
import {
  completedSteps,
  type DefineState,
  inProgressChanges,
  newState,
  readState,
  StateError,
  writeState,
} from "./state.js";
import { changeDirFor, firstStepId, nextStepId, renderStep, type StepId, type Workflow } from "./steps.js";

export interface NextStepArgs {
  change_name?: string | undefined;
  start?: boolean | undefined;
}

function refuse(text: string): ToolText {
  return { text: `Refused: ${text}`, isError: true };
}

/** next_step: start or resume a define, or complete the current step and return the next one. */
export async function nextStep(context: Context, calls: CallManager, args: NextStepArgs): Promise<ToolText> {
  let root: string;
  try {
    root = await repoRoot(context);
  } catch (error) {
    return refuse((error as Error).message);
  }
  const result = await nextStepIn(context, calls, root, args);
  logEvent(context, root, "next_step", {
    change_name: args.change_name,
    start: args.start === true,
    refused: result.isError === true,
    head: result.text.split("\n")[0],
  });
  return result;
}

/** The change to act on: the named one, or the only define in progress. A refusal when neither works. */
function resolveName(workflow: Workflow, root: string, args: NextStepArgs): string | ToolText {
  const name = args.change_name?.trim() ?? "";
  if (name !== "") {
    return isValidChangeName(name) ? name : refuse(nameRuleMessage(name));
  }
  if (args.start) {
    return refuse("start needs a change_name. Ask the user for one.");
  }
  const active = inProgressChanges(workflow, root);
  const only = active[0];
  if (active.length === 1 && only !== undefined) {
    return isValidChangeName(only) ? only : refuse(nameRuleMessage(only));
  }
  if (active.length === 0) {
    return refuse("no define is in progress in this repository. Start one with change_name and start: true.");
  }
  return refuse(`more than one define is in progress (${active.join(", ")}). Pass change_name.`);
}

/** The change's saved state, or a refusal when its state file cannot be read. */
function loadState(workflow: Workflow, root: string, name: string): { state: DefineState | undefined } | { refusal: ToolText } {
  try {
    return { state: readState(workflow, root, name) };
  } catch (error) {
    if (error instanceof StateError) {
      return { refusal: refuse(error.message) };
    }
    throw error;
  }
}

/** Why next_step cannot run now, if it cannot: a crosscheck is starting or running, or another next_step is. */
function busyRefusal(calls: CallManager): ToolText | undefined {
  if (calls.isStarting()) {
    return refuse(
      "a crosscheck call is still starting. Wait for call_agent to return, then collect the call with get_agent_call or stop it with cancel_agent_call before calling next_step.",
    );
  }
  const busy = calls.running();
  if (busy) {
    return refuse(
      `crosscheck call ${busy.id} is still running. Collect it with get_agent_call, or stop it with cancel_agent_call, before calling next_step.`,
    );
  }
  return calls.stepGate.held ? refuse("another next_step call is still running. Wait for it to return.") : undefined;
}

/** Runs one next_step with the step gate held, so no crosscheck starts until it returns. */
function nextStepIn(context: Context, calls: CallManager, root: string, args: NextStepArgs): Promise<ToolText> {
  const busy = busyRefusal(calls);
  if (busy) {
    return Promise.resolve(busy);
  }
  return calls.stepGate.hold(() => stepIn(context, root, args));
}

async function stepIn(context: Context, root: string, args: NextStepArgs): Promise<ToolText> {
  const name = resolveName(context.workflow, root, args);
  if (typeof name !== "string") {
    return name;
  }
  const loaded = loadState(context.workflow, root, name);
  if ("refusal" in loaded) {
    return loaded.refusal;
  }
  return args.start ? startDefine(context, root, name, loaded.state) : completeStep(context, root, name, loaded.state);
}

/** next_step with start: true. Checks the crosscheck config, then begins a new define or resumes one. */
async function startDefine(context: Context, root: string, name: string, state: DefineState | undefined): Promise<ToolText> {
  const leadCli = detectLead(context.clientName(), context.env);
  // Check the crosscheck config before any step, so a missing one is set up before the proposal's review.
  const crosscheck = resolveCrosscheck(leadCli, context.env);
  if (typeof crosscheck === "string") {
    return refuse(crosscheck);
  }
  const lead = leadCli ?? "unknown";
  if (!state) {
    return createDefine(context, root, name, lead);
  }
  if (state.status === "complete" || state.current_step === null) {
    return refuse(`OpenSpec change "${name}" was already defined (completed ${state.completed_at}). There is nothing left to do.`);
  }
  return resumeDefine(context, root, state, lead);
}

async function createDefine(context: Context, root: string, name: string, lead: string): Promise<ToolText> {
  const absoluteDir = join(root, changeDirFor(name));
  if (existsSync(absoluteDir)) {
    return refuse(
      `OpenSpec change "${name}" already exists at ${absoluteDir}, and define-openspec-change did not start it. Choose another name.`,
    );
  }
  const created = await run("openspec", ["new", "change", name], { cwd: root, env: context.env });
  if (created.code !== 0 || !existsSync(absoluteDir)) {
    return refuse(`openspec new change ${name} failed: ${output(created)}`);
  }
  const at = context.now().toISOString();
  writeState(root, newState(context.workflow, name, at, lead), at);
  const step = firstStepId(context.workflow);
  return {
    text: renderStep({ workflow: context.workflow, pluginRoot: context.pluginRoot, changeName: name, step, mode: "new", completed: [] }),
  };
}

/** Records a resume and returns the step the define stopped at. The caller has checked it is not complete. */
function resumeDefine(context: Context, root: string, state: DefineState, lead: string): ToolText {
  const step = state.current_step;
  if (step === null) {
    return refuse(`OpenSpec change "${state.change_name}" has no current step.`);
  }
  const at = context.now().toISOString();
  state.starts.push({ at, lead, mode: "resume", step });
  writeState(root, state, at);
  return {
    text: renderStep({
      workflow: context.workflow,
      pluginRoot: context.pluginRoot,
      changeName: state.change_name,
      step,
      mode: "resume",
      completed: completedSteps(context.workflow, state),
    }),
  };
}

/** The refusal for next_step without start when the change has no saved state. */
function refuseNoState(root: string, name: string): ToolText {
  if (existsSync(join(root, changeDirFor(name)))) {
    return refuse(`OpenSpec change "${name}" was not started with define-openspec-change, so there is no step to complete.`);
  }
  return refuse(`no define is in progress for "${name}". Start it with change_name "${name}" and start: true.`);
}

/** next_step without start: checks the current step's artifact, then returns the next step or finishes. */
async function completeStep(context: Context, root: string, name: string, state: DefineState | undefined): Promise<ToolText> {
  if (!state) {
    return refuseNoState(root, name);
  }
  const step = state.current_step;
  if (state.status === "complete" || step === null) {
    return {
      text: `OpenSpec change "${name}" is already defined (completed ${state.completed_at}). The define workflow is finished; do not call next_step again.`,
    };
  }
  const missing = await missingForSteps(root, name, [step], context.env);
  if (missing.length > 0) {
    return refuse(
      `step "${step}" of OpenSpec change "${name}" is not complete. Missing: ${missing.join("; ")}. Finish the step, then call next_step again.`,
    );
  }
  const following = nextStepId(context.workflow, step);
  return following ? advance(context, root, state, { from: step, to: following }) : finishDefine(context, root, state);
}

function advance(context: Context, root: string, state: DefineState, move: { from: StepId; to: StepId }): ToolText {
  const at = context.now().toISOString();
  state.steps[move.from] = { started_at: state.steps[move.from]?.started_at ?? at, completed_at: at };
  state.steps[move.to] = { started_at: at };
  state.current_step = move.to;
  writeState(root, state, at);
  return {
    text: renderStep({
      workflow: context.workflow,
      pluginRoot: context.pluginRoot,
      changeName: state.change_name,
      step: move.to,
      mode: "continue",
      completed: completedSteps(context.workflow, state),
    }),
  };
}
