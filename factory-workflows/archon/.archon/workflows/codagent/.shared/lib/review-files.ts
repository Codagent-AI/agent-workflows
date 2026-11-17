// The scripts' filesystem and git boundary; finding transitions live in review.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACTS } from './artifacts.ts';
import { runCommand } from './exec.ts';
import { currentCycle, emptyState, handoff, renderResult, type ReviewState } from './review.ts';

export function git(args: string[]): string {
  const response = runCommand('git', args);
  if (response.status !== 0) throw new Error(`git ${args.join(' ')}: ${response.stderr.trim()}`);
  return response.stdout.trim();
}
export const head = (): string => git(['rev-parse', 'HEAD']);
export function assertHead(end: string, name: string): void {
  if (head() !== end) throw new Error(`${name}: HEAD moved since preparation; see review output under artifacts/nodes/${name}.md`);
}
export function readState(dir: string): ReviewState {
  const file = join(dir, ARTIFACTS.reviewState);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as ReviewState : emptyState();
}
function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
export function saveState(dir: string, state: ReviewState): void {
  write(join(dir, ARTIFACTS.reviewState), `${JSON.stringify(state, null, 2)}\n`);
}
export function saveResult(dir: string, state: ReviewState): void {
  const path = currentCycle(state).place === 'acceptance' ? ARTIFACTS.reviewAcceptance : ARTIFACTS.reviewBeforePr;
  write(join(dir, path), renderResult(state));
  saveState(dir, state);
}
export function saveHandoff(dir: string, state: ReviewState): void {
  const file = join(dir, ARTIFACTS.assumptions);
  const ledger = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = handoff(state, ledger);
  if (next !== ledger) write(file, next);
  saveState(dir, state);
}
export function script(run: () => Record<string, unknown>): void {
  try { process.stdout.write(`${JSON.stringify(run())}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); }
}
export function result<T>(text: string | undefined, name: string): T {
  try {
    if (!text) throw new Error('missing result');
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
    return parsed as T;
  } catch (error) {
    throw new Error(`${name}: invalid review result (${String(error)}); see output under artifacts/nodes/${name}.md`);
  }
}
