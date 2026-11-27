import { checkRanking, placeRanking } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { pageHtml } from '../.archon/workflows/codagent/.shared/lib/publish-review.ts';
import { standardQuestion } from '../.archon/workflows/codagent/.shared/lib/review-questions.ts';
import { changeSize } from '../.archon/workflows/codagent/.shared/lib/review-media.ts';
import { commitLogs, syncLogs } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { resolveTarget } from '../.archon/workflows/codagent/.shared/lib/review-links.ts';
import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { emptyRanking, inventory, stepFailures } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkResponse, mergeBase, finishMerge } from '../.archon/workflows/codagent/.shared/lib/review-work.ts';
import { checkForgeAccess } from '../.archon/workflows/codagent/.shared/lib/forge.ts';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ciGate, finalCi, finalizeProblems, waitFinalize, recordFinalize, recordFinalizeCheck } from '../.archon/workflows/codagent/.shared/lib/finalize.ts';
import { blank, type CiResult } from '../.archon/workflows/codagent/.shared/lib/ci.ts';
import { markReady, acceptancePush, gitNetwork } from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
import { createSandbox, type Sandbox, noSleep, ok, rule, prView, reply, failed } from './helpers.ts';
let box: Sandbox;
beforeEach(()=>{box=createSandbox();});afterEach(()=>box.dispose());
function report(): CiResult { return {...blank(''),status:'passed',headSha:box.head(),mergeable:'clean'}; }
function tools() {
  box.fake('gh',[rule(['api','graphql'],reply(JSON.stringify({data:{repository:{pullRequest:{}}}})))]);
  const result=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView({head_revision:box.head(),is_draft:false}))),rule(['forge','checks.state'],ok('checks.state',{units:[]})),rule(['forge','pr.reviews'],ok('pr.reviews',{items:[]})),rule(['forge','pr.merge-state'],ok('pr.merge-state',{mergeable:'clean'}))]);
  box.git('push','--set-upstream','origin','feature');return result;
}
test.each(['passed','failed','comments','pending','error'])('INT-010 CI gate handles %s and stops after three cycles',status=>{
  const first=ciGate(status,false,1);expect(first.fix).toBe(['failed','comments'].includes(status));expect(first.done).toBe(['passed','error'].includes(status));
  expect(ciGate(status,false,3).done).toBe(true);expect(ciGate(status,true,1).done).toBe(true);
});
test.each(['check','pending','review','conflict','comment','head','error','unknown'])('INT-010 final result rejects %s',kind=>{
  const result=report();
  if(kind==='check'){result.status='failed';result.failedChecks=[{name:'lint',state:'red',detail:'failure',unit:{kind:'check',id:'1',name:'lint'}}];}
  if(kind==='pending'){result.status='pending';result.pendingChecks=[{name:'build',state:'pending',detail:'running',unit:{kind:'check',id:'1',name:'build'}}];}
  if(kind==='review')result.blockingReviews=[{login:'reviewer',state:'CHANGES_REQUESTED',body:'fix'}];
  if(kind==='conflict')result.mergeable='conflict';
  if(kind==='unknown')result.mergeable='unknown';
  if(kind==='comment')result.comments={hasComments:true,unresolvedThreads:[],deferredThreads:[],issueComments:[{author:'author',body:'fix'}],informationalBotComments:[]};
  if(kind==='head')result.headSha='stale';if(kind==='error')result.error='missing credential';
  const expected: Record<string,string> = {'check': 'failed check: lint', 'pending': 'pending check: build', 'review': 'blocking review: reviewer', 'conflict': 'merge state: conflict', 'comment': 'review comments remain actionable', 'head': 'CI report does not cover the final head', 'error': 'missing credential', 'unknown': 'merge state: unknown'};
  expect(finalizeProblems(result,box.head())).toContain(expected[kind]);
});
test('INT-010 clean and no-CI heads pass; missing reports fail',()=>{
  expect(finalizeProblems(report(),box.head())).toEqual([]);expect(finalizeProblems(null,box.head())).toEqual(['final CI report is missing']);
});
test('INT-010 final report reuse avoids waiting; pending or moved heads wait again',()=>{
  const api=tools();const args={tools:api,sleep:noSleep,dir:box.path('artifacts'),report:'ci/final.md',options:{maxMinutes:0,intervalSeconds:30}};
  const settled=report();box.write('artifacts/ci/latest.json',JSON.stringify(settled));
  expect(finalCi(args)).toEqual(settled);expect(box.calls('archon').filter(c=>c.args[1]==='checks.state')).toHaveLength(0);
  box.write('artifacts/ci/latest.json',JSON.stringify({...settled,status:'pending'}));expect(finalCi(args).status).toBe('passed');
  box.write('artifacts/ci/latest.json',JSON.stringify({...settled,headSha:'old'}));expect(finalCi(args).headSha).toBe(box.head());
  expect(box.calls('archon').filter(c=>c.args[1]==='checks.state')).toHaveLength(2);
});
test('INT-010 cycle status and record-finalize scripts use saved reports across cycles',()=>{
  const api=tools();box.write('artifacts/ci/latest.json',JSON.stringify(report()));
  expect(recordFinalize(api,box.path('artifacts')).ok).toBe(true);
  const script=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const env={...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_OP:'ci-cycle-status',INPUTS_STATUS:'',ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])};
  box.write('artifacts/ci/latest.json',JSON.stringify({...report(),status:'pending'}));
  for(let i=0;i<3;i++){
    const result=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_PREVIOUS:String(i)}});
    expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({done:i===2,fix:false,cycle:i+1});
  }
  const result=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_OP:'record-finalize'}});
  expect(JSON.parse(result.stdout).ok).toBe(false);expect(JSON.parse(box.read('artifacts/step-results.json')).finalize.remaining).toContain('before merging');
});
test('INT-010 cycle gate reads the saved wait result, so comments reach fix-pr when the re-wait is skipped',()=>{
  tools();
  const comments={...report(),status:'comments' as const,comments:{hasComments:true,unresolvedThreads:[],deferredThreads:[],issueComments:[{author:'reviewer',body:'name the file in the error'}],informationalBotComments:[]}};
  box.write('artifacts/ci/latest.json',JSON.stringify(comments));
  const script=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const env={...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_STATUS:'',INPUTS_PREVIOUS:'0',ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])};
  const run=(op:string)=>{const r=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_OP:op}});expect(r.status).toBe(0);return JSON.parse(r.stdout);};
  const gate=run('ci-cycle-status');
  expect(gate).toMatchObject({done:false,fix:true,cycle:1});expect(gate.ci_report).toContain('name the file in the error');
  expect(run('end-ci-cycle')).toEqual({done:false,fix:true,cycle:1});
});
test('INT-010 wait errors for missing upstream and draft return without polling',()=>{
  const api=tools();box.git('branch','--unset-upstream');
  expect(waitFinalize({tools:api,sleep:noSleep,dir:box.path('artifacts'),report:'ci/final.md'}).status).toBe('error');
});
test.each([true,false])('INT-012 ready operation accepted %s or refused with forge reason',accepted=>{
  const api=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView())),rule(['forge','pr.ready'],accepted?ok('pr.ready',{}):failed('permission','ready denied'))]);
  const result=markReady(api);expect(result.ok).toBe(accepted);if(!accepted)expect(result.problems).toContain('ready denied');
  expect(box.calls('archon').some(call=>call.args[1]==='pr.ready')).toBe(true);expect(box.calls('archon').some(call=>call.args[1].includes('merge'))).toBe(false);
});
test('INT-012 push failure names the work and never force pushes',()=>{
  box.addBareOrigin();box.git('remote','set-url','origin',box.path('missing.git'));
  const result=acceptancePush(box.exec,'the CI fixes');expect(result.ok).toBe(false);expect(result.problems).toContain('the CI fixes push:');expect(result.problems).not.toContain('--force');
});
test('INT-012 forge preflight requests pr.ready and reports its absence before agents',()=>{
  box.forgeTools([rule(['forge','check'],failed('unsupported_operation','pr.ready unavailable'))]);box.git('remote','set-url','origin','git@github.com:owner/repo.git');
  const result=checkForgeAccess(box.exec,{ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])});
  expect(result.ok).toBe(false);expect(result.problems).toContain('pr.ready unavailable');
  const call=box.calls('archon').find(c=>c.args[1]==='check');expect(call).toBeDefined();expect(JSON.parse(call?.files.data ?? '{}').operations).toContain('pr.ready');
});
test('INT-010 a blocked CI fix still pushes and remains a reportable finalize failure',()=>{
  const api=tools();box.write('artifacts/ci/latest.json',JSON.stringify(report()));
  const script=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const env={...process.env,ARTIFACTS_DIR:box.path('artifacts'),ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])};
  const run=(op:string,extra={})=>{
    const r=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_OP:op,...extra}});
    expect(r.status).toBe(0);return JSON.parse(r.stdout);
  };
  expect(run('finalize-push',{INPUTS_STEP:'push-ci-fix',INPUTS_BLOCKED:'true',INPUTS_REASON:'missing permission'})).toEqual({ok:true,problems:''});
  expect(run('end-ci-cycle',{INPUTS_STATUS:'failed',INPUTS_PREVIOUS:'0'})).toMatchObject({done:true,fix:false});
  expect(run('ci-cycle-status',{INPUTS_STATUS:'failed',INPUTS_PREVIOUS:'1'}).fix).toBe(false);
  recordFinalizeCheck(box.path('artifacts'),'fix-pr',{ok:true,problems:''});
  const final=recordFinalize(api,box.path('artifacts'));expect(final.ok).toBe(false);expect(final.problems).toContain('missing permission');
});
test('INT-010 final diagnostics name every simultaneous blocker',()=>{
  const result=report();result.status='failed';result.headSha='old';result.error='forge permission denied';
  result.failedChecks=[{name:'lint',state:'red',detail:'failure',unit:{kind:'check',id:'lint',name:'lint'}}];
  result.pendingChecks=[{name:'build',state:'pending',detail:'running',unit:{kind:'check',id:'build',name:'build'}}];
  result.blockingReviews=[{login:'alice',state:'CHANGES_REQUESTED',body:'fix'}];result.mergeable='conflict';
  result.comments={hasComments:true,unresolvedThreads:[],deferredThreads:[],issueComments:[{author:'bob',body:'fix'}],informationalBotComments:[]};
  expect(finalizeProblems(result,box.head())).toEqual(['forge permission denied','CI report does not cover the final head','failed check: lint','pending check: build','blocking review: alice','merge state: conflict','review comments remain actionable','final CI status: failed']);
});

function withMovedTips(conflict: boolean) {
  const api = box.forgeTools([rule(['forge', 'pr.view'], ok('pr.view', prView({ base: 'release', head: 'feature' })))]);
  const number = 7;
  const ref = { repo: { host: 'github.com', path: 'owner/repo' }, number };
  box.write('artifacts/review/pages.json', JSON.stringify([{ ref }]));
  box.git('push', 'origin', 'feature:feature', 'feature:release');
  box.git('checkout', '-qb', 'outside');
  box.write('remote-change.txt', 'concurrent push');
  box.git('add', 'remote-change.txt');
  const remote = box.commit('remote PR commit');
  box.git('push', 'origin', 'outside:feature');
  box.git('checkout', 'feature');
  if (conflict) box.commitFix('ours');
  box.git('checkout', '-qb', 'release', 'origin/release');
  if (conflict) box.commitFix('theirs');
  else {
    box.write('release-change.txt', 'base update');
    box.git('add', 'release-change.txt');
    box.commit('base update');
  }
  const base = box.head();
  box.git('push', 'origin', 'release');
  box.git('checkout', 'feature');
  return { api, base, remote, dir: box.path('artifacts') };
}

test('INT-008 merges the forge base and moved remote head with idempotent retry', () => {
  const { api, base, remote, dir } = withMovedTips(false);
  expect(mergeBase(api, dir)).toMatchObject({ ok: true, conflict: false });
  expect(box.exec('git', ['merge-base', '--is-ancestor', base, 'HEAD']).status).toBe(0);
  expect(box.exec('git', ['merge-base', '--is-ancestor', remote, 'HEAD']).status).toBe(0);
  expect(box.git('show', '-s', '--format=%P', 'HEAD').split(' ')).toHaveLength(2);
  const head = box.head();
  expect(mergeBase(api, dir)).toMatchObject({ ok: true });
  expect(box.head()).toBe(head);
});

test('INT-008 hands off a conflict, aborts it into a clean worktree, and records the reason', () => {
  const { api, dir } = withMovedTips(true);
  expect(mergeBase(api, dir)).toMatchObject({ ok: false, conflict: true });
  expect(box.exec('git', ['rev-parse', '--verify', 'MERGE_HEAD']).status).toBe(0);
  expect(finishMerge(box.exec, dir, true, 'A person must choose behavior.').ok).toBe(false);
  expect(box.exec('git', ['rev-parse', '--verify', 'MERGE_HEAD']).status).not.toBe(0);
  expect(box.git('status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(box.read('artifacts/review/merge-conflicts.md')).toBe('A person must choose behavior.');
  expect(JSON.parse(box.read('artifacts/step-results.json'))['merge-base'].ok).toBe(false);
});

test('INT-007 finish entry point resumes a saved feedback response and reports terminal outcomes', () => {
  const sha = box.head();
  const ref = { repo: { host: 'github.com', path: 'owner/repo' }, number: 7 };
  box.forgeTools([rule(['forge', 'pr.view'], ok('pr.view', prView()))]);
  box.write('artifacts/review/accepted-head.txt', sha);
  box.write('artifacts/review/pages.json', JSON.stringify([{ round: 1, head: sha, file: 'review-page-round-1.html', status: 'current', ref }]));
  const html = '<script type="application/json" id="sent-answers">null</script>';
  box.write('artifacts/review-page-round-1.html', html);
  box.write('artifacts/review-page.html', html);
  const script = join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const run = (op: string, answer = '') => {
    const response = Bun.spawnSync([process.execPath, script], { cwd: box.dir, env: {
      ...process.env, ARTIFACTS_DIR: box.path('artifacts'), ARCHON_CLI_COMMAND: JSON.stringify([join(box.binDir, 'archon')]),
      INPUTS_OP: op, INPUTS_CHANGE_FOLDER: 'openspec/changes/fixture', INPUTS_ANSWER: answer,
    } });
    expect(response.exitCode).toBe(0);
    return JSON.parse(response.stdout.toString());
  };
  expect(run('start-round', 'One note')).toMatchObject({ mode: 'feedback', round: 2, archive_needed: true });
  expect(JSON.parse(box.read('artifacts/review-answers-round-1.json')).note).toBe('One note');
  expect(run('start-round')).toMatchObject({ mode: 'feedback', round: 2 });
  for (const failedStep of ['', 'acceptance', 'archive', 'finalize']) {
    box.write('artifacts/step-results.json', JSON.stringify(failedStep ? { [failedStep]: { ok: false, problems: 'failed', remaining: '' } } : {}));
    expect(run('end-run').succeeded).toBe(failedStep === '');
  }
  for (const mode of ['merged', 'closed']) {
    box.write('artifacts/review/outcome.json', JSON.stringify({ mode }));
    expect(run('end-run').succeeded).toBe(mode === 'merged');
  }
});

test('INT-008 finishMerge aborts a remaining target that introduces a second conflict', () => {
  const { api, dir } = withMovedTips(true);
  expect(mergeBase(api, dir).conflict).toBe(true);
  box.git('merge', '--abort');
  expect(finishMerge(box.exec, dir, false, '').ok).toBe(false);
  expect(box.exec('git', ['rev-parse', '--verify', 'MERGE_HEAD']).status).not.toBe(0);
  expect(box.read('artifacts/review/merge-conflicts.md')).toContain('CONFLICT');
  expect(box.git('status', '--porcelain', '--untracked-files=no')).toBe('');
});

test('INT-009 blocked feedback, missing responses are written as review failures', () => {
  const dir = box.path('artifacts');
  expect(checkResponse(dir, 2, false, '').problems).toContain('missing');
  expect(checkResponse(dir, 2, true, 'implementor stopped').ok).toBe(true);
  expect(stepFailures(dir).map(entry => entry.source[0])).toEqual(['failure:address-feedback', 'failure:check-response']);
});

test.each(['check-response', 'finish-merge', 'record-retest'])('round entry point records unexpected %s failures', op => {
  const dir = box.path('artifacts');
  const files: Record<string, string> = {
    'check-response': 'review-answers-round-1.json', 'finish-merge': 'review/merge-targets.json', 'record-retest': 'review/retested-commits.json',
  };
  box.write(`artifacts/${files[op]}`, 'not json');
  const script = join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const result = Bun.spawnSync([process.execPath, script], { cwd: box.dir, env: {
    ...process.env, ARTIFACTS_DIR: dir, INPUTS_ROUND: '2', INPUTS_STATUS: 'true', INPUTS_OP: op,
  } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).ok).toBe(false);
  const step = { 'check-response': 'check-response', 'finish-merge': 'merge-base', 'record-retest': 'retest' }[op];
  expect(stepFailures(dir).map(entry => entry.source[0])).toContain(`failure:${step}`);
});

test.each(['merged', 'open'] as const)('INT-007 resumes an interrupted merge when read-back is %s without resubmitting', state => {
  const dir = box.path('artifacts');
  const head = box.head();
  const api = box.forgeTools([rule(['forge', 'pr.view'], ok('pr.view', prView({ state, head_revision: head }))), rule(['forge', 'pr.edit-body'], ok('pr.edit-body', {}))]);
  const ref = { repo: { host: 'github.com', path: 'owner/repo' }, number: 7 };
  box.write('artifacts/review/pages.json', JSON.stringify([{ round: 1, head, status: 'current', ref }]));
  box.write('artifacts/review-answers-round-1.json', JSON.stringify({ action: 'merge', round: 1, head, time: 'previous' }));
  const passed = { ok: true, problems: '', remaining: '' };
  box.write('artifacts/step-results.json', JSON.stringify({ archive: passed, finalize: passed }));
  const round = startRound(api, { dir, folder: '', text: '' });
  expect(round.mode).toBe(state === 'merged' ? 'merged' : 'stale');
  expect(box.exists('artifacts/review/outcome.json')).toBe(state === 'merged');
  expect(box.calls('archon').some(call => call.args[1] === 'pr.merge')).toBe(false);
});
test.each(['fetch', 'push'])('gitNetwork %s retries timeout and server errors with noninteractive timed attempts', command => {
  const errors = ['spawnSync git ETIMEDOUT', 'returned error: 503', ''];
  const delays: number[] = [];
  const result = gitNetwork((_cmd, args, options) => {
    expect(args[0]).toBe(command);
    expect(options).toMatchObject({ timeout: 300_000, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    const stderr = errors.shift() ?? '';
    return { status: Number(Boolean(stderr)), stdout: '', stderr };
  }, [command, 'origin'], delay => delays.push(delay));
  expect(result).toMatchObject({ ok: true, person: false });
  expect(delays).toEqual([10_000, 30_000]);
});

test.each([
  ['HTTP 500', true, 'unavailable after 3 retries', [10_000, 30_000, 90_000]],
  ['Could not resolve host', true, 'unavailable after 3 retries', [10_000, 30_000, 90_000]],
  ['Authentication failed', true, 'Log in again', []],
  ['could not read Username', true, 'Log in again', []],
  ['Invalid username or password', true, 'Log in again', []],
  ['terminal prompts disabled', true, 'Log in again', []],
  ['Permission denied (publickey)', true, 'Log in again', []],
  ['returned error: 401', true, 'Log in again', []],
  ['returned error: 403', true, 'Log in again', []],
  ['refusing to allow a token to update workflow', true, 'workflow scope', []],
  ['unrecognized failure', false, 'unrecognized failure', []],
] as const)('gitNetwork classifies %s and bounds retries', (stderr, person, problems, expected) => {
  const sleeps: number[] = [];
  let attempts = 0;
  const result = gitNetwork(() => { attempts++; return { status: 1, stdout: '', stderr }; },
    ['push', 'origin'], delay => sleeps.push(delay));
  expect(result).toMatchObject({ ok: false, person, problems: expect.stringContaining(problems) });
  expect(sleeps).toEqual([...expected]);
  expect(attempts).toBe(expected.length + 1);
});

test('acceptance recheck stops on a failed push and the post-round node retries without repair', () => {
  const dir = box.path('artifacts');
  const script = (name: string, env: Record<string, string> = {}) =>
    Bun.spawnSync([process.execPath, join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts', name)], {
      cwd: box.dir, env: { ...process.env, ARTIFACTS_DIR: dir, ...env },
    });
  const initial = script('acceptance-push.ts', { INPUTS_STRICT: 'false' });
  expect(initial.exitCode).toBe(0);
  expect(JSON.parse(initial.stdout.toString())).toMatchObject({ ok: false, person: false });
  expect(box.exists('artifacts/acceptance-stop.txt')).toBe(false);
  const rechecked = script('acceptance-push.ts', { INPUTS_STRICT: 'true', INPUTS_BLOCKED: 'true', INPUTS_REASON: 'fixture repair blocked' });
  expect(rechecked.exitCode).toBe(0);
  expect(JSON.parse(box.read('artifacts/step-results.json')).acceptance).toMatchObject({ ok: false, push: true });
  expect(box.read('artifacts/acceptance-stop.txt')).toContain('fixture repair blocked');
  const strict = script('finish.ts', { INPUTS_OP: 'push-recheck' });
  expect(strict.exitCode).toBe(1);
  expect(strict.stdout.toString()).toBe('');
  box.addBareOrigin();
  const resumed = script('finish.ts', { INPUTS_OP: 'push-recheck' });
  expect(resumed.exitCode).toBe(0);
  expect(JSON.parse(resumed.stdout.toString()).ok).toBe(true);
  expect(stepFailures(dir).find(item => item.source[0] === 'failure:acceptance')?.failLine).toContain('because the push failed');
  const repaired = script('acceptance-push.ts', { INPUTS_STRICT: 'true', INPUTS_BLOCKED: 'true' });
  expect(JSON.parse(repaired.stdout.toString()).ok).toBe(true);
});


  test('merges and pushes both sides of a branch that moved on the remote', () => {
    box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
    box.git('clone', '--branch', 'feature', box.path('origin.git'), box.path('second'));
    box.write('second/remote.txt', 'remote');
    box.gitIn(box.path('second'), 'add', 'remote.txt');
    box.gitIn(box.path('second'), '-c', 'user.email=second@example.test', '-c', 'user.name=Second', 'commit', '-qm', 'second clone');
    box.gitIn(box.path('second'), 'push', 'origin', 'feature');
    const remote = box.gitIn(box.path('second'), 'rev-parse', 'HEAD');
    const local = box.commitFix();
    expect(acceptancePush(box.exec).ok).toBe(true);
    expect(box.git('show', '-s', '--format=%P', 'HEAD')).toBe(`${local} ${remote}`);
    expect(box.gitIn(box.path('origin.git'), 'rev-parse', 'feature')).toBe(box.head());
  });

  test('keeps a pre-push hook refusal eligible for repair', async () => {
    box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
    box.commitFix();
    const hook = box.path('.git/hooks/pre-push');
    await Bun.write(hook, '#!/bin/sh\necho hook-refusal >&2\nexit 1\n');
    box.git('config', 'core.hooksPath', box.path('.git/hooks'));
    expect(Bun.spawnSync(['chmod', '+x', hook]).exitCode).toBe(0);
    expect(acceptancePush(box.exec)).toMatchObject({ ok: false, person: false, problems: expect.stringContaining('hook-refusal') });
  });

test('GitHub targets use the reviewed head and reject paths or commits outside the pull request', () => {
  const changed = box.commitFix();
  const other = box.git('rev-parse', 'HEAD^');
  const links = { base: 'https://github.com/owner/repo', head: changed, dir: box.path('artifacts'), folder: 'openspec/changes/demo', exec: box.exec, bases: [other] };
  expect(resolveTarget('file.txt#L4-L7', links)).toEqual({ href: `${links.base}/blob/${changed}/file.txt#L4-L7` });
  expect(resolveTarget(`commit:${changed}`, links)).toEqual({ href: `${links.base}/commit/${changed}` });
  for (const target of ['artifacts/report.txt', box.path('file.txt'), 'https://example.org/path', `commit:${other}`]) {
    expect(resolveTarget(target, links)).toMatchObject({ problem: expect.stringContaining(target) });
  }
});


  test('ignores untracked files', () => {
    box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
    box.commitFix();
    box.write('scratch.log', 'x\n');
    expect(acceptancePush(box.exec).ok).toBe(true);
  });

  test('aborts a conflicting merge and preserves the remote head', () => {
    box.addBareOrigin();
    box.git('push', '-q', '--set-upstream', 'origin', 'feature');
    const remoteHead = box.commitFix('remote\n');
    box.git('push', '-q', 'origin', 'feature');
    box.git('reset', '-q', '--hard', 'HEAD~1');
    box.commitFix('local\n');
    const result = acceptancePush(box.exec);
    expect(result.ok).toBe(false);
    expect(result.person).toBe(false);
    expect(result.problems).toContain('file.txt');
    expect(box.exec('git', ['rev-parse', '--verify', 'MERGE_HEAD']).status).not.toBe(0);
    expect(box.git('status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(box.gitIn(box.path('origin.git'), 'rev-parse', 'feature')).toBe(remoteHead);
  });

test('INT-010 cloc nonzero exit is an unavailable count after a good merge base', () => {
  box.git('branch', 'main');
  box.fake('cloc', [rule([], { status: 127 })]);
  expect(changeSize(box.exec, 'main')).toBeNull();
  expect(box.calls('cloc')[0]?.args).toContain(box.head());
});


test.each([['ACCEPTANCE_COMPLETE',true],['ACCEPTANCE_FAILED',false]] as const)('stop_after acceptance: %s ends the run without a package, succeeded %s',(status,succeeded)=>{
  const dir=box.path('artifacts');box.write('artifacts/acceptance-preparation-status.txt',`${status}\n`);box.write('artifacts/acceptance-handoff.md','Acceptance did not converge.');
  const finish=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const run=(op:string)=>Bun.spawnSync([process.execPath,finish],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_OP:op,INPUTS_STEP:op,INPUTS_STOP_AFTER:'acceptance'}});
  const ended=run('end-after-acceptance');expect(ended.exitCode).toBe(0);expect(JSON.parse(ended.stdout.toString()).ok).toBe(true);
  const published=run('end-run');expect(published.exitCode).toBe(0);
  expect(JSON.parse(published.stdout.toString())).toEqual({succeeded, reason: ''});expect(box.exists('artifacts/review-package.md')).toBe(false);
});


test('a person-only acceptance push stops the rounds without failing the script', () => {
  box.fake('git', [
    rule(['branch'], reply('feature\n')),
    rule(['status'], reply('')),
    rule(['config'], { status: 1 }),
    rule(['fetch'], { status: 128, stderr: 'fatal: Authentication failed for origin' }),
  ]);
  const script = join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts/acceptance-push.ts');
  const run = Bun.spawnSync([process.execPath, script], { cwd: box.dir,
    env: { ...process.env, ARTIFACTS_DIR: box.path('artifacts'), INPUTS_STRICT: 'false' } });
  expect(run.exitCode).toBe(0);
  expect(JSON.parse(run.stdout.toString())).toMatchObject({ ok: false, person: true, problems: expect.stringContaining('Log in again') });
  expect(JSON.parse(box.read('artifacts/step-results.json')).acceptance).toMatchObject({ push: true });
  expect(box.read('artifacts/acceptance-stop.txt')).toContain('Log in again');
});

test('a resumed first review pass uses the completed archive state', () => {
  box.write('artifacts/step-results.json', JSON.stringify({ archive: { ok: true } }));
  const round = startRound({ exec: box.exec, forge: { call: () => { throw new Error('unexpected forge call'); } } },
    { dir: box.path('artifacts'), folder: 'openspec/changes/demo', text: '' });
  expect(round).toMatchObject({ mode: 'first', archive_needed: false });
});

test('the fixed finalize line comes from final check names, without the raw problems', () => {
  const data = report();
  data.failedChecks = [{ name: 'Verify export', state: 'red', detail: 'failure', unit: { kind: 'check', id: '1', name: 'Verify export' } }];
  data.error = '/tmp/raw output';
  box.write('artifacts/ci/latest.json', JSON.stringify(data));
  const api = { exec: box.exec, forge: { call: () => { throw new Error('unexpected forge call'); } } };
  expect(recordFinalize(api, box.path('artifacts')).ok).toBe(false);
  const failure = stepFailures(box.path('artifacts'))[0];
  expect(failure.failLine).toContain('Verify export');
  expect(failure.failLine).toContain('before merging');
  expect(failure.detail).not.toContain('/tmp/raw output');
});

test('late logs sync into the archive in one commit and preserve unrelated staged work', () => {
  const dir = box.path('artifacts');
  box.write('artifacts/decision-log.md', '## Initial decision\nRequirement: Export settings.\nDecision pending from user: none\n');
  box.write('artifacts/dispute-log.md', '## Initial dispute\nReason: Exit status.\n');
  expect(commitLogs(box.exec, dir, 'demo').ok).toBe(true);
  expect(box.read('openspec/changes/demo/decision-log.md')).not.toContain('Decision pending');
  const archive = 'openspec/changes/archive/2026-11-26-demo';
  mkdirSync(box.path('openspec/changes/archive'), { recursive: true });
  box.git('mv', 'openspec/changes/demo', archive);
  box.commit('archive');
  box.write('file.txt', 'staged change');
  box.git('add', 'file.txt');
  box.write('artifacts/decision-log.md', `${box.read('artifacts/decision-log.md')}\n## D-20: Retest decision\nReason: Timed out.\n`);
  box.write('artifacts/dispute-log.md', `${box.read('artifacts/dispute-log.md')}\n## New dispute\nReason: Exit code.\n`);
  expect(syncLogs(box.exec, dir, archive, 'demo').ok).toBe(true);
  const head = box.head();
  expect(box.git('show', '--format=', '--name-only', head).split('\n')).toEqual([`${archive}/decision-log.md`, `${archive}/dispute-log.md`]);
  expect(box.read(`${archive}/decision-log.md`)).toContain('## DECIDE-2: Retest decision');
  expect(box.read(`${archive}/dispute-log.md`)).toContain('## DISPUTE-2: New dispute');
  expect(JSON.parse(box.read('artifacts/review/log-state.json'))).toEqual({ decision: 2, dispute: 2 });
  expect(box.git('diff', '--cached', '--name-only')).toBe('file.txt');
  expect(syncLogs(box.exec, dir, archive, 'demo').ok).toBe(true);
  expect(box.head()).toBe(head);
});

test('failure to commit synced logs records the failure, restores the tree, and allows a retry', () => {
  const dir = box.path('artifacts');
  expect(commitLogs(box.exec, dir, 'demo').ok).toBe(true);
  box.write('artifacts/decision-log.md', '## Retest choice\nReason: Imports.\n');
  const folder = 'openspec/changes/demo';
  const refusal = syncLogs((command, args, options) => args[0] === 'commit'
    ? { status: 1, stdout: '', stderr: 'commit refused' } : box.exec(command, args, options), dir, folder, 'demo');
  expect(refusal.ok).toBe(false);
  expect(stepFailures(dir).map(item => item.source[0])).toContain('failure:logs');
  expect(box.git('status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(JSON.parse(box.read('artifacts/review/log-state.json')).decision).toBe(0);
  expect(syncLogs(box.exec, dir, folder, 'demo').ok).toBe(true);
  expect(box.read(`${folder}/decision-log.md`)).toContain('## DECIDE-1: Retest choice');
});

test('shared answers settle every grouped source while separate declined disputes stay open', () => {
  const folder = 'openspec/changes/demo';
  const dir = box.path('artifacts');
  box.write('artifacts/pull-request.json', JSON.stringify({ head_revision: box.head() }));
  box.write(`${folder}/checklist.md`, '| ID | Behavior | Status |\n|---|---|---|\n| C-1 | Export | verified |\n');
  box.write(`${folder}/decision-log.md`, '## DECIDE-1: Choose format\nReason: Readers.\n## D-2: Accept empty notes\nReason: CLI.\n## DECIDE-3: Extra column\nSettled in review round 1\n## DECIDE-4: Export fields\nReason: Stability.\n');
  box.write(`${folder}/dispute-log.md`, '## DISPUTE-1: PR comment on spacing\nReason: Style.\n## DISPUTE-2: Alternate export\nStatus: spec-change\n## DISPUTE-3: Missing headers\nStatus: spec-change\n## DISPUTE-4: PR comment on names\nReason: Style.\n');
  box.git('add', 'openspec');
  box.commit('commit logs');
  const question = standardQuestion('Dispute');
  const ranked = { ...emptyRanking(), red: [{ source: ['DISPUTE-2', 'DISPUTE-3'], questions: [
    { ...question, source: 'DISPUTE-2' }, { ...question, source: 'DISPUTE-3' },
  ] }], yellow: [{ source: ['DECIDE-1', 'D-2', 'DISPUTE-1'], questions: [question] }] };
  box.write('artifacts/review/pages.json', '[{"round":1,"file":"page.html","status":"feedback sent"}]');
  box.write('artifacts/page.html', pageHtml(ranked));
  box.write('artifacts/review-response-round-1.json', JSON.stringify([
    { item: 'D-2', status: 'unchanged' }, { item: 'DISPUTE-2', status: 'fixed' }, { item: 'DISPUTE-3', status: 'declined' },
  ]));
  const result = inventory({ exec: box.exec, dir, changeFolder: folder });
  expect(result.required.map(row => [row.tier, ...row.item.source])).toEqual([
    ['yellow', 'DECIDE-4'], ['red', 'DISPUTE-3'], ['yellow', 'DISPUTE-4'],
  ]);
  expect(checkRanking(emptyRanking(), result.required, result.context).problems).toContain('DISPUTE-4');
  const placed = placeRanking(emptyRanking(), result.required, result.context);
  expect(placed.yellow[0].title).toBe('Export fields');
  expect(placed.yellow[0].links).toEqual([{ label: 'How the agent decided', target: 'log:DECIDE-4' }]);
});
