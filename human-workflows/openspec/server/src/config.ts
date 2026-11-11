import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { parse } from "yaml";

import type { Cli, CrosscheckChoice } from "./child.js";

export const CONFIG_DISPLAY_PATH = "~/.agent-workflows/config.yaml";
export const DEFAULT_EFFORT = "high";
const CLIS: readonly Cli[] = ["claude", "codex"];
const CROSSCHECK_KEY = "`human-workflows.crosscheck`";
const ENTRY_KEYS = new Set(["cli", "model", "effort"]);

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

function optionalString(entry: Record<string, unknown>, key: string): string | undefined | null {
  const value = entry[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The raw `human-workflows.crosscheck` value, or a problem when it is absent or empty. */
function crosscheckList(root: Record<string, unknown>): unknown[] | string {
  const section = root["human-workflows"];
  const list = isMapping(section) ? section.crosscheck : undefined;
  if (Array.isArray(list) && list.length > 0) {
    return list;
  }
  if (root.crosscheck !== undefined) {
    return "the `crosscheck` list now goes under `human-workflows`, as `human-workflows.crosscheck`.";
  }
  return `it needs a ${CROSSCHECK_KEY} list with one entry per CLI.`;
}

/** One checked list entry, or the problem with it. `earlier` is the entries accepted so far. */
function parseEntry(raw: unknown, index: number, earlier: CrosscheckChoice[]): CrosscheckChoice | string {
  const where = `${CROSSCHECK_KEY} entry ${index + 1}`;
  if (!isMapping(raw)) {
    return `${where} must be a mapping with cli, model, and effort.`;
  }
  const unknown = Object.keys(raw).filter((key) => !ENTRY_KEYS.has(key));
  if (unknown.length > 0) {
    return `${where} has unknown keys: ${unknown.join(", ")}. Allowed: cli, model, effort.`;
  }
  const cli = raw.cli;
  if (cli !== "claude" && cli !== "codex") {
    return `${where} needs cli: claude or cli: codex, not ${JSON.stringify(cli)}.`;
  }
  if (earlier.some((existing) => existing.cli === cli)) {
    return `more than one ${CROSSCHECK_KEY} entry has cli: ${cli}.`;
  }
  const model = optionalString(raw, "model");
  const effort = optionalString(raw, "effort");
  if (model === null || effort === null) {
    return `${where}: model and effort must be non-empty text when given.`;
  }
  return model === undefined ? { cli, effort: effort ?? DEFAULT_EFFORT } : { cli, model, effort: effort ?? DEFAULT_EFFORT };
}

/** Every list entry checked, or the first problem. */
function parseEntries(list: unknown[]): CrosscheckChoice[] | string {
  const entries: CrosscheckChoice[] = [];
  for (const [index, raw] of list.entries()) {
    const entry = parseEntry(raw, index, entries);
    if (typeof entry === "string") {
      return entry;
    }
    entries.push(entry);
  }
  return entries;
}

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
  const list = crosscheckList(isMapping(doc) ? doc : {});
  const entries = typeof list === "string" ? list : parseEntries(list);
  return typeof entries === "string" ? invalid(path, entries) : { ok: true, path, crosscheck: entries };
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
