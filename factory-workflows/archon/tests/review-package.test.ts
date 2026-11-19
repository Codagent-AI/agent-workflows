import { commitLogs } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { join } from 'node:path';
import { markBlock } from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { inventory, emptyRanking, failedItems, type Item, type RequiredItem } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
import { checkRanking, placeRanking, renderPackage, publishPackage } from '../.archon/workflows/codagent/.shared/lib/review-package.ts';
import { createSandbox, type Sandbox, rule, ok, failed, prView, } from './helpers.ts';
let box: Sandbox; let accepted: string;
const folder = 'openspec/changes/demo';
const item = (type = 'Verification', source = 'I-1'): Item => ({ type, title: source, detail: 'specific evidence', link: 'openspec/specs/foo/spec.md:12-18', source: [source] });
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
test('INT-011 accepted head fallback and openspec-only commit exclusion',()=>{
  box.git('add','openspec');box.commit('logs');expect(inv().later_commits).toEqual([]);
  const changed=box.commitFix();expect(inv().later_commits.map(i=>i.title)).toEqual([changed]);
  expect(inv().later_commits[0].detail).toContain('1 file changed');expect(inv().accepted_head).toBe(accepted);
  box.write('artifacts/acceptance-tested-revision.txt',changed);expect(inv().accepted_head).toBe(changed);
  box.write('artifacts/acceptance-round-status.txt',`READY ${accepted}\n`);expect(inv().accepted_head).toBe(accepted);
});
test('INT-011 inventory independently requires failures gaps non-PR disputes and late commits',()=>{
  const list=inv().required;
  expect(list.map(row=>row.item.source[0])).toEqual(['I-1','I-2','DP-01']);
  expect(list.find(row=>row.item.source.includes('DP-02'))).toBeUndefined();
});
test.each(['omit','lower','duplicate','empty','unknown'])('INT-011 rejects %s ranking',kind=>{
  const ranking=emptyRanking();ranking.red=[item()];ranking.orange=[item('Dispute','DP-01')];
  if(kind==='omit')ranking.red=[];
  if(kind==='lower'){ranking.yellow=ranking.red;ranking.red=[];}
  if(kind==='duplicate')ranking.white=[item()];
  if(kind==='empty')ranking.red[0].detail='';
  if(kind==='unknown')ranking.red[0].type='Unknown';
  expect(checkRanking(ranking,required()).ok).toBe(false);
});
test('INT-011 discretionary PR style disputes retain yellow and merged types are accepted',()=>{
  const ranking=emptyRanking();ranking.red=[{...item(),type:'Verification, Dispute',source:['I-1','DP-01']}];
  ranking.yellow=[item('Dispute','DP-02')];expect(checkRanking(ranking,required()).ok).toBe(true);
});
test('INT-011 placement fills omissions corrects floors and names uncovered late commits',()=>{
  box.commitFix();const source=inv();const ranking=emptyRanking();ranking.white=[item()];
  const placed=placeRanking(ranking,source.required);expect(checkRanking(placed,source.required).ok).toBe(true);
  const late = placed.orange.find(i=>i.type==='Late commit');
  if (!late) throw new Error('missing late commit');
  late.detail='Tests: test';expect(checkRanking(placed,source.required).ok).toBe(false);
});
test('INT-011 a late commit sized without openspec/ passes, and placement keeps its detail as written',()=>{
  const sha=box.commitFix();const source=inv();
  const own={...item('Late commit',sha),title:`Commit ${sha.slice(0,7)} after acceptance`,detail:'Size: 7 files changed, 9 insertions(+)\n\nTests: none cover it.'};
  const ranking=emptyRanking();ranking.orange=[own];ranking.red=[item('Verification','I-1')];
  const placed=placeRanking(ranking,source.required);
  expect(placed.orange.find(entry=>entry.source.includes(sha))?.detail).toBe(own.detail);
});
test('INT-011 review-first ordering counts types collapsed sections and evidence',()=>{
  const ranking=emptyRanking();ranking.red=[{...item(),type:'Verification, Dispute'}];ranking.orange=Array.from({length:7},(_,i)=>item(i===6?'Late commit':'Decision',`D-${i}`));ranking.yellow=[item('Human check','manual review')];ranking.white=[item('Verification','I-3')];ranking.evidence='Screenshot text equivalent. Unexercised behavior has named unit coverage.';
  const body=renderPackage({ranking,failures:[item('Failure','finalize failed')],summary:'SUMMARY',decisions:'DECISIONS',disputes:'DISPUTES',base:'https://github.com/owner/repo',head:accepted});
  const top=body.split('SUMMARY')[0];expect(top).not.toContain('D-4');expect(top.indexOf('D-6')).toBeLessThan(top.indexOf('D-0'));
  expect(body).toContain('DECISIONS');expect(body).toContain('#L12-L18');
});
test.each([true,false])('INT-011 publication preserves human text and declares clean outcome %s',clean=>{
  if (!clean) box.write('artifacts/step-results.json',JSON.stringify({archive:{ok:false,problems:'archive failed',remaining:'repair'}}));
  let body='Human intro\n<!-- codagent:generated-body:start -->\nold\n<!-- codagent:generated-body:end -->\nHuman footer';
  const tools=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView({head_revision:box.head()},{body})),ok('pr.view',prView({head_revision:box.head()},{body:'placeholder'}))),rule(['forge','pr.edit-body'],ok('pr.edit-body',{}))]);
  const original=tools.forge.call.bind(tools.forge);
  tools.forge.call=<T>(op:string,request:object)=>{
    if(op==='pr.edit-body') body=(request as {body:string}).body;
    if(op==='pr.view') return {ok:true,value:prView({head_revision:box.head()},{body}) as T};
    return original<T>(op,request);
  };
  box.git('add','openspec');box.commit('late logs');
  const ranking=placeRanking(emptyRanking(),inv().required);
  expect(publishPackage(tools,box.path('artifacts'),folder,ranking).succeeded).toBe(clean);
  expect(body).toStartWith('Human intro\n');expect(body).toEndWith('\nHuman footer');expect(body).toContain('D-01: Later choice');expect(box.exists('artifacts/review-package.md')).toBe(true);
});
test.each(['write','readback'])('INT-011 package %s failure throws',kind=>{
  const tools=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView())),rule(['forge','pr.edit-body'],kind==='write'?failed('permission','refused'):ok('pr.edit-body',{}))]);
  expect(()=>publishPackage(tools,box.path('artifacts'),folder,emptyRanking())).toThrow(kind==='write'?'refused':undefined);
});
test('INT-011 failed steps are independent red Failure items and drive authored outcome',()=>{
  box.write('artifacts/step-results.json',JSON.stringify({archive:{ok:false,problems:'delta failed',remaining:'repair delta'},finalize:{ok:false,problems:'check lint failed',remaining:'fix lint'},acceptance:{ok:false,problems:'blocked D-01',remaining:'choose D-01; push failed unless finalize pushed it'}}));
  const source=inv();const failures=source.required.filter(row=>row.item.type==='Failure');expect(failures).toHaveLength(3);expect(failures.every(row=>row.tier==='red')).toBe(true);
  const body=renderPackage({ranking:emptyRanking(),failures:failures.map(row=>row.item),summary:'summary',decisions:'',disputes:'',base:'url',head:accepted});expect(body).toContain('check lint failed');expect(body).toContain('D-01');expect(body).toContain('unless finalize pushed it');
});
test('INT-011 original PR head survives a later checked revision',()=>{
  const later=box.commitFix();box.write('artifacts/pull-request.json',JSON.stringify({head_revision:later,opened_head_revision:accepted}));
  expect(inv().accepted_head).toBe(accepted);expect(inv().later_commits[0].source).toContain(later);
});
test('INT-011 finish entry points prepare reject place and publish with fake forge envelopes',()=>{
  const ranking=placeRanking(emptyRanking(),inv().required);
  const expected=markBlock(renderPackage({ranking,failures:[],summary:box.read('artifacts/pr-body.md'),decisions:box.read(`${folder}/decision-log.md`),disputes:box.read(`${folder}/dispute-log.md`),base:'https://github.com/owner/repo',head:box.head()}));
  box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView({}, {body:''})),ok('pr.view',prView({}, {body:expected}))),rule(['forge','pr.edit-body'],ok('pr.edit-body',{}))]);
  const file=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const run=(op:string,value:unknown='')=>{
    const result=Bun.spawnSync([process.execPath,file],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_OP:op,INPUTS_CHANGE_FOLDER:folder,INPUTS_RESULT:typeof value==='string'?value:JSON.stringify(value),ARCHON_CLI_COMMAND:JSON.stringify([join(box.binDir,'archon')])}});
    expect(result.exitCode).toBe(0);return JSON.parse(result.stdout.toString());
  };
  expect(run('prepare-ranking').accepted_head).toBe(accepted);
  expect(run('check-ranking',emptyRanking()).ok).toBe(false);
  expect(run('place-ranking',emptyRanking()).ok).toBe(true);
  expect(run('publish-review-package').succeeded).toBe(true);
  expect(box.exists('artifacts/review-package.md')).toBe(true);
});
test('INT-011 an agent Failure cannot hide a failed checklist row during publication',()=>{
  const ranking=emptyRanking();ranking.red=[item('Failure')];
  expect(checkRanking(ranking,[required()[0]]).ok).toBe(false);
  const placed=placeRanking(ranking,[required()[0]]);expect(placed.red).toHaveLength(1);expect(placed.red[0].type).toBe('Verification');
  const body=renderPackage({ranking:placed,failures:[],summary:'summary',decisions:'',disputes:'',base:'url',head:accepted});expect(body).toContain('I-1');
});
test('INT-011 wrong source type is rejected and deterministic placement repairs it',()=>{
  const ranking=emptyRanking();ranking.red=[item('Decision')];
  expect(checkRanking(ranking,[required()[0]]).ok).toBe(false);
  expect(checkRanking(placeRanking(ranking,[required()[0]]),[required()[0]]).ok).toBe(true);
});
test('INT-011 grouped late commits retain every size tests and merged symptom after placement',()=>{
  const source=inv();const one=box.commitFix('first change');const two=box.commitFix('second\nchange\nwith more lines');
  const commits=inventory({exec:box.exec,dir:box.path('artifacts'),changeFolder:folder}).required.filter(row=>row.item.type==='Late commit');
  const ranking=emptyRanking();ranking.yellow=[{...item('Late commit, Decision','D-01'),title:'Grouped changes',detail:'Original symptom: integration changed.\nTests: regression.',source:[one,two,'D-01']}];
  const placed=placeRanking(ranking,[...source.required,...commits]);expect(checkRanking(placed,[...source.required,...commits]).ok).toBe(true);
  const group=placed.orange.find(entry=>entry.source.includes(one)&&entry.source.includes(two));expect(group?.detail).toContain('Original symptom');expect(group?.detail).toContain('Tests: regression.');
  for(const expected of commits){expect(group?.detail).toContain(expected.item.title);expect(group?.detail).toContain(expected.item.detail.split('\n')[0]);}
});
test('INT-011 merge conflict resolution is inventoried and OpenSpec-only merges are excluded',()=>{
  const base=box.head();box.git('checkout','-qb','side');box.commitFix('side');box.git('checkout','feature');box.commitFix('main');
  const merge=box.exec('git',['merge','side','--no-ff','-m','merge']);expect(merge.status).not.toBe(0);
  box.write('file.txt','product conflict resolution');box.git('add','file.txt');const merged=box.commit('merge resolved');
  const found=inv().later_commits.find(entry=>entry.title===merged);expect(found).toBeDefined();expect(found?.detail).toContain('1 file changed');
  box.git('checkout','-qb','spec-side');box.write('openspec/specs/new/spec.md','spec');box.git('add','openspec/specs/new/spec.md');box.commit('spec');box.git('checkout','feature');box.git('merge','spec-side','--no-ff','-m','spec merge');
  expect(inv().later_commits.map(entry=>entry.title)).not.toContain(box.head());expect(base).toBe(accepted);
});
test('INT-011 actual blocked acceptance is linked to its numbered committed decision',()=>{
  box.write('artifacts/decision-log.md','## Fallback choice\nQuestion: choose the fallback.\nRequirement: approved fallback.\nDecision pending from user: choose.\n');
  const file=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/check-acceptance-progress.ts');
  const result=Bun.spawnSync([process.execPath,file],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:box.path('artifacts'),INPUTS_BLOCKED:'true',INPUTS_FIX:'true',INPUTS_REASON:'choose the fallback'}});
  expect(result.exitCode).toBe(0);expect(commitLogs(box.exec,box.path('artifacts'),'demo').ok).toBe(true);
  const failure=failedItems(box.path('artifacts')).find(entry=>entry.source.includes('failure:acceptance'));
  expect(failure?.detail).toContain('D-01: Fallback choice');expect(failure?.detail).toContain('choose the fallback');
});
test.each([false,true])('INT-011 actual failed acceptance push reports subsequent finalize push %s',pushAgain=>{
  const dir=box.path('artifacts');
  const push=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/acceptance-push.ts');
  const failedPush=Bun.spawnSync([process.execPath,push],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_ON_FAILURE:'report',INPUTS_STRICT:'true',INPUTS_BLOCKED:'false'}});
  expect(failedPush.exitCode).toBe(0);expect(JSON.parse(failedPush.stdout.toString()).ok).toBe(false);
  const detail=()=>failedItems(dir).find(entry=>entry.source.includes('failure:acceptance'))?.detail;
  const before=detail();expect(before).toBeDefined();
  if(pushAgain){box.addBareOrigin();const finish=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');const pushed=Bun.spawnSync([process.execPath,finish],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_OP:'finalize-push',INPUTS_STEP:'finalize-push',INPUTS_RESULT:'the round fixes'}});expect(JSON.parse(pushed.stdout.toString()).ok).toBe(true);}
  expect(detail()===before).toBe(!pushAgain);
});
test.each([['ACCEPTANCE_COMPLETE',true],['ACCEPTANCE_FAILED',false]] as const)('stop_after acceptance: %s ends the run without a package, succeeded %s',(status,succeeded)=>{
  const dir=box.path('artifacts');box.write('artifacts/acceptance-preparation-status.txt',`${status}\n`);box.write('artifacts/acceptance-handoff.md','Acceptance did not converge.');
  const finish=join(import.meta.dir,'../.archon/workflows/codagent/implement-change/scripts/finish.ts');
  const run=(op:string)=>Bun.spawnSync([process.execPath,finish],{cwd:box.dir,env:{...process.env,ARTIFACTS_DIR:dir,INPUTS_OP:op,INPUTS_STEP:op,INPUTS_STOP_AFTER:'acceptance'}});
  const ended=run('end-after-acceptance');expect(ended.exitCode).toBe(0);expect(JSON.parse(ended.stdout.toString()).ok).toBe(true);
  const published=run('publish-review-package');expect(published.exitCode).toBe(0);
  expect(JSON.parse(published.stdout.toString())).toEqual({succeeded});expect(box.exists('artifacts/review-package.md')).toBe(false);
});
