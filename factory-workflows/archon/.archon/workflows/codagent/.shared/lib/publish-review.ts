import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { output } from './exec.ts';
import { remoteOf } from './forge.ts';
import { type Tools, lookupPr } from './pull-request.ts';
import { failedItems, type Item, type Ranking } from './review-inventory.ts';
import { codeLinks, sourceLink, urlPath } from './review-links.ts';
import { changeSize, journeys, screenshots } from './review-media.ts';
import { description, embeddedJson, type PageEntry, pagesPath, prefix, readPages, sentBlock, updateDescription } from './review-pages.ts';
import { standardQuestion } from './review-questions.ts';
import { readJson, readText, recordStep, type StepResult, writeJson, writeText } from './run-files.ts';

export interface PublishOptions {
  round: number; wait: boolean; run: string; archonUrl: string; reason?: string; stale?: boolean;
}
interface ResponseEntry { item: string; status: string; commit?: string; note: string }

const asset = (name: string) => readFileSync(join(import.meta.dir, name), 'utf8');
const script = () => new Bun.Transpiler({ loader: 'ts' }).transformSync(asset('review-send.ts').replaceAll('export function', 'function').replaceAll('export async function', 'async function'));

export function pageHtml(data: unknown): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review page</title>
<style>${asset('review-page.css')}</style>
<header class="masthead"><div class="inner"><p id="round" class="eyebrow"></p><h1></h1><p id="state" class="state"></p></div></header>
<div class="inner shell"><nav class="rail" aria-label="Contents"><h2>Contents</h2></nav><main></main></div>
<footer class="sendbar"><div class="inner sendbar-inner"><div id="send-status" class="send-status" role="status"></div><div id="send-actions" class="send-actions"></div></div></footer>
<script type="application/json" id="page-data">${embeddedJson(data)}</script>
${sentBlock(null)}
<script>${script()}\n${asset('review-page.js')}</script>
</html>`;
}

function stateLine(failures: Item[], red: number, blocked: string[]): string {
  const state = failures.length > 0? 'Run needs attention.' : 'Run succeeded.';
  const reason = blocked.length > 0? ` Merge is hidden because ${blocked.join(' and ')} did not pass.` : '';
  return `${state}${reason} ${red} red ${red === 1 ? 'item needs' : 'items need'} your call.`;
}

function recap(dir: string, round: number, reason: string) {
  if (round === 1) return [];
  const responses = readJson<ResponseEntry[]>(join(dir, `review-response-round-${round - 1}.json`), []);
  const notes = ['merge-base', 'retest'].flatMap(step => {
    const result = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {})[step];
    return result ? [result.ok ? result.remaining : result.problems] : [];
  });
  return [...responses, ...[reason, ...notes].filter(Boolean).map(note => ({ item: '', status: '', note }))] as ResponseEntry[];
}

export function currentPage(dir: string, reason = '') {
  const page = readPages(dir).at(-1);
  if (!page) throw new Error('No current review page');
  return { page: page.file, message: reason ? `${prefix(page.round)} ${reason}` : page.message };
}

export interface PackageSource { dir: string; folder: string; ranking: Ranking }

export function publishPackage(tools: Tools, source: PackageSource, options: PublishOptions = { round: 1, wait: false, run: '', archonUrl: '' }) {
  const { dir, folder, ranking } = source;
  if (options.stale) return { ...currentPage(dir, options.reason), succeeded: false };
  const found = lookupPr(tools);
  if (!found.ok) throw new Error(found.problem);
  const { repo, view } = found.value;
  if (!view) throw new Error('no open pull request for review package');
  const head = output(tools.exec, 'git', ['rev-parse', 'HEAD']) ?? '';
  const base = `https://${repo.host}/${repo.path}`;
  const links = { base, head, dir, folder, exec: tools.exec };
  const blocked = blockedSteps(dir);
  const failures = failedItems(dir);
  const entries = readPages(dir).filter(entry => entry.round < options.round);
  const newPage: PageEntry = { round: options.round, file: `review-page-round-${options.round}.html`, head,
    message: `${prefix(options.round)} Review the page and answer with feedback or merge.`,
    state: stateLine(failures, failures.length + ranking.red.length, blocked),
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
function renderPage(source: PackageSource, links: Parameters<typeof sourceLink>[1], newPage: PageEntry,
  options: PublishOptions & { title: string; base: string; mergeAllowed: boolean }) {
  const { dir, folder, ranking } = source;
  const { head, exec } = links;
  const shots = screenshots(dir).map(shot => ({ ...shot, href: urlPath(shot.file) }));
  const picks = (ranking.keyEvidence ?? []).flatMap(pick => {
    const shot = shots.find(candidate => candidate.file === pick.file);
    return shot ? [{ ...shot, ...pick }] : [];
  });
  const stepItems = failedItems(dir);
  const alreadyRanked = new Set(ranking.red.flatMap(item => item.source));
  const red = [...stepItems.filter(item => !alreadyRanked.has(item.source[0])), ...ranking.red];
  const visible = (items: Item[]) => items.map(item => ({ ...item, href: sourceLink(item.link, links),
    questions: item.questions?.length ? item.questions : [standardQuestion(item.type)] }));
  const orange = [...ranking.orange].sort((a, b) => Number(b.type.includes('Late commit')) - Number(a.type.includes('Late commit')));
  newPage.state = stateLine(stepItems, red.length, blockedSteps(dir));
  const remote = remoteOf(exec);
  const size = changeSize(exec, `${remote.ok ? remote.value.name : 'origin'}/${options.base}`);
  const codes = codeLinks(links, [...red, ...orange, ...ranking.yellow]);
  const changes = recap(dir, options.round, options.reason ?? '').map(entry => ({
    note: entry.note, label: entry.commit || entry.item,
    href: entry.commit ? sourceLink(entry.commit, links) : codes[entry.item]?.href,
  }));
  const html = pageHtml({ title: options.title, round: options.round, head, run: options.run, state: newPage.state,
    acceptedHead: readText(join(dir, 'review/accepted-head.txt')).trim(), wait: options.wait, merge: options.mergeAllowed,
    summary: readText(join(dir, 'pr-body.md')), recap: changes, size, screenshots: shots, keyEvidence: picks, codes,
    red: visible(red), orange: visible(orange), yellow: visible(ranking.yellow),
    decisions: readText(join(folder, 'decision-log.md')), disputes: readText(join(folder, 'dispute-log.md')) });
  const chosen = orange.flatMap(item => (item.journeys ?? []).map(journey => ({
    ...journey, sources: item.source, coveredCommits: item.source.filter(code => /^[a-f0-9]{40,64}$/.test(code)),
  })));
  const known = journeys(dir);
  writeJson(join(dir, 'review', `journeys-round-${options.round}.json`),
    chosen.map(item => ({ ...known.find(journey => journey.code === item.code), ...item })));
  return { html, succeeded: stepItems.length === 0 };
}
