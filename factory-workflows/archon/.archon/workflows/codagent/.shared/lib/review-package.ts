import { type CheckResult, fail, pass } from './check.ts';
import { TIERS, type Ranking, type RequiredItem, type Item, type Tier } from './review-inventory.ts';
import { type KeyEvidence, type Question, standardQuestion, validQuestion } from './review-questions.ts';


const TYPES = new Set(['Verification', 'Agent decision', 'Decision', 'Risk', 'Failure', 'Dispute', 'Late commit', 'Human check']);
export function validItem(item: Item): boolean {
  return typeof item?.type === 'string' && item.type.split(',').every(type => TYPES.has(type.trim())) &&
    typeof item.title === 'string' && item.title.trim() !== '' && typeof item.detail === 'string' && item.detail.trim() !== '' &&
    typeof item.link === 'string' && Array.isArray(item.source) && item.source.length > 0 && item.source.every(source => typeof source === 'string');
}
const typeAliases: Record<string, string> = { 'Human-only check': 'Human check', 'Human-only testing': 'Human check' };
function normalizeTypes(item: Item): Item {
  if (typeof item?.type !== 'string') return item;
  const types = item.type.split(',').map(value => {
    const type = value.trim();
    return Object.hasOwn(typeAliases, type) ? typeAliases[type] : type;
  });
  return { ...item, type: [...new Set(types)].join(', ') };
}

export function isStepFailure(source: string): boolean {
  return source.startsWith('failure:');
}
export function withoutStepFailures(item: Item): Item[] {
  const source = item.source.filter(code => !isStepFailure(code));
  return source.length > 0 ? [{ ...item, source }] : [];
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
    if (expected.item.source[0]?.startsWith('failure:')) return [];
    const found = all.find(({ item }) => expected.item.source.every(source => item.source?.includes(source)));
    if (!found || TIERS.indexOf(found.tier) > TIERS.indexOf(expected.tier)) return [`missing or under-ranked ${expected.item.source.join(', ')}`];
    return requiredItemProblems(expected, found.item);
  });
}
export interface RankingContext {
  shots: string[];
  journeys: string[];
  commits: string[];
  dismissed: string[];
}
const emptyContext: RankingContext = { shots: [], journeys: [], commits: [], dismissed: [] };
function validPick(pick: KeyEvidence, context: RankingContext): boolean {
  return context.shots.includes(pick?.file) && typeof pick.title === 'string' && Boolean(pick.title.trim()) &&
    typeof pick.shows === 'string' && Boolean(pick.shows.trim());
}
function validQuestions(item: Item, tier: Tier): boolean {
  const questions = item.questions ?? [];
  if (tier === 'white') return questions.length === 0;
  if (!((Array.isArray(questions) && questions.length > 0) && questions.every(validQuestion))) return false;
  const retest = questions.some(question => question.options.some(option => option.id === 'retest'));
  return retest === Boolean(item.journeys?.length);
}
function isRetestQuestion(question?: Question): boolean {
  const ids = new Set(question?.options.map(option => option.id));
  return ids.size === 2 && ids.has('retest') && ids.has('leave');
}

function disputeChoices(item: Item, required: RequiredItem[]): Item[] {
  const disputes = required.filter(row => row.item.specChange).map(row => row.item);
  return item.source.flatMap(source => disputes.filter(dispute => dispute.source[0] === source));
}

function matchesDisputeChoices(question: Question | undefined, expected: Item): boolean {
  const allowed = expected.questions?.[0]?.options ?? [];
  return question?.options.length === allowed.length && allowed.every(wanted => question.options.some(option =>
    option.id === wanted.id && (!wanted.detail || option.detail === wanted.detail)));
}

function choiceProblems(ranking: Ranking, required: RequiredItem[]): string[] {
  return entries(ranking).flatMap(({ item }) => {
    const disputes = disputeChoices(item, required);
    if (disputes.length === 0) return [];
    const questions = item.questions ?? [];
    const retest = item.journeys?.length ? 1 : 0;
    if (questions.length !== disputes.length + retest || (retest && !isRetestQuestion(questions.at(-1)))) {
      return [`Give ${item.title} one separate question per spec-change dispute in source order, then Retest if applicable`];
    }
    return disputes.flatMap((expected, index) => matchesDisputeChoices(questions[index], expected) ? [] :
      [`spec-change dispute ${expected.source[0]} needs exactly the allowed options`]);
  });
}

function disputeQuestions(disputes: Item[], found: Item): Question[] {
  const questions = disputes.flatMap(dispute => dispute.questions ?? []);
  if (!found.journeys?.length) return questions;
  return [...questions, { prompt: 'Retest the affected journeys?', options: [
    { id: 'retest', label: 'Retest' }, { id: 'leave', label: 'Continue without retesting' },
  ] }];
}

export function bindDisputeQuestions(ranking: Ranking, required: RequiredItem[], repair = false): Ranking {
  for (const tier of TIERS) {
    ranking[tier] = ranking[tier].map(item => {
      const disputes = disputeChoices(item, required);
      if (disputes.length === 0) return item;
      const questions = repair ? disputeQuestions(disputes, item) : item.questions;
      return { ...item, questions: questions?.map((question, index) => ({ ...question, source: disputes[index]?.source[0] })) };
    });
  }
  return ranking;
}

function sourceProblems(item: Item, context: RankingContext): string[] {
  const rejected = item.source.filter(source => context.dismissed.includes(source));
  const journeys = (item.journeys ?? []).filter(entry => !(context.journeys.includes(entry.code) && context.commits.includes(entry.commit)));
  return [...rejected.map(source => `dismissed item ${source}`), ...journeys.map(entry => `unknown journey or commit ${entry.code} ${entry.commit}`)];
}
function evidenceProblems(ranking: Ranking, context: RankingContext, fallback: boolean): string[] {
  const picks = ranking.keyEvidence ?? [];
  if (!Array.isArray(picks) || picks.length > 5 || (!fallback && picks.length === 0 && context.shots.length > 0)) {
    return ['invalid key evidence count'];
  }
  return picks.filter(pick => !validPick(pick, context)).map(pick => `invalid key evidence ${pick?.file}`);
}
function itemProblems(ranking: Ranking, context: RankingContext): string[] {
  const problems: string[] = []; const titles = new Set<string>();
  for (const { tier, item } of entries(ranking)) {
    if (!validItem(item)) { problems.push('empty item or unknown type'); continue; }
    if (titles.has(item.title)) problems.push(`item appears in two tiers: ${item.title}`);
    if (!validQuestions(item, tier)) problems.push(`invalid questions for ${item.title}`);
    problems.push(...sourceProblems(item, context));
    if (item.source.some(isStepFailure)) problems.push(`Step failure items are supplied by the publisher: ${item.title}`);
    titles.add(item.title);
  }
  return problems;
}
export function checkRanking(ranking: Ranking, required: RequiredItem[], context = emptyContext, fallback = false): CheckResult {
  if (!ranking || typeof ranking.evidence !== 'string' || !TIERS.every(tier => Array.isArray(ranking[tier]))) return fail('ranking shape is invalid');
  const problems = itemProblems(ranking, context);
  if (problems.length > 0) return fail(problems);
  problems.push(...evidenceProblems(ranking, context, fallback));
  problems.push(...requiredProblems(ranking, required), ...choiceProblems(ranking, required));
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
    const questions = found.item.questions;
    placed[tier].push({ ...found.item, type, detail, questions: questions?.length ? questions : [standardQuestion(type)] });
}
function repairedItem(item: Item, tier: Tier, context: RankingContext): Item {
  const journeys = (item.journeys ?? []).filter(entry => context.journeys.includes(entry.code) && context.commits.includes(entry.commit));
  const questions = tier === 'white' ? [] : (item.questions ?? []).filter(candidate =>
    validQuestion(candidate) && (journeys.length > 0 || candidate.options.every(option => option.id !== 'retest')));
  const cleaned = { ...item, journeys, questions };
  if (validQuestions(cleaned, tier)) return cleaned;
  const question = standardQuestion(item.type);
  if (journeys.length > 0) question.options.unshift({ id: 'retest', label: 'Retest' });
  return { ...cleaned, questions: [...questions, question] };
}

export function placeRanking(ranking: Ranking, required: RequiredItem[], context = emptyContext): Ranking {
  const picks = Array.isArray(ranking?.keyEvidence) ? ranking.keyEvidence : [];
  const placed: Ranking = { red: [], orange: [], yellow: [], white: [],
    evidence: ranking?.evidence || 'No testing summary was supplied.',
    keyEvidence: picks.filter(pick => validPick(pick, context)).slice(0, 5) };
  const titles = new Set<string>();
  for (const { tier, item } of entries(ranking)) {
    const normalized = normalizeTypes(item);
    if (!validItem(normalized) || titles.has(normalized.title) || normalized.source.some(source => context.dismissed.includes(source))) continue;
    for (const remaining of withoutStepFailures(normalized)) {
      placed[tier].push(repairedItem(remaining, tier, context));
      titles.add(remaining.title);
    }
  }
  for (const expected of required.filter(row => !row.item.source[0]?.startsWith('failure:'))) {
    insertRequired(placed, { ...expected, item: repairedItem(expected.item, expected.tier, context) });
  }
  bindDisputeQuestions(placed, required, true);
  const checked = checkRanking(placed, required, context, true);
  if (!checked.ok) throw new Error(`deterministic ranking failed: ${checked.problems}`);
  return placed;
}
