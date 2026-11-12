// Runs external commands (git, gh, the archon CLI, openspec) for the pack's scripts.
//
// Every check takes an `Exec` instead of spawning directly, so a test can pass a fake
// that records the calls and returns canned results.
import { spawnSync } from 'node:child_process';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  input?: string;
}

export type Exec = (command: string, args: readonly string[], options?: ExecOptions) => ExecResult;

export const runCommand: Exec = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { status: 127, stdout: '', stderr: `${command}: ${result.error.message}` };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export type Sleep = (milliseconds: number) => void;

export const sleep: Sleep = milliseconds => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** Trimmed stdout of a command that must succeed, or undefined when it fails. */
export function output(exec: Exec, command: string, args: readonly string[]): string | undefined {
  const result = exec(command, args);
  return result.status === 0 ? result.stdout.trim() : undefined;
}
