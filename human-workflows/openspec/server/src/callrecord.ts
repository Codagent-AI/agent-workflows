import { existsSync } from "node:fs";

import type { Call } from "./call.js";
import type { Context } from "./context.js";
import { readState, writeState } from "./state.js";

/** Adds a finished call to its change's state file. A failure here never changes what the lead gets. */
export function recordCall(context: Context, call: Call): void {
  try {
    const state = readState(context.workflow, call.root, call.changeName);
    if (!(state && existsSync(call.root))) {
      return;
    }
    state.calls.push({
      call_id: call.id,
      step: call.step,
      cli: call.cli,
      ...(call.model === undefined ? {} : { model: call.model }),
      effort: call.effort,
      status: call.status,
      ...(call.workingTree === undefined ? {} : { working_tree: call.workingTree }),
      started_at: call.startedAt.toISOString(),
      ended_at: (call.endedAt ?? context.now()).toISOString(),
    });
    writeState(call.root, state, context.now().toISOString());
  } catch {
    // The call result still reaches the lead.
  }
}
