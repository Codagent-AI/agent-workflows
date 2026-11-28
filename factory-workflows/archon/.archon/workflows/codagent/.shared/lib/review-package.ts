import { type CheckResult, fail, pass } from './check.ts';
import { type Answered, TIERS, type Ranking, type RequiredItem, type Item, type Tier } from './review-inventory.ts';
import { type LinkContext, resolveTarget } from './review-links.ts';
import { type KeyEvidence, type Question, standardQuestion, validQuestion } from './review-questions.ts';
import { isRepeat } from './review-repeats.ts';


const TYPES = new Set(['Agent decision', 'Risk', 'Failure', 'Dispute', 'Late commit', 'Human check']);
export function validItem(item: Item): boolean {
  return typeof item?.type === 'string' && item.type.split(',').every(type => TYPES.has(type.trim())) &&
    typeof item.title === 'string' && item.title.trim() !== '' && typeof item.detail === 'string' && item.detail.trim() !== '' &&
    Array.isArray(item.links) && item.links.every(link => typeof link?.label === 'string' && Boolean(link.label.trim()) && typeof link.target === 'string') &&
    (item.evidence === undefined || typeof item.evidence === 'string') && Array.isArray(item.source) && item.source.length > 0 && item.source.every(source => typeof source === 'string');
}
const typeAliases: Record<string, string> = { Decision: 'Agent decision', 'Human-only check': 'Human check', 'Human-only testing': 'Human check' };
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
function entries(ranking: Ranking): { tier: Tier; item: Item }[] {
  return TIERS.flatMap(tier => (Array.isArray(ranking?.[tier]) ? ranking[tier] : []).map(item => ({ tier, item })));
}
function requiredItemProblems(expected: RequiredItem, item: Item, context: RankingContext): string[] {
  if (!item.type.split(',').map(type => type.trim()).includes(expected.item.type)) return [`wrong type for ${expected.item.source.join(', ')}`];
  if (expected.item.type !== 'Late commit') return [];
  const sha = expected.item.source[0];
  const linked = item.links.some(link => link.target.startsWith('commit:') &&
    (context.links ? 'href' in resolveTarget(link.target, context.links) && sha.startsWith(link.target.slice(7)) : link.target === `commit:${sha}`));
  return linked && /\b\d+ files? changed\b/.test(item.detail) && /(?:^|\n|[.!?]\s+)Tests:\s*\S/.test(item.detail)
    ? [] : [`late commit ${sha} needs a commit link, shortstat and Tests:`];
}
function requiredProblems(ranking: Ranking, required: RequiredItem[], context: RankingContext): string[] {
  const all = entries(ranking);
  return required.flatMap(expected => {
    const found = all.find(({ item }) => expected.item.source.every(source => item.source?.includes(source)));
    // An item that repeats an earlier answer may sit below its tier, where the page shows that answer.
    if (!found || (TIERS.indexOf(found.tier) > TIERS.indexOf(expected.tier) && !isRepeat(found.item, context.answered))) return [`missing or under-ranked ${expected.item.source.join(', ')}`];
    return requiredItemProblems(expected, found.item, context);
  });
}
export interface RankingContext {
  media: string[];
  commands: string[];
  links?: LinkContext;
  journeys: string[];
  commits: string[];
  dismissed: string[];
  answered?: Answered[];
}
const emptyContext: RankingContext = { media: [], commands: [], journeys: [], commits: [], dismissed: [] };
function validPick(pick: KeyEvidence, context: RankingContext): boolean {
  return context.media.includes(pick?.file) && typeof pick.title === 'string' && Boolean(pick.title.trim()) &&
    typeof pick.shows === 'string' && Boolean(pick.shows.trim());
}
function validJourney(entry: NonNullable<Item['journeys']>[number]): boolean {
  return typeof entry?.code === 'string' && typeof entry.title === 'string' && typeof entry.commit === 'string';
}
function validCollections(item: Item): boolean {
  const { journeys, questions } = item;
  return (journeys === undefined || (Array.isArray(journeys) && journeys.every(validJourney))) &&
    (questions === undefined || (Array.isArray(questions) && questions.every(validQuestion)));
}
function validQuestions(item: Item): boolean {
  const questions = item.questions ?? [];
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
  return question?.options.length === allowed.length && allowed.every(wanted => question.options.some(option => option.id === wanted.id));
}

function hasSharedSource(item: Item, disputes: Item[]): boolean {
  return item.source.some(code => disputes.every(dispute => !dispute.source.includes(code)));
}

function validDisputeQuestions(questions: Question[], disputes: Item[], item: Item): boolean {
  if (questions.length < disputes.length + Number(Boolean(item.journeys?.length))) return false;
  const shared = questions.slice(disputes.length);
  return disputes.every((expected, index) => matchesDisputeChoices(questions[index], expected)) &&
    (!item.journeys?.length || isRetestQuestion(shared.at(-1))) &&
    (!hasSharedSource(item, disputes) || shared.some(question =>
      !question.source && (isSharedQuestion(question) || isRetestQuestion(question))));
}

function choiceProblems(ranking: Ranking, required: RequiredItem[]): string[] {
  return entries(ranking).flatMap(({ item }) => {
    const disputes = disputeChoices(item, required);
    if (disputes.length === 0) return [];
    return validDisputeQuestions(item.questions ?? [], disputes, item) ? [] :
      [`Give ${item.title} one separate question per spec-change dispute in source order with exactly the allowed options, then shared questions and Retest if applicable`];
  });
}

function isSharedQuestion(question: Question): boolean {
  const ids = new Set(question.options.map(option => option.id));
  return !(ids.has('spec-edit') || ids.has('retest') || (ids.has('follow-up') && ids.has('drop')));
}

function repairDisputeQuestions(item: Item, disputes: Item[]): Question[] {
  const unused = [...item.questions ?? []];
  const own = disputes.flatMap(dispute => {
    const index = unused.findIndex(question => matchesDisputeChoices(question, dispute));
    return index < 0 ? dispute.questions ?? [] : unused.splice(index, 1);
  });
  const needsShared = hasSharedSource(item, disputes);
  const shared = needsShared ? unused.filter(question => !question.source && isSharedQuestion(question)) : [];
  const retest = item.journeys?.length ? [unused.find(isRetestQuestion) ?? {
    prompt: 'Retest the affected journeys?', options: [
      { id: 'retest', label: 'Retest' }, { id: 'leave', label: 'Continue without retesting' },
    ],
  }] : [];
  if (needsShared && shared.length + retest.length === 0) shared.push(standardQuestion(item.type));
  return [...own, ...shared, ...retest];
}

export function bindDisputeQuestions(ranking: Ranking, required: RequiredItem[], repair = false): Ranking {
  for (const tier of TIERS) {
    ranking[tier] = ranking[tier].map(item => {
      const disputes = disputeChoices(item, required);
      if (disputes.length === 0) return item;
      const current = item.questions ?? [];
      const valid = validDisputeQuestions(current, disputes, item);
      const questions = repair && !valid ? repairDisputeQuestions(item, disputes) : item.questions;
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
  if (!Array.isArray(picks) || picks.length > 5 || (!fallback && picks.length === 0 && context.media.length > 0)) {
    return ['invalid key evidence count'];
  }
  return picks.filter(pick => !validPick(pick, context)).map(pick => `invalid key evidence ${pick?.file}`);
}
function itemShapeProblem(item: Item): string | undefined {
  if (!validItem(item)) return 'empty item or unknown type';
  return validCollections(item) ? undefined : `invalid questions or journeys for ${item.title}`;
}
function linkProblems(item: Item, context: RankingContext): string[] {
  if (!context.links) return [];
  return item.links.flatMap(link => {
    const resolved = resolveTarget(link.target, context.links as LinkContext);
    return 'problem' in resolved ? [`${item.title}: ${resolved.problem}`] : [];
  });
}

function failureProblems(item: Item, tier: Tier, failures: Set<string>, used: Set<string>): string[] {
  const sources = item.source.filter(isStepFailure);
  if (sources.length === 0) return item.links.length > 0? [] : [`missing links for ${item.title}`];
  const invalid = tier !== 'red' || sources.some(source => !failures.has(source) || used.has(source));
  for (const source of sources) used.add(source);
  return invalid ? [`invalid or duplicate failed step for ${item.title}`] : [];
}

const itemIdentity = (item: Item) => JSON.stringify([...new Set(item.source)].sort());

function itemProblems(ranking: Ranking, required: RequiredItem[], context: RankingContext): string[] {
  const problems: string[] = [];
  const identities = new Set<string>();
  const used = new Set<string>();
  const failures = new Set(required.flatMap(row => row.item.source.filter(isStepFailure)));
  for (const { tier, item } of entries(ranking)) {
    const shapeProblem = itemShapeProblem(item);
    if (shapeProblem) { problems.push(shapeProblem); continue; }
    if (identities.has(itemIdentity(item))) problems.push(`item appears in two tiers: ${item.title}`);
    if (!validQuestions(item)) problems.push(`invalid questions for ${item.title}`);
    if (item.evidence && !context.commands.includes(item.evidence)) problems.push(`unknown command evidence ${item.evidence}`);
    problems.push(...sourceProblems(item, context), ...linkProblems(item, context), ...failureProblems(item, tier, failures, used));
    identities.add(itemIdentity(item));
  }
  return problems;
}
export function checkRanking(ranking: Ranking, required: RequiredItem[], context = emptyContext, fallback = false): CheckResult {
  if (!ranking || Object.hasOwn(ranking, 'white') || typeof ranking.evidence !== 'string' || !TIERS.every(tier => Array.isArray(ranking[tier]))) return fail('ranking shape is invalid');
  const problems = itemProblems(ranking, required, context);
  if (problems.length > 0) return fail(problems);
  problems.push(...evidenceProblems(ranking, context, fallback));
  problems.push(...requiredProblems(ranking, required, context), ...choiceProblems(ranking, required));
  return problems.length > 0 ? fail(problems) : pass();
}

function insertRequired(placed: Ranking, expected: RequiredItem, context: RankingContext): void {
    const found = entries(placed).find(({ item }) => expected.item.source.every(source => item.source.includes(source)));
    if (!found) { placed[expected.tier].push({ ...expected.item, source: [...expected.item.source] }); return; }
    const tier = TIERS[Math.min(TIERS.indexOf(found.tier), TIERS.indexOf(expected.tier))];
    placed[found.tier] = placed[found.tier].filter(item => item !== found.item);
    const type = [...new Set([...found.item.type.split(',').map(value => value.trim()), expected.item.type])].join(', ');
    const lacksSize = expected.item.type === 'Late commit' && requiredItemProblems(expected, found.item, context).length > 0;
    const detail = lacksSize ? `${found.item.detail}\n\nLate commit ${expected.item.title}\n${expected.item.detail}` : found.item.detail;
    const links = lacksSize ? [...found.item.links, ...expected.item.links.filter(link =>
      !found.item.links.some(existing => existing.target === link.target))] : found.item.links;
    placed[tier].push(repairedItem({ ...found.item, type, detail, links }, context));
}
function repairedItem(item: Item, context: RankingContext): Item {
  const journeys = (Array.isArray(item.journeys) ? item.journeys : []).filter(entry =>
    validJourney(entry) && context.journeys.includes(entry.code) && context.commits.includes(entry.commit));
  const questions = (Array.isArray(item.questions) ? item.questions : []).filter(candidate =>
    validQuestion(candidate) && (journeys.length > 0 || candidate.options.every(option => option.id !== 'retest')));
  const cleaned = { ...item, journeys, questions };
  if (validQuestions(cleaned)) return cleaned;
  const question = standardQuestion(item.type);
  if (journeys.length > 0) question.options.unshift({ id: 'retest', label: 'Retest' });
  return { ...cleaned, questions: [...questions, question] };
}

function repairCandidate(item: Item, context: RankingContext, permitted: (code: string) => boolean): Item | undefined {
  const candidate = normalizeTypes(item);
  if (!validItem(candidate) || candidate.source.some(code => context.dismissed.includes(code))) return;
  const source = [...new Set(candidate.source.filter(permitted))];
  if (source.length === 0) return;
  const links = candidate.links.filter(link => !context.links || 'href' in resolveTarget(link.target, context.links));
  if (links.length === 0 && !source.some(isStepFailure)) return;
  const evidence = context.commands.includes(candidate.evidence ?? '') ? candidate.evidence : '';
  return repairedItem({ ...candidate, source, links, evidence }, context);
}

function mergeFailureConcerns(placed: Ranking, candidate: Item): void {
  const codes = candidate.source.filter(isStepFailure);
  const related = placed.red.filter(item => codes.some(code => item.source.includes(code)));
  placed.red = placed.red.filter(item => !related.includes(item));
  const group = [...related, candidate];
  const head = group[0];
  placed.red.push({ ...head,
    type: [...new Set(group.flatMap(item => item.type.split(',').map(type => type.trim())))].join(', '),
    source: [...new Set(group.flatMap(item => item.source))],
    unlinkedSources: [...new Set(group.flatMap(item => item.unlinkedSources ?? []))],
    detail: [...new Set(group.map(item => item.detail))].join('\n\n'),
    links: [...new Map(group.flatMap(item => item.links).map(link => [link.target, link])).values()],
    questions: [...new Map(group.flatMap(item => item.questions ?? []).map(question => [JSON.stringify(question), question])).values()],
    journeys: group.flatMap(item => item.journeys ?? []),
    evidence: group.find(item => item.evidence)?.evidence,
  });
}

function placeCandidates(placed: Ranking, ranking: Ranking, required: RequiredItem[], context: RankingContext): void {
  const identities = new Set<string>();
  const failures = new Set(required.flatMap(row => row.item.source.filter(isStepFailure)));
  for (const { tier, item } of entries(ranking)) {
    const candidate = repairCandidate(item, context, code => !isStepFailure(code) || failures.has(code));
    if (!candidate || identities.has(itemIdentity(candidate))) continue;
    if (candidate.source.some(isStepFailure)) mergeFailureConcerns(placed, candidate);
    else placed[tier].push(candidate);
    identities.add(itemIdentity(candidate));
  }
}

function attachUnavailableSources(placed: Ranking, required: RequiredItem[], context: RankingContext): void {
  if (!(context.links && required.some(row => row.item.source.includes('failure:archive')))) return;
  for (const { tier, item } of entries(placed)) {
    if (item.source.some(isStepFailure) || item.links.length > 0 || item.type.includes('Late commit')) continue;
    placed[tier] = placed[tier].filter(entry => entry !== item);
    mergeFailureConcerns(placed, { ...item, detail: `${item.title}\n\n${item.detail}`,
      source: ['failure:archive', ...item.source], unlinkedSources: item.source, questions: [] });
  }
}

export function placeRanking(ranking: Ranking, required: RequiredItem[], context = emptyContext): Ranking {
  const picks = Array.isArray(ranking?.keyEvidence) ? ranking.keyEvidence : [];
  const placed: Ranking = { red: [], orange: [], yellow: [],
    evidence: ranking?.evidence || 'No testing summary was supplied.',
    keyEvidence: picks.filter(pick => validPick(pick, context)).slice(0, 5) };
  placeCandidates(placed, ranking, required, context);
  for (const expected of required) {
    const links = expected.item.links.filter(link => !context.links || 'href' in resolveTarget(link.target, context.links));
    insertRequired(placed, { ...expected, item: repairedItem({ ...expected.item, links }, context) }, context);
  }
  attachUnavailableSources(placed, required, context);
  bindDisputeQuestions(placed, required, true);
  const checked = checkRanking(placed, required, context, true);
  if (!checked.ok) throw new Error(`deterministic ranking failed: ${checked.problems}`);
  return placed;
}
