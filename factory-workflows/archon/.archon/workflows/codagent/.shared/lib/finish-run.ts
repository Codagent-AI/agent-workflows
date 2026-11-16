import { renderReport } from './ci-report.ts';
// Adapters for finish nodes. All expected failures become reports so the package still runs.
import { join } from 'node:path';
import { artifactsDir, type CheckResult, fail, pass } from './check.ts';
import { runCommand, sleep } from './exec.ts';
import { defaultTools } from './forge.ts';
import { archiveChange, verifyArchive, recordArchive } from './archive.ts';
import { commitLogs } from './logs.ts';
import { acceptancePush, markReady } from './pull-request.ts';
import { blank } from './ci.ts';
import { waitFinalize, finalCi, ciGate, recordFinalize, recordFinalizeCheck } from './finalize.ts';
import { inventory, type Ranking } from './review-inventory.ts';
import { checkRanking, placeRanking, publishPackage } from './review-package.ts';
import { readJson, writeJson, recordStep, readText, writeText } from './run-files.ts';
interface FinishInputs {
  op: string; name: string; folder: string; blocked: boolean; reason: string;
  result: string; previous: string; status: string; step: string;
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
function ciNode(input: FinishInputs, dir: string): unknown {
  const previous = Number(input.previous); const cycle = Number.isFinite(previous) ? previous + 1 : 1;
  if (input.op === 'ci-cycle-status') return ciGate(input.status, input.blocked, cycle);
  const tools = defaultTools();
  if (input.op === 'record-finalize') return recordFinalize(tools, dir);
  if (input.blocked) {
    recordFinalizeCheck(dir, input.step, fail(`REPAIR_BLOCKED: ${input.reason}`));
    return { status: 'error', had_checks: false, head_moved: false, report: '', ci_report: input.reason, cycle };
  }
  const args = { tools, sleep, dir, report: `ci/finalize-${cycle}.md` };
  const result = input.op === 'final-ci' ? finalCi(args) : waitFinalize(args);
  if (result.status === 'error') recordFinalizeCheck(dir, input.step, fail(result.error));
  else recordFinalizeCheck(dir, input.step, pass());
  return { status: result.status, had_checks: result.hadChecks, head_moved: result.headMoved, report: readText(join(dir, 'ci/latest-report.txt')) || join(dir, args.report), ci_report: renderReport(result), cycle };
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
    const blocked = fail(`REPAIR_BLOCKED: ${input.reason}`);
    recordFinalizeCheck(dir, input.step, blocked); return blocked;
  }
  const checked = input.op === 'mark-ready' ? markReady(defaultTools()) : acceptancePush(runCommand, input.result);
  recordFinalizeCheck(dir, input.step, checked); return checked;
}
function dispatch(input: FinishInputs, dir: string): unknown {
  if (input.op === 'commit-logs') return commitLogs(runCommand, dir, input.name);
  if (['archive-change', 'verify-archive-commit', 'record-archive'].includes(input.op)) return archiveNode(input, dir);
  if (['wait-finalize-ci', 'ci-cycle-status', 'final-ci', 'record-finalize'].includes(input.op)) return ciNode(input, dir);
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
