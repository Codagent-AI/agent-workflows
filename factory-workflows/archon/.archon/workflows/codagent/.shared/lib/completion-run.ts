import { join } from 'node:path';
import { artifactsDir, required } from './check.ts';
import { checkoutStart } from './checkout.ts';
import { runCommand } from './exec.ts';
import type { CompletionInput } from './completion.ts';
export function completionInput(values: { changeDir?: string; start?: string; blocked?: string; previous?: string }): CompletionInput {
  const dir = artifactsDir();
  const observed = checkoutStart(required(values.start, 'start'), dir, false);
  if ('failure' in observed) throw new Error(observed.failure.problems);
  const previous = Number(values.previous);
  return { exec: runCommand, dir, start: observed.start.commit, changeDir: required(values.changeDir, 'change_dir'),
    blocked: values.blocked === 'true', judgment: String(Number.isFinite(previous) ? previous + 1 : 1) };
}
export const responsePath = (): string => join(artifactsDir(), 'implementor-response.md');
