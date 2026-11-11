import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CallManager } from "./agentcall.js";
import { isValidChangeName, missingForStep, nameRuleMessage } from "./checks.js";
import { detectLead } from "./child.js";
import { resolveCrosscheck } from "./config.js";
import { type Context, logEvent, repoRoot } from "./context.js";
import { finishDefine, type ToolText } from "./finish.js";
import { output, run } from "./proc.js";
import {
  completedSteps,
  inProgressChanges,
  newState,
  readState,
  StateError,
  writeState,
} from "./state.js";
import { changeDirFor, nextStepId, renderStep } from "./steps.js";

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

async function nextStepIn(context: Context, calls: CallManager, root: string, args: NextStepArgs): Promise<ToolText> {
  const busy = calls.running();
  if (busy) {
    return refuse(
      `crosscheck call ${busy.id} is still running. Collect it with get_agent_call, or stop it with cancel_agent_call, before calling next_step.`,
    );
  }

  let name = args.change_name?.trim() ?? "";
  if (name === "") {
    if (args.start) {
      return refuse("start needs a change_name. Ask the user for one.");
    }
    const active = inProgressChanges(root);
    if (active.length === 1 && active[0] !== undefined) {
      name = active[0];
    } else if (active.length === 0) {
      return refuse('no define is in progress in this repository. Start one with change_name and start: true.');
    } else {
      return refuse(`more than one define is in progress (${active.join(", ")}). Pass change_name.`);
    }
  }
  if (!isValidChangeName(name)) {
    return refuse(nameRuleMessage(name));
  }

  const changeDir = changeDirFor(name);
  const absoluteDir = join(root, changeDir);
  let state;
  try {
    state = readState(root, name);
  } catch (error) {
    if (error instanceof StateError) {
      return refuse(error.message);
    }
    throw error;
  }
  const at = context.now().toISOString();
  const leadCli = detectLead(context.clientName(), context.env);
  const lead = leadCli ?? "unknown";

  if (args.start) {
    // Check the crosscheck config before any step, so a missing one is set up before the proposal's review.
    const crosscheck = resolveCrosscheck(leadCli, context.env);
    if (typeof crosscheck === "string") {
      return refuse(crosscheck);
    }
    if (!state) {
      if (existsSync(absoluteDir)) {
        return refuse(
          `OpenSpec change "${name}" already exists at ${absoluteDir}, and define-openspec-change did not start it. Choose another name.`,
        );
      }
      const created = await run("openspec", ["new", "change", name], { cwd: root, env: context.env });
      if (created.code !== 0 || !existsSync(absoluteDir)) {
        return refuse(`openspec new change ${name} failed: ${output(created)}`);
      }
      state = newState(name, at, lead);
      writeState(root, state, at);
      return { text: renderStep({ pluginRoot: context.pluginRoot, changeName: name, step: "proposal", mode: "new", completed: [] }) };
    }
    if (state.status === "complete" || state.current_step === null) {
      return refuse(`OpenSpec change "${name}" was already defined (completed ${state.completed_at}). There is nothing left to do.`);
    }
    const step = state.current_step;
    state.starts.push({ at, lead, mode: "resume", step });
    writeState(root, state, at);
    return {
      text: renderStep({ pluginRoot: context.pluginRoot, changeName: name, step, mode: "resume", completed: completedSteps(state) }),
    };
  }

  if (!state) {
    if (existsSync(absoluteDir)) {
      return refuse(`OpenSpec change "${name}" was not started with define-openspec-change, so there is no step to complete.`);
    }
    return refuse(`no define is in progress for "${name}". Start it with change_name "${name}" and start: true.`);
  }
  if (state.status === "complete" || state.current_step === null) {
    return {
      text: `OpenSpec change "${name}" is already defined (completed ${state.completed_at}). The define workflow is finished; do not call next_step again.`,
    };
  }

  const step = state.current_step;
  const missing = await missingForStep(root, name, step, context.env);
  if (missing.length > 0) {
    return refuse(
      `step "${step}" of OpenSpec change "${name}" is not complete. Missing: ${missing.join("; ")}. Finish the step, then call next_step again.`,
    );
  }

  const following = nextStepId(step);
  if (!following) {
    return finishDefine(context, root, state);
  }
  state.steps[step] = { started_at: state.steps[step]?.started_at ?? at, completed_at: at };
  state.steps[following] = { started_at: at };
  state.current_step = following;
  writeState(root, state, at);
  return {
    text: renderStep({ pluginRoot: context.pluginRoot, changeName: name, step: following, mode: "continue", completed: completedSteps(state) }),
  };
}
