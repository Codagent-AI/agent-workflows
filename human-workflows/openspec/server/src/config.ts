import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import type { Cli, CrosscheckChoice } from "./child.js";
import { check } from "./schema.js";

export const CONFIG_DISPLAY_PATH = "~/.agent-workflows/config.yaml";
export const DEFAULT_EFFORT = "high";
const CLIS = ["claude", "codex"] as const satisfies readonly Cli[];
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
      cli: z.enum(CLIS, { error: (issue) => `must be "claude" or "codex", not ${JSON.stringify(issue.input)}` }),
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
  const seen = new Set<Cli>();
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

/**
 * The crosscheck entry for this session: the other CLI's entry when it is configured and installed,
 * otherwise the lead's own. With an unknown lead, the first configured entry that is installed.
 */
export function chooseCrosscheck(
  lead: Cli | undefined,
  entries: CrosscheckChoice[],
  installed: (cli: Cli) => boolean,
): CrosscheckChoice | string {
  const order: Cli[] = lead === undefined ? entries.map((entry) => entry.cli) : [lead === "claude" ? "codex" : "claude", lead];
  for (const cli of order) {
    const entry = entries.find((candidate) => candidate.cli === cli);
    if (entry && installed(cli)) {
      return entry;
    }
  }
  const configured = entries.map((entry) => entry.cli);
  const missing = configured.filter((cli) => !installed(cli));
  const leadText = lead === undefined ? "" : ` for a ${lead} lead`;
  const detail =
    missing.length > 0
      ? `${CONFIG_DISPLAY_PATH} lists ${configured.join(" and ")}, but ${missing.join(" and ")} is not on PATH.`
      : `${CONFIG_DISPLAY_PATH} has no entry for ${CLIS.join(" or ")} that can run${leadText}.`;
  return `No crosscheck agent can run${leadText}. ${detail}`;
}

/** The crosscheck to use now, or the reason there is none (with the setup hint). */
export function resolveCrosscheck(lead: Cli | undefined, env: NodeJS.ProcessEnv): CrosscheckChoice | string {
  const config = readConfig(env);
  if (!config.ok) {
    return `${config.message} ${SETUP_HINT}`;
  }
  const choice = chooseCrosscheck(lead, config.crosscheck, (cli) => onPath(cli, env));
  return typeof choice === "string" ? `${choice} ${SETUP_HINT}` : choice;
}
