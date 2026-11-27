import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { type RunOptions, run } from "./proc.js";

export interface TreeSnapshot {
  head: string;
  paths: Map<string, string>;
}

export type TreeResult =
  | { working_tree: "unchanged" | "unknown" }
  | { working_tree: "changed"; changed_paths: string[] };

function statusPaths(output: string): Map<string, string> {
  const fields = output.split("\0");
  const paths = new Map<string, string>();
  for (let index = 0; index < fields.length - 1; index += 1) {
    const field = fields[index] as string;
    const status = field.slice(0, 2);
    paths.set(field.slice(3), status);
    if (/[RC]/.test(status)) {
      index += 1;
      paths.set(fields[index] as string, status);
    }
  }
  return paths;
}

function indexEntries(output: string, paths: Map<string, string>): Map<string, string> {
  const entries = new Map<string, string>();
  for (const field of output.split("\0")) {
    const tab = field.indexOf("\t");
    const path = field.slice(tab + 1);
    if (tab >= 0 && paths.has(path)) {
      entries.set(path, `${entries.get(path) ?? ""}${field.slice(0, tab)}\n`);
    }
  }
  return entries;
}

function fileFingerprint(path: string): string {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) {
    return "missing";
  }
  const hash = createHash("sha256").update(String(stat.mode));
  if (stat.isSymbolicLink()) {
    hash.update(readlinkSync(path, { encoding: "buffer" }));
  } else if (stat.isFile()) {
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

export async function snapshotTree(options: RunOptions): Promise<TreeSnapshot | undefined> {
  const [head, status, index] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], options),
    run("git", ["status", "--porcelain=v1", "-z", "-uall"], options),
    run("git", ["ls-files", "-s", "-z"], options),
  ]);
  if (head.code !== 0 || status.code !== 0 || index.code !== 0) {
    return undefined;
  }
  const paths = statusPaths(status.stdout);
  const entries = indexEntries(index.stdout, paths);
  try {
    for (const [path, code] of paths) {
      paths.set(path, JSON.stringify([code, entries.get(path), fileFingerprint(join(options.cwd, path))]));
    }
    return { head: head.stdout.trim(), paths };
  } catch {
    return undefined;
  }
}

async function committedPaths(oldHead: string, newHead: string, options: RunOptions): Promise<string[] | undefined> {
  if (oldHead === newHead) {
    return [];
  }
  const diff = await run("git", ["diff", "--name-only", "--no-renames", "-z", oldHead, newHead], options);
  return diff.code === 0 ? ["HEAD", ...diff.stdout.split("\0").filter(Boolean)] : undefined;
}

export async function compareTrees(
  before: TreeSnapshot | undefined,
  after: TreeSnapshot | undefined,
  options: RunOptions,
): Promise<TreeResult> {
  if (!(before && after)) {
    return { working_tree: "unknown" };
  }
  const committed = await committedPaths(before.head, after.head, options);
  if (!committed) {
    return { working_tree: "unknown" };
  }
  const changed = new Set(committed);
  for (const path of new Set([...before.paths.keys(), ...after.paths.keys()])) {
    if (before.paths.get(path) !== after.paths.get(path)) {
      changed.add(path);
    }
  }
  return changed.size === 0 ? { working_tree: "unchanged" } : { working_tree: "changed", changed_paths: [...changed].sort() };
}
