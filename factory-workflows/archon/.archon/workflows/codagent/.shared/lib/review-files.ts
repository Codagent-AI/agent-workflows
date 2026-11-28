// The scripts' filesystem and git boundary; finding transitions live in review.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { numberLog } from './logs.ts';
import { required } from './check.ts';
import { ARTIFACTS } from './artifacts.ts';
import { runCommand } from './exec.ts';
import { addFindings, applyVerdicts, currentCycle, emptyState, handoff, renderResult, type Defect, type ReviewState, type Verdict } from './review.ts';

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
  const path = `review/${currentCycle(state).place}.md`;
  write(join(dir, path), renderResult(state));
  saveState(dir, state);
}
function updateLog(file: string, state: ReviewState, decisions: boolean, numbered: boolean): void {
  const ledger = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = handoff(state, ledger, decisions);
  if (next === ledger) return;
  write(file, numbered ? numberLog(next, decisions ? 'DECIDE' : 'DISPUTE') : next);
}
export function saveHandoff(dir: string, state: ReviewState, folder?: string): void {
  const target = folder || dir;
  updateLog(join(target, ARTIFACTS.decisions), state, true, Boolean(folder));
  updateLog(join(target, ARTIFACTS.disputes), state, false, Boolean(folder));
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

export function recordReviewed(state: ReviewState, env: NodeJS.ProcessEnv, verdicts: boolean): void {
  const end = required(env.INPUTS_END, 'end');
  const name = required(env.INPUTS_REVIEW_NAME, 'review_name');
  assertHead(end, name);
  const output = env.INPUTS_NEEDED === 'false' ? { findings: [] }
    : result<{ findings: Defect[]; verdicts?: Verdict[] }>(env.INPUTS_RESULT, name);
  if (verdicts && 'verdicts' in output) applyVerdicts(state, output.verdicts ?? []);
  addFindings(state, output.findings);
  currentCycle(state).end = end;
  if (env.INPUTS_NEEDED !== 'false') currentCycle(state).reviewed = true;
  state.last_reviewed = end;
}
