import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archiveChange, verifyArchive, recordArchive, archiveMessage } from '../.archon/workflows/codagent/.shared/lib/archive.ts';
import { commitLogs, numberLog } from '../.archon/workflows/codagent/.shared/lib/logs.ts';
import { createSandbox, type Sandbox } from './helpers.ts';
let box: Sandbox;
const active = 'openspec/changes/demo'; const archived = 'openspec/changes/archive/2026-11-16-demo';
const script = join(import.meta.dir, '../.archon/workflows/codagent/implement-change/scripts/finish.ts');
beforeEach(() => {
  box = createSandbox(); box.write(`${active}/proposal.md`, 'approved'); box.write('openspec/specs/widget/spec.md', 'old');
  box.git('add', 'openspec'); box.commit('definition'); box.write('artifacts/keep', 'artifacts');
  const fake = join(box.binDir, 'openspec');
  writeFileSync(fake, `#!${process.execPath}\nimport { renameSync, mkdirSync, writeFileSync } from 'node:fs';\nif (process.argv[2] === 'archive') { mkdirSync('openspec/changes/archive', {recursive:true}); renameSync('${active}', '${archived}'); writeFileSync('openspec/specs/widget/spec.md','new'); }\n`);
  chmodSync(fake, 0o755);
});
afterEach(() => box.dispose());
const input = () => ({ exec: box.exec, dir: box.path('artifacts'), name: 'demo' });
function run(op: string, extra = {}) {
  return spawnSync(process.execPath, [script], { cwd: box.dir, encoding: 'utf8', env: { ...process.env, PATH: `${box.binDir}:${process.env.PATH}`, ARTIFACTS_DIR: box.path('artifacts'), INPUTS_OP: op, INPUTS_CHANGE_NAME: 'demo', ...extra } });
}
// Direct module calls use the same fake through an explicit executable path.
function archive() {
  const original = box.exec;
  return archiveChange({ ...input(), exec: (program, args, opts) => original(program === 'openspec' ? join(box.binDir, program) : program, args, opts) });
}
test('INT-008 archive scripts commit exact paths and preserve unrelated staged and unstaged bytes', () => {
  box.write('file.txt', 'staged'); box.git('add', 'file.txt'); box.write('file.txt', 'unstaged');
  const staged = box.git('diff', '--cached'); const unstaged = box.git('diff');
  const result = run('archive-change'); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).ok).toBe(true);
  expect(box.read('openspec/specs/widget/spec.md')).toBe('new'); expect(box.exists(active)).toBe(false);
  expect(box.git('diff', '--cached')).toBe(staged); expect(box.git('diff')).toBe(unstaged);
  expect(verifyArchive(input()).ok).toBe(true);
  expect(box.git('show', '--format=', '--name-only', '--no-renames', 'HEAD').split('\n').sort()).toEqual([`${active}/proposal.md`,`${archived}/proposal.md`,'openspec/specs/widget/spec.md'].sort());
  expect(box.git('log', '-1', '--format=%s')).toBe(archiveMessage('demo'));
  const recorded = run('record-archive'); expect(JSON.parse(recorded.stdout).change_folder).toBe(archived);
  expect(JSON.parse(box.read('artifacts/step-results.json')).archive.ok).toBe(true);
});
test('INT-008 already archived folder is reused without openspec', () => {
  expect(archive().ok).toBe(true); const head = box.head();
  box.fake('openspec', []); expect(archiveChange(input()).ok).toBe(true); expect(box.calls('openspec')).toEqual([]); expect(box.head()).toBe(head);
});
test.each(['none', 'two'])('INT-008 missing or doubled archive %s fails naming folders', kind => {
  box.git('rm', '-r', active); box.commit('removed');
  if (kind === 'two') for (const date of ['2026-11-15','2026-11-16']) box.write(`openspec/changes/archive/${date}-demo/proposal.md`, 'archive');
  box.fake('openspec', [{ args: [], responses: [{ stdout: '' }] }]);
  const result = archiveChange(input()); expect(result.ok).toBe(false);
});
test('INT-008 failed validation records active folder and retains other work', () => {
  box.fake('openspec', [{ args: ['validate'], responses: [{ status: 1, stderr: 'delta conflict' }] }]);
  box.write('file.txt', 'keep'); const result = archiveChange(input()); expect(result.problems).toContain('delta conflict');
  expect(recordArchive(input()).change_folder).toBe(active); expect(box.read('file.txt')).toBe('keep');
  expect(JSON.parse(box.read('artifacts/step-results.json')).archive.ok).toBe(false);
});
test('INT-008 rejected commit keeps moved archive and commit repair can verify it', () => {
  const hooks = box.path('hooks'); box.write('hooks/commit-msg', '#!/bin/sh\necho rejected >&2\nexit 1\n'); chmodSync(join(hooks,'commit-msg'), 0o755); box.git('config','core.hooksPath',hooks);
  archive(); expect(verifyArchive(input()).ok).toBe(false); expect(verifyArchive(input()).problems).toContain('rejected'); expect(recordArchive(input()).change_folder).toBe(archived);
  box.git('config','core.hooksPath','/dev/null'); box.git('add','-A','--','openspec'); box.commit(archiveMessage('demo'),'--only','--','openspec');
  expect(verifyArchive(input()).ok).toBe(true);
});
test('INT-008 verification rejects unrelated commits or altered earlier work', () => {
  archive(); box.commitFix(); expect(verifyArchive(input()).ok).toBe(false);
});
test('INT-009 numbered logs commit only logs; empty logs and ticket messages', () => {
  box.write('artifacts/decision-log.md', '## Choice\nQuestion: API?\nDecision: preserve it.\n');
  box.write('file.txt','unrelated staged');box.git('add','file.txt');
  const result = run('commit-logs');expect(JSON.parse(result.stdout).ok).toBe(true);
  expect(box.read(`${active}/decision-log.md`)).toContain('## D-01: Choice');expect(box.exists(`${active}/dispute-log.md`)).toBe(true);
  expect(box.git('show','--format=','--name-only','HEAD').split('\n').sort()).toEqual([`${active}/decision-log.md`,`${active}/dispute-log.md`]);
  expect(box.git('diff','--cached','--name-only')).toBe('file.txt');
  expect(numberLog('## DP-01: First\ntext\n## Next\nmore','DP')).toContain('## DP-02: Next');
  expect(archiveMessage('abc-123-demo')).toContain('ABC-123');
});
test('INT-009 rejected log commit reports failure for archive fallback', () => {
  box.write('hooks/commit-msg','#!/bin/sh\nexit 1\n');chmodSync(box.path('hooks/commit-msg'),0o755);box.git('config','core.hooksPath',box.path('hooks'));
  expect(commitLogs(box.exec,box.path('artifacts'),'demo').ok).toBe(false);
  expect(JSON.parse(box.read('artifacts/step-results.json')).logs.ok).toBe(false);
  box.git('config','core.hooksPath','/dev/null'); expect(archive().ok).toBe(true);
  expect(box.git('show',`HEAD:${archived}/decision-log.md`)).not.toBe('');
});
test('INT-008 unrelated preexisting main-spec edits remain outside owned delta', () => {
  box.write('openspec/specs/other/spec.md','baseline');box.git('add','openspec/specs/other/spec.md');box.commit('other spec');
  box.write('openspec/specs/other/spec.md','staged other');box.git('add','openspec/specs/other/spec.md');box.write('openspec/specs/other/spec.md','unstaged other');
  const before=box.git('diff','--cached');const unstaged=box.git('diff');expect(archive().ok).toBe(true);
  expect(box.git('diff','--cached')).toBe(before);expect(box.git('diff')).toBe(unstaged);expect(verifyArchive(input()).ok).toBe(true);
  expect(box.git('show','--format=','--name-only','HEAD')).not.toContain('other/spec.md');
});
function localSpecArchive(): { path: string; base: string } {
  const path='openspec/specs/widget/spec.md';
  const base=`${Array.from({length:45},(_,i)=>`line ${i}`).join('\n')}\n`;
  box.write(path,base);box.commit('spec baseline',path);
  const staged=base.replace('line 30\n','user staged\n');box.write(path,staged);box.git('add',path);
  box.write(path,staged.replace('line 40\n','user unstaged\n'));
  const fake=join(box.binDir,'openspec');
  writeFileSync(fake,`#!${process.execPath}\nimport{renameSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';if(process.argv[2]==='archive'){mkdirSync('openspec/changes/archive',{recursive:true});renameSync('${active}','${archived}');writeFileSync('${path}',readFileSync('${path}','utf8').replace('line 0\\n','archived requirement\\n'));}`);chmodSync(fake,0o755);
  return {path,base};
}
test('INT-008 staged and unstaged edits in the archived spec survive without entering its commit',()=>{
  const {path,base}=localSpecArchive();
  expect(archive().ok).toBe(true);
  expect(box.git('show',`HEAD:${path}`)).toBe(base.replace('line 0\n','archived requirement\n').trimEnd());
  expect(box.git('show',`:${path}`)).toContain('user staged');expect(box.git('show',`:${path}`)).not.toContain('user unstaged');
  expect(box.read(path)).toContain('user unstaged');expect(box.read(path)).toContain('archived requirement');
  expect(verifyArchive(input()).ok).toBe(true);
  box.write(path,box.read(path).replace('user unstaged','tampered'));expect(verifyArchive(input()).ok).toBe(false);
});
test.each(['demo','abc-123-demo'])('INT-009 log commit message names the change or ticket for %s',name=>{
  box.write(`openspec/changes/${name}/proposal.md`,'proposal');
  expect(commitLogs(box.exec,box.path('artifacts'),name).ok).toBe(true);
  expect(box.git('log','-1','--format=%s')).toContain(name==='demo'?'demo':'ABC-123');
});
test('INT-008 same-file local layers survive archive commit rejection and repair',()=>{
  const {path}=localSpecArchive();
  box.write('hooks/commit-msg','#!/bin/sh\necho rejected >&2\nexit 1\n');chmodSync(box.path('hooks/commit-msg'),0o755);box.git('config','core.hooksPath',box.path('hooks'));
  archive();expect(verifyArchive(input()).ok).toBe(false);
  box.git('config','core.hooksPath','/dev/null');box.commit(archiveMessage('demo'),'--only','--',active,archived,path);
  expect(verifyArchive(input()).ok).toBe(true);expect(box.git('show',`HEAD:${path}`)).not.toContain('user staged');expect(box.git('show',`:${path}`)).toContain('user staged');expect(box.read(path)).toContain('user unstaged');
});
test('INT-008 failed validation restores suspended local spec patches at final recording',()=>{
  const path='openspec/specs/widget/spec.md';box.write(path,'old\nstaged\n');box.git('add',path);box.write(path,'old\nstaged\nunstaged\n');
  const index=box.git('diff','--cached');const worktree=box.git('diff');
  box.fake('openspec',[{args:['validate'],responses:[{status:1,stderr:'validation failed'}]}]);
  expect(archiveChange(input()).ok).toBe(false);recordArchive(input());
  expect(box.git('diff','--cached')).toBe(index);expect(box.git('diff')).toBe(worktree);expect(JSON.parse(box.read('artifacts/step-results.json')).archive.ok).toBe(false);
});
test('INT-008 conflicting spec restoration fails verification and retains original patches',()=>{
  const path='openspec/specs/widget/spec.md';box.write(path,'local change');box.git('add',path);
  archive();recordArchive(input());
  expect(JSON.parse(box.read('artifacts/step-results.json')).archive.ok).toBe(false);
  const local=JSON.parse(box.read('artifacts/archive/local-specs.json'));
  expect(local.staged).toContain('local change');expect(local.error).toBeTruthy();expect(box.git('show',`HEAD:${path}`)).toBe('new');
});
