// Deterministic numbering and isolated commit of the two agent-authored logs.
import { join } from 'node:path';
import type { Exec } from './exec.ts';
import { type CheckResult, fail, pass } from './check.ts';
import { readText, writeText, recordStep, readJson } from './run-files.ts';
export function numberLog(text: string, prefix: string): string {
  let count = 0;
  const numbered = text.replace(/^## (?:D[P]?-\d+: )?(.*)$/gm, (_match, heading: string) => {
    count += 1; return `## ${prefix}-${String(count).padStart(2, '0')}: ${heading}`;
  });
  return count > 0 ? `${numbered.trim()}\n` : 'No entries.\n';
}
export function logMessage(name: string): string {
  const ticket = /^([a-z][a-z0-9]*)-(\d+)-.+$/.exec(name);
  return ticket ? `${ticket[1].toUpperCase()}-${ticket[2]}: Add decision and dispute logs` : `[logs] chore: add the decision and dispute logs for ${name}`;
}
export function commitLogs(exec: Exec, dir: string, name: string): CheckResult {
  const folder = `openspec/changes/${name}`;
  const paths = ['decision-log.md', 'dispute-log.md'].map(file => join(folder, file));
  for (const [index, file] of ['decision-log.md', 'dispute-log.md'].entries()) {
    writeText(paths[index], numberLog(readText(join(dir, file)), index === 0 ? 'D' : 'DP'));
  }
  const results = readJson<Record<string, { ok: boolean; problems: string; remaining: string }>>(join(dir, 'step-results.json'), {});
  if (results.acceptance && !results.acceptance.ok) {
    const decisions = readText(paths[0]);
    recordStep(dir, 'acceptance', { ...results.acceptance, remaining: `${results.acceptance.remaining}\n${decisions}` });
  }
  for (const args of [['add', '--', ...paths], ['commit', '--only', '-m', logMessage(name), '--', ...paths]]) {
    const result = exec('git', args);
    if (result.status !== 0) {
      const failure = fail(`${result.stdout}\n${result.stderr}`);
      recordStep(dir, 'logs', { ...failure, remaining: 'The archive commit will include these logs.' });
      return failure;
    }
  }
  return pass();
}
