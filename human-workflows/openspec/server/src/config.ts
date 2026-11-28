import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { Cli } from "./acpx.js";
import { check } from "./schema.js";

export const CONFIG_DISPLAY_PATH = "~/.agent-workflows/config.yaml";
export const DEFAULT_EFFORT = "high";
const LOCAL_CLIS = new Set(["claude", "codex", "agy"]);

export interface CrosscheckChoice {
  cli: string;
  model?: string;
  effort: string;
}
const CROSSCHECK_KEY = "`human-workflows.crosscheck`";

export const SETUP_HINT = "Use the define-openspec-change:setup skill to set it up with the user, then try again.";

/** The user's agent-workflows config file, under HOME as the server sees it. */
export function configPath(env: NodeJS.ProcessEnv): string {
  return join(env.HOME || homedir(), ".agent-workflows", "config.yaml");
}

export type ConfigResult =
  | { ok: true; path: string; crosscheck: CrosscheckChoice[] }
  | { ok: false; path: string; reason: "missing" | "invalid"; message: string };

function invalid(path: string, problem: string): ConfigResult {
  return { ok: false, path, reason: "invalid", message: `${CONFIG_DISPLAY_PATH} (${path}) is not valid: ${problem}` };
}

const NEEDS_LIST = `it needs a ${CROSSCHECK_KEY} list with one entry per CLI.`;

/** Text for `model` and `effort`: absent or blank in the YAML means not given. */
const optionalText = z
  .string({ error: "must be non-empty text when given" })
  .trim()
  .min(1, "must be non-empty text when given")
  .nullish()
  .transform((value) => value ?? undefined);

const entrySchema = z
  .strictObject(
    {
      cli: z.string().regex(/^[a-z][a-z0-9-]*$/, "must start with a lowercase letter and use only lowercase letters, digits, and hyphens"),
      model: optionalText,
      effort: optionalText,
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `has unknown keys: ${issue.keys.join(", ")}. Allowed: cli, model, effort.`
          : "must be a mapping with cli, model, and effort.",
    },
  )
  .transform(({ cli, model, effort }): CrosscheckChoice => (model === undefined ? { cli, effort: effort ?? DEFAULT_EFFORT } : { cli, model, effort: effort ?? DEFAULT_EFFORT }));

const crosscheckSchema = z.array(entrySchema, { error: NEEDS_LIST }).min(1, NEEDS_LIST).superRefine((entries, context) => {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.cli)) {
      context.addIssue({ code: "custom", message: `more than one entry has cli: ${entry.cli}`, path: [index, "cli"] });
    }
    seen.add(entry.cli);
  }
});

/** Only `human-workflows.crosscheck` is read. Other keys, such as `factory-workflows`, are for other workflows and ignored. */
const configSchema = z.looseObject(
  { "human-workflows": z.looseObject({ crosscheck: crosscheckSchema }, { error: NEEDS_LIST }) },
  { error: NEEDS_LIST },
);

/**
 * Reads and checks the `human-workflows.crosscheck` list: one entry per CLI, each with a cli and an optional
 * model and effort. Other top-level keys, such as `factory-workflows`, are reserved for other workflows and ignored.
 */
export function readConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const path = configPath(env);
  if (!existsSync(path)) {
    return { ok: false, path, reason: "missing", message: `There is no ${CONFIG_DISPLAY_PATH} (${path}), so the crosscheck agent is not configured.` };
  }
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, "utf8"));
  } catch (error) {
    return invalid(path, (error as Error).message);
  }
  const checked = check(configSchema, doc);
  return "problem" in checked ? invalid(path, checked.problem) : { ok: true, path, crosscheck: checked.value["human-workflows"].crosscheck };
}

/** True when `command` is an executable file on the PATH in `env`. */
export function onPath(command: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = join(dir, command);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return true;
      }
    } catch {
      // not here
    }
  }
  return false;
}

/** All available reviewers on other CLIs, falling back to the lead's own entry. */
export function chooseCrosscheck(
  entries: CrosscheckChoice[],
  lead: Cli | undefined,
  env: NodeJS.ProcessEnv,
): CrosscheckChoice[] {
  const available = entries.filter(({ cli }) => !LOCAL_CLIS.has(cli) || onPath(cli, env));
  const others = available.filter(({ cli }) => cli !== lead);
  return others.length > 0 ? others : available;
}

export function resolveCrosscheck(lead: Cli | undefined, env: NodeJS.ProcessEnv): CrosscheckChoice[] | string {
  const config = readConfig(env);
  if (!config.ok) {
    return `${config.message} ${SETUP_HINT}`;
  }
  const choices = chooseCrosscheck(config.crosscheck, lead, env);
  return choices.length > 0
    ? choices
    : `No crosscheck reviewer can run. ${CONFIG_DISPLAY_PATH} lists ${config.crosscheck.map(({ cli }) => cli).join(", ")}, but none are on PATH. ${SETUP_HINT}`;
}
