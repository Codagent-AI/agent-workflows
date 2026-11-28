import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { output, sleep as pause } from './exec.ts';
import { remoteOf } from './forge.ts';
import { type Tools, lookupPr } from './pull-request.ts';
import { branchCommits, restingSources, stepFailures, type Item, type Ranking } from './review-inventory.ts';
import { forgeBase, type LinkContext, logUrl, resolveTarget, urlPath } from './review-links.ts';
import { changeSize, journeys, reviewMedia } from './review-media.ts';
import { description, embeddedJson, type PageEntry, pagesPath, prefix, publishedItems, readPages, sentBlock, updateDescription } from './review-pages.ts';
import { standardQuestion } from './review-questions.ts';
import { readState } from './review-files.ts';
import { answersPath, type Choice } from './review-round.ts';
import { roundReview } from './review.ts';
import { readJson, readText, recordStep, type StepResult, writeJson, writeText } from './run-files.ts';

export interface PublishOptions {
  round: number; wait: boolean; run: string; archonUrl: string; reason?: string; stale?: boolean;
}
interface ResponseEntry { item: string; status: string; commit?: string; note: string; label?: string; href?: string }

const asset = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');
const script = () => new Bun.Transpiler({ loader: 'ts' }).transformSync(asset('review-send.ts').replaceAll('export function', 'function').replaceAll('export async function', 'async function'));

export function pageHtml(data: unknown): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review page</title>
<style>${asset('review-page.css')}</style>
<header class="masthead"><div class="inner"><div id="round" class="eyebrow"></div><h1></h1><div class="meta-row"><dl class="meta"></dl></div></div></header>
<div class="inner shell"><nav class="rail" aria-label="Contents"><h2>Contents</h2><ol></ol></nav><main></main></div>
<footer class="sendbar"><div class="inner sendbar-inner"><div id="send-status" class="send-status" role="status"></div><div id="send-actions" class="send-actions"></div></div></footer>
<script type="application/json" id="page-data">${embeddedJson(data)}</script>
${sentBlock(null)}
<script>${script()}\n${asset('review-page.js')}</script>
</html>`;
}

export function stateLine(failures: Item[], red: number, blocked: string[]): string {
  const state = failures.length > 0? 'Run needs attention.' : 'Run succeeded.';
  const reason = blocked.length > 0? ` Merge is hidden because ${blocked.join(' and ')} did not pass.` : '';
  return `${state}${reason} ${red} red ${red === 1 ? 'item needs' : 'items need'} your call.`;
}

/** Step failures still on the page: not those answered with no work that have not changed since. */
function openFailures(dir: string, failures: Item[]): Item[] {
  const resting = restingSources(dir, failures);
  return failures.filter(item => !resting.has(item.source[0]));
}

// What happened since the last page: the work its answers got, the issues filed for them, the round's
// other commits, what its code reviews found, its merge and its retest. Answers that needed nothing done are left out.
function recap(links: LinkContext, round: number, reason: string): ResponseEntry[] {
  if (round === 1) return [];
  const { dir, exec } = links;
  const done = readJson<ResponseEntry[]>(join(dir, `review-response-round-${round - 1}.json`), []).filter(entry => entry.status === 'fixed');
  const page = readPages(dir).find(entry => entry.round === round - 1);
  const items = page ? publishedItems(dir, page) : [];
  const answers = readJson<{ answers?: Choice[] }>(answersPath(dir, round - 1), {}).answers ?? [];
  const issues = answers.flatMap(choice => choice.issue ? [{ item: choice.item, status: '', note: 'Filed a follow-up issue:',
    label: items.find(item => item.source.includes(choice.item))?.title || choice.issue, href: choice.issue }] : []);
  const named = done.flatMap(entry => entry.commit ? [entry.commit] : []);
  const commits = page ? branchCommits({ exec, dir, changeFolder: links.folder }, page.head)
    .filter(item => !named.some(sha => item.source[0].startsWith(sha))) : [];
  const steps = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  const results = [steps['merge-base'], steps.retest?.round === round ? steps.retest : undefined];
  const notes = results.flatMap(result => result?.ok ? [result.remaining] : []);
  return [...done, ...issues, ...commits.map(item => ({ item: '', status: '', note: 'Committed', commit: item.source[0] })),
    ...[...roundReview(readState(dir), round), reason, ...notes].filter(Boolean).map(note => ({ item: '', status: '', note }))];
}

export function currentPage(dir: string, reason = '') {
  const page = readPages(dir).at(-1);
  if (!page) throw new Error('No current review page');
  return { page: page.file, message: reason ? `${prefix(page.round)} ${reason}` : page.message };
}

export interface PackageSource { dir: string; folder: string; ranking: Ranking }

function matchedHead(tools: Tools, head: string, sleep: typeof pause) {
  for (let attempt = 0; ; attempt++) {
    const found = lookupPr(tools);
    if (!found.ok) throw new Error(found.problem);
    const { repo, view } = found.value;
    if (!view) throw new Error('no open pull request for review package');
    if (head && view.pr.head_revision === head) return { repo, view };
    if (attempt === 10) throw new Error(`The pull request's head on GitHub is ${view.pr.head_revision}, not the local head ${head}. Push the branch, then resume the run.`);
    sleep(3000);
  }
}

function redConcerns(ranking: Ranking, failures: Item[]): Item[] {
  const red = ranking.red.map(item => {
    const lines = failures.filter(failure => item.source.includes(failure.source[0])).map(failure => failure.failLine);
    return lines.length > 0? { ...item, failLine: lines.join(' ') } : item;
  });
  const missing = failures.filter(failure => !red.some(item => item.source.includes(failure.source[0])));
  return [...missing, ...red];
}

export function publishPackage(tools: Tools, source: PackageSource,
  options: PublishOptions = { round: 1, wait: false, run: '', archonUrl: '' }, sleep = pause) {
  const { dir, folder, ranking } = source;
  if (options.stale) return { ...currentPage(dir, options.reason), succeeded: false };
  const head = output(tools.exec, 'git', ['rev-parse', 'HEAD']) ?? '';
  const { repo, view } = matchedHead(tools, head, sleep);
  const links = { base: forgeBase(repo), head, dir, folder, exec: tools.exec };
  const blocked = blockedSteps(dir);
  const failures = stepFailures(dir);
  const redCount = redConcerns(ranking, openFailures(dir, failures)).length;
  const entries = readPages(dir).filter(entry => entry.round < options.round);
  const newPage: PageEntry = { round: options.round, file: `review-page-round-${options.round}.html`, head,
    message: `${prefix(options.round)} Review the page and answer with feedback or merge.`,
    state: stateLine(failures, redCount, blocked),
    status: 'current', time: new Date().toISOString(), run: options.run, archonUrl: options.archonUrl,
    ref: { repo, number: view.pr.number } };
  entries.push(newPage);
  try {
    updateDescription(tools, view, description(dir, entries));
  } catch (error) {
    if (options.round === 1) throw error;
    recordStep(dir, 'description', { ok: false, problems: String(error), remaining: 'Retry publishing the pull request description.' });
  }
  const rendered = renderPage(source, links, newPage, { ...options, mergeAllowed: blocked.length === 0, base: view.pr.base, title: view.title });
  const html = rendered.html;
  writeText(join(dir, newPage.file), html);
  writeText(join(dir, 'review-page.html'), html);
  writeJson(pagesPath(dir), entries);
  writeText(join(dir, 'review-package.md'), description(dir, entries));
  writeJson(join(dir, 'review-attention.json'), ranking);
  return { succeeded: rendered.succeeded, page: newPage.file, message: newPage.message };
}

function blockedSteps(dir: string) {
  const steps = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  return ['archive', 'finalize'].filter(step => !steps[step]?.ok);
}
function acceptanceRecaps(media: ReturnType<typeof reviewMedia>) {
  const rounds = new Map<number, { journeys: string[]; evidence: string[] }>();
  const add = (round: number, type: 'journeys' | 'evidence', text: string) => {
    const found = rounds.get(round) ?? { journeys: [], evidence: [] };
    found[type].push(text);
    rounds.set(round, found);
  };
  for (const entry of [...media.shots, ...media.commands]) add(entry.round, 'evidence', entry.shows);
  for (const journey of media.journeys) {
    const round = /round-(\d+)\.json$/.exec(journey.artifact)?.[1];
    if (round !== undefined) add(Number(round), 'journeys', journey.title);
  }
  return Object.fromEntries([...rounds].map(([round, detail]) => {
    const text = detail.journeys.length > 0 ? `Exercised ${detail.journeys.join(', ')}.` : detail.evidence[0];
    return [round, text];
  }));
}

function renderPage(source: PackageSource, links: LinkContext, newPage: PageEntry,
  options: PublishOptions & { title: string; base: string; mergeAllowed: boolean }) {
  const { dir, ranking } = source;
  const { head, exec } = links;
  const media = reviewMedia(dir);
  const screenshots = media.shots.map(shot => ({ ...shot, href: urlPath(shot.file), kind: 'screenshot' }));
  const commands = media.commands.map(command => ({ ...command, kind: 'command' }));
  const picks = (ranking.keyEvidence ?? []).slice(0, 5).flatMap(pick => {
    const entry = [...screenshots, ...commands].find(candidate => candidate.file === pick.file);
    return entry ? [{ ...entry, ...pick }] : [];
  });
  const failures = stepFailures(dir, media.problems);
  const red = redConcerns(ranking, openFailures(dir, failures));
  const orange = [...ranking.orange].sort((a, b) => Number(b.type.includes('Late commit')) - Number(a.type.includes('Late commit')));
  const yellow = ranking.yellow;
  const visible = (items: Item[]) => items.map(item => ({
    ...item, links: item.links.flatMap(({ target, label }) => {
      const resolved = resolveTarget(target, links);
      return 'href' in resolved ? [{ label, href: resolved.href }] : [];
    }),
    evidence: commands.find(command => command.file === item.evidence),
    questions: item.questions?.length ? item.questions : [standardQuestion(item.type)],
  }));
  newPage.state = stateLine(failures, red.length, blockedSteps(dir));
  const remote = remoteOf(exec);
  const size = changeSize(exec, `${remote.ok ? remote.value.name : 'origin'}/${options.base}`);
  const html = pageHtml({ title: options.title, repository: newPage.ref.repo.path, pullRequest: newPage.ref.number,
    pullRequestUrl: `${links.base}/pull/${newPage.ref.number}`, forgeBase: links.base,
    round: options.round, head, run: options.run,
    logs: { decisions: logUrl(links, 'decision'), disputes: logUrl(links, 'dispute') },
    acceptedHead: readText(join(dir, 'review/accepted-head.txt')).trim(), wait: options.wait, merge: options.mergeAllowed,
    summary: readText(join(dir, 'pr-body.md')), recap: recapLinks(links, options), size, screenshots, commands, keyEvidence: picks, acceptanceRecaps: acceptanceRecaps(media),
    red: visible(red), orange: visible(orange), yellow: visible(yellow) });
  saveJourneys(dir, options.round, [...red, ...orange, ...yellow]);
  return { html, succeeded: failures.length === 0 };
}

function saveJourneys(dir: string, round: number, items: Item[]): void {
  const chosen = items.flatMap(item => (item.journeys ?? []).map(journey => ({
    ...journey, sources: item.source, coveredCommits: item.source.filter(code => /^[a-f0-9]{40,64}$/.test(code)),
  })));
  const known = journeys(dir);
  writeJson(join(dir, 'review', `journeys-round-${round}.json`),
    chosen.map(item => ({ ...known.find(journey => journey.code === item.code), ...item })));
}

function recapLinks(links: LinkContext, options: PublishOptions) {
  return recap(links, options.round, options.reason ?? '').map(entry => {
    if (entry.href) return { note: entry.note, label: entry.label, href: entry.href };
    const resolved = entry.commit ? resolveTarget(`commit:${entry.commit}`, links) : undefined;
    if (!(resolved && ('href' in resolved))) return { note: entry.note };
    const subject = output(links.exec, 'git', ['show', '-s', '--format=%s', entry.commit ?? '']) || 'Review fix';
    return { note: entry.note, label: subject, href: resolved.href };
  });
}
