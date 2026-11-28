import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { acpxCommand, type ChildCommand, childEnv } from "./acpx.js";
import type { CrosscheckChoice } from "./config.js";
import { type Context, privateLogDir } from "./context.js";

export function newCrosscheckId(): string {
  return `cc-${randomBytes(4).toString("hex")}`;
}

export function reserveLogDir(context: Context, root: string, initialId: string): { id: string; dir: string } {
  const base = privateLogDir(context, root);
  let id = initialId;
  for (;;) {
    const dir = join(base, id);
    try {
      mkdirSync(dir, { mode: 0o700 });
      return { id, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      id = newCrosscheckId();
    }
  }
}

export function prepareChild(dir: string, root: string, prompt: string, choice: CrosscheckChoice): ChildCommand {
  mkdirSync(dir, { mode: 0o700 });
  const command = acpxCommand(choice, root, prompt);
  writeFileSync(join(dir, "prompt.txt"), prompt, { mode: 0o600 });
  const shown = JSON.stringify({ command: command.command, args: command.args, prompt: "on stdin, see prompt.txt" }, null, 2);
  writeFileSync(join(dir, "command.json"), shown, { mode: 0o600 });
  return command;
}

export interface LoggedChild {
  child: ChildProcess;
  /** Closes the stdout and stderr log files the child writes to. */
  closeLogs: () => void;
}

/**
 * Starts the child in its own process group, with stdout and stderr going to files in `dir` and the
 * prompt on its stdin. Throws if it cannot start.
 */
export function spawnLogged(command: ChildCommand, dir: string, root: string, env: NodeJS.ProcessEnv): LoggedChild {
  const stdoutFd = openSync(join(dir, "events.ndjson"), "w", 0o600);
  let stderrFd: number;
  try {
    stderrFd = openSync(join(dir, "stderr.txt"), "w", 0o600);
  } catch (error) {
    closeSync(stdoutFd);
    throw error;
  }
  const closeLogs = () => {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  };
  try {
    const child = spawn(command.command, command.args, {
      cwd: root,
      env: childEnv(env),
      stdio: ["pipe", stdoutFd, stderrFd],
      detached: true,
    });
    // A child that exits without reading its prompt closes the pipe. The call's outcome says what happened.
    child.stdin?.on("error", () => {});
    child.stdin?.end(command.prompt);
    return { child, closeLogs };
  } catch (error) {
    closeLogs();
    throw error;
  }
}
