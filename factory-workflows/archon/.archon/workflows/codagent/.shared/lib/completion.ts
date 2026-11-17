// Completion is checked independently of the judge, including bounded progress on resume.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { type Exec, output } from './exec.ts';
import { checkEvidence } from './evidence.ts';
import { evidenceRows } from './evidence.ts';
import { tableBlocks, isSeparatorRow } from './checklist.ts';
import { readText, readJson, writeJson, writeText, appendLine } from './run-files.ts';
export interface CompletionInput { exec: Exec; dir: string; changeDir: string; start: string; blocked: boolean; judgment?: string; }
interface Snapshot { head: string; rows: string; }
export interface CompletionCheck { passed: boolean; only_unverified_with_reason: boolean; }
export interface Verdict { verdict: string; reason: string; remaining: string; }
interface Judgment extends Verdict { judgment: string; }
interface Ledger { continues: number; records: number; judgment: string; }
function snapshot(input: CompletionInput): Snapshot {
  return { head: output(input.exec, 'git', ['rev-parse', 'HEAD']) ?? '', rows: tableBlocks(readText(join(input.changeDir, 'checklist.md'))).flatMap(table => table.rows.filter(row => !isSeparatorRow(row))).join('\n') };
}
function assertUnblocked(input: CompletionInput): void {
  const blocked = join(input.dir, 'implementation-blocked.md');
  if (existsSync(blocked) || input.blocked) {
    throw new Error(`${readText(blocked) || 'Implementor reported blocked.'}\nUpdate the definition and start a new run.`);
  }
}
function assertProgress(input: CompletionInput): void {
  const prior = readJson<Snapshot | null>(join(input.dir, 'continue-snapshot.json'), null);
  const verdict = readJson<Judgment | null>(join(input.dir, 'completion-verdict.json'), null);
  if (verdict?.verdict !== 'continue' || !prior) return;
  const current = snapshot(input);
  if (current.head === prior.head && current.rows === prior.rows) throw new Error('implementation stalled: no new commit and no changed checklist row');
}
export function checkCompletion(input: CompletionInput): { complete: boolean; judge: boolean } {
  assertUnblocked(input); assertProgress(input);
  const checklist = join(input.changeDir, 'checklist.md');
  const evidence = checkEvidence({ checklistFile: checklist, evidenceDir: join(input.dir, 'evidence'),
    problemsFile: join(input.dir, 'evidence-problems.txt'), planFile: join(input.dir, 'planned-checklist.md') });
  const problems = evidence.ok ? [] : [evidence.problems];
  if (!readText(join(input.dir, 'implementation-complete.md')).trim()) problems.push('completion record is missing or empty');
  const commits = output(input.exec, 'git', ['log', '--format=%s', `${input.start}..HEAD`]);
  if (!commits?.split('\n').some(message => message && !message.startsWith('[judge-completion]'))) problems.push('implementation made no commit');
  const rows = evidenceRows(readText(checklist)) ?? [];
  const gaps = rows.filter(row => row.status !== 'verified');
  const onlyGaps = problems.length === 0 && gaps.every(row => row.status === 'not verified' && row.hasText);
  problems.push(...gaps.map(row => `${row.id}: ${row.status}`));
  const check = { passed: problems.length === 0, only_unverified_with_reason: onlyGaps };
  writeJson(join(input.dir, 'completion-check.json'), check);
  writeText(join(input.dir, 'completion-problems.txt'), problems.join('\n'));
  return { complete: check.passed, judge: !(check.passed || savedVerdict(input.dir, input.judgment ?? '1') ) };
}
export function savedVerdict(dir: string, judgment: string): Judgment | null {
  const verdict = readJson<Judgment | null>(join(dir, 'completion-verdict.json'), null);
  return verdict?.judgment === judgment ? verdict : null;
}
function checkLimits(verdict: Verdict, state: Ledger): void {
  if (verdict.verdict === 'continue' && state.continues >= 3) throw new Error(`continue passes exhausted: ${verdict.remaining}`);
  if (verdict.verdict === 'fix-record' && state.records >= 2) throw new Error('record could not be fixed');
}
function validateVerdict(input: CompletionInput, verdict: Verdict, state: Ledger): void {
  if (!['blocked', 'continue', 'fix-record', 'complete'].includes(verdict.verdict) || typeof verdict.reason !== 'string' || typeof verdict.remaining !== 'string') throw new Error('judge returned no valid verdict');
  if (verdict.verdict === 'blocked') {
    if (!readText(join(input.dir, 'implementation-blocked.md')).trim()) throw new Error('judge returned no valid verdict: blocked without record');
  }
  if (verdict.verdict === 'continue' && !verdict.remaining?.trim()) throw new Error('judge returned no valid verdict: no remaining work');
  const check = readJson<CompletionCheck>(join(input.dir, 'completion-check.json'), { passed: false, only_unverified_with_reason: false });
  if (verdict.verdict === 'complete' && !check.only_unverified_with_reason) throw new Error('judge returned no valid verdict: completion check disagrees');
  checkLimits(verdict, state);
}
function saveVerdict(input: CompletionInput, verdict: Verdict, state: Ledger): void {
  const stateFile = join(input.dir, 'completion-state.json');
    const judgment = input.judgment ?? '1';
    appendLine(join(input.dir, 'completion-loop.jsonl'), { ...verdict, judgment });
    writeJson(join(input.dir, 'completion-verdict.json'), { ...verdict, judgment });
    writeJson(stateFile, { judgment, continues: state.continues + Number(verdict.verdict === 'continue'), records: verdict.verdict === 'fix-record' ? state.records + 1 : 0 });
}
function saveContinuation(input: CompletionInput, verdict: Verdict, prior: Judgment | null): void {
  if (verdict.verdict !== 'continue') return;
  if (prior && existsSync(join(input.dir, 'continue-snapshot.json'))) return;
  writeText(join(input.dir, 'implementation-remaining.md'), verdict.remaining);
  writeJson(join(input.dir, 'continue-snapshot.json'), snapshot(input));
}
export function checkVerdict(input: CompletionInput, raw: Verdict | null): { done: boolean; verdict: string; remaining: string } {
  const check = readJson<CompletionCheck>(join(input.dir, 'completion-check.json'), { passed: false, only_unverified_with_reason: false });
  if (check.passed) return { done: true, verdict: '', remaining: '' };
  const stateFile = join(input.dir, 'completion-state.json');
  const state = readJson<Ledger>(stateFile, { continues: 0, records: 0, judgment: '0' });
  const prior = savedVerdict(input.dir, input.judgment ?? '1');
  const verdict = prior ?? raw;
  if (!verdict) throw new Error('judge returned no valid verdict');
  if (!prior) validateVerdict(input, verdict, state);
  if (!prior) {
    saveVerdict(input, verdict, state);
  }
  if (verdict.verdict === 'blocked') assertUnblocked(input);
  saveContinuation(input, verdict, prior);
  return { done: verdict.verdict === 'complete', verdict: verdict.verdict, remaining: verdict.remaining ?? '' };
}
