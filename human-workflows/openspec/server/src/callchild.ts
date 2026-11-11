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

/** Makes the call's log folder and records the prompt and the command (without the prompt argument) there. */
export function prepareChild(context: Context, root: string, prompt: string, choice: CrosscheckChoice): PreparedChild {
  const id = `call-${randomBytes(4).toString("hex")}`;
  const dir = privateLogDir(context, root, id);
  const lastMessageFile = join(dir, "last-message.txt");
  const command = childCommand({ ...choice, prompt, pluginRoot: context.pluginRoot, lastMessageFile });
  writeFileSync(join(dir, "prompt.txt"), prompt, { mode: 0o600 });
  const shown = JSON.stringify({ command: command.command, args: command.args.slice(0, -1) }, null, 2);
  writeFileSync(join(dir, "command.json"), shown, { mode: 0o600 });
  return { id, dir, command };
}

export interface LoggedChild {
  child: ChildProcess;
  /** Closes the stdout and stderr log files the child writes to. */
  closeLogs: () => void;
}

/** Starts the child in its own process group, with stdout and stderr going to files in `dir`. Throws if it cannot start. */
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
      stdio: ["ignore", stdoutFd, stderrFd],
      detached: true,
    });
    return { child, closeLogs };
  } catch (error) {
    closeLogs();
    throw error;
  }
}
