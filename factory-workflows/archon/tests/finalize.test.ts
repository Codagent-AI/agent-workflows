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
  const env={...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_OP:'ci-cycle-status',INPUTS_STATUS:'pending',ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])};
  for(let i=0;i<3;i++){
    const result=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_PREVIOUS:String(i)}});
    expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual({done:i===2,fix:false,cycle:i+1});
  }
  box.write('artifacts/ci/latest.json',JSON.stringify({...report(),status:'pending'}));
  const result=spawnSync(process.execPath,[script],{cwd:box.dir,encoding:'utf8',env:{...env,INPUTS_OP:'record-finalize'}});
  expect(JSON.parse(result.stdout).ok).toBe(false);expect(JSON.parse(box.read('artifacts/step-results.json')).finalize.remaining).toContain('before merging');
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
  expect(run('finalize-push',{INPUTS_STEP:'push-ci-fix',INPUTS_BLOCKED:'true',INPUTS_REASON:`${cause} missing permission`}).ok).toBe(false);
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
