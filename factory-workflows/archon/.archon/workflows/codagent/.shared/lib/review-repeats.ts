import { type Answered, type Item, type Ranking, TIERS } from './review-inventory.ts';

const logCode = /^(?:D|DECIDE|DP|DISPUTE)-\d+$/;

/** Whether the ranker matched this decision or dispute to an earlier item answered with no work. Other items never repeat one. */
export function isRepeat(item: Item, answered: Answered[] = []): boolean {
  const earlier = item.repeats;
  return typeof earlier === 'string' && answered.some(entry => entry.source === earlier) && !item.source.includes(earlier) &&
    item.source.every(source => logCode.test(source));
}

/** Moves each item that repeats an earlier answer to yellow and records that answer on it for the page. Other items stay as ranked. */
export function settleRepeats(ranking: Ranking, answered: Answered[]): Ranking {
  const repeats = TIERS.flatMap(tier => ranking[tier].filter(item => isRepeat(item, answered)));
  const marked = repeats.map(item => {
    const { source: _, ...earlier } = answered.find(entry => entry.source === item.repeats) as Answered;
    return { ...item, answered: earlier };
  });
  const rest = (items: Item[]) => items.filter(item => !repeats.includes(item));
  return { ...ranking, red: rest(ranking.red), orange: rest(ranking.orange), yellow: [...rest(ranking.yellow), ...marked] };
}
