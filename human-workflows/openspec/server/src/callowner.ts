import { errorText } from "./call.js";
import type { ToolText } from "./finish.js";
import { inProgressChanges, readState } from "./state.js";
import { allowsCallAgent, callAgentStepsText, type StepId, type Workflow } from "./steps.js";

/** The define a call runs for: the change in progress and the step it is at. */
export interface CallOwner {
  changeName: string;
  step: StepId;
}

/** Every in-progress define that is at a step where call_agent is available. */
function eligibleOwners(workflow: Workflow, root: string): CallOwner[] {
  const owners: CallOwner[] = [];
  for (const name of inProgressChanges(workflow, root)) {
    const step = readState(workflow, root, name)?.current_step;
    if (step && allowsCallAgent(workflow, step)) {
      owners.push({ changeName: name, step });
    }
  }
  return owners;
}

/**
 * The define a call belongs to: the named change, or the only eligible one. Refuses when the call
 * could belong to more than one define, so a crosscheck is never recorded against the wrong change.
 */
export function chooseCallOwner(workflow: Workflow, root: string, changeName: string | undefined): CallOwner | ToolText {
  const owners = eligibleOwners(workflow, root);
  const wanted = changeName?.trim() ?? "";
  const named = wanted === "" ? undefined : owners.find((candidate) => candidate.changeName === wanted);
  const only = owners.length === 1 ? owners[0] : undefined;
  const owner = wanted === "" ? only : named;
  if (owner) {
    return owner;
  }
  if (wanted === "" && owners.length > 1) {
    const names = owners.map((candidate) => candidate.changeName).join(", ");
    return errorText("ambiguous_change", `More than one define can use call_agent (${names}). Pass change_name.`);
  }
  return errorText(
    "call_agent_unavailable",
    `call_agent is only available during ${callAgentStepsText(workflow)} of a define that is in progress` +
      (wanted === "" ? "." : `, and "${wanted}" is not at one of them.`),
  );
}
