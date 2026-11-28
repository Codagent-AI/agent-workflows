import { type ChildProcess, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { prepareChild, spawnLogged } from "./callchild.js";
import type { CrosscheckChoice } from "./config.js";
import type { Context } from "./context.js";
import { type Exit, type Outcome, readReview, reviewOutcome } from "./reviewoutcome.js";

export const KILL_GRACE_MS = 15_000;

interface ProcessGroup {
  pid: number;
  parent: number;
  group: number;
}

function processes(env: NodeJS.ProcessEnv): ProcessGroup[] {
  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8", env, timeout: 2_000 });
  return (result.stdout ?? "").trim().split("\n").flatMap((line) => {
    const [pid, parent, group] = line.trim().split(/\s+/).map(Number);
    return pid && parent !== undefined && group ? [{ pid, parent, group }] : [];
  });
}

export function descendantGroups(pid: number, all: ProcessGroup[], serverPid: number): number[] {
  const own = all.find((item) => item.pid === serverPid)?.group;
  const children = new Map<number, ProcessGroup[]>();
  for (const item of all) {
    const siblings = children.get(item.parent) ?? [];
    siblings.push(item);
    children.set(item.parent, siblings);
  }
  const groups = new Set([pid]);
  const queue = [pid];
  for (const parent of queue) {
    for (const child of children.get(parent) ?? []) {
      queue.push(child.pid);
      groups.add(child.group);
    }
  }
  if (own !== undefined) {
    groups.delete(own);
  }
  return [...groups];
}

export function signal(pid: number, value: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, value);
    return true;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ESRCH") {
      return false;
    }
    console.error(`Crosscheck could not signal PID or group ${pid} with ${value}: ${failure.message}`);
    return value === 0;
  }
}

export class Reviewer {
  readonly startedAt: Date;
  readonly done: Promise<void>;
  endedAt?: Date;
  outcome?: Outcome;
  private child?: ChildProcess;
  private exit?: Exit;
  private stopReason?: Exit["stopped"];
  private groups = new Set<number>();
  private killTimer?: NodeJS.Timeout;
  private killAt = Infinity;
  private finishCleanup?: () => void;

  constructor(
    readonly entry: CrosscheckChoice,
    readonly dir: string,
    private readonly context: Context,
    launch: { root: string; prompt: string },
  ) {
    this.startedAt = context.now();
    this.done = this.run(launch.root, launch.prompt);
  }

  private async run(root: string, prompt: string): Promise<void> {
    this.exit = await this.launch(root, prompt);
    this.endedAt = this.context.now();
    await this.waitForCleanup();
    try {
      const review = this.exit.launchError || this.stopReason ? undefined : await readReview(this.dir);
      this.outcome = reviewOutcome({ ...this.exit, stopped: this.stopReason }, review);
    } catch (error) {
      this.outcome = { status: "failed", code: "execution_failed", error: String(error) };
    }
    this.saveResponse();
  }

  private saveResponse(): void {
    try {
      const response = this.outcome?.status === "succeeded" ? this.outcome.response : "";
      writeFileSync(join(this.dir, "response.txt"), response, { mode: 0o600 });
    } catch {
      // The result remains available if the log cannot be written.
    }
  }

  private launch(root: string, prompt: string): Promise<Exit> {
    return new Promise((resolve) => {
      try {
        const command = prepareChild(this.dir, root, prompt, this.entry);
        const { child, closeLogs } = spawnLogged(command, this.dir, root, this.context.env);
        this.child = child;
        let exit: Exit | undefined;
        child.once("error", (error) => {
          exit = { code: null, launchError: `Could not start acpx: ${error.message}` };
        });
        child.once("close", (code, closedSignal) => {
          closeLogs();
          resolve(exit ?? { code, signal: closedSignal });
        });
      } catch (error) {
        resolve({ code: null, launchError: `Could not start acpx: ${String(error)}` });
      }
    });
  }

  stop(reason: NonNullable<Exit["stopped"]>, grace = this.context.killGraceMs ?? KILL_GRACE_MS): void {
    const pid = this.child?.pid;
    if (!pid || (this.exit && !this.stopReason)) {
      return;
    }
    if (!this.stopReason) {
      this.captureGroups(pid);
      signal(pid, "SIGTERM");
    }
    if (!this.stopReason || reason === "timeout") {
      this.stopReason = reason;
    }
    const deadline = Date.now() + grace;
    if (deadline < this.killAt && this.groups.size > 0) {
      clearTimeout(this.killTimer);
      this.killAt = deadline;
      this.killTimer = setTimeout(() => this.killGroups(pid), grace);
    }
  }

  private captureGroups(pid: number): void {
    for (const group of descendantGroups(pid, processes(this.context.env), process.pid)) {
      this.groups.add(group);
    }
  }

  private killGroups(pid: number): void {
    if (!this.exit && signal(pid, 0)) {
      this.captureGroups(pid);
    }
    for (const group of this.groups) {
      signal(-group, "SIGKILL");
    }
    this.groups.clear();
    this.finishCleanup?.();
  }

  private waitForCleanup(): Promise<void> | undefined {
    if ([...this.groups].some((group) => signal(-group, 0))) {
      return new Promise((resolve) => {
        this.finishCleanup = resolve;
      });
    }
    clearTimeout(this.killTimer);
    this.groups.clear();
    return undefined;
  }
}
