import { commitLogs } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { inventory, emptyRanking, failedItems, type Item, type Ranking, type RequiredItem } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkRanking, placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { publishPackage } from '../.archon/workflows/codagent/.shared/lib/publish-review.ts';
import { readPages } from '../.archon/workflows/codagent/.shared/lib/review-pages.ts';
import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { checkResponse, recordRetest } from '../.archon/workflows/codagent/.shared/lib/review-work.ts';
import { sendReview, missingAnswers } from '../.archon/workflows/codagent/.shared/lib/review-send.ts';
import { changeSize } from '../.archon/workflows/codagent/.shared/lib/review-media.ts';
import { sourceLink } from '../.archon/workflows/codagent/.shared/lib/review-links.ts';
import { standardQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { createSandbox, type Sandbox, rule, ok, failed, prView, } from './helpers.ts';
let box: Sandbox; let accepted: string;
const folder = 'openspec/changes/demo';
const item = (type = 'Verification', source = 'I-1'): Item => ({ type, title: source, detail: 'specific evidence', link: 'openspec/specs/foo/spec.md:12-18', source: [source], questions: [standardQuestion(type)] });
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
  const changed=box.commitFix();expect(inv().later_commits.map(i=>i.title)).toEqual([changed]);
  expect(inv().later_commits[0].detail).toContain('1 file changed');expect(inv().accepted_head).toBe(accepted);
  box.write('artifacts/acceptance-tested-revision.txt',changed);expect(inv().accepted_head).toBe(changed);
  box.write('artifacts/acceptance-round-status.txt',`READY ${accepted}\n`);expect(inv().accepted_head).toBe(accepted);
});
test('INT-009 inventory independently requires failures gaps non-PR disputes and late commits',()=>{
  const list=inv().required;
  expect(list.map(row=>row.item.source[0])).toEqual(['I-1','I-2','DP-01']);
  expect(list.find(row=>row.item.source.includes('DP-02'))).toBeUndefined();
});
test.each(['omit','lower','duplicate','empty','unknown'])('INT-009 rejects %s ranking',kind=>{
  const ranking=emptyRanking();ranking.red=[item()];ranking.orange=[item('Dispute','DP-01')];
  if(kind==='omit')ranking.red=[];
  if(kind==='lower'){ranking.yellow=ranking.red;ranking.red=[];}
  if(kind==='duplicate')ranking.white=[item()];
  if(kind==='empty')ranking.red[0].detail='';
  if(kind==='unknown')ranking.red[0].type='Unknown';
  expect(checkRanking(ranking,required()).ok).toBe(false);
});
test('INT-009 discretionary PR style disputes retain yellow and merged types are accepted',()=>{
  const ranking=emptyRanking();ranking.red=[{...item(),type:'Verification, Dispute',source:['I-1','DP-01']}];
  ranking.yellow=[item('Dispute','DP-02')];expect(checkRanking(ranking,required()).ok).toBe(true);
});
test('INT-009 placement fills omissions corrects floors and names uncovered late commits',()=>{
  box.commitFix();const source=inv();const ranking=emptyRanking();ranking.white=[item()];
  const placed=placeRanking(ranking,source.required);expect(checkRanking(placed,source.required).ok).toBe(true);
  expect(placed.orange.find(i=>i.type==='Late commit')?.detail).toContain('Tests: none named.');
  const late = placed.orange.find(i=>i.type==='Late commit');
  if (!late) throw new Error('missing late commit');
  late.detail='Tests: test';expect(checkRanking(placed,source.required).ok).toBe(false);
});
test('INT-009 a late commit sized without openspec/ passes, and placement keeps its detail as written',()=>{
  const sha=box.commitFix();const source=inv();
  const own={...item('Late commit',sha),title:`Commit ${sha.slice(0,7)} after acceptance`,detail:'Size: 7 files changed, 9 insertions(+)\n\nTests: none cover it.'};
  const ranking=emptyRanking();ranking.orange=[own];ranking.red=[item('Verification','I-1')];
  expect(checkRanking(ranking,source.required).problems).not.toContain('needs shortstat');
  const placed=placeRanking(ranking,source.required);
  expect(placed.orange.find(entry=>entry.source.includes(sha))?.detail).toBe(own.detail);
});
test.each(['write','readback'])('INT-009 package %s failure throws',kind=>{
  const tools=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView())),rule(['forge','pr.edit-body'],kind==='write'?failed('permission','refused'):ok('pr.edit-body',{}))]);
  expect(()=>publishPackage(tools, { dir: box.path('artifacts'), folder, ranking: emptyRanking() })).toThrow(kind==='write'?'refused':'read-back');
});
test('INT-009 original PR head survives a later checked revision',()=>{
  const later=box.commitFix();box.write('artifacts/pull-request.json',JSON.stringify({head_revision:later,opened_head_revision:accepted}));
  expect(inv().accepted_head).toBe(accepted);expect(inv().later_commits[0].source).toContain(later);
});
test('INT-009 wrong source type is rejected and deterministic placement repairs it',()=>{
  const ranking=emptyRanking();ranking.red=[item('Decision')];
  expect(checkRanking(ranking,[required()[0]]).problems).toContain('wrong type');
  expect(checkRanking(placeRanking(ranking,[required()[0]]),[required()[0]]).ok).toBe(true);
});
test('INT-009 grouped late commits retain every size tests and merged symptom after placement',()=>{
  const source=inv();const one=box.commitFix('first change');const two=box.commitFix('second\nchange\nwith more lines');
  const commits=inventory({exec:box.exec,dir:box.path('artifacts'),changeFolder:folder}).required.filter(row=>row.item.type==='Late commit');
  const ranking=emptyRanking();ranking.yellow=[{...item('Late commit, Decision','D-01'),title:'Grouped changes',detail:'Original symptom: integration changed.\nTests: regression.',source:[one,two,'D-01']}];
  const placed=placeRanking(ranking,[...source.required,...commits]);expect(checkRanking(placed,[...source.required,...commits]).ok).toBe(true);
  const group=placed.orange.find(entry=>entry.source.includes(one)&&entry.source.includes(two));expect(group?.detail).toContain('Original symptom');expect(group?.detail).toContain('Tests: regression.');
  for(const expected of commits){expect(group?.detail).toContain(expected.item.title);expect(group?.detail).toContain(expected.item.detail.split('\n')[0]);}
});
test('INT-009 merge conflict resolution is inventoried and OpenSpec-only merges are excluded',()=>{
  const base=box.head();box.git('checkout','-qb','side');box.commitFix('side');box.git('checkout','feature');box.commitFix('main');
  const merge=box.exec('git',['merge','side','--no-ff','-m','merge']);expect(merge.status).not.toBe(0);
  box.write('file.txt','product conflict resolution');box.git('add','file.txt');const merged=box.commit('merge resolved');
  const found=inv().later_commits.find(entry=>entry.title===merged);expect(found).toBeDefined();expect(found?.detail).toContain('1 file changed');
  box.git('checkout','-qb','spec-side');box.write('openspec/specs/new/spec.md','spec');box.git('add','openspec/specs/new/spec.md');box.commit('spec');box.git('checkout','feature');box.git('merge','spec-side','--no-ff','-m','spec merge');
  expect(inv().later_commits.map(entry=>entry.title)).not.toContain(box.head());expect(base).toBe(accepted);
});
test('INT-009 actual blocked acceptance is linked to its numbered committed decision',()=>{
  box.write('artifacts/decision-log.md','## Fallback choice\nQuestion: choose the fallback.\nRequirement: approved fallback.\nDecision pending from user: choose.\n');
  const file=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/check-acceptance-progress.ts');
  const result=Bun.spawnSync([process.execPath,file],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_BLOCKED:'true',INPUTS_FIX:'true',INPUTS_REASON:'choose the fallback'}});
  expect(result.exitCode).toBe(0);expect(commitLogs(box.exec,box.path('artifacts'),'demo').ok).toBe(true);
  const failure=failedItems(box.path('artifacts')).find(entry=>entry.source.includes('failure:acceptance'));
  expect(failure?.detail).toContain('DECIDE-1: Fallback choice');expect(failure?.detail).toContain('choose the fallback');
});
test.each([false,true])('INT-009 actual failed acceptance push reports subsequent finalize push %s',pushAgain=>{
  const dir=box.path('artifacts');
  const push=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/acceptance-push.ts');
  const failedPush=Bun.spawnSync([process.execPath,push],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_ON_FAILURE:'report',INPUTS_STRICT:'true',INPUTS_BLOCKED:'false'}});
  expect(failedPush.exitCode).toBe(0);expect(JSON.parse(failedPush.stdout.toString()).ok).toBe(false);
  if(pushAgain){box.addBareOrigin();const finish=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');const pushed=Bun.spawnSync([process.execPath,finish],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_OP:'finalize-push',INPUTS_STEP:'finalize-push',INPUTS_RESULT:'the round fixes'}});expect(JSON.parse(pushed.stdout.toString()).ok).toBe(true);}
  const failure=failedItems(dir).find(entry=>entry.source.includes('failure:acceptance'));
  expect(failure?.detail).toContain(pushAgain?'Finalize subsequently pushed':"lacks the round's fix unless finalize pushes it");
});
test.each([['ACCEPTANCE_COMPLETE',true],['ACCEPTANCE_FAILED',false]] as const)('stop_after acceptance: %s ends the run without a package, succeeded %s',(status,succeeded)=>{
  const dir=box.path('artifacts');box.write('artifacts/acceptance-preparation-status.txt',`${status}\n`);box.write('artifacts/acceptance-handoff.md','Acceptance did not converge.');
  const finish=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const run=(op:string)=>Bun.spawnSync([process.execPath,finish],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_OP:op,INPUTS_STEP:op,INPUTS_STOP_AFTER:'acceptance'}});
  const ended=run('end-after-acceptance');expect(ended.exitCode).toBe(0);expect(JSON.parse(ended.stdout.toString()).ok).toBe(true);
  const published=run('end-run');expect(published.exitCode).toBe(0);
  expect(JSON.parse(published.stdout.toString())).toEqual({succeeded, reason: ''});expect(box.exists('artifacts/review-package.md')).toBe(false);
});

const passedStep = { ok: true, problems: '', remaining: '' };
const failedStep = { ok: false, problems: 'fixture failure', remaining: 'repair it' };
const steps = (overrides = {}) => box.write('artifacts/step-results.json', JSON.stringify({ archive: passedStep, finalize: passedStep, ...overrides }));
const dir = () => box.path('artifacts');
const options = { round: 1, wait: true, run: 'review-run', archonUrl: 'http://archon.example' };
const pageFile = (round: number) => `artifacts/review-page-round-${round}.html`;
const dataBlock = (html: string, id = 'page-data') => JSON.parse(new RegExp(`id="${id}">([^<]*)</script>`).exec(html)?.[1] ?? 'null');

function publisher() {
  let body = 'Before\n<!-- codagent:generated-body:start -->\nold\n<!-- codagent:generated-body:end -->\nAfter';
  const seen: { op: string; request: object }[] = [];
  let state: 'open' | 'closed' | 'merged' = 'open';
  let refuse = '';
  let mergeProblem = '';
  let mergedOnError = false;
  const tools = box.forgeTools([]);
  const original = tools.forge.call.bind(tools.forge);
  const edit = <T>(request: object) => {
    if (refuse) return { ok: false as const, problem: refuse };
    body = (request as { body: string }).body;
    return { ok: true as const, value: {} as T };
  };
  const merge = <T>() => {
    if (mergeProblem) {
      if (mergedOnError) state = 'merged';
      return { ok: false as const, problem: mergeProblem };
    }
    state = 'merged';
    return { ok: true as const, value: {} as T };
  };
  tools.forge.call = <T>(op: string, request: object) => {
    seen.push({ op, request });
    if (op === 'pr.view') return { ok: true, value: prView({ state, head_revision: box.head() }, { body }) as T };
    if (op === 'pr.edit-body') return edit<T>(request);
    if (op === 'pr.merge') return merge<T>();
    return original<T>(op, request);
  };
  return { tools, seen, get body() { return body; }, close: () => { state = 'closed'; },
    merged: () => { state = 'merged'; }, refused: (reason: string, wasMerged = false) => { mergeProblem = reason; mergedOnError = wasMerged; },
    denyDescription: () => { refuse = 'Description edit refused'; } };
}

test('INT-010 publishes numbered pages, relative screenshots, cloc data and merged description entries', () => {
  steps();
  const forge = publisher();
  const rank = emptyRanking();
  rank.red = [item('Risk', 'CHECK-2')];
  box.write('artifacts/pr-body.md', 'Summary <img onerror=x> </script> &');
  box.write('artifacts/acceptance-screenshots/round-0/screen.png', 'bytes');
  box.write('artifacts/acceptance-screenshots/round-0/manifest.json', JSON.stringify([{ file: 'screen.png', title: 'Screen', shows: 'Save', revision: accepted, alt: 'App' }]));
  rank.keyEvidence = [{ file: 'acceptance-screenshots/round-0/screen.png', title: 'Save button', shows: 'Shows save' }];
  box.git('branch', 'main');
  box.git('update-ref', 'refs/remotes/origin/main', accepted);
  box.fake('cloc', [rule([], { stdout: JSON.stringify({ added: { TypeScript: { code: 5, nFiles: 1 } }, modified: {}, removed: {} }) })]);
  expect(publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, options)).toMatchObject({ succeeded: true, page: 'review-page-round-1.html' });
  const first = box.read(pageFile(1));
  const javascript = first.split('<script>').at(-1)?.split('</script>')[0] ?? '';
  expect(() => new Script(javascript)).not.toThrow();
  expect(first).toContain('\\u003c/script\\u003e');
  expect(dataBlock(first)).toMatchObject({ round: 1, summary: 'Summary <img onerror=x> </script> &', merge: true, wait: true,
    state: 'Run succeeded. 1 red item needs your call.', size: [{ language: 'TypeScript', files: 1, added: 5, modified: 0, removed: 0 }],
    screenshots: [{ href: 'acceptance-screenshots/round-0/screen.png', round: 0 }], keyEvidence: [{ title: 'Save button' }] });
  expect(box.calls('cloc')[0]?.args).toContain(accepted);
  expect(box.calls('cloc')[0]?.args.some(arg => arg.startsWith('--not-match-f='))).toBe(true);
  startRound(forge.tools, { dir: dir(), folder, text: 'Preserve the summary' });
  const answered = box.read(pageFile(1));
  box.write('artifacts/review-response-round-1.json', JSON.stringify([{ item: 'note', status: 'no-change', note: 'Kept the summary' }]));
  publishPackage(forge.tools, { dir: dir(), folder, ranking: rank }, { ...options, round: 2, archonUrl: '' });
  expect(box.read(pageFile(1))).toBe(answered);
  expect(box.read('artifacts/review-page.html')).toBe(box.read(pageFile(2)));
  expect(dataBlock(box.read(pageFile(2))).recap[0].note).toBe('Kept the summary');
  expect(forge.body).toStartWith('Before\n');
  expect(forge.body).toEndWith('\nAfter');
  expect(forge.body.indexOf('round-1.html')).toBeLessThan(forge.body.indexOf('Review round 2'));
  expect(forge.body).toContain('feedback sent');
  expect(forge.body).toContain('Review round 2 (run review-run)');
});

test.each(['archive', 'finalize'])('INT-010 %s failure hides Merge and wait-off hides sending', step => {
  steps({ [step]: failedStep });
  const forge = publisher();
  const result = publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, { ...options, wait: false });
  expect(result.succeeded).toBe(false);
  const data = dataBlock(box.read(pageFile(1)));
  expect(data).toMatchObject({ merge: false, wait: false, screenshots: [], keyEvidence: [], size: null });
  expect(data.state).toContain(`Merge is hidden because ${step}`);
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
  steps({ 'push-round': failedStep });
  const forge = publisher();
  publishPackage(forge.tools, { dir: dir(), folder, ranking: emptyRanking() }, options);
  box.write('artifacts/finalize-results.json', '{"terminal":true}');
  const answer = { action: 'feedback', round: 1, head: accepted, answers: [{ item: 'I-1', question: 0, option: 'fix', note: '</script>' }], screenshotComments: [] };
  expect(started(forge, JSON.stringify(answer))).toMatchObject({ mode: 'feedback', round: 2, archive_needed: false, retest: false });
  const saved = box.read('artifacts/review-answers-round-1.json');
  const page = box.read(pageFile(1));
  expect(dataBlock(page, 'sent-answers')).toMatchObject(answer);
  expect(page).toContain('\\u003c/script\\u003e');
  expect(box.read('artifacts/review-page.html')).toBe(page);
  expect(readPages(dir())[0].status).toBe('feedback sent');
  expect(box.read('artifacts/review/round-1/finalize-results.json')).toBe('{"terminal":true}');
  expect(box.read('artifacts/step-results.json')).not.toContain('push-round');
  expect(started(forge, '')).toMatchObject({ mode: 'feedback', round: 2 });
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
  expect(source.required.some(row => row.item.source.includes('I-2'))).toBe(false);
  expect(checkRanking(rank, [], source.context).ok).toBe(false);
  expect(placeRanking(rank, [], source.context).red).toEqual([]);
  expect(failedItems(dir()).map(entry => entry.source[0])).toContain('failure:check-response');
});

test('INT-009 failure persists after a failed retest and a pass removes only listed commits', () => {
  const first = box.commitFix('first');
  const second = box.commitFix('second');
  steps({ acceptance: failedStep });
  box.write('artifacts/review/journeys-round-1.json', JSON.stringify([{ commit: first, code: 'JOURNEY-1', sources: [first], coveredCommits: [first] },
    { commit: second, code: 'JOURNEY-2', sources: [second], coveredCommits: [second] }]));
  box.write('artifacts/review-answers-round-1.json', JSON.stringify({ answers: [{ item: first, option: 'retest' }] }));
  recordRetest(dir(), 2, false, 'retest did not pass');
  expect(failedItems(dir()).map(entry => entry.source[0])).toEqual(['failure:acceptance', 'failure:retest']);
  expect(inv().later_commits.map(entry => entry.title)).toEqual([first, second]);
  recordRetest(dir(), 2, true, '');
  expect(failedItems(dir())).toEqual([]);
  expect(inv().later_commits.map(entry => entry.title)).toEqual([second]);
  expect(inv().accepted_head).toBe(accepted);
});

test('INT-009 validates questions, screenshot picks and legacy journey commits', () => {
  const picked = { file: 'shot.png', title: 'Title', shows: 'Showing evidence' };
  const context = { shots: [picked.file], journeys: ['AT-001'], commits: [accepted], dismissed: [] };
  const valid: Ranking = { ...emptyRanking(), red: [item('Risk')], keyEvidence: [picked] };
  expect(checkRanking(valid, [], context).ok).toBe(true);
  const cases = [
    { ...valid, keyEvidence: [] },
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
  const placed = placeRanking({ ...valid, keyEvidence: [picked, { ...picked, file: 'missing.png' }] }, [], context);
  expect(placed.keyEvidence).toEqual([picked]);
  expect(placed.red[0].questions).toEqual(valid.red[0].questions);
});

test.each([true, false])('INT-009 spec-change fallback offers a targeted edit only when defined (%s)', editable => {
  box.write(`${folder}/dispute-log.md`, `## DISPUTE-1: Scope change\nStatus: spec-change\n${editable ? 'Spec edit: Permit an empty note.' : 'Needs a follow-up.'}\n`);
  const requiredRows = inv().required;
  const ranking = { ...emptyRanking(), red: [item('Dispute', 'DISPUTE-1')] };
  expect(checkRanking(ranking, requiredRows).ok).toBe(false);
  const dispute = placeRanking(ranking, requiredRows).red.find(row => row.source.includes('DISPUTE-1'));
  expect(dispute?.questions?.[0].options.map(option => option.id)).toEqual(editable ? ['spec-edit', 'follow-up', 'drop'] : ['follow-up', 'drop']);
});

test.each(['feedback', 'merge'])('INT-011 sends one %s answer for the current occurrence', async action => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return sent.length === 1 ? Response.json({ item: { runId: 'r', occurrence: 'this-wait', message: 'Review round 1: waiting' } }) : Response.json({ message: 'accepted' });
  });
  const answer = { action, round: 1, head: accepted, ...(action === 'feedback' ? { answers: [{ note: 'a note' }], screenshotComments: [{ file: 'one.png', round: 0 }] } : {}) };
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

test('INT-010 cloc nonzero exit is an unavailable count after a good merge base', () => {
  box.git('branch', 'main');
  box.fake('cloc', [rule([], { status: 127 })]);
  expect(changeSize(box.exec, 'main')).toBeNull();
  expect(box.calls('cloc')[0]?.args).toContain(accepted);
});

test('source links preserve remote URLs and resolve committed line ranges and run artifacts', () => {
  const links = { base: 'https://github.com/owner/repo', head: accepted, dir: dir(), folder, exec: box.exec };
  expect(sourceLink('file.txt:4-7', links)).toBe(`${links.base}/blob/${accepted}/file.txt#L4-L7`);
  expect(sourceLink(box.path('artifacts/ci/report file.txt'), links)).toBe('ci/report%20file.txt');
  expect(sourceLink('https://example.org/path', links)).toBe('https://example.org/path');
});

test('INT-009 a cited file in passing finalize CI changes an unverified row floor only', () => {
  box.write('tests/example.test.ts', 'export {};');
  box.git('add', 'tests/example.test.ts');
  box.commit('named test');
  box.write(`${folder}/checklist.md`, '| ID | Behavior | Evidence | Status |\n|---|---|---|---|\n| CHECK-1 | feature | tests/example.test.ts | not verified |\n| CHECK-2 | unknown | tools/standalone.test.ts | not verified |\n');
  steps();
  box.write('artifacts/ci/latest.json', '{"hadChecks":true}');
  expect(inv().required.filter(row => row.item.source[0].startsWith('CHECK-')).map(row => row.tier)).toEqual(['yellow', 'red']);
  steps({ finalize: failedStep });
  expect(inv().required.filter(row => row.item.source[0].startsWith('CHECK-')).map(row => row.tier)).toEqual(['red', 'red']);
});

test('INT-007 Retest selects only the journeys shown for the answered Late commit item', () => {
  steps();
  const forge = publisher();
  const first = box.commitFix('journey one');
  const second = box.commitFix('journey two');
  const retest = [{ prompt: 'Rerun?', options: [{ id: 'retest', label: 'Retest' }, { id: 'leave', label: 'Leave' }] }];
  const orange = [first, second].map((commit, index) => ({ ...item('Late commit', commit), questions: retest,
    journeys: [{ code: `JOURNEY-${index + 1}`, title: `Journey ${index + 1}`, commit }] }));
  publishPackage(forge.tools, { dir: dir(), folder, ranking: { ...emptyRanking(), orange } }, options);
  const answer = JSON.stringify({ action: 'feedback', round: 1, head: second, answers: [{ item: first, question: 0, option: 'retest' }], screenshotComments: [] });
  const round = started(forge, answer);
  expect(round).toMatchObject({ retest: true, round: 2 });
  expect(JSON.parse(round.journeys).map((entry: { code: string }) => entry.code)).toEqual(['JOURNEY-1']);
});
