export interface Option { id: string; label: string; detail?: string }
export interface Question { source?: string; prompt: string; options: Option[] }
export interface KeyEvidence { file: string; title: string; shows: string }
export interface LateJourney { code: string; title: string; commit: string }

export function validQuestion(question: Question): boolean {
  if (typeof question?.prompt !== 'string' || !question.prompt.trim() || !Array.isArray(question.options)) return false;
  const { options, source } = question;
  if (source !== undefined && typeof source !== 'string') return false;
  return options.length >= 2 && options.length <= 4 && options.every(option =>
    typeof option?.id === 'string' && Boolean(option.id.trim()) && option.id !== 'other' &&
    typeof option.label === 'string' && Boolean(option.label.trim()) && (option.detail === undefined || typeof option.detail === 'string')) &&
    new Set(options.map(option => option.id)).size === options.length;
}

/** Sends a late commit through the next round's review: the reviewer reviews it, the implementor fixes what it finds, and the reviewer checks the fixes. */
export const reviewRound: Option = { id: 'review-round', label: 'Run a review round',
  detail: 'The next round’s reviewer reviews this commit, the implementor fixes what it finds, and the reviewer checks the fixes.' };
const keepCommit: Option = { id: 'keep', label: 'Keep it without a review' };
/** Files an issue for the item when the next round starts. The workflow does it, so the wording is the workflow's, not the ranking's. */
export const followUp: Option = { id: 'follow-up', label: 'File a follow-up issue',
  detail: 'The next round files a GitHub issue for this and changes nothing in this pull request.' };

export function standardQuestion(type: string): Question {
  if (type.includes('Late commit')) return { prompt: 'What should the run do about this commit?', options: [{ ...reviewRound }, { ...keepCommit }] };
  return { prompt: type === 'Failure' ? 'How should the run handle this failure?' : 'What should the run do about this item?',
    options: [{ id: 'fix', label: 'Fix it in the next round' }, { id: 'leave', label: 'Leave it for me to handle' }] };
}

interface Asked { type: string; questions?: Question[] }
const sharedQuestion = (question: Question) => !(question.source ||
  question.options.some(option => ['retest', 'spec-edit', 'follow-up', 'drop'].includes(option.id)));
const hasOption = (questions: Question[], id: string) => questions.some(question => question.options.some(option => option.id === id));

/** Every late commit offers a review round: in its first shared question, or in a question of its own before Retest. */
export function withReviewRound<T extends Asked>(item: T): T {
  const questions = item.questions ?? [];
  if (!item.type.includes('Late commit') || hasOption(questions, reviewRound.id)) return item;
  const at = questions.findIndex(sharedQuestion);
  if (at >= 0 && questions[at].options.length < 4) {
    return { ...item, questions: questions.map((question, index) => index === at ? { ...question, options: [...question.options, { ...reviewRound }] } : question) };
  }
  const end = questions.at(-1)?.options.some(option => option.id === 'retest') ? questions.length - 1 : questions.length;
  const own = { prompt: 'Run a review round on this commit?', options: [{ ...reviewRound }, { ...keepCommit }] };
  return { ...item, questions: [...questions.slice(0, end), own, ...questions.slice(end)] };
}

// The first option is the recommendation. Yellow is for items the agent recommends accepting as they are.
const workOptions = new Set(['fix', 'retest', 'spec-edit', reviewRound.id]);
const recommendsWork = (item: Asked) => (item.questions ?? []).some(question => workOptions.has(question.options[0]?.id));

const noReview: Option[] = [{ id: 'keep', label: 'Keep it' }, { id: 'leave', label: 'Leave it for me to handle' }];

/** With code review off no round can review a commit, so a late commit offers keeping it or leaving it to the person reviewing. */
export function withoutReviewRound<T extends Asked>(item: T): T {
  if (!hasOption(item.questions ?? [], reviewRound.id)) return item;
  return { ...item, questions: item.questions?.map(question => {
    const options = question.options.filter(option => option.id !== reviewRound.id);
    const missing = options.length >= 2 ? [] : noReview.filter(extra => !options.some(option => option.id === extra.id));
    return { ...question, options: [...options, ...missing.map(extra => ({ ...extra }))] };
  }) };
}

function withFollowUpWording<T extends Asked>(item: T): T {
  if (!hasOption(item.questions ?? [], followUp.id)) return item;
  return { ...item, questions: item.questions?.map(question => ({ ...question,
    options: question.options.map(option => option.id === followUp.id ? { ...followUp } : option) })) };
}

/** Gives late commits their review round when code review is on, words each follow-up option as what it does, and moves each yellow item whose recommendation asks the next round for work up to orange. */
export function settleQuestions<T extends Asked, R extends { red: T[]; orange: T[]; yellow: T[] }>(ranking: R, review = true): R {
  const offer = review ? withReviewRound : withoutReviewRound;
  const [red, orange, yellow] = [ranking.red, ranking.orange, ranking.yellow].map(items => items.map(item => withFollowUpWording(offer(item))));
  return { ...ranking, red, orange: [...orange, ...yellow.filter(recommendsWork)], yellow: yellow.filter(item => !recommendsWork(item)) };
}

export function disputeQuestion(edit: string): Question {
  // The next round applies the dispute log's Spec edit line, so the option describes it and never quotes it; settleQuestions words the follow-up.
  const options: Option[] = [{ id: followUp.id, label: followUp.label }, { id: 'drop', label: 'Drop the request' }];
  if (edit) options.unshift({ id: 'spec-edit', label: 'Change the spec', detail: 'The next round makes the spec edit the dispute proposes and changes the code to match.' });
  return { prompt: 'How should the run handle this request to change approved behavior?', options };
}
