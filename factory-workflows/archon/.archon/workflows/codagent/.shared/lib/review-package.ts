// Validate the agent's ranking, place required items if needed, and publish the generated block.
import { join } from 'node:path';
import { type CheckResult, fail, pass } from './check.ts';
import { OPS } from './forge.ts';
import { type Tools, lookupPr, markBlock, spliceBody } from './pull-request.ts';
import { type Exec, output } from './exec.ts';
import { readText, writeText, writeJson } from './run-files.ts';
import { TIERS, type Ranking, type RequiredItem, type Item, type Tier, failedItems } from './review-inventory.ts';
const TYPES = new Set(['Verification', 'Decision', 'Dispute', 'Late commit', 'Human check']);
export function validItem(item: Item): boolean {
  return typeof item?.type === 'string' && item.type.split(',').every(type => TYPES.has(type.trim())) &&
    typeof item.title === 'string' && item.title.trim() !== '' && typeof item.detail === 'string' && item.detail.trim() !== '' &&
    typeof item.link === 'string' && Array.isArray(item.source) && item.source.length > 0 && item.source.every(source => typeof source === 'string');
}
function entries(ranking: Ranking): { tier: Tier; item: Item }[] {
  return TIERS.flatMap(tier => (Array.isArray(ranking[tier]) ? ranking[tier] : []).map(item => ({ tier, item })));
}
function requiredItemProblems(expected: RequiredItem, item: Item): string[] {
    if (!item.type.split(',').map(type => type.trim()).includes(expected.item.type)) return [`wrong type for ${expected.item.source.join(', ')}`];
    if (expected.item.type !== 'Late commit') return [];
    // As Factory's verify-classification.py: the item names the commit by SHA and gives a size in
    // `git diff --shortstat` wording, not one exact count, since the ranker sizes the commits
    // without openspec/ and a commit may touch both.
    const named = `${item.title} ${item.detail}`.includes(expected.item.title.slice(0, 7));
    return named && /\b\d+ files? changed\b/.test(item.detail) && /(?:^|\n|[.!?]\s+)Tests:\s*\S/.test(item.detail) ? [] : [`late commit ${expected.item.title} needs shortstat and Tests:`];
}
function requiredProblems(ranking: Ranking, required: RequiredItem[]): string[] {
  const all = entries(ranking);
  return required.flatMap(expected => {
    // Failures are inserted by the publisher, never entrusted to the ranker.
    if (expected.item.type === 'Failure') return [];
    const found = all.find(({ item }) => expected.item.source.every(source => item.source?.includes(source)));
    if (!found || TIERS.indexOf(found.tier) > TIERS.indexOf(expected.tier)) return [`missing or under-ranked ${expected.item.source.join(', ')}`];
    return requiredItemProblems(expected, found.item);
  });
}
export function checkRanking(ranking: Ranking, required: RequiredItem[]): CheckResult {
  if (!ranking || typeof ranking.evidence !== 'string' || !TIERS.every(tier => Array.isArray(ranking[tier]))) return fail('ranking shape is invalid');
  const problems: string[] = []; const titles = new Set<string>();
  for (const { item } of entries(ranking)) {
    if (!validItem(item)) { problems.push('empty item or unknown type'); continue; }
    if (titles.has(item.title)) problems.push(`item appears in two tiers: ${item.title}`);
    titles.add(item.title);
  }
  if (problems.length > 0) return fail(problems);
  problems.push(...requiredProblems(ranking, required));
  return problems.length > 0 ? fail(problems) : pass();
}
function insertRequired(placed: Ranking, expected: RequiredItem): void {
    const found = entries(placed).find(({ item }) => expected.item.source.every(source => item.source.includes(source)));
    if (!found) { placed[expected.tier].push({ ...expected.item, source: [...expected.item.source] }); return; }
    const tier = TIERS[Math.min(TIERS.indexOf(found.tier), TIERS.indexOf(expected.tier))];
    placed[found.tier] = placed[found.tier].filter(item => item !== found.item);
    const type = [...new Set([...found.item.type.split(',').map(value => value.trim()), expected.item.type])].join(', ');
    const lacksSize = expected.item.type === 'Late commit' && requiredItemProblems(expected, found.item).length > 0;
    const detail = lacksSize ? `${found.item.detail}\n\nLate commit ${expected.item.title}:\n${expected.item.detail}` : found.item.detail;
    placed[tier].push({ ...found.item, type, detail });
}
export function placeRanking(ranking: Ranking, required: RequiredItem[]): Ranking {
  const placed: Ranking = { red: [], orange: [], yellow: [], white: [], evidence: ranking?.evidence || 'No testing summary was supplied.' };
  const titles = new Set<string>();
  for (const { tier, item } of entries(ranking)) {
    if (validItem(item) && !titles.has(item.title)) { placed[tier].push(item); titles.add(item.title); }
  }
  for (const expected of required.filter(row => row.item.type !== 'Failure')) {
    insertRequired(placed, expected);
  }
  const checked = checkRanking(placed, required);
  if (!checked.ok) throw new Error(`deterministic ranking failed: ${checked.problems}`);
  return placed;
}
function itemLink(item: Item, base: string, head: string): string {
  if (/^https?:\/\//.test(item.link)) return `[${item.title}](${item.link})`;
  if (/^[a-f0-9]{40,64}$/.test(item.link)) return `[${item.title}](${base}/commit/${item.link})`;
  const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(item.link);
  if (match && !match[1].startsWith('/')) return `[${item.title}](${base}/blob/${head}/${match[1]}#L${match[2]}${match[3] ? `-L${match[3]}` : ''})`;
  return item.link ? `${item.title} (${item.link})` : item.title;
}
function renderItem(item: Item, base: string, head: string): string {
  return `- **${item.type}:** ${itemLink(item, base, head)}\n  ${item.detail.replaceAll('\n', '\n  ')}`;
}
const collapse = (title: string, body: string): string => `<details>\n<summary>${title}</summary>\n\n${body || 'None.'}\n\n</details>`;
export function renderPackage(input: { ranking: Ranking; failures: Item[]; summary: string; decisions: string; disputes: string; base: string; head: string }): string {
  const { ranking, failures, base, head } = input;
  const orange = [...ranking.orange].sort((a, b) => Number(b.type.includes('Late commit')) - Number(a.type.includes('Late commit')));
  const show = (items: Item[]): string => items.map(item => renderItem(item, base, head)).join('\n');
  const red = [...failures, ...ranking.red.filter(item => item.type !== 'Failure')];
  return ['## Review first', `Run ${failures.length > 0 ? 'needs attention' : 'succeeded'}.`, show(red), show(orange.slice(0, 5)),
    `${Math.max(0, orange.length - 5)} orange and ${ranking.yellow.length} yellow items collapsed below.`, input.summary,
    collapse('Other review items', show([...orange.slice(5), ...ranking.yellow])),
    collapse('Testing evidence', `${ranking.evidence}\n\n${show(ranking.white)}`), collapse('Decision log', input.decisions), collapse('Dispute log', input.disputes)].join('\n\n');
}
function committedLink(exec: Exec, head: string, link: string): string {
  if (/^(https?:|\/)/.test(link) || /:\d+(?:-\d+)?$/.test(link)) return link;
  return exec('git', ['cat-file', '-e', `${head}:${link}`]).status === 0 ? `${link}:1` : link;
}
function linkRanking(exec: Exec, head: string, ranking: Ranking): Ranking {
  const linked = { ...ranking };
  for (const tier of TIERS) linked[tier] = ranking[tier].map(item => ({ ...item, link: committedLink(exec, head, item.link) }));
  return linked;
}
export function publishPackage(tools: Tools, dir: string, folder: string, ranking: Ranking): { succeeded: boolean } {
  const found = lookupPr(tools);
  if (!found.ok) throw new Error(found.problem);
  const { repo, view } = found.value;
  if (!view) throw new Error('no open pull request for review package');
  const head = output(tools.exec, 'git', ['rev-parse', 'HEAD']) ?? '';
  const failures = failedItems(dir);
  const block = renderPackage({ ranking: linkRanking(tools.exec, head, ranking), failures, summary: readText(join(dir, 'pr-body.md')), decisions: readText(join(folder, 'decision-log.md')),
    disputes: readText(join(folder, 'dispute-log.md')), base: `https://${repo.host}/${repo.path}`, head });
  const body = spliceBody(view.body, markBlock(block)); const ref = { repo, number: view.pr.number };
  const edited = tools.forge.call(OPS.editBody, { ref, body });
  if (!edited.ok) throw new Error(edited.problem);
  const after = lookupPr(tools);
  if (!after.ok || after.value.view?.body !== body) throw new Error('review package read-back did not match');
  writeText(join(dir, 'review-package.md'), block); writeJson(join(dir, 'review-attention.json'), ranking);
  return { succeeded: failures.length === 0 };
}
