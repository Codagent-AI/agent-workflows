// Inventory comes from source files and git, independently of the ranking agent.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { tableBlocks, rawCells, isSeparatorRow } from './checklist.ts';
import { readText, readJson, type StepResult } from './run-files.ts';
import { disputeQuestion, type KeyEvidence, type LateJourney, type Question, standardQuestion } from './review-questions.ts';
import { journeys, screenshots } from './review-media.ts';
export const TIERS = ['red', 'orange', 'yellow', 'white'] as const;
export type Tier = typeof TIERS[number];
export interface Item { type: string; title: string; detail: string; link: string; source: string[]; questions?: Question[]; journeys?: LateJourney[]; specChange?: boolean; }
export interface Ranking { red: Item[]; orange: Item[]; yellow: Item[]; white: Item[]; evidence: string; keyEvidence?: KeyEvidence[]; }
export interface RequiredItem { tier: Tier; item: Item; }
export interface Inventory { accepted_head: string; later_commits: Item[]; required: RequiredItem[]; context: { shots: string[]; journeys: string[]; commits: string[]; dismissed: string[] }; }
export interface InventoryInput { exec: Exec; dir: string; changeFolder: string; }
export const emptyRanking = (): Ranking => ({ red: [], orange: [], yellow: [], white: [], evidence: '' });
function checklistItems(input: InventoryInput): RequiredItem[] {
  const folder = input.changeFolder;
  const table = tableBlocks(readText(join(folder, 'checklist.md'))).find(block => rawCells(block.header).includes('Status'));
  if (!table) throw new Error('checklist with Status column is missing');
  const header = rawCells(table.header);
  return table.rows.filter(row => !isSeparatorRow(row)).flatMap(row => {
    const cells = rawCells(row); const status = cells[header.indexOf('Status')];
    if (status === 'verified') return [];
    const id = cells[header.indexOf('ID')];
    const finalize = readJson<{ hadChecks?: boolean; had_checks?: boolean }>(join(input.dir, 'ci/latest.json'), {});
    const steps = readJson<Record<string, StepResult>>(join(input.dir, 'step-results.json'), {});
    const named = cells.join(' ').match(/(?:^|[\s`])([\w./-]+\.(?:test|spec)\.[a-z]+)/g) ?? [];
    const ciEvidence = status === 'not verified' && steps.finalize?.ok && (finalize.hadChecks || finalize.had_checks) &&
      named.some(file => output(input.exec, 'git', ['cat-file', '-t', `HEAD:${file.trim().replace(/^`/, '')}`]) === 'blob');
    return [{ tier: ciEvidence ? 'yellow' as const : 'red' as const, item: { type: status === 'failed' ? 'Failure' : 'Risk', title: `${id}: ${status}`, detail: `${cells[header.indexOf('Behavior')]} — ${cells[header.indexOf('Evidence')]}`, link: `${folder}/checklist.md:${readText(join(folder, 'checklist.md')).split('\n').indexOf(row) + 1}`, source: [id] } }];
  });
}
function disputeItems(folder: string): RequiredItem[] {
  const text = readText(join(folder, 'dispute-log.md'));
  return [...text.matchAll(/^## ((?:DP|DISPUTE)-\d+): (.*)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].flatMap(match => {
    if (/^Settled in review round /mi.test(match[3])) return [];
    const specChange = /\bspec-change\b/i.test(match[3]);
    if (match[2].startsWith('PR comment') && !specChange) return [];
    const questions = specChange ? [disputeQuestion(/^[- ]*(?:Spec edit|Edit): (.+)$/mi.exec(match[3])?.[1] ?? '')] : undefined;
    return [{ tier: specChange ? 'red' as const : 'orange' as const, item: { type: 'Dispute', specChange, questions, title: `${match[1]}: ${match[2]}`, detail: match[3].trim(), link: `${folder}/dispute-log.md:${text.slice(0, match.index).split('\n').length}`, source: [match[1]] } }];
  });
}
function acceptancePushResult(dir: string, result: StepResult): StepResult {
  if (!result.problems.startsWith('Acceptance push failed:')) return result;
  const finalize = readJson<Record<string, { ok: boolean }>>(join(dir, 'finalize-results.json'), {});
  const pushed = finalize['finalize-push']?.ok === true;
  const detail = pushed ? "Finalize subsequently pushed the round's committed fixes to the pull request; acceptance still did not converge." : "The pull request lacks the round's fix unless finalize pushes it.";
  return { ...result, problems: result.problems.replace(/ The PR lacks.*$/, ''), remaining: `${result.remaining}\n${detail}` };
}
export function failedItems(dir: string): Item[] {
  const results = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  if (readText(join(dir, 'acceptance-preparation-status.txt')).trim() === 'ACCEPTANCE_FAILED' && !results.acceptance) {
    results.acceptance = { ok: false, problems: 'Acceptance did not converge.', remaining: readText(join(dir, 'acceptance-handoff.md')) };
  }
  return ['acceptance', 'archive', 'finalize', 'retest', 'merge-base', 'address-feedback', 'check-response', 'push-round', 'description'].flatMap(step => {
    const recorded = results[step];
    const result = step === 'acceptance' && recorded ? acceptancePushResult(dir, recorded) : recorded;
    return result && !result.ok ? [{ type: 'Failure', title: `${step} failed`, detail: `${result.problems}\n${['archive', 'finalize'].includes(step) ? 'Merge is unavailable. ' : ''}${result.remaining}`, link: join(dir, 'step-results.json'), source: [`failure:${step}`], questions: [standardQuestion('Failure')] }] : [];
  });
}
export function acceptedHead(input: InventoryInput): string {
  const saved = readText(join(input.dir, 'review/accepted-head.txt')).trim();
  if (saved) return saved;
  const ready = /^READY\s+([a-f0-9]+)\s*$/m.exec(readText(join(input.dir, 'acceptance-round-status.txt')))?.[1];
  const tested = readText(join(input.dir, 'acceptance-tested-revision.txt')).trim().split('\n').at(-1);
  const pr = readJson<{ head_revision?: string; opened_head_revision?: string }>(join(input.dir, 'pull-request.json'), {});
  const sha = ready || tested || pr.opened_head_revision || pr.head_revision;
  if (!sha || output(input.exec, 'git', ['rev-parse', '--verify', `${sha}^{commit}`]) === undefined) throw new Error('accepted revision is missing or invalid');
  return sha;
}
export function laterCommits(input: InventoryInput, start: string): Item[] {
  const revisions = output(input.exec, 'git', ['rev-list', '--first-parent', '--reverse', `${start}..HEAD`]);
  if (revisions === undefined) throw new Error('could not list commits after acceptance');
  const retested = readJson<string[]>(join(input.dir, 'review/retested-commits.json'), []);
  return revisions.split('\n').filter(sha => sha && !retested.includes(sha)).flatMap(sha => lateCommit(input.exec, sha));
}
function lateCommit(exec: Exec, sha: string): Item[] {
    const parents = output(exec, 'git', ['show', '-s', '--format=%P', sha])?.split(' ') ?? [];
    const flags = parents.length > 1 ? ['--remerge-diff'] : [];
    const files = parents.length > 1 ? output(exec, 'git', ['show', ...flags, '--format=', '--name-only', sha]) : output(exec, 'git', ['diff-tree', '--root', '--first-parent', '-m', '--no-commit-id', '--name-only', '-r', sha]);
    if (files === undefined) throw new Error(`could not inspect ${sha}`);
    if (files.split('\n').filter(Boolean).every(file => file.startsWith('openspec/'))) return [];
    const size = output(exec, 'git', ['show', ...flags, '--format=', '--shortstat', sha]) ?? '';
    return [{ type: 'Late commit', title: sha, detail: `${size}\nTests: none named.`, link: sha, source: [sha] }];
}
export function responseStatuses(dir: string): Map<string, string> {
  const responses = readdirSync(dir).filter(file => /^review-response-round-\d+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const statuses = new Map<string, string>();
  for (const file of responses) {
    const entries = readJson<{ item: string; status: string }[]>(join(dir, file), []);
    for (const { item, status } of entries) statuses.set(item, status);
  }
  return statuses;
}
export function inventory(input: InventoryInput): Inventory {
  const head = acceptedHead(input);
  const commits = laterCommits(input, head);
  const statuses = responseStatuses(input.dir);
  const dismissed = [...statuses].filter(([, status]) => status === 'no-change' || status === 'settled').map(([id]) => id);
  const plan = join(input.changeFolder, 'test-plan.md');
  const legacy = existsSync(plan) ? readText(plan).match(/\bAT-\d+\b/g) ?? [] : [];
  const required = [...checklistItems(input), ...disputeItems(input.changeFolder),
    ...commits.map(item => ({ tier: 'orange' as const, item })), ...failedItems(input.dir).map(item => ({ tier: 'red' as const, item }))];
  return { accepted_head: head, later_commits: commits.filter(item => !dismissed.includes(item.source[0])),
    required: required.filter(row => !row.item.source.some(source => dismissed.includes(source))),
    context: { dismissed, shots: screenshots(input.dir).map(shot => shot.file),
      journeys: [...journeys(input.dir).map(journey => journey.code), ...legacy], commits: commits.map(item => item.source[0]) } };
}
