import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type ChildCommand, childCommand, childEnv, type CrosscheckChoice } from "./child.js";
import { type Context, privateLogDir } from "./context.js";

export interface PreparedChild {
  id: string;
  dir: string;
  command: ChildCommand;
}

/** Makes the call's log folder and records the prompt and the command there. */
export function prepareChild(context: Context, root: string, prompt: string, choice: CrosscheckChoice): PreparedChild {
  const id = `call-${randomBytes(4).toString("hex")}`;
  const dir = privateLogDir(context, root, id);
  const lastMessageFile = join(dir, "last-message.txt");
  const command = childCommand({ ...choice, prompt, pluginRoot: context.pluginRoot, lastMessageFile });
  writeFileSync(join(dir, "prompt.txt"), prompt, { mode: 0o600 });
  const shown = JSON.stringify({ command: command.command, args: command.args, prompt: "on stdin, see prompt.txt" }, null, 2);
  writeFileSync(join(dir, "command.json"), shown, { mode: 0o600 });
  return { id, dir, command };
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
  const stdoutFd = openSync(join(dir, "stdout"), "w", 0o600);
  let stderrFd: number;
  try {
    stderrFd = openSync(join(dir, "stderr"), "w", 0o600);
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
