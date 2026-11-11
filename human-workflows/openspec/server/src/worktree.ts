import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { run } from "./proc.js";

/** Adds an untracked file's name and contents to the hash. An unreadable file adds a marker instead. */
function hashUntracked(hash: ReturnType<typeof createHash>, root: string, file: string): void {
  hash.update(file).update("\0");
  try {
    const path = join(root, file);
    if (statSync(path).isFile()) {
      hash.update(readFileSync(path));
    }
  } catch {
    hash.update("<unreadable>");
  }
}

/**
 * A fingerprint of the working tree: status, the tracked diff, and untracked file contents.
 * Used to report whether anything changed while a child ran.
 */
export async function workingTreeFingerprint(root: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const git = (...args: string[]) => run("git", args, { cwd: root, env });
  const status = await git("status", "--porcelain=v1", "-uall");
  if (status.code !== 0) {
    return undefined;
  }
  const diff = await git("diff", "HEAD", "--binary");
  const untracked = await git("ls-files", "-o", "--exclude-standard", "-z");
  const hash = createHash("sha256").update(status.stdout).update("\0").update(diff.stdout).update("\0");
  for (const file of untracked.stdout.split("\0").filter(Boolean).sort()) {
    hashUntracked(hash, root, file);
  }
  return hash.digest("hex");
}

export type WorkingTreeChange = "unchanged" | "changed" | "unknown";

/** Compares fingerprints taken before and after a child ran. */
export function compareFingerprints(before: string | undefined, after: string | undefined): WorkingTreeChange {
  if (before === undefined || after === undefined) {
    return "unknown";
  }
  return before === after ? "unchanged" : "changed";
}
