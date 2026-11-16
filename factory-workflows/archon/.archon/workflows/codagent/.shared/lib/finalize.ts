// Final-head CI reports are reusable only when they are settled and cover the current head.
import { join } from 'node:path';
import { type CiResult, type WaitOptions, blank, waitForCi } from './ci.ts';
import { renderReport } from './ci-report.ts';
import type { Tools } from './pull-request.ts';
import { lookupPr } from './pull-request.ts';
import { type Sleep, output } from './exec.ts';
import { readJson, writeJson, writeText, recordStep } from './run-files.ts';
export function ciGate(status: string, blocked: boolean, cycle: number): { done: boolean; fix: boolean; cycle: number } {
  return { done: blocked || ['passed', 'error'].includes(status) || cycle >= 3, fix: !blocked && ['failed', 'comments'].includes(status), cycle };
}
export interface FinalizeWait { tools: Tools; sleep: Sleep; dir: string; report: string; options?: WaitOptions; }
export function waitFinalize(input: FinalizeWait): CiResult {
  const found = lookupPr(input.tools);
  const upstream = output(input.tools.exec, 'git', ['rev-parse', '--abbrev-ref', '@{upstream}']);
  const ahead = output(input.tools.exec, 'git', ['rev-list', '--count', 'HEAD..@{upstream}']);
  const invalid = !found.ok || found.value.view?.pr.is_draft || !upstream || ahead !== '0';
  const invalidReason = found.ok ? 'CI wait requires a ready pull request and an upstream not ahead of this branch' : found.problem;
  const result = invalid ? blank(invalidReason) :
    waitForCi(input.tools, input.sleep, input.options ?? { maxMinutes: 15, intervalSeconds: 30 });
  writeText(join(input.dir, input.report), renderReport(result));
  writeJson(join(input.dir, `${input.report}.json`), result);
  writeJson(join(input.dir, 'ci/latest.json'), result);
  writeText(join(input.dir, 'ci/latest-report.txt'), join(input.dir, input.report));
  return result;
}
export function finalCi(input: FinalizeWait): CiResult {
  const last = readJson<CiResult | null>(join(input.dir, 'ci/latest.json'), null);
  const head = output(input.tools.exec, 'git', ['rev-parse', 'HEAD']);
  const found = lookupPr(input.tools);
  const sameHead = found.ok && found.value.view?.pr.head_revision === head;
  if (last && sameHead && last.headSha === head && !last.headMoved && !['pending', 'error'].includes(last.status)) return last;
  return waitFinalize({ ...input, report: 'ci/final.md' });
}
export function finalizeProblems(result: CiResult | null, head: string): string[] {
  if (!result) return ['final CI report is missing'];
  const problems: string[] = [];
  if (result.error) problems.push(result.error);
  if (result.headSha !== head || result.headMoved) problems.push('CI report does not cover the final head');
  problems.push(...result.failedChecks.map(check => `failed check: ${check.name}`));
  problems.push(...result.pendingChecks.map(check => `pending check: ${check.name}`));
  problems.push(...result.blockingReviews.map(review => `blocking review: ${review.login}`));
  if (result.mergeable !== 'clean') problems.push(`merge state: ${result.mergeable}`);
  if (result.comments?.hasComments) problems.push('review comments remain actionable');
  if (result.status !== 'passed') problems.push(`final CI status: ${result.status}`);
  return problems;
}
export function recordFinalize(tools: Tools, dir: string): { ok: boolean; problems: string } {
  const result = readJson<CiResult | null>(join(dir, 'ci/latest.json'), null);
  const failures = readJson<Record<string, { ok: boolean; problems: string }>>(join(dir, 'finalize-results.json'), {});
  const problems = Object.values(failures).filter(item => !item.ok).map(item => item.problems);
  problems.push(...finalizeProblems(result, output(tools.exec, 'git', ['rev-parse', 'HEAD']) ?? ''));
  const final = { ok: problems.length === 0, problems: problems.join('\n') };
  recordStep(dir, 'finalize', { ...final, remaining: final.ok ? '' : 'Resolve the listed blockers before merging.' });
  return final;
}
export function recordFinalizeCheck(dir: string, step: string, result: { ok: boolean; problems: string }): void {
  const file = join(dir, 'finalize-results.json');
  writeJson(file, { ...readJson<Record<string, unknown>>(file, {}), [step]: result });
}
