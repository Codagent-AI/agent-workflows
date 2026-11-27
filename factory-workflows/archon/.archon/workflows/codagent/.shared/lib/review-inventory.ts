// Inventory comes from source files and git, independently of the ranking agent.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { tableBlocks, rawCells, isSeparatorRow } from './checklist.ts';
import { readText, readJson, type StepResult } from './run-files.ts';
import { disputeQuestion, type KeyEvidence, type LateJourney, type Question, standardQuestion } from './review-questions.ts';
import { baseRevisions, commitParents, reviewRevisions } from './review-revisions.ts';
import { reviewMedia } from './review-media.ts';
import type { LinkContext, TargetLink } from './review-links.ts';
import { type PageEntry, readPages } from './review-pages.ts';
import { citesExistingTest, passedFinalizeChecks } from './review-ci.ts';
import type { CiResult } from './ci.ts';
export const TIERS = ['red', 'orange', 'yellow'] as const;
export type Tier = typeof TIERS[number];
export interface Item { type: string; title: string; detail: string; links: TargetLink[]; evidence?: string; failLine?: string; source: string[]; questions?: Question[]; journeys?: LateJourney[]; specChange?: boolean; }
export interface Ranking { red: Item[]; orange: Item[]; yellow: Item[]; evidence: string; keyEvidence?: KeyEvidence[]; }
export interface RequiredItem { tier: Tier; item: Item; }
export interface Inventory { accepted_head: string; later_commits: Item[]; required: RequiredItem[]; context: { media: string[]; commands: string[]; links: LinkContext; journeys: string[]; commits: string[]; dismissed: string[] }; }
export interface InventoryInput { exec: Exec; dir: string; changeFolder: string; }
export const emptyRanking = (): Ranking => ({ red: [], orange: [], yellow: [], evidence: '' });
export function humanChecks(folder: string) {
  const plan = readText(join(folder, 'test-plan.md'));
  const section = /^## Human-Only Testing[^\S\n]*\n([\s\S]*?)(?=^## (?!#)|(?![\s\S]))/mi.exec(plan)?.[1] ?? '';
  return [...section.matchAll(/^### ((?:HUMAN|HT)-\d+):\s*(.+)$/gm)].map(([, code, title]) => ({ code, title }));
}
function checklistItems(input: InventoryInput): RequiredItem[] {
  const path = `${input.changeFolder}/checklist.md`;
  const text = readText(path);
  const table = tableBlocks(text).find(block => rawCells(block.header).includes('Status'));
  if (!table) throw new Error('checklist with Status column is missing');
  const columns = rawCells(table.header);
  const finalize = readJson<Partial<CiResult>>(join(input.dir, 'ci/latest.json'), {});
  const steps = readJson<Record<string, StepResult>>(join(input.dir, 'step-results.json'), {});
  const checked = steps.finalize?.ok && passedFinalizeChecks(input.exec, finalize);
  return table.rows.filter(row => !isSeparatorRow(row)).flatMap(row => {
    const cells = rawCells(row);
    const cell = (name: string) => cells[columns.indexOf(name)];
    const status = cell('Status');
    if (status === 'verified') return [];
    const failed = status === 'failed';
    const ciEvidence = status === 'not verified' && checked && citesExistingTest(input.exec, cells.join(' '));
    const line = text.split('\n').indexOf(row) + 1;
    return [{ tier: ciEvidence ? 'yellow' as const : 'red' as const, item: {
      type: failed ? 'Failure' : 'Risk', title: cell('Behavior'),
      detail: failed ? 'This failed in acceptance.' : 'Acceptance did not verify this.',
      links: [{ label: 'The checklist row', target: `${path}#L${line}` }], source: [cell('ID')],
    } }];
  });
}

function logTier(kind: string, title: string, specChange: boolean): Tier {
  if (specChange) return 'red';
  if (kind === 'decision' || title.startsWith('PR comment')) return 'yellow';
  return 'orange';
}

function logItem(kind: 'decision' | 'dispute', code: string, title: string, body: string): RequiredItem {
  const decision = kind === 'decision';
  const specChange = !decision && /\bspec-change\b/i.test(body);
  const edit = /^[- ]*(?:Spec edit|Edit): (.+)$/mi.exec(body)?.[1] ?? '';
  return { tier: logTier(kind, title, specChange), item: {
    type: decision ? 'Agent decision' : 'Dispute', specChange, title,
    questions: specChange ? [disputeQuestion(edit)] : undefined,
    detail: decision ? 'An agent decided this on its own. It is still open.' : 'This dispute is still open.',
    links: [{ label: decision ? 'How the agent decided' : 'What was disputed', target: `log:${code}` }], source: [code],
  } };
}

function logItems(folder: string, kind: 'decision' | 'dispute'): RequiredItem[] {
  const text = readText(join(folder, `${kind}-log.md`));
  const pattern = kind === 'decision' ? /^(?:DECIDE|D)-\d+$/ : /^(?:DISPUTE|DP)-\d+$/;
  const blocks = text.matchAll(/^## ([\w-]+): (.*)(?:\n([\s\S]*?))?(?=^## |$(?![\s\S]))/gm);
  return [...blocks].flatMap(([, code, title, body = '']) => {
    if (!pattern.test(code) || /^\s*(?:[-*] )?Settled in review round /mi.test(body)) return [];
    return [logItem(kind, code, title, body)];
  });
}

const failures: Record<string, [string, string]> = {
  acceptance: ['Acceptance did not converge', 'Review what remains untested before merging.'],
  archive: ['The archive did not pass', 'Repair the archive before merging.'],
  finalize: ['Finalize did not pass', 'Resolve the final checks before merging.'],
  retest: ['The retest did not pass', 'Review the behavior the retest could not verify.'],
  'merge-base': ['Merging in the base branch needs a person', 'Merge the current base before proceeding.'],
  'address-feedback': ['Addressing the feedback was blocked', 'Review which feedback still needs action.'],
  'check-response': ['The response to the feedback failed its check', 'Correct the rejected responses.'],
  description: ['The pull request description was not updated', 'Retry updating the pull request description.'],
  'review-media': ['Some acceptance evidence could not be shown', 'Review the remaining evidence for those behaviors.'],
};

function acceptanceFailureLine(result: StepResult, title: string): string {
  const { round } = result;
  if (result.push) return `Acceptance stopped${round ? ` after round ${round}` : ''} because the push failed.`;
  return round ? `${title} after ${round} rounds.` : `${title}.`;
}

function failureLine(step: string, result: StepResult, title: string): string {
  if (step === 'acceptance') return acceptanceFailureLine(result, title);
  if (step === 'finalize') {
    const checks = result.failedChecks?.join(', ');
    if (checks) return `Finalize did not pass. The following checks must pass before merging: ${checks}.`;
  }
  return `${title}.`;
}

export function stepFailures(dir: string, mediaProblems = reviewMedia(dir).problems): Item[] {
  const results = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  const failed = { ok: false, problems: '', remaining: '' };
  if (readText(join(dir, 'acceptance-preparation-status.txt')).trim() === 'ACCEPTANCE_FAILED') results.acceptance ??= failed;
  if (mediaProblems.length > 0) results['review-media'] = failed;
  return Object.entries(failures).flatMap(([step, [title, detail]]) => {
    const result = results[step];
    if (!result || result.ok) return [];
    return [{ type: 'Failure', title, detail, failLine: failureLine(step, result, title),
      links: [], source: [`failure:${step}`], questions: [standardQuestion('Failure')] }];
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
  const revisions = reviewRevisions(input.exec, input.dir, start, 'HEAD');
  const retested = readJson<string[]>(join(input.dir, 'review/retested-commits.json'), []);
  return revisions.filter(sha => !retested.includes(sha)).flatMap(sha => lateCommit(input.exec, sha));
}
function lateCommit(exec: Exec, sha: string): Item[] {
    const parents = commitParents(exec, sha);
    const flags = parents.length > 1 ? ['--remerge-diff'] : [];
    const files = parents.length > 1 ? output(exec, 'git', ['show', ...flags, '--format=', '--name-only', sha]) : output(exec, 'git', ['diff-tree', '--root', '--first-parent', '-m', '--no-commit-id', '--name-only', '-r', sha]);
    if (files === undefined) throw new Error(`could not inspect ${sha}`);
    if (files.split('\n').filter(Boolean).every(file => file.startsWith('openspec/'))) return [];
    const size = output(exec, 'git', ['show', ...flags, '--format=', '--shortstat', sha]) ?? '';
    return [{ type: 'Late commit', title: output(exec, 'git', ['show', '-s', '--format=%s', sha]) || 'Changes after acceptance', detail: `This change landed after acceptance and still needs review.\n${size}\nTests: none named.`, links: [{ label: 'Commit after acceptance', target: `commit:${sha}` }], source: [sha] }];
}
function sharedSources(dir: string, page: PageEntry): Map<string, string[]> {
  const html = readText(join(dir, page.file));
  const block = /<script type="application\/json" id="page-data">([^<]*)<\/script>/.exec(html)?.[1];
  const data = JSON.parse(block ?? '{}') as Ranking;
  const shared = new Map<string, string[]>();
  for (const item of TIERS.flatMap(tier => data[tier] ?? [])) {
    if (!item.questions?.some(question => !question.source)) continue;
    const own = new Set(item.questions?.map(question => question.source).filter(Boolean));
    const sources = item.source.filter(source => !own.has(source));
    for (const source of sources) shared.set(source, sources);
  }
  return shared;
}

type ResponseStatus = { item: string; status: string };

function responseRoundFiles(dir: string) {
  return readdirSync(dir).flatMap(file => {
    const match = /^review-response-round-(\d+)\.json$/.exec(file);
    return match ? [{ file, round: Number(match[1]) }] : [];
  }).sort((a, b) => a.round - b.round);
}

function keepsOpen(status: string): boolean {
  return !['fixed', 'no-change', 'unchanged', 'settled'].includes(status);
}

function mergeStatuses(statuses: Map<string, string>, source: string, status: string) {
  const prior = statuses.get(source);
  if (prior === undefined || !keepsOpen(prior)) statuses.set(source, status);
}

function roundStatuses(entries: ResponseStatus[], shared: Map<string, string[]>) {
  const direct = new Map<string, string>();
  for (const { item, status } of entries) mergeStatuses(direct, item, status);
  const inherited = new Map<string, string>();
  for (const [item, status] of direct) {
    for (const source of shared.get(item) ?? []) mergeStatuses(inherited, source, status);
  }
  return [...inherited, ...direct];
}

export function responseStatuses(dir: string): Map<string, string> {
  const statuses = new Map<string, string>();
  const pages = readPages(dir);
  for (const { round, file } of responseRoundFiles(dir)) {
    const entries = readJson<ResponseStatus[]>(join(dir, file), []);
    const page = pages.find(entry => entry.round === round);
    const shared = page ? sharedSources(dir, page) : new Map<string, string[]>();
    for (const [item, status] of roundStatuses(entries, shared)) statuses.set(item, status);
  }
  return statuses;
}

function dismissedSource(source: string, status: string): boolean {
  if (['no-change', 'unchanged', 'settled'].includes(status)) return true;
  return status === 'fixed' && /^(?:D|DECIDE|DP|DISPUTE)-\d+$/.test(source);
}

export function inventory(input: InventoryInput): Inventory {
  const { exec, dir, changeFolder } = input;
  const head = acceptedHead(input);
  const commits = laterCommits(input, head);
  const statuses = responseStatuses(dir);
  const media = reviewMedia(dir);
  const checklist = checklistItems(input);
  const failedRows = new Set(checklist.filter(row => row.tier === 'red').map(row => row.item.source[0]));
  const dismissed = [...statuses].filter(([id, status]) => !(failedRows.has(id) || id.startsWith('failure:')) && dismissedSource(id, status)).map(([id]) => id);
  const legacy = readText(join(changeFolder, 'test-plan.md')).match(/\bAT-\d+\b/g) ?? [];
  const required = [...checklist, ...logItems(changeFolder, 'decision'), ...logItems(changeFolder, 'dispute'),
    ...commits.map(item => ({ tier: 'orange' as const, item })), ...stepFailures(dir, media.problems).map(item => ({ tier: 'red' as const, item }))];
  const commands = media.commands.map(command => command.file);
  return { accepted_head: head, later_commits: commits.filter(item => !dismissed.includes(item.source[0])),
    required: required.filter(row => !row.item.source.some(source => dismissed.includes(source))),
    context: { dismissed, media: [...media.shots.map(shot => shot.file), ...commands], commands,
      links: { exec, dir, folder: changeFolder, base: '', head: output(exec, 'git', ['rev-parse', 'HEAD']) ?? '', bases: baseRevisions(exec, dir) },
      journeys: [...media.journeys.map(journey => journey.code), ...legacy], commits: commits.map(item => item.source[0]) } };
}
