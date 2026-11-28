import { commitLogs } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { join } from 'node:path'; import { mkdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { inventory, emptyRanking, itemPrints, stepFailures, type Item, type Ranking, type RequiredItem } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkRanking, placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { settleRepeats } from '../.archon/workflows/codagent/.shared/lib/review-repeats.ts';
import { publishPackage } from '../.archon/workflows/codagent/.shared/lib/publish-review.ts';
import { readPages } from '../.archon/workflows/codagent/.shared/lib/review-pages.ts';
import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { checkResponse, recordRetest } from '../.archon/workflows/codagent/.shared/lib/review-work.ts';
import { resolveTarget } from '../.archon/workflows/codagent/.shared/lib/review-links.ts';
import { disputeQuestion, standardQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { createSandbox, type Sandbox, rule, ok, failed, prView, reviewPublisher } from './helpers.ts';
let box: Sandbox; let accepted: string;
const folder = 'openspec/changes/demo';
const item = (type = 'Failure', source = 'I-1'): Item => ({ type, title: `Concern for ${source}`, detail: 'specific evidence', links: [{ label: 'Source', target: type === 'Late commit' ? `commit:${source}` : 'file.txt' }], source: [source], questions: [standardQuestion(type)] });
const required = (): RequiredItem[] => [{ tier:'red', item:item() },{tier:'orange',item:item('Dispute','DP-01')}];
beforeEach(() => {
  box=createSandbox();accepted=box.head();
  box.write(`${folder}/checklist.md`,'| ID | Behavior | Evidence | Status |\n|---|---|---|---|\n| I-1 | fails | assertion failed | failed |\n| I-2 | gap | unavailable | not verified |\n| I-3 | works | passed | verified |\n');
  box.write(`${folder}/decision-log.md`,'## D-01: Later choice\nReason: compatibility.\n');
  box.write(`${folder}/dispute-log.md`,'## DP-01: Defect\nReviewer: unsafe. Implementor: intended.\n\n## DP-02: PR comment: style\nPreference.\n');
  box.write('artifacts/pull-request.json',JSON.stringify({head_revision:accepted}));
  box.write('artifacts/pr-body.md','The change summary.');
});
afterEach(()=>box.dispose());
const inv=()=>inventory({exec:box.exec,dir:box.path('artifacts'),changeFolder:folder});
test('INT-009 accepted head fallback and openspec-only commit exclusion',()=>{
  box.git('add','openspec');box.commit('logs');expect(inv().later_commits).toEqual([]);
  const changed=box.commitFix();expect(inv().later_commits.map(i=>i.source[0])).toEqual([changed]);
  expect(inv().later_commits[0].detail).toContain('1 file changed');expect(inv().accepted_head).toBe(accepted);
  box.write('artifacts/acceptance-tested-revision.txt',changed);expect(inv().accepted_head).toBe(changed);
  box.write('artifacts/acceptance-round-status.txt',`READY ${accepted}\n`);expect(inv().accepted_head).toBe(accepted);
});
test('INT-009 inventory independently requires failures gaps non-PR disputes and late commits',()=>{
  const list=inv().required;
  expect(list.map(row=>row.item.source[0])).toEqual(['I-1','I-2','D-01','DP-01','DP-02']);
  expect(list.find(row=>row.item.source.includes('DP-02'))?.tier).toBe('yellow');
});
test.each(['omit','lower','duplicate','empty','unknown'])('INT-009 rejects %s ranking',kind=>{
  const ranking=emptyRanking();ranking.red=[item()];ranking.orange=[item('Dispute','DP-01')];
  if(kind==='omit')ranking.red=[];
  if(kind==='lower'){ranking.yellow=ranking.red;ranking.red=[];}
  if(kind==='duplicate')Object.assign(ranking, { white: [item()] });
  if(kind==='empty')ranking.red[0].detail='';
  if(kind==='unknown')ranking.red[0].type='Unknown';
  expect(checkRanking(ranking,required()).ok).toBe(false);
});
test('INT-009 discretionary PR style disputes retain yellow and merged types are accepted',()=>{
  const ranking=emptyRanking();ranking.red=[{...item(),type:'Failure, Dispute',source:['I-1','DP-01']}];
  ranking.yellow=[item('Dispute','DP-02')];expect(checkRanking(ranking,required()).ok).toBe(true);
});
test('INT-009 placement fills omissions corrects floors and names uncovered late commits',()=>{
  box.commitFix();const source=inv();const ranking=emptyRanking();Object.assign(ranking, { white: [item()] });
  const placed=placeRanking(ranking,source.required);expect(checkRanking(placed,source.required).ok).toBe(true);
  const late = placed.orange.find(i=>i.type==='Late commit');
  if (!late) throw new Error('missing late commit');
  expect(late.detail).toContain('still needs review'); expect(late.detail).toContain('Tests: none named.');
  late.detail='Tests: test';expect(checkRanking(placed,source.required).ok).toBe(false);
});
test('INT-009 a late commit sized without openspec/ passes, and placement keeps its detail as written',()=>{
  const sha=box.commitFix();const source=inv();
  const own={...item('Late commit',sha),title:`Commit ${sha.slice(0,7)} after acceptance`,detail:'Size: 7 files changed, 9 insertions(+)\n\nTests: none cover it.'};
  const ranking=emptyRanking();ranking.orange=[own];ranking.red=[item('Failure','I-1')];
  const late = source.required.filter(row => row.item.type === 'Late commit');
  expect(checkRanking(ranking, late).ok).toBe(true);
  expect(checkRanking({ ...ranking, orange: [{ ...own, links: ranking.red[0].links }] }, late).problems).toContain('needs a commit link');
  expect(checkRanking({ ...ranking, orange: [{ ...own, links: [] }] }, late).problems).toContain('missing links');
  const placed=placeRanking(ranking,source.required);
  expect(placed.orange.find(entry=>entry.source.includes(sha))?.detail).toBe(own.detail);
});
test.each(['write','readback'])('INT-009 package %s failure throws',kind=>{
  const tools=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView({ head_revision: box.head() }))),rule(['forge','pr.edit-body'],kind==='write'?failed('permission','refused'):ok('pr.edit-body',{}))]);
  expect(()=>publishPackage(tools, { dir: box.path('artifacts'), folder, ranking: emptyRanking() })).toThrow(kind==='write'?'refused':'read-back');
});
test('INT-009 wrong source type is rejected and deterministic placement repairs it',()=>{
  const ranking=emptyRanking();ranking.red=[item('Agent decision')];
  expect(checkRanking(ranking,[required()[0]]).problems).toContain('wrong type');
  expect(checkRanking(placeRanking(ranking,[required()[0]]),[required()[0]]).ok).toBe(true);
});
test('INT-009 grouped late commits retain every size tests and merged symptom after placement',()=>{
  const source=inv();const one=box.commitFix('first change');const two=box.commitFix('second\nchange\nwith more lines');
  const commits=inventory({exec:box.exec,dir:box.path('artifacts'),changeFolder:folder}).required.filter(row=>row.item.type==='Late commit');
  const ranking=emptyRanking();ranking.yellow=[{...item('Late commit, Agent decision','D-01'),title:'Grouped changes',detail:'Original symptom: integration changed.\nTests: regression.',source:[one,two,'D-01']}];
  const placed=placeRanking(ranking,[...source.required,...commits]);expect(checkRanking(placed,[...source.required,...commits]).ok).toBe(true);
  const group=placed.orange.find(entry=>entry.source.includes(one)&&entry.source.includes(two));expect(group?.detail).toContain('Original symptom');expect(group?.detail).toContain('Tests: regression.');
  for(const expected of commits){expect(group?.detail).toContain(expected.item.title);expect(group?.detail).toContain(expected.item.detail.split('\n')[0]);}
});
test('INT-009 merge conflict resolution is inventoried and OpenSpec-only merges are excluded',()=>{
  const base=box.head();box.git('checkout','-qb','side');box.commitFix('side');box.git('checkout','feature');box.commitFix('main');
  const merge=box.exec('git',['merge','side','--no-ff','-m','merge']);expect(merge.status).not.toBe(0);
  box.write('file.txt','product conflict resolution');box.git('add','file.txt');const merged=box.commit('merge resolved');
  const found=inv().later_commits.find(entry=>entry.source.includes(merged));expect(found).toBeDefined();expect(found?.detail).toContain('1 file changed');
  box.git('checkout','-qb','spec-side');box.write('openspec/specs/new/spec.md','spec');box.git('add','openspec/specs/new/spec.md');box.commit('spec');box.git('checkout','feature');box.git('merge','spec-side','--no-ff','-m','spec merge');
  expect(inv().later_commits.map(entry=>entry.source[0])).not.toContain(box.head());expect(base).toBe(accepted);
});
test('INT-009 actual blocked acceptance is linked to its numbered committed decision',()=>{
  box.write('artifacts/decision-log.md','## Fallback choice\nQuestion: choose the fallback.\nRequirement: approved fallback.\nDecision pending from user: choose.\n');
  const file=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/check-acceptance-progress.ts');
  const result=Bun.spawnSync([process.execPath,file],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_BLOCKED:'true',INPUTS_FIX:'true',INPUTS_REASON:'choose the fallback'}});
  expect(result.exitCode).toBe(0);expect(commitLogs(box.exec,box.path('artifacts'),'demo').ok).toBe(true);
  const failure=stepFailures(box.path('artifacts')).find(entry=>entry.source.includes('failure:acceptance'));
  expect(failure?.failLine).toContain('Acceptance did not converge');
  expect(failure?.detail).not.toContain('choose the fallback');
  const context = { base: 'https://github.com/owner/repo', head: box.head(), dir: box.path('artifacts'), folder, exec: box.exec };
  expect(resolveTarget('log:DECIDE-1', context)).toMatchObject({ href: expect.stringContaining('decision-log.md#L1-L3') });
});

const passedStep = { ok: true, problems: '', remaining: '' };
const failedStep = { ok: false, problems: 'fixture failure', remaining: 'repair it' };
const steps = (overrides = {}) => box.write('artifacts/step-results.json', JSON.stringify({ archive: passedStep, finalize: passedStep, ...overrides }));
const dir = () => box.path('artifacts');
const options = { round: 1, wait: true, run: 'review-run', archonUrl: 'http://archon.example' };
const pageFile = (round: number) => `artifacts/review-page-round-${round}.html`;
const dataBlock = (html: string, id = 'page-data') => JSON.parse(new RegExp(`id="${id}">([^<]*)</script>`).exec(html)?.[1] ?? 'null');

const publisher = () => reviewPublisher(box);

test('INT-010 publishes numbered pages, relative screenshots, cloc data and merged description entries', () => {
  steps({ logs: failedStep });
  const forge = publisher();
  const rank = emptyRanking();
  rank.red = [item('Risk', 'CHECK-2')];
  box.write('artifacts/pr-body.md', 'Summary <img onerror=x> </script> &');
  box.write('artifacts/acceptance-screenshots/round-0/screen.png', 'bytes');
  box.write('artifacts/acceptance-screenshots/round-0/manifest.json', JSON.stringify([{ file: 'screen.png', title: 'Screen', shows: 'Save', revision: accepted, alt: 'App' }]));
  box.write('artifacts/acceptance-screenshots/round-2/second.webp', 'bytes');
  box.write('artifacts/acceptance-screenshots/round-2/manifest.json', JSON.stringify([{ file: 'second.webp', title: 'Later', shows: 'Finish', revision: accepted, alt: 'App' }]));
  rank.keyEvidence = [{ file: 'acceptance-screenshots/round-0/screen.png', title: 'Save button', shows: 'Shows save' }];
  box.git('branch', 'main');
  box.git('update-ref', 'refs/remotes/origin/main', accepted);
  box.fake('cloc', [rule([], { stdout: JSON.stringify({ added: { TypeScript: { code: 5, nFiles: 1 } }, modified: { TypeScript: { code: 3, nFiles: 1 } }, removed: { TypeScript: { code: 2, nFiles: 1 } } }) })]);
  expect(publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, options)).toMatchObject({ succeeded: true, page: 'review-page-round-1.html' });
  const first = box.read(pageFile(1));
  const javascript = first.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  expect(() => new Script(javascript)).not.toThrow();
  expect(first).toContain('\\u003c/script\\u003e');
  expect(dataBlock(first)).toMatchObject({ round: 1, summary: 'Summary <img onerror=x> </script> &', merge: true, wait: true,
    size: [{ language: 'TypeScript', files: 3, added: 5, modified: 3, removed: 2 }],
    screenshots: [{ href: 'acceptance-screenshots/round-0/screen.png', round: 0 }, { href: 'acceptance-screenshots/round-2/second.webp', round: 2 }], keyEvidence: [{ title: 'Save button' }] });
  expect(forge.body).toContain('Run succeeded. 1 red item needs your call.');
  for (const field of ['state', 'codes', 'decisions', 'disputes']) expect(dataBlock(first)).not.toHaveProperty(field);
  expect(box.calls('cloc')[0]?.args).toContain(accepted);
  expect(box.calls('cloc')[0]?.args.some(arg => arg.startsWith('--not-match-f='))).toBe(true);
  startRound(forge.tools, { dir: dir(), folder, text: 'Preserve the summary' });
  const answered = box.read(pageFile(1));
  box.commitFix();
  box.write('artifacts/review-response-round-1.json', JSON.stringify([{ item: 'CHECK-2', status: 'fixed', note: 'Kept the summary', commit: accepted }, { item: 'note', status: 'no-change', note: 'Kept the rest' }]));
  steps({ 'merge-base': { ...passedStep, remaining: 'Merged the current base.' } }); recordRetest(dir(), 2, false, 'Retest needs work');
  const found = (cycle: number, title: string, state: string, flags: { handed_off?: boolean; reopened?: boolean } = {}) => ({ cycle, title, state, accepted_decline: Boolean(flags.handed_off), ...flags });
  box.write('artifacts/review/state.json', JSON.stringify({ cycles: [{ place: 'feedback', round: 2 }, { place: 'finalize', round: 2, reviewed: true }, { place: 'finalize', round: 2 }, { place: 'feedback', round: 1, reviewed: true }],
    findings: [found(0, 'Gap', 'closed', { handed_off: true }), found(0, 'Crash', 'closed'), found(0, 'Asked', 'closed', { reopened: true }), found(0, 'Nit', 'declined'), found(3, 'Old', 'open')] }));
  publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, { ...options, round: 2, archonUrl: '' });
  expect(box.read(pageFile(1))).toBe(answered);
  expect(box.read('artifacts/review-page.html')).toBe(box.read(pageFile(2)));
  expect(dataBlock(box.read(pageFile(2))).recap).toMatchObject([{ note: 'Kept the summary' }, { note: 'Committed', label: 'fix' }, { note: 'Code review found “Gap”. It is on this page.' },
    { note: 'Code review found “Crash”, and it was fixed.' }, { note: 'Code review found “Nit”, a minor problem left unfixed.' }, { note: 'Code review found no problems in a CI fix.' }, { note: 'Merged the current base.' }]);
  expect(forge.body).toStartWith('Before\n'); expect(forge.body).toEndWith('\nAfter');
  expect(forge.body.indexOf('round-1.html')).toBeLessThan(forge.body.indexOf('Review round 2'));
  expect(forge.body).toContain('feedback sent');
  expect(forge.body).toContain('Review round 2 (run review-run)');
});
const choice = (code: string, option: string) => ({ item: code, question: 0, option, other: '', note: '' });
const feedback = (...answers: ReturnType<typeof choice>[]) => JSON.stringify({ action: 'feedback', round: 1, head: box.head(), answers, screenshotComments: [] });
test('a follow-up answer files one issue for its item, retried on resume, and the next page lists it', () => {
  steps(); const forge = publisher();
  const rank = emptyRanking();
  rank.orange = [{ ...item('Dispute', 'DP-01'), title: 'Unsafe default', questions: [{ ...disputeQuestion(''), source: 'DP-01' }] }];
  publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, options);
  forge.refuseIssues('rate limited');
  startRound(forge.tools, { dir: dir(), folder, text: feedback(choice('DP-01', 'follow-up')) });
  const saved = () => JSON.parse(box.read('artifacts/review-answers-round-1.json')).answers[0].issue;
  expect([JSON.parse(box.read('artifacts/step-results.json'))['follow-up'].problems, saved()]).toEqual(['DP-01: rate limited', undefined]);
  forge.refuseIssues('');
  for (const _ of [1, 2]) startRound(forge.tools, { dir: dir(), folder, text: '' });
  const filed = forge.seen.filter(call => call.op === 'workitem.create').map(call => call.request);
  expect(filed).toHaveLength(2);
  expect(filed[1]).toEqual({ repo: { host: 'github.com', path: 'owner/repo' }, title: 'Unsafe default', marker: '<!-- codagent follow-up: owner/repo#7 DP-01 -->',
    body: expect.stringMatching(/^<!-- codagent follow-up: owner\/repo#7 DP-01 -->\n\nLeft for later in review round 1 of owner\/repo#7\.\n\nspecific evidence\n\n## DP-01: Defect\nReviewer: unsafe/) });
  expect(saved()).toBe('https://github.com/owner/repo/issues/31');
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 2 });
  expect(dataBlock(box.read(pageFile(2))).recap).toEqual([{ note: 'Filed a follow-up issue:', label: 'Unsafe default', href: saved() }]);
});
test('an item answered with no work stays off later pages until it changes, and a new decision or dispute may repeat it', () => {
  steps({ retest: failedStep }); const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  box.write('artifacts/review/prints-round-1.json', JSON.stringify(itemPrints(dir(), inv().required.map(row => row.item))));
  startRound(forge.tools, { dir: dir(), folder, text: feedback(choice('failure:retest', 'leave'), choice('I-1', 'keep'), choice('I-2', 'fix')) });
  expect(inv().required.map(row => row.item.source[0])).toEqual(['I-2', 'D-01', 'DP-01', 'DP-02']);
  const answered = inv().context.answered; expect(answered.map(entry => entry.source)).toEqual(['failure:retest', 'I-1']);
  const repeat = (repeats: string, tier: 'orange' | 'yellow' = 'yellow') => ({ ...emptyRanking(), [tier]: [{ ...item('Dispute', 'DP-01'), repeats }] });
  expect(['I-1', 'I-2'].map(code => checkRanking(repeat(code), inv().required, { ...inv().context, links: undefined }).problems.includes('under-ranked DP-01'))).toEqual([false, true]);
  expect([settleRepeats(repeat('I-1', 'orange'), answered).yellow[0].answered, settleRepeats(repeat('I-2', 'orange'), answered).orange[0].answered]).toEqual([{ round: 1, answer: 'keep' }, undefined]);
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 2 }); expect(dataBlock(box.read(pageFile(2))).red).toEqual([]);
  steps({ retest: { ...failedStep, problems: 'a new failure' } }); expect(inv().required.map(row => row.item.source[0])).toContain('failure:retest');
});
test.each(['archive', 'finalize'])('INT-010 %s failure hides Merge and wait-off hides sending', step => {
  steps({ [step]: failedStep }); const forge = publisher();
  const result = publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, wait: false });
  expect(result.succeeded).toBe(false);
  const data = dataBlock(box.read(pageFile(1)));
  expect(data).toMatchObject({ merge: false, wait: false, screenshots: [], keyEvidence: [], size: null });
  expect(forge.body).toContain(`Merge is hidden because ${step}`);
  expect(data.red[0].source).toContain(`failure:${step}`);
  expect(data.red[0].questions[0].options[0].id).toBe('fix');
});
test('INT-010 later description refusal reports a red item while a first refusal throws', () => {
  steps();
  const forge = publisher();
  forge.denyDescription();
  expect(() => publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options)).toThrow('Description edit refused');
  expect(box.exists(pageFile(1))).toBe(false);
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 2 });
  expect(dataBlock(box.read(pageFile(2))).red[0].source).toEqual(['failure:description']);
});
test('INT-010 stale publish returns the current wait and preserves page and index', () => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  const html = box.read(pageFile(1));
  const saved = readPages(dir());
  const result = publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, stale: true, reason: 'approval required' });
  expect(result).toMatchObject({ page: 'review-page-round-1.html', message: 'Review round 1: approval required' });
  expect(box.read(pageFile(1))).toBe(html);
  expect(readPages(dir())).toEqual(saved);
});

function started(forge: ReturnType<typeof publisher>, text: string) {
  return startRound(forge.tools, { dir: dir(), folder, text });
}

test('INT-007 feedback is escaped on the correct page and resumed from a single snapshot', () => {
  steps({ 'merge-base': failedStep, logs: failedStep });
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  box.write('artifacts/finalize-results.json', '{"terminal":true}');
  const answer = { action: 'feedback', round: 1, head: accepted, answers: [{ item: 'I-1', question: 0, option: 'fix', note: '</script>' }], screenshotComments: [], commandComments: [{ ref: 'acceptance-commands/round-0/export.txt', round: 0, comment: 'Which option was used?' }] };
  expect(started(forge, JSON.stringify(answer))).toMatchObject({ mode: 'feedback', round: 2, archive_needed: false, retest: false });
  const saved = box.read('artifacts/review-answers-round-1.json');
  expect(JSON.parse(saved).commandComments).toEqual(answer.commandComments);
  box.write('artifacts/review-response-round-1.json', JSON.stringify([{ item: answer.commandComments[0].ref, status: 'fixed' }]));
  expect(checkResponse(dir(), 2, false, '').ok).toBe(true);
  const page = box.read(pageFile(1));
  expect(dataBlock(page, 'sent-answers')).toMatchObject(answer);
  expect(page).toContain('\\u003c/script\\u003e');
  expect(box.read('artifacts/review-page.html')).toBe(page);
  expect(readPages(dir())[0].status).toBe('feedback sent');
  expect(box.read('artifacts/review/round-1/finalize-results.json')).toBe('{"terminal":true}');
  expect(box.read('artifacts/step-results.json')).not.toContain('merge-base');
  steps({ 'merge-base': failedStep, logs: failedStep, 'check-response': failedStep, 'address-feedback': failedStep, finalize: failedStep });
  box.write('artifacts/finalize-results.json', '{"stale":{"terminal":true}}');
  box.write('artifacts/ci/latest.json', '{}');
  expect(started(forge, '')).toMatchObject({ mode: 'feedback', round: 2 });
  expect(box.exists('artifacts/finalize-results.json')).toBe(false);
  expect(box.exists('artifacts/ci/latest.json')).toBe(false);
  expect(JSON.parse(box.read('artifacts/step-results.json'))).toEqual({ archive: passedStep });
  expect(box.read('artifacts/review/round-1/finalize-results.json')).toBe('{"terminal":true}');
  expect(box.read(pageFile(1))).toBe(page);
  expect(box.read('artifacts/review-answers-round-1.json')).toBe(saved);
});

test.each(['', '{"action":"merge","round":0,"head":"old"}'])('INT-007 ignores stale round or empty answer %j', answer => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  const page = box.read(pageFile(1));
  expect(started(forge, answer)).toMatchObject({ mode: 'stale', round: 1 });
  expect(box.exists('artifacts/review-answers-round-1.json')).toBe(false);
  expect(box.read(pageFile(1))).toBe(page);
  expect(forge.seen.some(call => call.op === 'pr.merge')).toBe(false);
});

test('INT-007 plain text is one note and mixed-case merge is pinned to the page head', () => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  expect(started(forge, '  MeRgE ')).toMatchObject({ mode: 'merged' });
  const call = forge.seen.find(entry => entry.op === 'pr.merge');
  expect(call?.request).toMatchObject({ method: 'merge', conditions: { head: accepted } });
  expect(dataBlock(box.read(pageFile(1)), 'sent-answers')).toMatchObject({ action: 'merge', head: accepted });
  expect(forge.body).toContain('merged');
});

test.each([
  ['forge pr.merge refused: head moved', 'refused'],
  ['forge pr.merge refused: merge conflict', 'refused'],
  ['forge pr.merge refused: required approval', 'stale'],
  ['forge pr.merge outcome_unknown: no response', 'stale'],
])('INT-007 classifies merge failure %s as %s', (why, mode) => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  forge.refused(why);
  expect(started(forge, 'merge')).toMatchObject({ mode, reason: why });
  expect(box.exists('artifacts/review/outcome.json')).toBe(false);
  if (mode === 'refused') {
    publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 2, reason: why });
    expect(forge.body).toContain(why);
    expect(dataBlock(box.read(pageFile(2))).recap[0].note).toBe(why);
  }
});

test.each(['finalize', 'archive'])('INT-007 never reaches forge merge when %s failed', blocked => {
  steps({ [blocked]: failedStep });
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  expect(started(forge, 'merge')).toMatchObject({ mode: 'stale', reason: expect.stringContaining(blocked) });
  expect(forge.seen.some(call => call.op === 'pr.merge')).toBe(false);
});

test.each(['closed', 'merged'])('INT-007 ends when PR was %s outside the run', state => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  if (state === 'closed') forge.close();
  else forge.merged();
  expect(started(forge, 'ordinary note')).toMatchObject({ mode: state });
  expect(JSON.parse(box.read('artifacts/review/outcome.json')).mode).toBe(state);
});
test('INT-009 response check drops invalid entries and settled codes stay out of later rankings', () => {
  steps();
  const forge = publisher();
  const rank = emptyRanking();
  rank.red = [{ ...item('Risk', 'I-2'), source: ['I-2', 'CHECK-2'] }];
  publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, options);
  box.write('artifacts/review-response-round-1.json', JSON.stringify([
    { item: 'I-2', status: 'no-change', note: 'resolved' }, { item: 'CHECK-2', status: 'no-change' },
    { item: 'MISSING-1', status: 'fixed' }, { item: 'I-2', status: 'invalid' },
  ]));
  expect(checkResponse(dir(), 2, false, '').ok).toBe(false);
  expect(JSON.parse(box.read('artifacts/review-response-round-1.json'))).toHaveLength(2);
  box.write('artifacts/review-response-round-2.json', '[]');
  const source = inv();
  expect(source.required.some(row => row.item.source.includes('I-2'))).toBe(true);
  expect(checkRanking(rank, [], source.context).ok).toBe(false);
  expect(placeRanking(rank, [], source.context).red).toEqual([]);
  expect(stepFailures(dir()).map(entry => entry.source[0])).toContain('failure:check-response');
});
test('INT-009 failure persists after a failed retest and a pass removes only listed commits', () => {
  const first = box.commitFix('first');
  const second = box.commitFix('second');
  steps({ acceptance: failedStep });
  box.write('artifacts/review/journeys-round-1.json', JSON.stringify([{ commit: first, code: 'JOURNEY-1', sources: [first], coveredCommits: [first] },
    { commit: second, code: 'JOURNEY-2', sources: [second], coveredCommits: [second] }]));
  box.write('artifacts/review-answers-round-1.json', JSON.stringify({ answers: [{ item: first, option: 'retest' }] }));
  recordRetest(dir(), 2, false, 'retest did not pass');
  expect(stepFailures(dir()).map(entry => entry.source[0])).toEqual(['failure:acceptance', 'failure:retest']);
  expect(inv().later_commits.map(entry => entry.source[0])).toEqual([first, second]);
  publishPackage(publisher().tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 3 });
  const later = dataBlock(box.read(pageFile(3)));
  expect(later.red.some((entry: Item) => entry.source.includes('failure:retest'))).toBe(true);
  expect(later.recap).toEqual([]);
  recordRetest(dir(), 2, true, '');
  expect(stepFailures(dir())).toEqual([]);
  expect(inv().later_commits.map(entry => entry.source[0])).toEqual([second]);
  expect(inv().accepted_head).toBe(accepted);
});
test('INT-009 validates questions, mixed evidence picks and legacy journey commits', () => {
  const picked = { file: 'shot.png', title: 'Title', shows: 'Showing evidence' };
  const context = { commands: ['run.txt'], media: [picked.file, 'run.txt'], journeys: ['AT-001'], commits: [accepted], dismissed: [] };
  const valid: Ranking = { ...emptyRanking(), red: [item('Risk')], keyEvidence: [picked] };
  expect(checkRanking(valid, [], context).ok).toBe(true);
  const cases = [
    { ...valid, keyEvidence: [] },
    { ...valid, red: [{ ...valid.red[0], evidence: 'missing-command.txt' }] },
    { ...valid, keyEvidence: Array.from({ length: 6 }, () => picked) },
    { ...valid, keyEvidence: [{ ...picked, file: 'missing.png' }] },
    { ...valid, red: [{ ...valid.red[0], questions: [] }] },
    ...[1, 5].map(count => ({ ...valid, red: [{ ...valid.red[0], questions: [{ prompt: 'Question', options: Array.from({ length: count }, (_, id) => ({ id: String(id), label: 'Choice' })) }] }] })),
  ];
  for (const rank of cases) expect(checkRanking(rank, [], context).ok).toBe(false);
  const late = { ...item('Late commit', accepted), journeys: [{ code: 'AT-001', title: 'Legacy', commit: accepted }],
    questions: [{ prompt: 'Retest this?', options: [{ id: 'retest', label: 'Retest' }, { id: 'leave', label: 'Leave' }] }] };
  expect(checkRanking({ ...valid, orange: [late] }, [], context).ok).toBe(true);
  for (const change of [{ code: 'JOURNEY-123' }, { commit: 'missing' }]) {
    expect(checkRanking({ ...valid, orange: [{ ...late, journeys: [{ ...late.journeys[0], ...change }] }] }, [], context).ok).toBe(false);
  }
  expect(checkRanking({ ...valid, keyEvidence: [{ ...picked, file: 'run.txt' }] }, [], context).ok).toBe(true);
  expect(placeRanking({ ...valid, keyEvidence: [{ ...picked, file: 'missing-command.txt' }] }, [], context).keyEvidence).toEqual([]);
  const placed = placeRanking({ ...valid, keyEvidence: [picked, { ...picked, file: 'missing.png' }] }, [], context);
  expect(placed.keyEvidence).toEqual([picked]);
  expect(placed.red[0].questions).toEqual(valid.red[0].questions);
});
test.each([true, false])('INT-009 spec-change fallback offers a targeted edit only when defined (%s)', editable => {
  box.write(`${folder}/dispute-log.md`, `## DISPUTE-1: Scope change\nStatus: spec-change\n${editable ? 'Spec edit: Permit an empty note.' : 'Needs a follow-up.'}\n`);
  const requiredRows = inv().required; const ranking = { ...emptyRanking(), red: [item('Dispute', 'DISPUTE-1')] };
  expect(checkRanking(ranking, requiredRows).ok).toBe(false);
  const dispute = placeRanking(ranking, requiredRows).red.find(row => row.source.includes('DISPUTE-1'));
  const unauthorized = { id: 'apply-anyway', label: 'Implement the request' }; expect(dispute).toBeDefined();
  const questions = dispute?.questions ?? [];
  const extra = { ...item('Dispute', 'DISPUTE-1'), questions: [{ ...questions[0], options: [...questions[0].options, unauthorized] }] };
  expect(checkRanking({ ...emptyRanking(), red: [extra] }, requiredRows).problems).toContain('exactly the allowed options');
  expect([dispute?.questions?.[0].options.map(option => option.id), JSON.stringify(dispute).includes('Permit an empty note')]).toEqual([editable ? ['spec-edit', 'follow-up', 'drop'] : ['follow-up', 'drop'], false]);
  const plain = { ...extra, questions: [{ ...questions[0], options: questions[0].options.map(option => ({ ...option, detail: 'In plain words' })) }] };
  expect(checkRanking({ ...emptyRanking(), red: [plain] }, requiredRows).problems).not.toContain('exactly the allowed options');
});
test('INT-007 reads the PR back after an ambiguous merge that landed', () => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  forge.refused('forge pr.merge verification_failed: unreadable result', true);
  expect(started(forge, 'merge')).toMatchObject({ mode: 'merged' });
  const mergeIndex = forge.seen.findIndex(call => call.op === 'pr.merge');
  expect(forge.seen[mergeIndex + 1]?.op).toBe('pr.view');
  expect(JSON.parse(box.read('artifacts/review/outcome.json')).mode).toBe('merged');
});

test('INT-010 an unwritable review page fails publication', () => {
  steps();
  const forge = publisher();
  mkdirSync(box.path(pageFile(1)), { recursive: true });
  expect(() => publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options)).toThrow();
  expect(box.exists('artifacts/review/pages.json')).toBe(false);
});

test.each(['match', 'lag', 'mismatch'])('publishes only a forge-matching head with %s', scenario => {
  steps();
  const forge = publisher();
  const old = 'a'.repeat(40);
  if (scenario === 'lag') forge.heads(old, old, box.head());
  if (scenario === 'mismatch') forge.heads(old);
  const waits: number[] = [];
  const publish = () => publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options, delay => waits.push(delay));
  if (scenario === 'mismatch') {
    expect(publish).toThrow(`GitHub is ${old}, not the local head ${box.head()}`);
    expect(forge.seen.some(call => call.op === 'pr.edit-body')).toBe(false);
    for (const name of [pageFile(1), 'artifacts/review-page.html', 'artifacts/review/pages.json']) expect(box.exists(name)).toBe(false);
    expect(waits).toEqual(Array(10).fill(3000));
  } else {
    expect(publish().page).toBe('review-page-round-1.html');
    expect(waits).toEqual(scenario === 'lag' ? [3000, 3000] : []);
  }
});
test('INT-009 a cited file in passing finalize CI changes an unverified row floor only', () => {
  box.write('tests/example.test.ts', 'export {};');
  box.write('src/test_smoke.py', 'pass');
  box.write('cmd/launch_test.go', 'package cmd');
  box.write(`${folder}/test-plan.md`, '# Test plan\n'); box.git('add', 'tests', 'src', 'cmd', `${folder}/test-plan.md`);
  box.commit('named test');
  box.write(`${folder}/checklist.md`, `| ID | Behavior | Evidence | Status |\n|---|---|---|---|\n| CHECK-1 | feature | tests/example.test.ts | not verified |\n| CHECK-2 | unknown | tests/standalone.test.ts | not verified |\n| CHECK-3 | Python | [smoke](src/test_smoke.py) | not verified |\n| CHECK-4 | Go | cmd/launch_test.go | not verified |\n| CHECK-5 | plan only | ${folder}/test-plan.md | not verified |\n`);
  steps();
  box.write('artifacts/ci/latest.json', JSON.stringify({ status: 'passed', headSha: box.head(), hadChecks: true, passedChecks: [{ name: 'Matrix checks (node 22)' }] }));
  expect(inv().required.filter(row => row.item.source[0].startsWith('CHECK-')).map(row => row.tier)).toEqual(['yellow', 'red', 'yellow', 'yellow', 'red']);
  steps({ finalize: failedStep });
  expect(inv().required.filter(row => row.item.source[0].startsWith('CHECK-')).map(row => row.tier)).toEqual(['red', 'red', 'red', 'red', 'red']);
});
test('INT-007 Retest selects journeys from a red Late commit and ignores an unselected orange one', () => {
  steps();
  const forge = publisher();
  const first = box.commitFix('journey one');
  const second = box.commitFix('journey two');
  const retest = [{ prompt: 'Rerun?', options: [{ id: 'retest', label: 'Retest' }, { id: 'leave', label: 'Leave' }] }];
  const orange = [first, second].map((commit, index) => ({ ...item('Late commit', commit), questions: retest,
    journeys: [{ code: `JOURNEY-${index + 1}`, title: `Journey ${index + 1}`, commit }] }));
  const scenario = 'A reviewer saves a preference.', repeat = '1. Save.\n2. Reload and verify.';
  box.write('artifacts/acceptance-journeys/round-0.json', JSON.stringify(orange.map(entry => ({ ...entry.journeys[0], scenario, repeat }))));
  publishPackage(forge.tools, { dir: dir(), folder, ranking: { ...emptyRanking(), red: [orange[0]], orange: [orange[1]] } }, options);
  const answer = JSON.stringify({ action: 'feedback', round: 1, head: second, answers: [{ item: first, question: 0, option: 'retest' }], screenshotComments: [] });
  const round = started(forge, answer);
  expect(round).toMatchObject({ retest: true, round: 2 });
  expect(JSON.parse(round.journeys)).toEqual([expect.objectContaining({ code: 'JOURNEY-1', scenario, repeat, artifact: 'acceptance-journeys/round-0.json' })]);
});
test('ranked step failures keep their details and fallback supplies a plain linked-or-linkless failure', () => {
  steps({ finalize: failedStep, acceptance: { ...failedStep, push: true } });
  const forge = publisher();
  const ranked = { ...item('Failure', 'failure:acceptance'), title: 'Acceptance stopped', links: [], detail: 'Testing stopped before the last case.' };
  const ranking = { ...emptyRanking(), red: [ranked] };
  const failures = inv().required.filter(row => row.item.type === 'Failure' && row.item.failLine);
  expect(checkRanking(ranking, failures).problems).toContain('failure:finalize');
  expect(checkRanking({ ...ranking, red: [ranked, { ...ranked, title: 'Duplicate' }] }, failures).problems).toContain('duplicate failed step');
  expect(checkRanking({ ...ranking, red: [], orange: [ranked] }, failures).problems).toContain('invalid or duplicate');
  expect(checkRanking({ ...ranking, red: [{ ...ranked, source: ['failure:not-failed'] }] }, failures).problems).toContain('invalid or duplicate');
  const decision = { ...item('Agent decision', 'D-01'), detail: 'The setup requires export permission.' };
  const placed = placeRanking({ ...ranking, orange: [{ ...decision, source: ['failure:acceptance', 'D-01'] }] }, failures);
  expect(placed.orange).toEqual([]);
  expect(placed.red.filter(entry => entry.source.includes('failure:acceptance'))).toHaveLength(1);
  expect(placed.red[0].source).toEqual(['failure:acceptance', 'D-01']);
  expect(placed.red[0].detail).toContain(decision.detail);
  expect(placeRanking({ ...ranking, red: [], orange: [ranked] }, failures).red[0].detail).toBe(ranked.detail);
  publishPackage(forge.tools, { dir: dir(), folder, ranking: placed }, options);
  const data = dataBlock(box.read(pageFile(1)));
  const acceptance = data.red.find((entry: Item) => entry.source.includes('failure:acceptance'));
  expect(acceptance.detail).toContain(ranked.detail);
  expect(acceptance.failLine).toContain('because the push failed');
  const finalize = data.red.find((entry: Item) => entry.source.includes('failure:finalize'));
  expect(finalize).toMatchObject({ links: [], failLine: 'Finalize did not pass.', questions: [standardQuestion('Failure')] });
  expect(finalize.detail).not.toContain(failedStep.problems);
  expect(forge.body).toContain('2 red items');
});
test('rules refusal stays in the description after same-round CLI feedback and a new publish', () => {
  steps();
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  forge.refused('forge pr.merge refused: required approval');
  expect(started(forge, 'merge').mode).toBe('stale');
  expect(started(forge, 'Please address this instead').mode).toBe('feedback');
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, round: 2 });
  expect(forge.body).toContain('Merge was chosen and refused: forge pr.merge refused: required approval · feedback sent');
});
