// Inventory comes from source files and git, independently of the ranking agent.
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { tableBlocks, rawCells, isSeparatorRow } from './checklist.ts';
import { readText, readJson, type StepResult } from './run-files.ts';
export const TIERS = ['red', 'orange', 'yellow', 'white'] as const;
export type Tier = typeof TIERS[number];
export interface Item { type: string; title: string; detail: string; link: string; source: string[]; }
export interface Ranking { red: Item[]; orange: Item[]; yellow: Item[]; white: Item[]; evidence: string; }
export interface RequiredItem { tier: Tier; item: Item; }
export interface Inventory { accepted_head: string; later_commits: Item[]; required: RequiredItem[]; }
export interface InventoryInput { exec: Exec; dir: string; changeFolder: string; }
export const emptyRanking = (): Ranking => ({ red: [], orange: [], yellow: [], white: [], evidence: '' });
function checklistItems(folder: string): RequiredItem[] {
  const table = tableBlocks(readText(join(folder, 'checklist.md'))).find(block => rawCells(block.header).includes('Status'));
  if (!table) throw new Error('checklist with Status column is missing');
  const header = rawCells(table.header);
  return table.rows.filter(row => !isSeparatorRow(row)).flatMap(row => {
    const cells = rawCells(row); const status = cells[header.indexOf('Status')];
    if (status === 'verified') return [];
    const id = cells[header.indexOf('ID')];
    return [{ tier: 'red' as const, item: { type: 'Verification', title: `${id}: ${status}`, detail: `${cells[header.indexOf('Behavior')]} — ${cells[header.indexOf('Evidence')]}`, link: `${folder}/checklist.md:${readText(join(folder, 'checklist.md')).split('\n').indexOf(row) + 1}`, source: [id] } }];
  });
}
function disputeItems(folder: string): RequiredItem[] {
  const text = readText(join(folder, 'dispute-log.md'));
  return [...text.matchAll(/^## (DP-\d+): (.*)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].flatMap(match => {
    if (match[2].startsWith('PR comment')) return [];
    return [{ tier: 'orange' as const, item: { type: 'Dispute', title: `${match[1]}: ${match[2]}`, detail: match[3].trim(), link: `${folder}/dispute-log.md:${text.slice(0, match.index).split('\n').length}`, source: [match[1]] } }];
  });
}
export function failedItems(dir: string): Item[] {
  const results = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  if (readText(join(dir, 'acceptance-preparation-status.txt')).trim() === 'ACCEPTANCE_FAILED' && !results.acceptance) {
    results.acceptance = { ok: false, problems: 'Acceptance did not converge.', remaining: readText(join(dir, 'acceptance-handoff.md')) };
  }
  return ['acceptance', 'archive', 'finalize'].flatMap(step => {
    const result = results[step];
    return result && !result.ok ? [{ type: 'Failure', title: `${step} failed`, detail: `${result.problems}\nMerge blocked. ${result.remaining}`, link: join(dir, 'step-results.json'), source: [`failure:${step}`] }] : [];
  });
}
export function acceptedHead(input: InventoryInput): string {
  const ready = /^READY\s+([a-f0-9]+)\s*$/m.exec(readText(join(input.dir, 'acceptance-round-status.txt')))?.[1];
  const tested = readText(join(input.dir, 'acceptance-tested-revision.txt')).trim().split('\n').at(-1);
  const pr = readJson<{ head_revision?: string; opened_head_revision?: string }>(join(input.dir, 'pull-request.json'), {});
  const sha = ready || tested || pr.opened_head_revision || pr.head_revision;
  if (!sha || output(input.exec, 'git', ['rev-parse', '--verify', `${sha}^{commit}`]) === undefined) throw new Error('accepted revision is missing or invalid');
  return sha;
}
export function laterCommits(input: InventoryInput, start: string): Item[] {
  const revisions = output(input.exec, 'git', ['rev-list', '--reverse', `${start}..HEAD`]);
  if (revisions === undefined) throw new Error('could not list commits after acceptance');
  return revisions.split('\n').filter(Boolean).flatMap(sha => {
    const files = output(input.exec, 'git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha]);
    if (files === undefined) throw new Error(`could not inspect ${sha}`);
    if (files.split('\n').filter(Boolean).every(file => file.startsWith('openspec/'))) return [];
    const size = output(input.exec, 'git', ['show', '--format=', '--shortstat', sha]) ?? '';
    return [{ type: 'Late commit', title: sha, detail: `${size}\nTests: none named.`, link: sha, source: [sha] }];
  });
}
export function inventory(input: InventoryInput): Inventory {
  const head = acceptedHead(input); const commits = laterCommits(input, head);
  return { accepted_head: head, later_commits: commits, required: [...checklistItems(input.changeFolder), ...disputeItems(input.changeFolder),
    ...commits.map(item => ({ tier: 'orange' as const, item })), ...failedItems(input.dir).map(item => ({ tier: 'red' as const, item }))] };
}
