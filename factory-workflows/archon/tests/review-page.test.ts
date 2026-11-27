import { acceptedHead, emptyRanking, stepFailures, inventory } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkRanking, placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { disputeQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { expect, test } from 'bun:test';
import { renameSync, mkdirSync } from 'node:fs';
import { rankingForPublication } from '../.archon/workflows/codagent/.shared/lib/finish-run.ts';
import { feedbackScope, refreshBase } from '../.archon/workflows/codagent/.shared/lib/review-revisions.ts';
import { numberLog } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { createSandbox, type Sandbox } from './helpers.ts';
import { runInNewContext } from 'node:vm';
import { collectReview, initialChoice, sendReview, missingAnswers, sizeTotals } from '../.archon/workflows/codagent/.shared/lib/review-send.ts';
import { reviewMedia } from '../.archon/workflows/codagent/.shared/lib/review-media.ts';
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
    screenshotComments: [{ file: 'two.png', round: 3, comment: 'Alignment' }], commandComments: [],
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
  private text = '';
  value = '';
  href = '';
  onclick?: () => void;
  showModal() {}
  focus() {}
  hidden = false;
  children: Element[] = [];
  dataset: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  classList = { add: () => undefined };
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
  setAttribute() {}
  addEventListener(event: string, handler: () => void) { this.listeners.set(event, handler); }
  querySelector() { return undefined; }
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
  runInNewContext(script, { URL, location: { href: 'file:///review.html' },
    document: { querySelector, createElement: (tag: string) => new Element(tag), body: querySelector('body') } });
  return querySelector;
}

test('dynamic review markup keeps item content and recommendation out of the number and radio columns', () => {
  const data = { title: 'Review title', round: 2, run: 'run-1', head: 'head', codes: {},
    summary: 'Summary', recap: [{ note: 'Round update' }], decisions: '## DECIDE-1: Choice\n- Rationale: Reason',
    disputes: '', keyEvidence: [], wait: false, orange: [], yellow: [],
    screenshots: [{ href: 'one.png', file: 'one.png', round: 0, title: 'Start' }, { href: 'two.png', file: 'two.png', round: 2, title: 'Retest' }],
    size: [{ language: 'Go', files: 1, added: 2, modified: 3, removed: 4 }],
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
  expect(gallery?.children.slice(1).map(group => group.children[0].textContent)).toEqual(['Acceptance round 0', 'Acceptance round 2']);
  expect(gallery?.find('thumb-label')?.textContent).toBe('Start');
  expect(main.find('fields')).toBeUndefined();
  expect(main.find('total')?.children.map(child => child.textContent)).toEqual(['Total', '1', '2', '3', '4']);
  expect(main.children[0].children.map(child => child.tag)).toEqual(['div', 'ul', 'div', 'div']);
});

test('placing a dispute grouped with a late commit retains a separate Retest question', () => {
  const commit = 'a'.repeat(40);
  const journey = { code: 'JOURNEY-1', title: 'Launch', commit };
  const item = { type: 'Dispute, Late commit', title: 'Shared issue', detail: 'One cause', links: [{ label: 'Source', target: 'file.txt' }],
    source: ['DISPUTE-1', commit], journeys: [journey] };
  const expected = { ...item, type: 'Dispute', source: ['DISPUTE-1'], journeys: [],
    specChange: true, questions: [disputeQuestion('')] };
  const context = { media: [], commands: [], dismissed: [], journeys: [journey.code], commits: [commit] };
  const placed = placeRanking({ ...emptyRanking(), orange: [item] }, [{ tier: 'red', item: expected }], context);
  expect(placed.red[0].questions?.map(question => question.options.map(option => option.id)))
    .toEqual([['follow-up', 'drop'], ['retest', 'leave']]);
});

test('review submission calls a receiver-sensitive fetch for both actions', async () => {
  async function browserFetch(this: unknown, url: string, options?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    if (url.endsWith('/attention')) {
      return Response.json({ item: { runId: 'run', occurrence: 'live', message: 'Review round 1: waiting' } });
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
  } finally {
    box.dispose();
  }
});

test('a no-change response cannot dismiss a checklist failure that still needs work', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    box.write('artifacts/review-response-round-1.json', JSON.stringify([
      { item: 'CHECK-1', status: 'no-change' }, { item: 'CHECK-2', status: 'no-change' },
    ]));
    const result = inventory(input);
    expect(result.context.dismissed).toEqual([]);
    expect(result.required.map(row => [row.tier, row.item.source[0]])).toEqual([['red', 'CHECK-1'], ['red', 'CHECK-2']]);
  } finally {
    box.dispose();
  }
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

test('command manifests validate whole lines, normalize excerpts, and reach ranking preparation', () => {
  const box = createSandbox();
  try {
    const input = rankingFixture(box);
    const base = 'artifacts/acceptance-commands/round-1';
    const entry = { title: 'Check export', shows: 'Rejects input', revision: input.start, command: 'tool verify', excerpt: '  invalid\n  detail', output: 'ok.txt' };
    box.write(`${base}/ok.txt`, '\u001b[31m  invalid\u001b[0m\r\n  detail\r\nfull only\r\n');
    const twenty = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    box.write(`${base}/long.txt`, `${twenty}\nline 20\n`);
    const bad = [{ ...entry, excerpt: 'invalid' }, { ...entry, output: 'missing.txt' },
      { ...entry, output: 'long.txt', excerpt: `${twenty}\nline 20` }, { output: 'bad.txt' }];
    box.write(`${base}/manifest.json`, JSON.stringify([entry, { ...entry, output: 'long.txt', excerpt: twenty }, ...bad]));
    box.write('artifacts/acceptance-screenshots/round-2/screen.png', 'example');
    box.write('artifacts/acceptance-screenshots/round-2/manifest.json', JSON.stringify([
      { file: 'screen.png', title: 'Screen', shows: 'Shows export', revision: input.start, alt: 'Export' }, null,
    ]));
    const media = reviewMedia(input.dir);
    expect(media.commands.map(command => command.excerpt)).toEqual([entry.excerpt, twenty]);
    expect(media.commands[0]).toMatchObject({ file: 'acceptance-commands/round-1/ok.txt', round: 1 });
    expect(media.problems).toHaveLength(5);
    expect(media.problems.map(problem => problem.path)).toEqual(expect.arrayContaining([
      box.path(`${base}/missing.txt`), box.path(`${base}/long.txt`), box.path(`${base}/manifest.json`),
    ]));
    const script = '../.archon/workflows/codagent/implement-change/scripts/finish.ts';
    const result = Bun.spawnSync([process.execPath, new URL(script, import.meta.url).pathname], { cwd: box.dir, env: {
      ...process.env, ARTIFACTS_DIR: input.dir, INPUTS_OP: 'prepare-ranking', INPUTS_CHANGE_FOLDER: input.changeFolder,
    } });
    expect(result.exitCode).toBe(0);
    const evidence = JSON.parse(box.read('artifacts/review/evidence.json'));
    expect(evidence.map((value: { round: number }) => value.round)).toEqual([2, 1, 1]);
    expect(JSON.parse(box.read('artifacts/review/media-problems.json'))).toHaveLength(5);
    expect(reviewMedia(box.path('empty'))).toMatchObject({ commands: [], shots: [], problems: [] });
  } finally { box.dispose(); }
});

test('mixed evidence renders a safe, ordered page and mirrors command comments', () => {
  const file = 'acceptance-commands/round-1/output.txt';
  const command = { kind: 'command', file, round: 1, command: 'tool verify', title: 'Check export', shows: 'Evidence', excerpt: '  line 1\n    line 2' };
  const forgeBase = 'https://github.com/owner/repo';
  const href = `${forgeBase}/blob/reviewed/file.txt#L2`;
  const red = { type: 'Failure', title: 'The `verify` command fails', source: ['failure:acceptance'], failLine: 'Acceptance stopped.',
    questions: [{ source: 'hidden-id', prompt: 'How should export work?', options: [{ id: 'fix', label: 'Fix' }, { id: 'leave', label: 'Leave' }] }],
    detail: `Coverage:\n- **Test** \`verify\`\n* </script><img onerror=x>\n\n[allowed](${href}) [other](https://example.test/) [local](file:///tmp/private)`,
    evidence: command, links: [] };
  const yellow = { ...red, type: 'Agent decision', title: 'Use the default', evidence: undefined, failLine: undefined,
    source: ['DECIDE-1'], links: [{ label: 'What changed', href }] };
  const data = { title: 'Export settings', round: 2, head: 'reviewed', run: 'review-run', repository: 'owner/repo', pullRequest: 7,
    pullRequestUrl: `${forgeBase}/pull/7`, logs: { decisions: href }, forgeBase, summary: '', recap: [], size: null,
    red: [red], orange: [], yellow: [yellow], commands: [command], keyEvidence: [command], wait: true, merge: true,
    screenshots: [{ file: 'screen.png', href: 'screen.png', title: 'Preview', shows: 'Shows export', round: 2 }] };
  const page = render(data);
  const main = page('main');
  expect(main.children.map(child => child.id)).toEqual(['summary', 'key-evidence', 'acceptance-evidence', 'concerns']);
  expect(page('.meta-row').find('red')).toBeDefined();
  expect(page('#send-status').textContent).toContain('1 high concern');
  page('#send-actions').find('merge')?.onclick?.();
  expect(page('body').find('confirm')?.textContent).toContain('1 high concern');
  const medium = render({ ...data, red: [], orange: [red] });
  expect(medium('.meta-row').find('orange')).toBeDefined();
  expect(medium('#send-status').textContent).toContain('1 medium concern');
  expect(page('.masthead .meta').byTag('a').map(anchor => anchor.href)).toEqual([data.pullRequestUrl, href]);
  expect(main.children.at(-1)?.children.filter(child => child.className === 'tier-group').map(child => child.id)).toEqual(['red', 'yellow']);
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
  const comments = [main.children[1].byTag('textarea')[0], main.children[2].byTag('textarea')[0]];
  expect(comments[0].hidden).toBe(true);
  main.children[1].find('comment-btn')?.onclick?.();
  expect(comments[0].hidden).toBe(false);
  comments[0].value = 'Can this explain which value failed?';
  comments[0].listeners.get('input')?.();
  expect(comments[1].value).toBe(comments[0].value);
  expect(comments[1].hidden).toBe(false);
  const answer = collectReview({ action: 'feedback', round: 2, head: data.head, rows: [], screenshots: [],
    commands: [command, command], comments: new Map([[file, comments[1].value]]) });
  expect('commandComments' in answer && answer.commandComments).toEqual([{ ref: file, round: 1, comment: comments[0].value }]);
  const answered = render(data, answer)('main');
  expect(answered.children[1].byTag('textarea')[0].value).toBe(comments[0].value);
  const commandOnly = render({ ...data, red: [], yellow: [], screenshots: [], wait: false })('main');
  expect(commandOnly.children.map(child => child.id)).toEqual(['summary', 'key-evidence', 'acceptance-evidence', 'concerns']);
  const empty = render({ ...data, red: [], yellow: [], commands: [], screenshots: [], keyEvidence: [], wait: false });
  expect(empty('main').children.map(child => child.id)).toEqual(['summary', 'concerns']);
  expect(empty('main').find('empty')).toBeDefined();
  expect(empty('.meta-row').find('concerns-total')?.className).toBe('concerns-total');
});
