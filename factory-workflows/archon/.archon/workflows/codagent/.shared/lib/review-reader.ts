// The reader check: a fresh agent reads the page's items as the reviewer sees them, and the
// items it could not follow go back to the ranker for one rewrite.
import { TIERS, type Item, type Ranking } from './review-inventory.ts';

export interface ReaderEntry { number: number; asks: string; options: { label: string; does: string }[]; if_wrong: string; unclear: string[]; }
export interface Flag { number: number; title: string; unclear: string[]; missing: string[]; }
export interface Rewrite { number: number; title: string; detail: string; questions: { prompt: string; options: { id: string; label: string; detail: string }[] }[]; links?: string[]; }

/** The items in page order, numbered from 1 as the page numbers them. */
export function pageItems(ranking: Ranking): Item[] {
  return TIERS.flatMap(tier => (Array.isArray(ranking?.[tier]) ? ranking[tier] : []));
}

/** The items' own words as the page shows them. The page's labels, its Other box and its link targets are left out. */
export function readerItems(ranking: Ranking): string {
  return pageItems(ranking).map((item, index) => {
    const questions = (item.questions ?? []).map(question => [
      `Question: ${question.prompt}`,
      ...question.options.map(option => `- ${option.label}${option.detail ? `: ${option.detail}` : ''}`),
    ].join('\n'));
    const links = item.links?.length ? [`Links on GitHub: ${item.links.map(entry => entry.label).join(', ')}`] : [];
    return [`## Item ${index + 1}`, `### ${item.title}`, item.detail, ...questions, ...links].join('\n\n');
  }).join('\n\n');
}

function missingAnswers(entry: ReaderEntry): string[] {
  const blank = (text: unknown) => typeof text !== 'string' || !text.trim();
  return [
    ...(blank(entry.asks) ? ['what the question asks you to decide'] : []),
    ...(entry.options ?? []).filter(option => blank(option.does)).map(option => `what choosing "${option.label}" would do`),
    ...(blank(entry.if_wrong) ? ['what happens if the choice is wrong'] : []),
  ];
}

/** An item is flagged when the reader quoted a term it could not follow or could not answer a field. */
export function flagItems(ranking: Ranking, reader: { items?: ReaderEntry[] }): Flag[] {
  const items = pageItems(ranking);
  const entries = Array.isArray(reader?.items) ? reader.items : [];
  return entries.flatMap(entry => {
    const item = items[entry.number - 1];
    if (!item) return [];
    const unclear = (Array.isArray(entry.unclear) ? entry.unclear : []).filter(term => typeof term === 'string' && term.trim());
    const missing = missingAnswers(entry);
    return unclear.length > 0|| missing.length > 0? [{ number: entry.number, title: item.title, unclear, missing }] : [];
  });
}

export function readerNotes(flags: Flag[]): string {
  return flags.map(flag => [
    `Item ${flag.number}: ${flag.title}`,
    ...(flag.unclear.length > 0? [`- Could not understand: ${flag.unclear.map(term => `"${term}"`).join('; ')}`] : []),
    ...flag.missing.map(field => `- Could not tell ${field}`),
  ].join('\n')).join('\n\n');
}

function sameQuestions(item: Item, rewrite: Rewrite): boolean {
  const questions = item.questions ?? [];
  return Array.isArray(rewrite.questions) && rewrite.questions.length === questions.length && questions.every((question, index) => {
    const options = rewrite.questions[index]?.options ?? [];
    return options.length === question.options.length && question.options.every((option, at) => options[at]?.id === option.id);
  });
}

/** New link labels, one per link in the same order, or none when they don't line up. */
function linkLabels(item: Item, rewrite: Rewrite): string[] | undefined {
  const labels = rewrite.links;
  const usable = Array.isArray(labels) && labels.length === (item.links?.length ?? 0) && labels.every(label => typeof label === 'string' && label.trim());
  return usable ? labels : undefined;
}

function rewritten(item: Item, rewrite: Rewrite): Item {
  const labels = linkLabels(item, rewrite);
  return {
    ...item, title: rewrite.title, detail: rewrite.detail,
    ...(labels && item.links ? { links: item.links.map((link, at) => ({ ...link, label: labels[at] })) } : {}),
    questions: item.questions?.map((question, index) => ({
      ...question, prompt: rewrite.questions[index].prompt,
      // A spec edit's detail is the exact edit the round applies, so its wording stays.
      options: question.options.map((option, at) => ({ ...option, label: rewrite.questions[index].options[at].label,
        detail: option.id === 'spec-edit' ? option.detail : rewrite.questions[index].options[at].detail })),
    })),
  };
}

/** Replaces the wording of flagged items only. A rewrite that changes an item's questions or options is ignored, and link labels that don't line up with the links are kept. */
export function applyRewrite(ranking: Ranking, rewrites: Rewrite[], flagged: number[]): Ranking {
  const byNumber = new Map((Array.isArray(rewrites) ? rewrites : []).map(entry => [entry.number, entry]));
  let number = 0;
  const next = { ...ranking };
  for (const tier of TIERS) {
    next[tier] = (ranking[tier] ?? []).map(item => {
      number += 1;
      const rewrite = byNumber.get(number);
      const usable = flagged.includes(number) && rewrite && typeof rewrite.title === 'string' && rewrite.title.trim()
        && typeof rewrite.detail === 'string' && rewrite.detail.trim() && sameQuestions(item, rewrite);
      return usable ? rewritten(item, rewrite) : item;
    });
  }
  return next;
}

/** The flagged items' rewrites when the ranking passes with all of them, and otherwise each one it still passes with. */
export function passingRewrite(ranking: Ranking, rewrites: Rewrite[], flagged: number[], passes: (candidate: Ranking) => boolean): Ranking {
  const whole = applyRewrite(ranking, rewrites, flagged);
  if (passes(whole)) return whole;
  return flagged.reduce((kept, number) => {
    const one = applyRewrite(kept, rewrites, [number]);
    return passes(one) ? one : kept;
  }, ranking);
}
