import { join } from 'node:path';
import { markBlock } from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { inventory, emptyRanking, type Item, type RequiredItem } from '../.archon/workflows/codagent/.shared/lib/review-inventory.ts';
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
  expect(placed.orange.find(i=>i.type==='Late commit')?.detail).toContain('Tests: none named.');
  const late = placed.orange.find(i=>i.type==='Late commit');
  if (!late) throw new Error('missing late commit');
  late.detail='Tests: test';expect(checkRanking(placed,source.required).ok).toBe(false);
});
test('INT-011 review-first ordering counts types collapsed sections and evidence',()=>{
  const ranking=emptyRanking();ranking.red=[{...item(),type:'Verification, Dispute'}];ranking.orange=Array.from({length:7},(_,i)=>item(i===6?'Late commit':'Decision',`D-${i}`));ranking.yellow=[item('Human check','manual review')];ranking.white=[item('Verification','I-3')];ranking.evidence='Screenshot text equivalent. Unexercised behavior has named unit coverage.';
  const body=renderPackage({ranking,failures:[item('Failure','finalize failed')],summary:'SUMMARY',decisions:'DECISIONS',disputes:'DISPUTES',base:'https://github.com/owner/repo',head:accepted});
  const top=body.split('SUMMARY')[0];expect(top).toContain('Run needs attention');expect(top).toContain('2 orange and 1 yellow');expect(top).not.toContain('D-4');expect(top.indexOf('D-6')).toBeLessThan(top.indexOf('D-0'));
  expect(body).toContain('Verification, Dispute:');expect(body).toContain(`<summary>Testing evidence</summary>`);expect(body).toContain('DECISIONS');expect(body).toContain('#L12-L18');
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
  expect(body).toStartWith('Human intro\n');expect(body).toEndWith('\nHuman footer');expect(body).toContain('D-01: Later choice');expect(box.read('artifacts/review-package.md')).toContain('Review first');
});
test.each(['write','readback'])('INT-011 package %s failure throws',kind=>{
  const tools=box.forgeTools([rule(['forge','pr.view'],ok('pr.view',prView())),rule(['forge','pr.edit-body'],kind==='write'?failed('permission','refused'):ok('pr.edit-body',{}))]);
  expect(()=>publishPackage(tools,box.path('artifacts'),folder,emptyRanking())).toThrow(kind==='write'?'refused':'read-back');
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
  expect(box.read('artifacts/review-package.md')).toContain('Review first');
});
