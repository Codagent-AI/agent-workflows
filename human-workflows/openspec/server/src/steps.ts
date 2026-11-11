import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WORKFLOW_NAME = "define-openspec-change";
export const WORKFLOW_DESCRIPTION =
  "Interactively define a structured change through proposal, specification, design, and testing strategy.";

export const STEP_IDS = ["proposal", "specs", "design", "test-plan", "approach-review"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Steps that may use call_agent, as Runner declared `tools: [call_agent]` only on these. */
export const CALL_STEPS: readonly StepId[] = ["proposal", "approach-review"];

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

export function stepNumber(step: StepId): number {
  return STEP_IDS.indexOf(step) + 1;
}

export function nextStepId(step: StepId): StepId | undefined {
  return STEP_IDS[STEP_IDS.indexOf(step) + 1];
}

export function changeDirFor(changeName: string): string {
  return `openspec/changes/${changeName}`;
}

export type StepMode = "new" | "continue" | "resume";

export interface RenderInput {
  pluginRoot: string;
  changeName: string;
  step: StepId;
  mode: StepMode;
  completed: StepId[];
}

/** Fills a step prompt file's placeholders. Throws if one is left over. */
export function stepBody(pluginRoot: string, step: StepId, changeName: string): string {
  const template = readFileSync(join(pluginRoot, "steps", `${step}.md`), "utf8");
  const filled = template
    .replaceAll("{{change_name}}", changeName)
    .replaceAll("{{skills_dir}}", join(pluginRoot, "skills"));
  const leftover = filled.match(/\{\{[^}]*\}\}/);
  if (leftover) {
    throw new Error(`step prompt ${step}.md has an unknown placeholder ${leftover[0]}`);
  }
  return filled.trim();
}

/**
 * The full text next_step returns for a step: Runner's step prefix, the step prompt, and the
 * completion instruction that replaces `agent-runner step complete`.
 */
export function renderStep(input: RenderInput): string {
  const { changeName, step, mode } = input;
  const position = `(step ${stepNumber(step)} of ${STEP_IDS.length})`;
  const changeDir = changeDirFor(changeName);
  const parts: string[] = [];

  switch (mode) {
    case "new":
      parts.push(`Created OpenSpec change "${changeName}" at \`${changeDir}/\`.`);
      parts.push(`You are running in the "${WORKFLOW_NAME}" workflow: ${WORKFLOW_DESCRIPTION}`);
      parts.push(`The current step is "${step}" ${position}.`);
      break;
    case "continue":
      parts.push(`Continuing to step "${step}" ${position}.`);
      break;
    case "resume":
      parts.push(`You are running in the "${WORKFLOW_NAME}" workflow: ${WORKFLOW_DESCRIPTION}`);
      parts.push(`Resuming step: "${step}" ${position}. If you already started on this step, resume from where you left off.`);
      if (input.completed.length > 0) {
        parts.push(
          `Completed steps: ${input.completed.join(", ")}. Their artifacts are under \`${changeDir}/\`.`,
        );
      }
      break;
  }

  parts.push("Before doing anything else, announce that you are starting this step.");
  parts.push(stepBody(input.pluginRoot, step, changeName));

  let completion =
    `When you or the user determine this step is complete, call the \`next_step\` tool with change_name "${changeName}". ` +
    "Make that call the final action of the step, and carry out the instructions it returns in this conversation. " +
    "Do not merely say that the step is complete.";
  if (!nextStepId(step)) {
    completion += " This is the last step: that call validates the change and commits its documents.";
  }
  parts.push(completion);
  return parts.join("\n\n");
}
