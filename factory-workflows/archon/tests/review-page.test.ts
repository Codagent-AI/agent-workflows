import { emptyRanking } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { disputeQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { collectReview, initialChoice, sendReview, missingAnswers, sizeTotals } from '../.archon/workflows/codagent/.shared/lib/review-send.ts';
import { pageHtml } from '../.archon/workflows/codagent/.shared/lib/publish-review.ts';

test.each(['feedback', 'merge'])('INT-011 sends one %s answer for the current occurrence', async action => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return sent.length === 1 ? Response.json({ item: { runId: 'r', occurrence: 'this-wait', message: 'Review round 1: waiting' } }) : Response.json({ message: 'accepted' });
  });
  const answer = { action, round: 1, head: 'reviewed-head', ...(action === 'feedback' ? { answers: [{ note: 'a note' }], screenshotComments: [{ file: 'one.png', round: 0 }] } : {}) };
  const result = await sendReview({ address: 'http://archon.example/api/artifacts/r/review-page.html', run: 'r', round: 1, answer, fetch: fake });
  expect(result).toMatchObject({ kind: 'sent', message: 'accepted' });
  expect(sent.map(entry => entry.url)).toEqual(['http://archon.example/api/runs/r/attention', 'http://archon.example/api/workflows/runs/r/answer']);
  expect(JSON.parse(String(sent[1].init?.body))).toEqual({ occurrence: 'this-wait', text: JSON.stringify(answer) });
});

const unavailable = ['file', 'offline', 'offline after GET'];
const expectedCalls: Record<string, number> = { file: 0, '409': 2, 'offline after GET': 2 };
function fakeWait(scenario: string) {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    if (scenario === 'offline' || (scenario === 'offline after GET' && calls > 1)) throw new Error('network');
    if (calls > 1) return new Response(null, { status: 409 });
    const n = scenario === 'round-12' ? 12 : 1;
    return Response.json({ item: scenario === 'no wait' ? null : { runId: 'r', occurrence: 'known', message: `Review round ${n}: waiting` } });
  };
  return { fetch, calls: () => calls };
}
test.each(['round-12', 'no wait', '409', 'file', 'offline', 'offline after GET'])('INT-011 sending handles %s and preserves payload for the CLI when unavailable', async scenario => {
  const mock = fakeWait(scenario);
  const answer = { action: 'feedback', note: "I'm waiting" };
  const address = scenario === 'file' ? 'file:///tmp/review-page.html' : 'http://archon.example/api/artifacts/r/review-page.html';
  const result = await sendReview({ address, run: 'r', round: 1, answer, fetch: mock.fetch });
  if (unavailable.includes(scenario)) {
    expect(result).toMatchObject({ kind: 'copy', text: JSON.stringify(answer) });
    if (result.kind !== 'copy') throw new Error('missing command');
    expect(result.command).toContain(scenario === 'offline after GET' ? "--occurrence 'known'" : 'workflow get');
    expect(result.command).toContain('workflow answer');
  } else expect(result.kind).toBe('stale');
  expect(mock.calls()).toBe(expectedCalls[scenario] ?? 1);
});

test('unanswered red and orange questions count plain blanks and empty Other, with yellow optional', () => {
  expect(missingAnswers([{ required: true, option: '', other: '' }, { required: true, option: 'other', other: '  ' },
    { required: true, option: 'other', other: 'choice' }, { required: false, option: '', other: '' }])).toBe(2);
});


test('question defaults start blank for required tiers and restore saved answers', () => {
  for (const tier of ['red', 'orange']) expect(initialChoice(tier, 'recommended', false)).toBe('');
  expect(initialChoice('yellow', 'recommended', false)).toBe('recommended');
  expect(initialChoice('yellow', 'recommended', true)).toBe('');
  expect(initialChoice('red', 'recommended', true, 'other')).toBe('other');
});

test('collects choice values, notes and nonblank screenshot comments with the acceptance round', () => {
  const row = { item: 'CHECK-1', question: 1, option: 'other', other: 'Try again', note: 'More context' };
  const input = { round: 2, head: 'reviewed', rows: [{ ...row, required: true }],
    screenshots: [{ file: 'one.png', round: 1 }, { file: 'two.png', round: 3 }],
    comments: new Map([['one.png', ''], ['two.png', 'Alignment']]) };
  expect(collectReview({ ...input, action: 'feedback' })).toEqual({
    action: 'feedback', round: 2, head: 'reviewed', answers: [row],
    screenshotComments: [{ file: 'two.png', round: 3, comment: 'Alignment' }],
  });
  expect(collectReview({ ...input, action: 'merge' })).toEqual({ action: 'merge', round: 2, head: 'reviewed' });
});

test('change size totals combine both languages and all change columns', () => {
  expect(sizeTotals([{ files: 3, added: 5, modified: 3, removed: 2 }, { files: 1, added: 7, modified: 1, removed: 6 }]))
    .toEqual({ files: 4, added: 12, modified: 4, removed: 8 });
});

class Element {
  id = '';
  className = '';
  textContent = '';
  children: Element[] = [];
  dataset: Record<string, string> = {};
  classList = { add: () => undefined };
  constructor(readonly tag: string) {}
  append(...children: (Element | string)[]) {
    this.children.push(...children.filter(child => child instanceof Element));
  }
  appendChild(child: Element) { this.append(child); return child; }
  setAttribute() {}
  addEventListener() {}
  createTHead() { return this.appendChild(new Element('thead')); }
  createTBody() { return this.appendChild(new Element('tbody')); }
  insertRow() { return this.appendChild(new Element('tr')); }
  find(className: string): Element | undefined {
    return this.className.split(' ').includes(className) ? this
      : this.children.map(child => child.find(className)).find(Boolean);
  }
}

test('dynamic review markup keeps item content and recommendation out of the number and radio columns', () => {
  const data = { title: 'Review title', round: 2, run: 'run-1', head: 'head', codes: {},
    summary: 'Summary', recap: [{ note: 'Round update' }], decisions: '## DECIDE-1: Choice\n- Rationale: Reason',
    disputes: '', keyEvidence: [], wait: false, orange: [], yellow: [],
    screenshots: [{ href: 'one.png', file: 'one.png', round: 0, title: 'Start' }, { href: 'two.png', file: 'two.png', round: 2, title: 'Retest' }],
    size: [{ language: 'Go', files: 1, added: 2, modified: 3, removed: 4 }],
    red: [{ type: 'Failure', title: 'Item title', source: ['CHECK-1'], detail: 'Details',
      questions: [{ prompt: 'Choose', options: [{ id: 'fix', label: 'Fix' }, { id: 'leave', label: 'Leave' }] }] }] };
  const selectors = new Map<string, Element>();
  const querySelector = (key: string) => {
    if (!selectors.has(key)) selectors.set(key, new Element(key));
    return selectors.get(key) as Element;
  };
  querySelector('#page-data').textContent = JSON.stringify(data);
  querySelector('#sent-answers').textContent = 'null';
  const html = pageHtml(data);
  const script = html.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  runInNewContext(script, { URL, location: { href: 'file:///review.html' },
    document: { querySelector, createElement: (tag: string) => new Element(tag), body: new Element('body') } });
  const main = querySelector('main');
  const item = main.find('item');
  expect(item?.children.map(child => child.className)).toEqual(['n', 'item-body']);
  expect(item?.children[1].children.find(child => child.tag === 'h3')).toBeDefined();
  const option = item?.find('opt');
  expect(option?.children.map(child => child.tag)).toEqual(['input', 'span']);
  expect(option?.children[1].find('rec')).toBeDefined();
  expect(querySelector('.rail > ol').find('dot')).toBeDefined();
  const gallery = main.children.find(child => child.id === 'screenshots');
  expect(gallery?.children.slice(1).map(group => group.children[0].textContent)).toEqual(['Acceptance round 0', 'Acceptance round 2']);
  expect(gallery?.find('thumb-label')?.textContent).toBe('Start');
  expect(main.find('fields')?.children.map(child => child.tag)).toEqual(['dt', 'dd']);
  expect(main.find('total')?.children.map(child => child.textContent)).toEqual(['Total', '1', '2', '3', '4']);
  expect(main.children[0].children.map(child => child.tag)).toEqual(['div', 'ul', 'div', 'div']);
});

test('placing a dispute grouped with a late commit retains a separate Retest question', () => {
  const commit = 'a'.repeat(40);
  const journey = { code: 'JOURNEY-1', title: 'Launch', commit };
  const item = { type: 'Dispute, Late commit', title: 'Shared issue', detail: 'One cause', link: '',
    source: ['DISPUTE-1', commit], journeys: [journey] };
  const expected = { ...item, type: 'Dispute', source: ['DISPUTE-1'], journeys: [],
    specChange: true, questions: [disputeQuestion('')] };
  const context = { shots: [], dismissed: [], journeys: [journey.code], commits: [commit] };
  const placed = placeRanking({ ...emptyRanking(), orange: [item] }, [{ tier: 'red', item: expected }], context);
  expect(placed.red[0].questions?.map(question => question.options.map(option => option.id)))
    .toEqual([['follow-up', 'drop'], ['retest', 'leave']]);
});
