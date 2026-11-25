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
  try {
    const response = await input.fetch(`${page.origin}/api/runs/${run}/attention`, { credentials: 'omit' });
    if (response.status === 404) return stale;
    if (!response.ok) return fallback();
    const { item } = await response.json() as { item?: { occurrence?: string; message?: string; runId?: string } | null };
    if (!item?.occurrence || item.runId !== decodeURIComponent(run) || !item.message?.startsWith(`Review round ${input.round}:`)) return stale;
    occurrence = item.occurrence;
    const sent = await input.fetch(`${page.origin}/api/workflows/runs/${run}/answer`, {
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
  return rows.filter(row => row.required && (!row.option || (row.option === 'other' && !row.other.trim()))).length;
}

export function initialChoice(tier: string, recommended: string, answered: boolean, prior?: string): string {
  if (answered) return prior ?? '';
  return tier === 'yellow' ? recommended : '';
}

export function collectReview(input: {
  action: 'feedback' | 'merge'; round: number; head: string;
  rows: { item: string; question: number; required: boolean; option: string; other: string; note: string }[];
  screenshots: { file: string; round: number }[]; comments: ReadonlyMap<string, string>;
}) {
  const answer = { action: input.action, round: input.round, head: input.head };
  if (input.action === 'merge') return answer;
  return { ...answer, answers: input.rows.map(({ required, ...choice }) => choice),
    screenshotComments: input.screenshots.flatMap(({ file, round }) => {
      const comment = input.comments.get(file);
      return comment?.trim() ? [{ file, round, comment }] : [];
    }) };
}

export function sizeTotals(rows: { files: number; added: number; modified: number; removed: number }[]) {
  return rows.reduce((sum, row) => ({
    files: sum.files + row.files, added: sum.added + row.added,
    modified: sum.modified + row.modified, removed: sum.removed + row.removed,
  }), { files: 0, added: 0, modified: 0, removed: 0 });
}
