import { renderReport } from './ci-report.ts';
// Adapters for finish nodes. All expected failures become reports so the package still runs.
import { join } from 'node:path';
import { artifactsDir, type CheckResult, fail, pass } from './check.ts';
import { runCommand, sleep } from './exec.ts';
import { defaultTools } from './forge.ts';
import { archiveChange, verifyArchive, recordArchive } from './archive.ts';
import { commitLogs } from './logs.ts';
import { checklistPath } from './checklist.ts';
import { evidenceRows } from './evidence.ts';
import { acceptancePush, markReady } from './pull-request.ts';
import { blank, type CiResult } from './ci.ts';
import { waitFinalize, finalCi, ciGate, recordFinalize, recordFinalizeCheck, finalizationBlocked, endCiCycle } from './finalize.ts';
import { failedItems, inventory, type Ranking } from './review-inventory.ts';
import { checkRanking, placeRanking, publishPackage } from './review-package.ts';
import { readJson, writeJson, recordStep, readText, writeText } from './run-files.ts';
interface FinishInputs {
  op: string; name: string; folder: string; blocked: boolean; reason: string;
  result: string; previous: string; status: string; step: string;
  /** False when stop_after is acceptance: the run ends after the acceptance rounds. */
  finish?: boolean;
}
function archiveNode(input: FinishInputs, dir: string): unknown {
  const args = { exec: runCommand, dir, name: input.name };
  if (input.op === 'record-archive') {
    const recorded = recordArchive(args);
    if (input.blocked) recordStep(dir, 'archive', { ok: false, problems: input.reason, remaining: `Repair the archive; retained folder: ${recorded.change_folder}` });
    return recorded;
  }
  if (input.blocked) return { ...fail(`REPAIR_BLOCKED: ${input.reason}`), ...(input.op === 'verify-archive-commit' ? { archive_state: readText(join(dir, 'archive/state.json')) } : {}) };
  if (input.op === 'archive-change') return archiveChange(args);
  return { ...verifyArchive(args), archive_state: readText(join(dir, 'archive/state.json')) };
}
function runCiWait(input: FinishInputs, dir: string, cycle: number): unknown {
  const tools = defaultTools();
  const args = { tools, sleep, dir, report: `ci/finalize-${cycle}.md` };
  const result = input.op === 'final-ci' ? finalCi(args) : waitFinalize(args);
  if (result.status === 'error') recordFinalizeCheck(dir, input.step, fail(result.error));
  else recordFinalizeCheck(dir, input.step, pass());
  return { status: result.status, had_checks: result.hadChecks, head_moved: result.headMoved, report: readText(join(dir, 'ci/latest-report.txt')) || join(dir, args.report), ci_report: renderReport(result), cycle };
}
// A cycle's gate reads the CI result its last wait saved, not the waits' node outputs: one of
// the two waits is always skipped, and a skipped node's output does not reach the gate.
function latestCi(dir: string, fallback: string): { status: string; ciReport: string } {
  const latest = readJson<CiResult | null>(join(dir, 'ci/latest.json'), null);
  return latest ? { status: latest.status, ciReport: renderReport(latest) } : { status: fallback, ciReport: '' };
}
function ciNode(input: FinishInputs, dir: string): unknown {
  const previous = Number(input.previous); const cycle = Number.isFinite(previous) ? previous + 1 : 1;
  if (input.op === 'end-ci-cycle') return endCiCycle(dir, latestCi(dir, input.status).status, cycle);
  if (input.op === 'ci-cycle-status') {
    const latest = latestCi(dir, input.status);
    return { ...ciGate(latest.status, input.blocked || finalizationBlocked(dir), cycle), ci_report: latest.ciReport };
  }
  const tools = defaultTools();
  if (input.op === 'record-finalize') return recordFinalize(tools, dir);
  if (input.blocked || (input.op === 'wait-finalize-ci' && finalizationBlocked(dir))) {
    recordFinalizeCheck(dir, input.step, { ...fail(`REPAIR_BLOCKED: ${input.reason || 'an earlier finalize repair is blocked'}`), terminal: true });
    return { status: 'error', had_checks: false, head_moved: false, report: '', ci_report: input.reason, cycle };
  }
  return runCiWait(input, dir, cycle);
}
function rankingNode(input: FinishInputs, dir: string): unknown {
  const inv = inventory({ exec: runCommand, dir, changeFolder: input.folder });
  if (input.op === 'prepare-ranking') return { accepted_head: inv.accepted_head, later_commits: JSON.stringify(inv.later_commits) };
  if (input.op === 'publish-review-package') return publishPackage(defaultTools(), dir, input.folder, readJson<Ranking>(join(dir, 'review-attention.json'), JSON.parse(input.result || '{}') as Ranking));
  const ranking = JSON.parse(input.result) as Ranking;
  if (input.op === 'place-ranking') {
    writeJson(join(dir, 'review-attention.json'), placeRanking(ranking, inv.required)); return pass();
  }
  const checked = checkRanking(ranking, inv.required);
  if (checked.ok) writeJson(join(dir, 'review-attention.json'), ranking);
  return checked;
}
function pushOrReady(input: FinishInputs, dir: string): CheckResult {
  if (input.blocked) {
    // The node's output is only ok and problems; the terminal mark stays in the run file.
    const blocked = fail(`REPAIR_BLOCKED: ${input.reason}`);
    recordFinalizeCheck(dir, input.step, { ...blocked, terminal: true }); return blocked;
  }
  const checked = input.op === 'mark-ready' ? markReady(defaultTools()) : acceptancePush(runCommand, input.result);
  recordFinalizeCheck(dir, input.step, checked); return checked;
}
/** The IDs of the checklist rows still marked not verified when the acceptance rounds end. */
export function unverifiedRows(folder: string): { rows: string } {
  const rows = evidenceRows(readText(checklistPath(folder))) ?? [];
  return { rows: rows.filter(row => row.status === 'not verified').map(row => row.id).join(', ') };
}
/** Pushes the recheck's commit when the run stops after acceptance; a failure is the acceptance's. */
export function pushRecheck(dir: string): CheckResult {
  const pushed = acceptancePush(runCommand, 'recheck');
  if (!pushed.ok) recordStep(dir, 'acceptance', { ok: false, problems: pushed.problems, remaining: 'Push the branch: the pull request lacks the recheck of the rows not verified.' });
  return pushed;
}
/** A run that stops after acceptance publishes no package; it succeeds when acceptance converged. */
export function endedAfterAcceptance(dir: string): { succeeded: boolean } {
  return { succeeded: failedItems(dir).length === 0 };
}
function dispatch(input: FinishInputs, dir: string): unknown {
  if (input.op === 'end-after-acceptance') return pass();
  if (input.op === 'list-unverified') return unverifiedRows(input.folder);
  if (input.op === 'push-recheck') return pushRecheck(dir);
  if (input.op === 'publish-review-package' && input.finish === false) return endedAfterAcceptance(dir);
  if (input.op === 'commit-logs') return commitLogs(runCommand, dir, input.name);
  if (['archive-change', 'verify-archive-commit', 'record-archive'].includes(input.op)) return archiveNode(input, dir);
  if (['wait-finalize-ci', 'ci-cycle-status', 'end-ci-cycle', 'final-ci', 'record-finalize'].includes(input.op)) return ciNode(input, dir);
  if (['mark-ready', 'finalize-push'].includes(input.op)) return pushOrReady(input, dir);
  return rankingNode(input, dir);
}
export function finishRun(input: FinishInputs): void {
  const dir = artifactsDir();
  try { process.stdout.write(`${JSON.stringify(dispatch(input, dir))}\n`); }
  catch (error) {
    const failure = fail(String(error));
    if (['wait-finalize-ci', 'final-ci'].includes(input.op)) {
      const result = blank(failure.problems); writeJson(join(dir, 'ci/latest.json'), result);
      recordFinalizeCheck(dir, input.step, failure);
      process.stdout.write(`${JSON.stringify({ status: 'error', had_checks: false, head_moved: false, report: '', ci_report: failure.problems, cycle: 0 })}\n`); return;
    }
    if (input.op === 'record-finalize') recordStep(dir, 'finalize', { ...failure, remaining: 'Repair finalization before merging.' });
    if (input.op === 'publish-review-package') { process.stderr.write(`${String(error)}\n`); process.exit(1); }
    const extra = input.op === 'verify-archive-commit' ? { archive_state: readText(join(dir, 'archive/state.json')) } : {};
    process.stdout.write(`${JSON.stringify({ ...failure, ...extra })}\n`);
  }
}
export function endAcceptance(dir: string, reason: string): void {
  writeText(join(dir, 'acceptance-stop.txt'), reason);
  recordStep(dir, 'acceptance', { ok: false, problems: reason, remaining: `Resolve the decision or push failure before merging. ${readText(join(dir, 'decision-log.md'))}` });
}
