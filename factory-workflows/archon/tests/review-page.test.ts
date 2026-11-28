import { acceptedHead, emptyRanking, stepFailures, inventory } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkRanking, placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { disputeQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { expect, test } from 'bun:test';
import { renameSync, mkdirSync } from 'node:fs';
import { rankingForPublication } from '../.archon/workflows/codagent/.shared/lib/finish-run.ts';
import { feedbackScope, markReviewRoundDone, refreshBase } from '../.archon/workflows/codagent/.shared/lib/review-revisions.ts';
import { numberLog } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { createSandbox, type Sandbox } from './helpers.ts';
import { runInNewContext } from 'node:vm';
import { collectReview, sendReview } from '../.archon/workflows/codagent/.shared/lib/review-send.ts';
import { reviewMedia } from '../.archon/workflows/codagent/.shared/lib/review-media.ts';
import { pageHtml } from '../.archon/workflows/codagent/.shared/lib/publish-review.ts';

test.each(['feedback', 'merge'])('INT-011 sends one %s answer for the current occurrence', async action => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return sent.length === 1 ? Response.json({ item: { run: { id: 'r', occurrence: 'this-wait' }, message: 'Review round 1: waiting' } }) : Response.json({ message: 'accepted' });
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
    return Response.json({ item: scenario === 'no wait' ? null : { run: { id: 'r', occurrence: 'known' }, message: `Review round ${n}: waiting` } });
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

class Element {
  id = '';
  className = '';
  private text = '';
  value = '';
  href = '';
  scrollLeft = 0;
  scrollTop = 0;
  clientWidth = 0; style: Record<string, string> = {}; disabled = false;
  onclick?: () => void;
  showModal() {}
  focus() {}
  scrollIntoView() {}
  hidden = false;
  children: Element[] = [];
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  classList = {
    add: (name: string) => { this.className += ` ${name}`; },
    contains: (name: string) => this.className.split(' ').includes(name),
    toggle: (name: string, value = !this.classList.contains(name)) => {
      this.className = [...this.className.split(' ').filter(part => part && part !== name), ...(value ? [name] : [])].join(' ');
      return value;
    },
  };
  prepend(child: Element) { this.children.unshift(child); }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; }
  byTag(tag: string): Element[] { return [...(this.tag === tag ? [this] : []), ...this.children.flatMap(child => child.byTag(tag))]; }
  constructor(readonly tag: string) {}
  append(...children: (Element | string)[]) {
    for (const child of children) {
      if (child instanceof Element) this.children.push(child);
      else { const text = new Element('#text'); text.textContent = child; this.children.push(text); }
    }
  }
  appendChild(child: Element) { this.append(child); return child; }
  replaceChildren(...children: Element[]) { this.children = children; }
  setAttribute() {}
  addEventListener(event: string, handler: () => void) { this.listeners.set(event, handler); }
  querySelector() { return undefined; } querySelectorAll(tag: string) { return this.byTag(tag); }
  createTHead() { return this.appendChild(new Element('thead')); }
  createTBody() { return this.appendChild(new Element('tbody')); }
  insertRow() { return this.appendChild(new Element('tr')); }
  find(className: string): Element | undefined {
    return this.className.split(' ').includes(className) ? this
      : this.children.map(child => child.find(className)).find(Boolean);
  }
}

function render(data: unknown, stored: unknown = null) {
  const selectors = new Map<string, Element>();
  const querySelector = (key: string) => {
    if (!selectors.has(key)) selectors.set(key, new Element(key));
    return selectors.get(key) as Element;
  };
  querySelector('#page-data').textContent = JSON.stringify(data);
  querySelector('#sent-answers').textContent = JSON.stringify(stored);
  const html = pageHtml(data);
  const script = html.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  runInNewContext(script, { URL, location: { href: 'file:///review.html' }, window: { addEventListener() {}, removeEventListener() {} },
    document: { querySelector, createElement: (tag: string) => new Element(tag), body: querySelector('body') } });
  return querySelector;
}

test('dynamic review markup lays out concerns, zooms the screenshot viewer and sorts the size table', () => {
  const data = { title: 'Review title', round: 2, run: 'run-1', head: 'head', codes: {},
    summary: 'Summary', recap: [{ note: 'Round update' }], decisions: '## DECIDE-1: Choice\n- Rationale: Reason',
    disputes: '', keyEvidence: [], wait: true, orange: [], yellow: [],
    screenshots: [{ href: 'one.png', file: 'one.png', round: 0, title: 'Start', shows: 'Before' }, { href: 'two.png', file: 'two.png', round: 2, title: 'Retest', shows: 'After' }],
    size: [{ language: 'Go', files: 1, added: 2, modified: 3, removed: 4 }, { language: 'TypeScript', files: 2, added: 9, modified: 0, removed: 1 }],
    red: [{ type: 'Failure', title: 'Item title', source: ['CHECK-1'], detail: 'Details',
      questions: [{ prompt: 'Choose', options: [{ id: 'fix', label: 'Fix' }, { id: 'leave', label: 'Leave' }] }] }] };
  const querySelector = render(data);
  const main = querySelector('main');
  const item = main.find('item');
  expect(item?.children.map(child => child.className)).toEqual(['n', 'item-body']);
  expect(item?.children[1].children.find(child => child.tag === 'h3')).toBeDefined();
  const option = item?.find('opt');
  expect(option?.children.map(child => child.tag)).toEqual(['input', 'span']);
  expect(option?.children[1].find('rec')).toBeDefined();
  expect(querySelector('.rail > ol').find('dot')).toBeDefined();
  const gallery = main.children.find(child => child.id === 'acceptance-evidence');
  expect(gallery?.children.slice(1).map(group => group.children[0].textContent)).toEqual(['Acceptance round 3', 'Acceptance round 1']);
  expect(gallery?.find('thumb-label')?.textContent).toBe('Retest');
  gallery?.byTag('button')[0].onclick?.();
  const body = querySelector('body');
  const stage = body.find('viewer-stage') as Element;
  stage.clientWidth = 1024;
  const press = (label: string) => body.find('viewer-bar')?.byTag('button').find(control => control.textContent === label)?.onclick?.();
  const view = () => [stage.children[0].style.width, body.find('viewer-zoom')?.textContent, stage.classList.contains('zoomed')];
  stage.children[0].listeners.get('load')?.();
  expect(view()).toEqual(['1000px', '100%', false]);
  press('+'); expect(view()).toEqual(['1500px', '150%', true]);
  for (const [label, title] of [['Previous', 'Start'], ['Next', 'Retest']]) {
    [stage.scrollLeft, stage.scrollTop] = [300, 150]; press(label);
    expect([body.find('viewer-info')?.byTag('h3')[0].textContent, stage.scrollLeft, stage.scrollTop]).toEqual([title, 0, 0]);
  }
  press('Fit'); expect(view()).toEqual(['1000px', '100%', false]);
  expect(main.find('fields')).toBeUndefined();
  expect(main.byTag('tr').slice(1).map(row => row.children[0].textContent)).toEqual(['TypeScript', 'Go', 'Total']);
  expect(main.find('total')?.children.map(child => child.textContent)).toEqual(['Total', '3', '11', '3', '5']);
  expect([main.children[0].children.map(child => child.tag), main.children[0].children[1].children[0].textContent]).toEqual([['div', 'div', 'div', 'div', 'div'], 'Since round 1']);
  expect(main.find('summary-comment')?.byTag('textarea')).toHaveLength(1);
});

test('placing a dispute grouped with a late commit retains a separate Retest question', () => {
  const commit = 'a'.repeat(40);
  const journey = { code: 'JOURNEY-1', title: 'Launch', commit };
  const shared = { prompt: 'Keep this integration?', options: [{ id: 'keep', label: 'Keep' }, { id: 'remove', label: 'Remove' }] };
  const item = { type: 'Dispute, Late commit', questions: [shared], title: 'Shared issue', detail: 'One cause', links: [{ label: 'Source', target: 'file.txt' }],
    source: ['DISPUTE-1', commit], journeys: [journey] };
  const expected = { ...item, type: 'Dispute', source: ['DISPUTE-1'], journeys: [],
    specChange: true, questions: [disputeQuestion('')] };
  const context = { media: [], commands: [], dismissed: [], journeys: [journey.code], commits: [commit] };
  const placed = placeRanking({ ...emptyRanking(), orange: [item] }, [{ tier: 'red', item: expected }], context);
  expect(placed.red[0].questions?.map(question => question.options.map(option => option.id)))
    .toEqual([['follow-up', 'drop'], ['keep', 'remove'], ['retest', 'leave']]);
  expect(placed.red[0].questions?.[1].prompt).toBe(shared.prompt);
});

test('review submission calls a receiver-sensitive fetch for both actions', async () => {
  async function browserFetch(this: unknown, url: string, options?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    if (url.endsWith('/attention')) {
      return Response.json({ item: { run: { id: 'run', occurrence: 'live' }, message: 'Review round 1: waiting' } });
    }
    return Response.json({ message: JSON.parse(options?.body as string).text });
  }
  for (const action of ['feedback', 'merge']) {
    const answer = { action, round: 1, head: 'reviewed' };
    expect(await sendReview({ address: 'https://archon.example/api/artifacts/run/review-page.html',
      run: 'run', round: 1, answer, fetch: browserFetch })).toEqual({ kind: 'sent', message: JSON.stringify(answer) });
  }
});

test('grouped spec-change disputes keep separate exact questions and answer sources', () => {
  const disputes = ['Change the default.', ''].map((edit, index) => ({
    tier: 'red' as const, item: { type: 'Dispute', title: `Dispute ${index + 1}`, detail: 'A spec change',
      links: [{ label: 'Source', target: 'file.txt' }], source: [`DISPUTE-${index + 1}`], specChange: true, questions: [disputeQuestion(edit)] },
  }));
  const grouped = { ...disputes[0].item, title: 'Shared cause', source: ['DISPUTE-2', 'DISPUTE-1'] };
  const raw = { ...emptyRanking(), red: [grouped] };
  expect(checkRanking(raw, disputes).problems).toContain('one separate question per spec-change dispute');
  const placed = placeRanking(raw, disputes);
  expect(placed.red).toHaveLength(1);
  expect(checkRanking(placed, disputes).ok).toBe(true);
  expect(placed.red[0].questions?.map(question => [question.source, question.options]))
    .toEqual([['DISPUTE-2', disputeQuestion('').options], ['DISPUTE-1', disputeQuestion('Change the default.').options]]);
});

function rankingFixture(box: Sandbox) {
  const start = box.head();
  box.write('artifacts/review/accepted-head.txt', start);
  box.write('openspec/changes/demo/checklist.md', [
    '| ID | Behavior | Evidence | Status |', '|---|---|---|---|',
    '| CHECK-1 | Saves | Assertion failed | failed |',
    '| CHECK-2 | loads | Not run locally | not verified |',
  ].join('\n'));
  return { start, exec: box.exec, dir: box.path('artifacts'), changeFolder: 'openspec/changes/demo' };
}

test('publication rebuilds missing ranking from required items and refuses an unreadable inventory', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    box.write(`${input.changeFolder}/dispute-log.md`, '## DISPUTE-1: Scope\nStatus: spec-change\n');
    box.git('add', 'openspec');
    box.commit('commit the review sources');
    const commit = box.commitFix();
    const ranking = rankingForPublication(input);
    expect(ranking.red.flatMap(item => item.source)).toEqual(['CHECK-1', 'CHECK-2', 'DISPUTE-1']);
    expect(ranking.orange.flatMap(item => item.source)).toEqual([commit]);
    box.write(`${input.changeFolder}/checklist.md`, '| No status column |');
    expect(() => rankingForPublication(input)).toThrow('checklist with Status column is missing');
  } finally {
    box.dispose();
  }
});

test.each(['merge targets', 'fresh base fetch', 'unreachable remote'])('clean PR-head imports stay visible using %s without imported base work', source => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    box.git('checkout', '-b', 'pr-head');
    box.write('pr-fix.txt', 'Fix pushed to the PR');
    box.git('add', 'pr-fix.txt');
    const pushed = box.commit('Fix pushed to the PR');
    box.git('checkout', '-b', 'base-tip', input.start);
    box.write('base-fix.txt', 'Unrelated base work');
    box.git('add', 'base-fix.txt');
    const baseWork = box.commit('Unrelated base work');
    box.git('checkout', '-b', 'round', input.start);
    box.git('merge', '--no-ff', '--no-edit', 'pr-head');
    box.git('merge', '--no-ff', '--no-edit', 'base-tip');
    if (source === 'merge targets') box.write('artifacts/review/merge-targets.json', '["pr-head","base-tip"]');
    else {
      const bare = box.addBareOrigin();
      box.gitIn(bare, 'fetch', box.dir, 'base-tip:refs/heads/base-tip');
      box.git('update-ref', 'refs/remotes/origin/base-tip', input.start);
      box.write('artifacts/pull-request.json', '{"base":"base-tip"}');
      if (source === 'unreachable remote') box.git('remote', 'set-url', 'origin', box.path('missing.git'));
      refreshBase(box.exec, input.dir, () => undefined);
    }
    const expected = source === 'unreachable remote' ? [pushed, baseWork] : [pushed];
    expect(inventory(input).later_commits.map(item => item.source[0])).toEqual(expected);
    expect(feedbackScope(box.exec, input.dir, input.start, 'HEAD').revisions.split('\n')).toEqual(expected);
  } finally {
    box.dispose();
  }
});

test('a moved but unsuccessful archive keeps the archived folder for feedback and remains pending', () => {
  const box = createSandbox();
  try {
    const { dir, changeFolder } = rankingFixture(box);
    const archived = 'openspec/changes/archive/2026-11-24-demo';
    mkdirSync('openspec/changes/archive');
    renameSync(changeFolder, archived);
    box.write('artifacts/step-results.json', '{"archive":{"ok":false,"problems":"commit failed","remaining":"retry"}}');
    box.write('artifacts/review/pages.json', '[{"round":1,"status":"feedback sent"}]');
    box.write('artifacts/review-answers-round-1.json', '{"action":"feedback","round":1,"head":"head","time":"now"}');
    expect(startRound(box.forgeTools([]), { dir, folder: changeFolder, text: '' })).toMatchObject({
      change_folder: archived, archive_needed: true, mode: 'feedback', round: 2,
    });
  } finally { box.dispose(); }
});

test('a no-change response cannot dismiss a checklist failure or a commit its review round has not read', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box); const late = box.commitFix();
    box.write('artifacts/review/pages.json', '[{"round":1,"file":"review-page-round-1.html"}]');
    box.write('artifacts/review-page-round-1.html', '<script type="application/json" id="page-data">{}</script>');
    box.write('artifacts/review-answers-round-1.json', JSON.stringify({ round: 1, answers: [{ item: late, option: 'review-round' }] }));
    box.write('artifacts/review-answers-round-2.json', JSON.stringify({ action: 'merge', round: 2 }));
    box.write('artifacts/review-response-round-1.json', JSON.stringify(['CHECK-1', 'CHECK-2', late].map(item => ({ item, status: 'no-change' }))));
    const result = inventory(input);
    expect(result.context.dismissed).toEqual([]);
    expect(result.required.map(row => [row.tier, row.item.source[0]])).toEqual([['red', 'CHECK-1'], ['red', 'CHECK-2'], ['orange', late]]);
    box.write('artifacts/review/review-round-commits.json', JSON.stringify([late])); markReviewRoundDone(input.dir);
    expect(inventory(input).later_commits).toEqual([]);
  } finally { box.dispose(); }
});

test('invalid evidence manifests preserve usable entries and become a named review failure', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    const shot = { file: 'one.png', title: 'Start', shows: 'The form', revision: input.start, alt: 'Form' };
    box.write('artifacts/acceptance-screenshots/round-1/one.png', 'image');
    box.write('artifacts/acceptance-screenshots/round-1/manifest.json', JSON.stringify([null, shot]));
    box.write('artifacts/acceptance-screenshots/round-2/manifest.json', '[');
    box.write('artifacts/acceptance-journeys/round-1.json', '{"journeys":[]}');
    box.write('artifacts/acceptance-journeys/round-2.json', '[{"code":"JOURNEY-2","title":"Save","scenario":"Save a form","repeat":"Click save"},{}]');
    const result = inventory(input);
    expect(result.context.media).toEqual(['acceptance-screenshots/round-1/one.png']);
    expect(result.context.journeys).toEqual(['JOURNEY-2']);
    const failures = stepFailures(input.dir);
    expect(failures).toHaveLength(1);
    expect(failures[0].source).toEqual(['failure:review-media']);
    expect(failures[0].links).toEqual([]);
    expect(failures[0].failLine).toContain('acceptance evidence');
  } finally {
    box.dispose();
  }
});

test('next-entry numbering continues existing decision and dispute codes', () => {
  expect(numberLog('## DECIDE-12: Existing\nText\n## Another choice\nText', 'DECIDE')).toContain('## DECIDE-13: Another choice');
  expect(numberLog('## DP-04: Existing\nText\n## Another dispute\nText', 'DISPUTE')).toContain('## DISPUTE-5: Another dispute');
});

test('accepted head uses the saved, ready, tested, and recorded PR revisions in order', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    const ready = box.commitFix('accepted');
    const tested = box.commitFix('tested');
    const opened = box.commitFix('opened');
    const head = box.commitFix('head');
    box.write('artifacts/acceptance-round-status.txt', `READY ${ready}\n`);
    box.write('artifacts/acceptance-tested-revision.txt', `${input.start}\n${tested}\n`);
    box.write('artifacts/pull-request.json', JSON.stringify({ opened_head_revision: opened, head_revision: head }));
    expect(acceptedHead(input)).toBe(input.start);
    box.write('artifacts/review/accepted-head.txt', '');
    expect(acceptedHead(input)).toBe(ready);
    box.write('artifacts/acceptance-round-status.txt', 'FAILED');
    expect(acceptedHead(input)).toBe(tested);
    box.write('artifacts/acceptance-tested-revision.txt', '');
    expect(acceptedHead(input)).toBe(opened);
    box.write('artifacts/pull-request.json', JSON.stringify({ head_revision: head }));
    expect(acceptedHead(input)).toBe(head);
    box.write('artifacts/pull-request.json', JSON.stringify({ head_revision: 'missing' }));
    expect(() => acceptedHead(input)).toThrow('accepted revision is missing or invalid');
  } finally {
    box.dispose();
  }
});

test('missing screenshot manifests are reported only when a round contains a supported image', () => {
  const box = createSandbox();
  try {
    const { dir } = rankingFixture(box);
    const root = 'artifacts/acceptance-screenshots';
    mkdirSync(box.path(`${root}/round-1`), { recursive: true });
    box.write(`${root}/round-2/notes.txt`, 'No screenshots taken');
    expect(stepFailures(dir)).toEqual([]);

    box.write(`${root}/round-3/capture.JPEG`, 'image');
    const failures = stepFailures(dir);
    expect(failures).toHaveLength(1);
    expect(failures[0].source).toEqual(['failure:review-media']);
    expect(reviewMedia(dir).problems.map(problem => problem.path)).toEqual([box.path(`${root}/round-3/manifest.json`)]);
    expect(failures[0].detail).not.toContain('manifest.json');
  } finally {
    box.dispose();
  }
});

test('malformed ranking collections are reported and repaired', () => {
  const item = { type: 'Risk', title: 'Coverage', detail: 'Missing check', links: [{ label: 'Source', target: 'file.txt' }], source: ['CHECK-1'] };
  const malformed = [
    { journeys: {} }, { journeys: [null] }, { questions: {} }, { questions: [null] },
    { questions: [{ prompt: 'Choose', options: [{ id: 'fix', label: 'Fix', detail: {} }, { id: 'leave', label: 'Leave' }] }] },
  ];
  for (const bad of malformed) {
    const raw = { ...emptyRanking(), red: [{ ...item, ...bad }] } as unknown as ReturnType<typeof emptyRanking>;
    expect(checkRanking(raw, []).problems).toContain('invalid questions or journeys');
    const repaired = placeRanking(raw, []);
    expect(checkRanking(repaired, []).ok).toBe(true);
    expect(repaired.red[0].source).toEqual(item.source);
    expect(repaired.red[0].questions?.[0].options.some(option => option.id === 'fix')).toBe(true);
  }
});

test('promoted yellow late commits preserve journeys and gain a Retest choice', () => {
  const commit = 'a'.repeat(40);
  const journey = { code: 'JOURNEY-1', title: 'Launch', commit };
  const item = { type: 'Late commit', title: commit, detail: '1 file changed\nTests: none named.', links: [{ label: 'Commit', target: `commit:${commit}` }], source: [commit] };
  const raw = { ...emptyRanking(), yellow: [{ ...item, links: [{ label: 'Commit', target: `commit:${commit}` }], journeys: [journey] }] };
  const context = { media: [], commands: [], dismissed: [], journeys: [journey.code], commits: [commit] };
  const placed = placeRanking(raw, [{ tier: 'orange', item }], context);
  expect(placed.orange[0].journeys).toEqual([journey]);
  expect(placed.orange[0].questions?.flatMap(question => question.options.map(option => option.id))).toContain('retest');
});

test('mixed evidence renders a safe, ordered page and mirrors command comments', async () => {
  const file = 'acceptance-commands/round-1/output.txt';
  const command = { kind: 'command', file, round: 1, revision: 'decafbad1234', command: 'tool verify', title: 'Check export', shows: 'Evidence', excerpt: '  line 1\n    line 2' };
  const forgeBase = 'https://github.com/owner/repo';
  const head = '0123456789abcdef0123456789abcdef01234567';
  const href = `${forgeBase}/blob/${head}/file.txt#L2`;
  const red = { type: 'Failure', title: 'The `verify` command fails', source: ['failure:acceptance'], failLine: 'Acceptance stopped.',
    questions: [{ source: 'hidden-id', prompt: 'How should export work?', options: [{ id: 'fix', label: 'Fix' }, { id: 'leave', label: 'Leave' }] }],
    detail: `Coverage:\n- **Test** \`verify\`\n* </script><img onerror=x>\n\n[allowed](${href}) [other](https://example.test/) [lookalike](https://github.com/owner/repo-lookalike/blob/${head}/file.txt) [local](file:///tmp/private)`,
    evidence: command, links: [] };
  const yellow = { ...red, type: 'Agent decision', title: 'Use the default', evidence: undefined, failLine: undefined,
    source: ['DECIDE-1'], links: [{ label: 'What changed', href }, { label: 'Why', href: `${href}0` }] };
  const data = { title: 'Export settings', round: 2, head, run: 'review-run', repository: 'owner/repo', pullRequest: 7,
    pullRequestUrl: `${forgeBase}/pull/7`, logs: { decisions: href, disputes: `${href}0` }, forgeBase, summary: '', recap: [], size: null,
    red: [red], orange: [], yellow: [yellow], commands: [command], keyEvidence: [command], wait: true, merge: true,
    screenshots: [{ file: 'screen.png', href: 'screen.png', title: 'Preview', shows: 'Shows export', round: 2 }] };
  const page = render(data);
  const main = page('main'); expect(main.children.map(child => child.id)).toEqual(['summary', 'key-evidence', 'concerns']); expect(main.find('summary-comment')).toBeDefined();
  expect(page('.meta-row').find('red')).toBeDefined();
  expect(page('#send-status').textContent).toContain('1 high concern');
  const grouped = { ...red, questions: [...red.questions, { ...red.questions[0], source: 'another-source' }] };
  const one = render({ ...data, red: [grouped] }); expect(one('#send-status').textContent).toContain('1 high concern');
  one('#send-actions').find('send')?.onclick?.(); expect(one('#send-status').textContent).toBe('Answer the questions in concern 1 before sending.');
  expect(render({ ...data, red: [grouped, red] })('#send-status').textContent).toContain('2 high concerns');
  const unanswered = render({ ...data, red: [grouped, red] }); unanswered('#send-actions').find('send')?.onclick?.();
  const retry = render({ ...data, red: [] }); const button = retry('#send-actions').find('send'); button?.onclick?.(); await Bun.sleep(0);
  expect([button?.disabled, retry('#send-status').textContent]).toEqual([false, 'Cannot send from here.']);
  expect(unanswered('main').byTag('fieldset').map(field => [field.classList.contains('missing'), field.find('q-missing')?.hidden])).toEqual([[true, false], [true, false], [true, false], [false, true]]);
  const sendStatus = unanswered('#send-status');
  expect([sendStatus.className, sendStatus.textContent, sendStatus.byTag('a').map(anchor => anchor.href)])
    .toEqual(['error', 'Answer the questions in concerns 1 and 2 before sending.', ['#red-1', '#red-2']]);
  page('#send-actions').find('merge')?.onclick?.();
  expect(page('body').find('confirm')?.textContent).toContain('1 high concern');
  const medium = render({ ...data, red: [], orange: [red] });
  expect(medium('.meta-row').find('orange')).toBeDefined(); expect(medium('#send-status').textContent).toContain('1 medium concern');
  expect(page('.masthead .meta').byTag('a').map(anchor => anchor.href)).toEqual([data.pullRequestUrl, href, `${href}0`]);
  expect(page('.masthead .meta').byTag('dd').map(value => value.textContent)).toContain(data.head);
  expect(main.children.at(-1)?.children.filter(child => child.className === 'tier-group').map(child => child.id)).toEqual(['red', 'yellow']);
  expect(main.byTag('article').map(article => article.children[0].textContent)).toEqual(['1', '2']);
  expect(main.find('tier-head')?.find('dot')?.className).toBe('dot red');
  expect(main.find('tier-head')?.find('c')?.textContent).toBe('(1)');
  expect(main.find('links')?.byTag('a').map(anchor => anchor.textContent)).toEqual(['What changed', 'Why']);
  expect(main.find('links-label')?.textContent).toBe('On GitHub');
  const concern = main.find('item-body');
  expect(concern?.children.map(child => child.className)).toEqual(['tags', '', 'fail-line', 'prose', 'cmd', 'ask']);
  expect(concern?.find('ask')?.textContent).not.toContain('hidden-id');
  expect(concern?.find('prose')?.children.slice(0, 2).map(child => child.tag)).toEqual(['p', 'ul']);
  expect(concern?.find('prose')?.textContent).toContain('</script><img');
  expect(concern?.find('prose')?.byTag('a').map(anchor => anchor.href)).toEqual([href]);
  expect(concern?.find('prose')?.byTag('strong')).toHaveLength(1);
  expect(page('.rail > ol').byTag('code').map(code => code.textContent)).toEqual(['verify']);
  expect(main.byTag('pre').map(entry => entry.textContent)).toEqual(Array(3).fill(command.excerpt));
  expect(main.byTag('details')).toHaveLength(1);
  const key = main.children[1];
  const gallery = key.find('all-shots');
  expect(gallery?.children[0].textContent).toBe('All acceptance evidence (1 screenshot, 1 command)');
  expect(gallery?.byTag('h4').map(heading => heading.textContent)).toEqual(['Acceptance round 3', 'Acceptance round 2 · decafbad']);
  expect(gallery?.byTag('h5').map(heading => heading.textContent)).toEqual(['Screenshots (1)', 'Commands (1)']);
  expect(key.find('cmd-head')?.find('cmd-meta')?.textContent).toBe('Round 2 · decafbad');
  expect(key.find('cmd-head')?.byTag('p')[0].textContent).toBe(command.shows);
  expect(key.find('cmd-head')?.find('comment-btn')).toBeDefined();
  expect(key.find('prompt')?.textContent).toBe('$');
  const comments = [key.byTag('textarea')[0], main.byTag('details')[0].byTag('textarea')[0]];
  expect(comments[0].hidden).toBe(true);
  main.children[1].find('comment-btn')?.onclick?.();
  expect(comments[0].hidden).toBe(false);
  comments[0].value = 'Can this explain which value failed?';
  comments[0].listeners.get('input')?.();
  expect(comments[1].value).toBe(comments[0].value);
  expect(comments[1].hidden).toBe(false);
  expect(main.byTag('details')[0].classList.contains('has-comment')).toBe(true);
  const answer = collectReview({ action: 'feedback', round: 2, head: data.head, rows: [], screenshots: [],
    commands: [command, command], comments: new Map([[file, comments[1].value]]) });
  expect('commandComments' in answer && answer.commandComments).toEqual([{ ref: file, round: 1, comment: comments[0].value }]);
  const answered = render(data, answer)('main');
  expect(answered.children[1].byTag('textarea')[0].value).toBe(comments[0].value);
  const commandOnly = render({ ...data, red: [], yellow: [], screenshots: [], wait: false })('main');
  expect(commandOnly.children.map(child => child.id)).toEqual(['summary', 'key-evidence', 'concerns']);
  const empty = render({ ...data, red: [], yellow: [], commands: [], screenshots: [], keyEvidence: [], wait: false });
  expect(empty('main').children.map(child => child.id)).toEqual(['summary', 'concerns']);
  expect(empty('main').find('empty')).toBeDefined();
  expect(empty('.meta-row').find('concerns-total')?.className).toBe('concerns-total');
});
test('fallback groups a checklist row with an uncommitted archive under its failure concern', () => {
  const folder = 'openspec/changes/archive/2026-11-26-demo';
  const archive = { type: 'Failure', title: 'Archive did not pass', detail: 'Repair the archive.', links: [], source: ['failure:archive'] };
  const row = { type: 'Risk', title: 'Exports preserve options', detail: 'Acceptance did not verify this.',
    links: [{ label: 'The checklist row', target: `${folder}/checklist.md#L3` }], source: ['CHECK-1'] };
  const context = { media: [], commands: [], journeys: [], commits: [], dismissed: [],
    links: { folder, base: 'https://github.com/owner/repo', head: 'abc', dir: 'run',
      exec: () => ({ status: 1, stdout: '', stderr: '' }) } };
  const required = [{ tier: 'red' as const, item: archive }, { tier: 'yellow' as const, item: row }];
  const ranking = placeRanking(emptyRanking(), required, context);
  expect(ranking.red).toHaveLength(1);
  expect(ranking.red[0].source).toEqual(['failure:archive', 'CHECK-1']);
  expect(ranking.red[0].detail).toContain(row.title);
  expect(ranking.red[0]).toMatchObject({ links: [], unlinkedSources: ['CHECK-1'] });
});
