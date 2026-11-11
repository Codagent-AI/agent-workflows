import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { check } from "./schema.js";

export type StepId = string;

export interface WorkflowStep {
  id: StepId;
  prompt: string;
  /** True when the step lists `call_agent` under `tools`. */
  callAgent: boolean;
}

export interface Workflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export class WorkflowError extends Error {}

/** The placeholders a step prompt may use. Anything else in double braces is refused. */
const PLACEHOLDERS = ["{{change_name}}", "{{reviews_dir}}"];

const required = (what: string) => z.string({ error: `needs ${what}` }).refine((value) => value.trim() !== "", { error: `needs ${what}` });

const promptSchema = required("a prompt").superRefine((prompt, context) => {
  const unknown = (prompt.match(/\{\{[^}]*\}\}/g) ?? []).find((placeholder) => !PLACEHOLDERS.includes(placeholder));
  if (unknown !== undefined) {
    context.addIssue({ code: "custom", message: `has an unknown placeholder ${unknown}` });
  }
});

const stepSchema = z
  .object(
    {
      id: required("an id"),
      prompt: promptSchema,
      tools: z.array(z.literal("call_agent", { error: "is not a supported tool. Only [call_agent] is supported" })).optional(),
    },
    { error: "must be a mapping with an id and a prompt" },
  )
  .transform((step): WorkflowStep => ({ id: step.id, prompt: step.prompt, callAgent: (step.tools ?? []).length > 0 }));

const workflowSchema = z
  .object(
    {
      name: required("a name"),
      description: required("a description"),
      steps: z.array(stepSchema, { error: "needs at least one step" }).min(1, "needs at least one step"),
    },
    { error: "must be a mapping with name, description, and steps" },
  )
  .superRefine((workflow, context) => {
    const seen = new Set<string>();
    for (const [index, step] of workflow.steps.entries()) {
      if (seen.has(step.id)) {
        context.addIssue({ code: "custom", message: `step id "${step.id}" is used twice`, path: ["steps", index, "id"] });
      }
      seen.add(step.id);
    }
  })
  .transform((workflow): Workflow => ({ name: workflow.name.trim(), description: workflow.description.trim(), steps: workflow.steps }));

/** Checks the shape of a workflow.yaml text and returns it. Throws WorkflowError when it is malformed. */
export function parseWorkflow(source: string): Workflow {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new WorkflowError(`is not valid YAML: ${(error as Error).message}`);
  }
  const checked = check(workflowSchema, raw);
  if ("problem" in checked) {
    throw new WorkflowError(`is not a valid workflow: ${checked.problem}`);
  }
  return checked.value;
}

/** Reads `workflow.yaml` from the plugin folder. The message says what is wrong with it. */
export function loadWorkflow(pluginRoot: string): Workflow {
  const path = join(pluginRoot, "workflow.yaml");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new WorkflowError(`Cannot read ${path}: ${(error as Error).message}`);
  }
  try {
    return parseWorkflow(text);
  } catch (error) {
    if (error instanceof WorkflowError) {
      throw new WorkflowError(`${path} ${error.message}`);
    }
    throw error;
  }
}

export function stepIds(workflow: Workflow): StepId[] {
  return workflow.steps.map((step) => step.id);
}

export function firstStepId(workflow: Workflow): StepId {
  return workflow.steps[0]?.id ?? "";
}

export function lastStepId(workflow: Workflow): StepId {
  return workflow.steps[workflow.steps.length - 1]?.id ?? "";
}

/** The steps where call_agent may be used, in order. */
export function callAgentSteps(workflow: Workflow): StepId[] {
  return workflow.steps.filter((step) => step.callAgent).map((step) => step.id);
}

/** "the proposal and approach-review steps", for a message that says where call_agent works. */
export function callAgentStepsText(workflow: Workflow): string {
  const ids = callAgentSteps(workflow);
  const last = ids.pop();
  if (last === undefined) {
    return "no steps";
  }
  return ids.length === 0 ? `the ${last} step` : `the ${ids.join(", ")} and ${last} steps`;
}

/** True when call_agent may be used at this step. */
export function allowsCallAgent(workflow: Workflow, step: StepId): boolean {
  return workflow.steps.some((candidate) => candidate.id === step && candidate.callAgent);
}

export function stepNumber(workflow: Workflow, step: StepId): number {
  return stepIds(workflow).indexOf(step) + 1;
}

export function nextStepId(workflow: Workflow, step: StepId): StepId | undefined {
  return workflow.steps[stepIds(workflow).indexOf(step) + 1]?.id;
}

export function changeDirFor(changeName: string): string {
  return `openspec/changes/${changeName}`;
}

export type StepMode = "new" | "continue" | "resume";

export interface RenderInput {
  workflow: Workflow;
  pluginRoot: string;
  changeName: string;
  step: StepId;
  mode: StepMode;
  completed: StepId[];
}

/** Fills a step prompt's placeholders. */
function stepBody(workflow: Workflow, pluginRoot: string, step: StepId, changeName: string): string {
  const prompt = workflow.steps.find((candidate) => candidate.id === step)?.prompt ?? "";
  return prompt
    .replaceAll("{{change_name}}", changeName)
    .replaceAll("{{reviews_dir}}", join(pluginRoot, "reviews"))
    .trim();
}

/**
 * The full text next_step returns for a step: a step prefix, the step prompt, and the instruction
 * to call next_step when the step is done.
 */
export function renderStep(input: RenderInput): string {
  const { workflow, changeName, step, mode } = input;
  const position = `(step ${stepNumber(workflow, step)} of ${workflow.steps.length})`;
  const changeDir = changeDirFor(changeName);
  const parts: string[] = [];

  switch (mode) {
    case "new":
      parts.push(`Created OpenSpec change "${changeName}" at \`${changeDir}/\`.`);
      parts.push(`You are running in the "${workflow.name}" workflow: ${workflow.description}`);
      parts.push(`The current step is "${step}" ${position}.`);
      break;
    case "continue":
      parts.push(`Continuing to step "${step}" ${position}.`);
      break;
    case "resume":
      parts.push(`You are running in the "${workflow.name}" workflow: ${workflow.description}`);
      parts.push(`Resuming step: "${step}" ${position}. If you already started on this step, resume from where you left off.`);
      if (input.completed.length > 0) {
        parts.push(
          `Completed steps: ${input.completed.join(", ")}. Their artifacts are under \`${changeDir}/\`.`,
        );
      }
      break;
  }

  parts.push("Before doing anything else, announce that you are starting this step.");
  parts.push(stepBody(workflow, input.pluginRoot, step, changeName));

  let completion =
    `When you or the user determine this step is complete, call the \`next_step\` tool with change_name "${changeName}". ` +
    "Make that call the final action of the step, and carry out the instructions it returns in this conversation. " +
    "Do not merely say that the step is complete.";
  if (!nextStepId(workflow, step)) {
    completion += " This is the last step: that call validates the change and commits its documents.";
  }
  parts.push(completion);
  return parts.join("\n\n");
}
