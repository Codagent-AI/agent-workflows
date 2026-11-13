import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { output, run } from "./proc.js";
import { changeDirFor, type StepId } from "./steps.js";

/** The change name rule: lowercase letters, digits, and hyphens, not starting with a hyphen. */
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
function nonEmptySpecs(root: string, changeDir: string): string[] {
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

/** What a step's artifact needs. A step with no entry here has nothing to check. */
interface StepArtifact {
  /** The OpenSpec artifact that must also report done. Absent when only the files are checked. */
  openspecArtifact?: string;
  /** The step's non-empty files, as repository-relative paths. */
  found: (root: string, changeDir: string) => string[];
  /** What is missing when `found` is empty. */
  need: (changeDir: string) => string;
}

function fileArtifact(relative: string, openspecArtifact?: string): StepArtifact {
  return {
    ...(openspecArtifact === undefined ? {} : { openspecArtifact }),
    found: (root, changeDir) => (nonEmptyFile(join(root, changeDir, relative)) ? [`${changeDir}/${relative}`] : []),
    need: (changeDir) => `a non-empty ${changeDir}/${relative}`,
  };
}

/**
 * The one list of what each step writes, keyed by the step ids in workflow.yaml and in the order the
 * steps run. Each step's check, the finish check, and the pull request's file list all come from it.
 * A test pins the step ids.
 */
const STEP_ARTIFACTS: Readonly<Record<string, StepArtifact>> = {
  proposal: fileArtifact("proposal.md", "proposal"),
  specs: {
    openspecArtifact: "specs",
    found: nonEmptySpecs,
    need: (changeDir) => `at least one non-empty ${changeDir}/specs/<capability>/spec.md`,
  },
  design: fileArtifact("design.md", "design"),
  // Not an OpenSpec artifact, so only the file check applies.
  "test-plan": fileArtifact("test-plan.md"),
};

/** Every file the steps wrote, in step order. The pull request lists them. */
export function artifactFiles(root: string, changeName: string): string[] {
  const changeDir = changeDirFor(changeName);
  return Object.values(STEP_ARTIFACTS).flatMap((artifact) => artifact.found(root, changeDir));
}

/** The steps' missing files, and the OpenSpec artifact ids of the steps whose files are there. */
function filesMissing(root: string, changeDir: string, steps: readonly StepId[]): { missing: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];
  for (const artifact of steps.map((step) => STEP_ARTIFACTS[step])) {
    if (artifact === undefined) {
      continue;
    }
    if (artifact.found(root, changeDir).length === 0) {
      missing.push(artifact.need(changeDir));
    } else if (artifact.openspecArtifact !== undefined) {
      present.push(artifact.openspecArtifact);
    }
  }
  return { missing, present };
}

/**
 * What the given steps still lack. Empty means their artifacts are there. OpenSpec counts any existing
 * file as done, so each check also requires a non-empty file.
 */
export async function missingForSteps(root: string, changeName: string, steps: readonly StepId[], env: NodeJS.ProcessEnv): Promise<string[]> {
  const { missing, present } = filesMissing(root, changeDirFor(changeName), steps);
  if (present.length === 0) {
    return missing;
  }
  const statuses = await openspecStatuses(root, changeName, env);
  if (typeof statuses === "string") {
    return [...missing, statuses];
  }
  // An artifact OpenSpec does not report on counts as not done.
  const notDone = present.filter((id) => statuses.get(id) !== "done");
  const reported = (id: string) => {
    const status = statuses.get(id);
    return status === undefined ? "it reports no status for it" : `it reports "${status}"`;
  };
  return [...missing, ...notDone.map((id) => `OpenSpec to report the ${id} artifact as done (${reported(id)})`)];
}
