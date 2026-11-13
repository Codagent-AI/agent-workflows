import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the command could not be started at all, for example ENOENT. */
  launchError?: string;
}

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function spawnPiped(command: string, args: string[], options: RunOptions) {
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 120_000,
  });
}

/** Runs a command to completion with stdin closed and returns its output. Never throws. */
export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child: ReturnType<typeof spawnPiped>;
    try {
      child = spawnPiped(command, args, options);
    } catch (error) {
      finish({ code: null, stdout, stderr, launchError: String(error) });
      return;
    }
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => finish({ code: null, stdout, stderr, launchError: error.message }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}

/** Combined, trimmed output of a command, or its launch error, for messages. */
export function output(result: RunResult): string {
  if (result.launchError) {
    return result.launchError;
  }
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
}

export function tail(text: string, max = 2000): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `...${trimmed.slice(trimmed.length - max)}`;
}
