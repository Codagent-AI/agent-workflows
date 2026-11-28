import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { retainedChangeFolder } from './archive.ts';
import { fail } from './check.ts';
import { OPS, type PrView } from './forge.ts';
import type { Tools } from './pull-request.ts';
import { description, type PageEntry, type PageItem, pagesPath, publishedItems, readPages, sentBlock, sharedSources, updateDescription, viewNumber } from './review-pages.ts';
import { asksNoWork, followUp } from './review-questions.ts';
import { readJson, readText, recordStep, type StepResult, writeJson, writeText } from './run-files.ts';

export interface Choice {
  item: string;
  question: number;
  option: string;
  label?: string;
  detail?: string;
  other?: string;
  note?: string;
  /** The follow-up issue the workflow filed for this choice. */
  issue?: string;
}

export interface ReviewAnswer {
  action: 'merge' | 'feedback';
  round: number;
  head: string;
  answers?: Choice[];
  screenshotComments?: { file: string; round: number; comment: string }[];
  commandComments?: { ref: string; round: number; comment: string }[];
  note?: string;
}

interface SavedAnswer extends ReviewAnswer {
  time: string;
}

interface RoundInput {
  dir: string;
  folder: string;
  text: string;
}

type Mode = 'first' | 'feedback' | 'refused' | 'stale' | 'merged' | 'closed';

export const outcomesPath = (dir: string) => join(dir, 'review/outcome.json');
export const answersPath = (dir: string, round: number) => join(dir, `review-answers-round-${round}.json`);
export const responsePath = (dir: string, round: number) => join(dir, `review-response-round-${round}.json`);
export const roundFailures = ['merge-base', 'follow-up', 'address-feedback', 'check-response', 'description', 'logs'];

function pageAnswer(text: string): Partial<ReviewAnswer> | undefined {
  try {
    const value = JSON.parse(text) as Partial<ReviewAnswer> | null;
    return value && ['action', 'round', 'head'].some(key => Object.hasOwn(value, key)) ? value : undefined;
  } catch {
    return undefined;
  }
}

function plainAnswer(text: string, current: { round: number; head: string }): ReviewAnswer | undefined {
  const trimmed = text.trim();
  if (/^\{\s*"(?:action|round|head)"\s*:/.test(trimmed)) return undefined;
  if (trimmed.toLowerCase() === 'merge') return { ...current, action: 'merge' };
  return { ...current, action: 'feedback', note: text };
}

export function parseAnswer(text: string, page: PageEntry): ReviewAnswer | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const current = { round: page.round, head: page.head };
  const answer = pageAnswer(trimmed);
  if (!answer) return plainAnswer(text, current);
  if (answer.round !== current.round || answer.head !== current.head) return undefined;
  if (answer.action === 'merge') return { ...current, action: 'merge' };
  if (answer.action === 'feedback' && Array.isArray(answer.answers) && Array.isArray(answer.screenshotComments)) {
    const commandComments = Array.isArray(answer.commandComments) ? answer.commandComments.filter(Boolean) : undefined;
    return { ...current, action: 'feedback', answers: answer.answers.filter(Boolean),
      screenshotComments: answer.screenshotComments.filter(Boolean), ...(commandComments && { commandComments }) };
  }
  return undefined;
}

function results(dir: string) {
  return readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
}

interface RetestJourney {
  code: string;
  title: string;
  commit: string;
  sources: string[];
  coveredCommits: string[];
}
export function selectedJourneys(dir: string, answeredRound: number): RetestJourney[] {
  const saved = readJson<SavedAnswer | null>(answersPath(dir, answeredRound), null);
  const selected = new Set(saved?.answers?.filter(choice => choice.option === 'retest').map(choice => choice.item));
  if (selected.size === 0) return [];
  const path = join(dir, 'review', `journeys-round-${answeredRound}.json`);
  return readJson<RetestJourney[]>(path, []).filter(entry => entry.sources.some(code => selected.has(code)));
}
function roundOutput(input: RoundInput, round: number, mode: Mode, reason = '') {
  const archived = results(input.dir).archive?.ok === true;
  const work = mode === 'feedback' || mode === 'refused';
  const answers = round > 1 && work ? answersPath(input.dir, round - 1) : '';
  const journeys = mode === 'feedback' ? selectedJourneys(input.dir, round - 1) : [];
  const changeFolder = retainedChangeFolder(input.folder);
  return { round, mode, reason, work, publish: mode === 'first' || work, change_folder: changeFolder,
    archive_needed: !archived, review_head: readPages(input.dir).at(-1)?.head ?? '',
    retest: journeys.length > 0, journeys: JSON.stringify(journeys), answers_file: answers };
}

function recordAnswer(dir: string, page: PageEntry, answer: SavedAnswer): void {
  writeJson(answersPath(dir, page.round), answer);
  const file = join(dir, page.file);
  const html = readText(file);
  const block = /<script type="application\/json" id="sent-answers">[^<]*<\/script>/;
  if (!block.test(html)) throw new Error(`Missing sent-answer block in ${page.file}`);
  const rendered = html.replace(block, () => sentBlock(answer));
  const latest = join(dir, 'review-page.html');
  const current = readText(latest);
  if (current === html || current === rendered) writeText(latest, rendered);
  writeText(file, rendered);
}

function clearRound(dir: string, round: number): void {
  const history = join(dir, 'review', `round-${round}`);
  const marker = join(history, 'snapshot.json');
  const snapshotted = existsSync(marker);
  for (const name of ['step-results.json', 'finalize-results.json', 'ci/latest.json', 'ci/latest-report.txt']) {
    const source = join(dir, name);
    const target = join(history, name);
    if (!snapshotted && existsSync(source) && !existsSync(target)) {
      mkdirSync(join(target, '..'), { recursive: true });
      copyFileSync(source, target);
    }
    if (name !== 'step-results.json') rmSync(source, { force: true });
  }
  const remaining = results(dir);
  for (const step of [...roundFailures, 'finalize']) delete remaining[step];
  writeJson(join(dir, 'step-results.json'), remaining);
  rmSync(join(dir, 'review-attention.json'), { force: true });
  if (!snapshotted) writeJson(marker, { round });
}

const logFiles: [RegExp, string][] = [[/^(?:DISPUTE|DP)-\d+$/, 'dispute-log.md'], [/^(?:DECIDE|D)-\d+$/, 'decision-log.md']];

// The decision or dispute log entry for a source code, if it has one.
function logEntry(folder: string, code: string): string {
  const file = logFiles.find(([pattern]) => pattern.test(code))?.[1];
  const blocks = file ? readText(join(folder, file)).split(/^(?=## )/m) : [];
  return blocks.find(block => block.startsWith(`## ${code}:`))?.trim() ?? '';
}

function followUpIssue(input: RoundInput, page: PageEntry, choice: Choice, item?: PageItem) {
  const pr = `${page.ref.repo.path}#${page.ref.number}`;
  const marker = `<!-- codagent follow-up: ${pr} ${choice.item} -->`;
  const parts = [`Left for later in review round ${page.round} of ${pr}.`, item?.detail, logEntry(retainedChangeFolder(input.folder), choice.item), choice.note];
  return { repo: page.ref.repo, title: item?.title || choice.item, body: [marker, ...parts.filter(Boolean)].join('\n\n'), marker };
}

// Each follow-up answer files an issue for its item. The marker lets a resumed round find the issue it filed instead of filing another.
function filePageFollowUps(tools: Tools, input: RoundInput, page: PageEntry): string[] {
  const file = answersPath(input.dir, page.round);
  const saved = readJson<SavedAnswer | null>(file, null);
  if (!saved?.answers?.some(choice => choice.option === followUp.id && !choice.issue)) return [];
  const items = publishedItems(input.dir, page);
  const problems: string[] = [];
  const answers = saved.answers.map(choice => {
    if (choice.option !== followUp.id || choice.issue) return choice;
    const request = followUpIssue(input, page, choice, items.find(item => item.source.includes(choice.item)));
    const filed = tools.forge.call<{ workitem: { url: string } }>(OPS.createIssue, request);
    if (filed.ok) return { ...choice, issue: filed.value.workitem.url };
    problems.push(`${choice.item}: ${filed.problem}`);
    return choice;
  });
  writeJson(file, { ...saved, answers });
  return problems;
}

/** Whether a page after this round answered the follow-up failure without asking for work, leaving its missing issues to the person. */
function followUpsLeft(dir: string, pages: PageEntry[], round: number): boolean {
  return pages.some(page => page.round > round && (readJson<SavedAnswer | null>(answersPath(dir, page.round), null)?.answers ?? []).some(choice =>
    (sharedSources(dir, page).get(choice.item) ?? [choice.item]).includes('failure:follow-up') && asksNoWork([choice])));
}

// A follow-up that could not be filed is tried again each round, until it is filed or the person takes it on, so its failure stays on the page.
function fileFollowUps(tools: Tools, input: RoundInput, page: PageEntry): void {
  const pages = readPages(input.dir).filter(entry => entry.round <= page.round);
  const pending = pages.filter(entry => entry.round === page.round || !followUpsLeft(input.dir, pages, entry.round));
  const problems = pending.flatMap(entry => filePageFollowUps(tools, input, entry));
  if (problems.length > 0) recordStep(input.dir, 'follow-up', { ...fail(problems.join('\n')), remaining: 'File the missing follow-up issues by hand.' });
}

function begin(tools: Tools, input: RoundInput, page: PageEntry): ReturnType<typeof roundOutput> {
  clearRound(input.dir, page.round);
  fileFollowUps(tools, input, page);
  const refused = page.status === 'Merge refused';
  return roundOutput(input, page.round + 1, refused ? 'refused' : 'feedback', page.reason);
}

function finish(input: RoundInput, page: PageEntry, mode: 'merged' | 'closed', reason = '') {
  writeJson(outcomesPath(input.dir), { mode, reason });
  return roundOutput(input, page.round, mode, reason);
}

function readPr(tools: Tools, page: PageEntry): PrView {
  const read = viewNumber(tools, page.ref);
  if (!read.ok) throw new Error(read.problem);
  if (!read.value) throw new Error(`Pull request #${page.ref.number} could not be read`);
  return read.value;
}

function merged(tools: Tools, input: RoundInput, pages: PageEntry[], page: PageEntry) {
  page.status = 'merged';
  writeJson(pagesPath(input.dir), pages);
  const outcome = finish(input, page, 'merged');
  try {
    updateDescription(tools, readPr(tools, page), description(input.dir, pages));
  } catch (error) {
    writeText(join(input.dir, 'review/merge-description-error.txt'), String(error));
  }
  return outcome;
}

function handleRefusal(tools: Tools, input: RoundInput, pages: PageEntry[], reply: { reason: string; time: string }) {
  const page = pages.at(-1) as PageEntry;
  const { reason, time } = reply;
  const checked = viewNumber(tools, page.ref);
  const observed = checked.ok ? checked.value?.pr : undefined;
  if (observed?.state === 'merged') return merged(tools, input, pages, page);
  if (observed?.state === 'closed') return finish(input, page, 'closed', `Pull request #${page.ref.number} was closed.`);
  page.status = 'Merge refused';
  page.refusals = [...(page.refusals ?? []), reason];
  page.reason = reason;
  page.time = time;
  page.refresh = needsRefresh(tools, page, observed?.head_revision);
  writeJson(pagesPath(input.dir), pages);
  if (page.refresh) return begin(tools, input, page);
  return roundOutput(input, page.round, 'stale', reason);
}

function needsRefresh(tools: Tools, page: PageEntry, head?: string | null): boolean {
  if (head && head !== page.head) return true;
  const reason = page.reason ?? '';
  if (/refused:.*(?:head moved|head changed|merge conflict|not mergeable)/i.test(reason)) return true;
  if (!/refused:.*(?:HTTP (?:405|409)|GitHub declined)/i.test(reason)) return false;
  const state = tools.forge.call<{ mergeable: string }>(OPS.mergeState, { ref: page.ref });
  return state.ok && state.value.mergeable === 'conflict';
}

function mergeAnswer(tools: Tools, input: RoundInput, pages: PageEntry[], request: { answer: SavedAnswer; retry: boolean }) {
  const { answer, retry } = request;
  const page = pages.at(-1) as PageEntry;
  const step = results(input.dir);
  const blocking = ['archive', 'finalize'].find(name => !step[name]?.ok);
  if (blocking) return roundOutput(input, page.round, 'stale', `${blocking} did not pass. ${step[blocking]?.problems ?? ''}`);
  if (!retry) recordAnswer(input.dir, page, answer);
  const attempt = retry ? { ok: false as const, problem: 'The saved merge did not apply.' }
    : tools.forge.call(OPS.merge, { ref: page.ref, method: 'merge', conditions: { head: page.head } });
  if (attempt.ok) return merged(tools, input, pages, page);
  return handleRefusal(tools, input, pages, { reason: attempt.problem, time: answer.time });
}

function resumePending(page: PageEntry, saved: SavedAnswer | null): boolean {
  return Boolean(saved && (page.status === 'feedback sent' || page.refresh));
}

export function startRound(tools: Tools, input: RoundInput) {
  const pages = readPages(input.dir);
  const page = pages.at(-1);
  if (!page) return roundOutput(input, 1, 'first');
  const saved = readJson<SavedAnswer | null>(answersPath(input.dir, page.round), null);
  if (resumePending(page, saved)) return begin(tools, input, page);
  const answer = parseAnswer(input.text, page);
  if (!answer && (!saved || page.status !== 'current')) return roundOutput(input, page.round, 'stale', page.reason);
  const view = readPr(tools, page);
  if (view.pr.state === 'merged') return saved?.action === 'merge' ? merged(tools, input, pages, page) : finish(input, page, 'merged');
  if (view.pr.state === 'closed') return finish(input, page, 'closed', `Pull request #${view.pr.number} was closed.`);
  return applyAnswer(tools, input, pages, { answer, saved });
}

function applyAnswer(tools: Tools, input: RoundInput, pages: PageEntry[], chosen: { answer?: ReviewAnswer; saved: SavedAnswer | null }) {
  const page = pages.at(-1) as PageEntry;
  const { answer, saved } = chosen;
  const response = saved && !answer ? saved : { ...answer as ReviewAnswer, time: new Date().toISOString() };
  if (response.action === 'merge') return mergeAnswer(tools, input, pages, { answer: response, retry: !answer });
  recordAnswer(input.dir, page, response);
  page.status = 'feedback sent';
  if (page.reason && !page.refusals) page.refusals = [page.reason];
  delete page.reason;
  delete page.refresh;
  page.time = response.time;
  writeJson(pagesPath(input.dir), pages);
  return begin(tools, input, page);
}
