import { startRound } from '../.archon/workflows/codagent/.shared/lib/review-round.ts';
import { failedItems } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkResponse, mergeBase, finishMerge, pushRound } from '../.archon/workflows/codagent/.shared/lib/review-work.ts';
import { checkForgeAccess } from '../.archon/workflows/codagent/.shared/lib/forge.ts';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ciGate, finalCi, finalizeProblems, waitFinalize, recordFinalize, recordFinalizeCheck } from '../.archon/workflows/codagent/.shared/lib/finalize.ts';
import { blank, type CiResult } from '../.archon/workflows/codagent/.shared/lib/ci.ts';
import { markReady, acceptancePush } from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
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
test.each(['fix-pr','push repair'])('INT-010 blocked %s ends the cycle and cannot be overwritten by later success',cause=>{
  const api=tools();box.write('artifacts/ci/latest.json',JSON.stringify(report()));
  const script=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const env={...process.env,ARTIFACTS_DIR:box.path('artifacts'),ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])};
  const run=(op:string,extra={})=>{
    const r=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_OP:op,...extra}});
    expect(r.status).toBe(0);return JSON.parse(r.stdout);
  };
  expect(run('finalize-push',{INPUTS_STEP:'push-ci-fix',INPUTS_BLOCKED:'true',INPUTS_REASON:`${cause} missing permission`})).toEqual({ok:false,problems:`REPAIR_BLOCKED: ${cause} missing permission`});
  expect(run('end-ci-cycle',{INPUTS_STATUS:'failed',INPUTS_PREVIOUS:'0'})).toMatchObject({done:true,fix:false});
  expect(run('ci-cycle-status',{INPUTS_STATUS:'failed',INPUTS_PREVIOUS:'1'}).fix).toBe(false);
  recordFinalizeCheck(box.path('artifacts'),'push-ci-fix',{ok:true,problems:''});
  const final=recordFinalize(api,box.path('artifacts'));expect(final.ok).toBe(false);expect(final.problems).toContain(`${cause} missing permission`);
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

test('INT-009 blocked feedback, missing responses and a failed push are written as review failures', () => {
  const dir = box.path('artifacts');
  expect(checkResponse(dir, 2, false, '').problems).toContain('missing');
  expect(checkResponse(dir, 2, true, 'implementor stopped').ok).toBe(true);
  expect(pushRound(box.exec, dir, false, '').ok).toBe(false);
  expect(failedItems(dir).map(entry => entry.source[0])).toEqual(['failure:address-feedback', 'failure:check-response', 'failure:push-round']);
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
  expect(failedItems(dir).map(entry => entry.source[0])).toContain(`failure:${step}`);
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
