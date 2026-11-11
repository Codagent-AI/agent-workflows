import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

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

const PLACEHOLDERS = ["{{change_name}}", "{{skills_dir}}"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseStep(raw: unknown, index: number, seen: Set<string>): WorkflowStep {
  const label = `step ${index + 1}`;
  if (!isRecord(raw)) {
    throw new WorkflowError(`${label} must be a mapping with an id and a prompt.`);
  }
  const { id, prompt, tools } = raw;
  if (!nonEmptyString(id)) {
    throw new WorkflowError(`${label} needs an id.`);
  }
  if (seen.has(id)) {
    throw new WorkflowError(`step id "${id}" is used twice.`);
  }
  seen.add(id);
  if (!nonEmptyString(prompt)) {
    throw new WorkflowError(`step "${id}" needs a prompt.`);
  }
  const unknown = (prompt.match(/\{\{[^}]*\}\}/g) ?? []).find((placeholder) => !PLACEHOLDERS.includes(placeholder));
  if (unknown) {
    throw new WorkflowError(`step "${id}" has an unknown placeholder ${unknown}.`);
  }
  if (tools !== undefined && (!Array.isArray(tools) || tools.some((tool) => tool !== "call_agent"))) {
    throw new WorkflowError(`step "${id}" has tools that are not [call_agent]. Only call_agent is supported.`);
  }
  return { id, prompt, callAgent: Array.isArray(tools) && tools.length > 0 };
}

/** Checks the shape of a workflow.yaml text and returns it. Throws WorkflowError when it is malformed. */
export function parseWorkflow(text: string): Workflow {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new WorkflowError(`is not valid YAML: ${(error as Error).message}`);
  }
  if (!isRecord(raw)) {
    throw new WorkflowError("must be a mapping with name, description, and steps.");
  }
  if (!nonEmptyString(raw.name)) {
    throw new WorkflowError("needs a name.");
  }
  if (!nonEmptyString(raw.description)) {
    throw new WorkflowError("needs a description.");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new WorkflowError("needs at least one step under steps.");
  }
  const seen = new Set<string>();
  const steps = raw.steps.map((step, index) => parseStep(step, index, seen));
  return { name: raw.name.trim(), description: raw.description.trim(), steps };
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

export function isStepId(workflow: Workflow, value: unknown): value is StepId {
  return typeof value === "string" && stepIds(workflow).includes(value);
}

export function firstStepId(workflow: Workflow): StepId {
  return workflow.steps[0]?.id ?? "";
}

export function lastStepId(workflow: Workflow): StepId {
  return workflow.steps[workflow.steps.length - 1]?.id ?? "";
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
    .replaceAll("{{skills_dir}}", join(pluginRoot, "skills"))
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
