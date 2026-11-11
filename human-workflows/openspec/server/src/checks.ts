import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { output, run } from "./proc.js";
import { changeDirFor, type StepId } from "./steps.js";

/** Runner's validate-change-name.sh rule: lowercase letters, digits, and hyphens, not starting with a hyphen. */
export function isValidChangeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

export function nameRuleMessage(name: string): string {
  return `change_name must use lowercase letters, digits, and hyphens, and start with a letter or digit: ${JSON.stringify(name)}`;
}

function nonEmptyFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** Relative paths of non-empty `specs/<capability>/spec.md` files, sorted. */
export function nonEmptySpecs(root: string, changeDir: string): string[] {
  const specsDir = join(root, changeDir, "specs");
  if (!existsSync(specsDir)) {
    return [];
  }
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${changeDir}/specs/${entry.name}/spec.md`)
    .filter((relative) => nonEmptyFile(join(root, relative)))
    .sort();
}

interface StatusArtifact {
  id: string;
  status: string;
}

/** OpenSpec's artifact statuses for a change, keyed by artifact id. */
async function openspecStatuses(
  root: string,
  changeName: string,
  env: NodeJS.ProcessEnv,
): Promise<Map<string, string> | string> {
  const result = await run("openspec", ["status", "--change", changeName, "--json"], { cwd: root, env });
  if (result.code !== 0) {
    return `openspec status --change ${changeName} --json failed: ${output(result)}`;
  }
  try {
    const parsed = JSON.parse(result.stdout) as { artifacts?: StatusArtifact[] };
    return new Map((parsed.artifacts ?? []).map((artifact) => [artifact.id, artifact.status]));
  } catch {
    return `openspec status --change ${changeName} --json did not print JSON: ${output(result)}`;
  }
}

/**
 * What a step still lacks before next_step may advance. Empty means the step's artifact is there.
 * OpenSpec counts any existing file as done, so each check also requires a non-empty file.
 */
export async function missingForStep(
  root: string,
  changeName: string,
  step: StepId,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const changeDir = changeDirFor(changeName);
  const fileCheck = (relative: string): string[] =>
    nonEmptyFile(join(root, changeDir, relative)) ? [] : [`a non-empty ${changeDir}/${relative}`];

  let openspecId: string | undefined;
  let missing: string[];
  switch (step) {
    case "proposal":
      openspecId = "proposal";
      missing = fileCheck("proposal.md");
      break;
    case "specs":
      openspecId = "specs";
      missing =
        nonEmptySpecs(root, changeDir).length > 0
          ? []
          : [`at least one non-empty ${changeDir}/specs/<capability>/spec.md`];
      break;
    case "design":
      openspecId = "design";
      missing = fileCheck("design.md");
      break;
    case "test-plan":
      // Not an OpenSpec artifact, so only the file check applies.
      return fileCheck("test-plan.md");
    case "approach-review":
      return [];
  }

  const statuses = await openspecStatuses(root, changeName, env);
  if (typeof statuses === "string") {
    return [...missing, statuses];
  }
  const status = statuses.get(openspecId);
  if (status !== undefined && status !== "done" && missing.length === 0) {
    missing.push(`OpenSpec to report the ${openspecId} artifact as done (it reports "${status}")`);
  }
  return missing;
}

/**
 * A port of validate-planning-artifacts.sh for change_kind=openspec and require_tasks=false.
 * Messages match the script's, without its prefix.
 */
export function planningArtifactFailures(root: string, changeDir: string): string[] {
  const failures: string[] = [];
  for (const required of ["proposal.md", "design.md", "test-plan.md"]) {
    if (!nonEmptyFile(join(root, changeDir, required))) {
      failures.push(`missing or empty ${changeDir}/${required}`);
    }
  }
  if (nonEmptySpecs(root, changeDir).length === 0) {
    failures.push(`no non-empty specification under ${changeDir}/specs/`);
  }
  return failures;
}
