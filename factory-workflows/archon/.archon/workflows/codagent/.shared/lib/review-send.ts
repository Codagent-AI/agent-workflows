export async function sendReview(input: {
  address: string; run: string; round: number; answer: unknown; fetch: (url: string, options?: RequestInit) => Promise<Response>;
}) {
  const page = new URL(input.address);
  const run = /^\/api\/artifacts\/([^/]+)\//.exec(page.pathname)?.[1];
  const text = JSON.stringify(input.answer);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  let occurrence = '';
  const fallback = () => {
    const id = quote(input.run || decodeURIComponent(run ?? ''));
    const lookup = `$(archon workflow get ${id} --json | jq -er '.metadata.wait.pauseId')`;
    return { kind: 'copy' as const, text, command: `archon workflow answer ${id} --occurrence ${occurrence ? quote(occurrence) : `"${lookup}"`} --text ${quote(text)}` };
  };
  const stale = { kind: 'stale' as const };
  if (!(run && ['http:', 'https:'].includes(page.protocol))) return fallback();
  const { fetch } = input;
  try {
    const response = await fetch(`${page.origin}/api/runs/${run}/attention`, { credentials: 'omit' });
    if (response.status === 404) return stale;
    if (!response.ok) return fallback();
    const { item } = await response.json() as { item?: { run?: { id?: string; occurrence?: string }; message?: string } | null };
    const held = item?.run;
    if (!held?.occurrence || held.id !== decodeURIComponent(run) || !item || !item.message?.startsWith(`Review round ${input.round}:`)) return stale;
    occurrence = held.occurrence;
    const sent = await fetch(`${page.origin}/api/workflows/runs/${run}/answer`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occurrence, text }),
    });
    if (sent.status === 409) return stale;
    if (!sent.ok) return fallback();
    const result = await sent.json().catch(() => ({})) as { message?: string };
    return { kind: 'sent' as const, message: result.message ?? '' };
  } catch {
    return fallback();
  }
}

export function missingAnswers(rows: { required: boolean; option: string; other: string }[]): number {
  return rows.filter(row => (row.required && !row.option) || (row.option === 'other' && !row.other.trim())).length;
}

export function initialChoice(tier: string, recommended: string, answered: boolean, prior?: string): string {
  if (answered) return prior ?? '';
  return tier === 'yellow' ? recommended : '';
}

export function collectReview(input: {
  action: 'feedback' | 'merge'; round: number; head: string;
  rows: { item: string; question: number; required: boolean; option: string; other: string; note: string; options?: { id: string; label: string; detail?: string }[] }[];
  screenshots: { file: string; round: number }[]; commands?: { file: string; round: number }[]; comments: ReadonlyMap<string, string>;
  note?: string;
}) {
  const answer = { action: input.action, round: input.round, head: input.head };
  if (input.action === 'merge') return answer;
  const comments = (entries: { file: string; round: number }[]) =>
    [...new Map(entries.map(entry => [entry.file, entry])).values()].flatMap(({ file, round }) => {
      const comment = input.comments.get(file);
      return comment?.trim() ? [{ file, round, comment }] : [];
    });
  const note = input.note?.trim() ? [{ item: 'note', question: 0, option: '', other: '', note: input.note }] : [];
  // The chosen option's label and wording go with its ID, so the next round reads what the option promised.
  const wording = (options: { id: string; label: string; detail?: string }[] = [], id = '') => {
    const chosen = options.find(option => option.id === id);
    return chosen ? { label: chosen.label, detail: chosen.detail ?? '' } : {};
  };
  return { ...answer, answers: [...input.rows.map(({ required, options, ...choice }) => ({ ...choice, ...wording(options, choice.option) })), ...note],
    screenshotComments: comments(input.screenshots),
    commandComments: comments(input.commands ?? []).map(({ file, round, comment }) => ({ ref: file, round, comment })) };
}

export function sizeTotals(rows: { files: number; added: number; modified: number; removed: number }[]) {
  return rows.reduce((sum, row) => ({
    files: sum.files + row.files, added: sum.added + row.added,
    modified: sum.modified + row.modified, removed: sum.removed + row.removed,
  }), { files: 0, added: 0, modified: 0, removed: 0 });
}
