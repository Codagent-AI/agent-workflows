import { recordAcceptanceFailure } from './acceptance.ts';
import { renderReport } from './ci-report.ts';
// Adapters for finish nodes. All expected failures become reports so the package still runs.
import { join } from 'node:path';
import { artifactsDir, type CheckResult, fail, pass } from './check.ts';
import { runCommand, sleep } from './exec.ts';
import { defaultTools } from './forge.ts';
import { archiveChange, verifyArchive, recordArchive } from './archive.ts';
import { commitLogs, syncLogs } from './logs.ts';
import { checklistPath } from './checklist.ts';
import { evidenceRows } from './evidence.ts';
import { acceptancePush, checkPush, markReady } from './pull-request.ts';
import { blank, type CiResult } from './ci.ts';
import { waitFinalize, finalCi, ciGate, recordFinalize, recordFinalizeCheck, finalizationBlocked, endCiCycle } from './finalize.ts';
import { acceptedHead, emptyRanking, stepFailures, humanChecks, inventory, type InventoryInput, type Ranking } from './review-inventory.ts';
import { reviewMedia } from './review-media.ts';
import { refreshBase } from './review-revisions.ts';
import { bindDisputeQuestions, checkRanking, placeRanking } from './review-package.ts';
import { settleQuestions } from './review-questions.ts';
import { currentPage, publishPackage } from './publish-review.ts';
import { flagItems, pageItems, passingRewrite, readerItems, readerNotes, type Flag } from './review-reader.ts';
import { outcomesPath, startRound } from './review-round.ts';
import { abortMerge, checkResponse, finishMerge, mergeBase, recordRetest } from './review-work.ts';
import { readJson, writeJson, recordStep, readText, type StepResult, writeText } from './run-files.ts';
interface FinishInputs {
  op: string; name: string; folder: string; blocked: boolean; reason: string;
  result: string; previous: string; status: string; step: string;
  /** False when stop_after is acceptance: the run ends after the acceptance rounds. */
  finish?: boolean; push?: boolean; strict?: boolean; review?: boolean;
  answer?: string; mode?: string; round?: number; wait?: boolean; run?: string; archonUrl?: string; archiveNeeded?: boolean;
}
export function finishInputs(env: NodeJS.ProcessEnv): FinishInputs {
  return { op: env.INPUTS_OP ?? '', name: env.INPUTS_CHANGE_NAME ?? '',
  folder: env.INPUTS_CHANGE_FOLDER ?? '', blocked: env.INPUTS_BLOCKED === 'true' || env.INPUTS_PREVIOUS_BLOCKED === 'true',
  reason: env.INPUTS_REASON ?? '', result: env.INPUTS_RESULT ?? '',
  previous: env.INPUTS_PREVIOUS ?? '', status: env.INPUTS_STATUS ?? '', step: env.INPUTS_STEP ?? '',
  answer: env.INPUTS_ANSWER, mode: env.INPUTS_MODE,
  round: Number(env.INPUTS_ROUND || 1), wait: env.INPUTS_REVIEW_WAIT !== 'false',
  run: env.WORKFLOW_ID, archonUrl: env.INPUTS_ARCHON_URL,
  archiveNeeded: env.INPUTS_ARCHIVE_NEEDED !== 'false',
  finish: env.INPUTS_STOP_AFTER !== 'acceptance',
  push: env.INPUTS_PUSH === 'true', strict: env.INPUTS_STRICT === 'true', review: env.INPUTS_REVIEW !== 'false' };
}
function archiveNode(input: FinishInputs, dir: string): unknown {
  const args = { exec: runCommand, dir, name: input.name, round: input.round };
  if (input.op === 'record-archive' && input.archiveNeeded === false) return { change_folder: input.folder };
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
export function rankingForPublication(input: InventoryInput, review = true): Ranking {
  const saved = readJson<Ranking | null>(join(input.dir, 'review-attention.json'), null);
  if (saved) return saved;
  const inv = inventory(input);
  return settleQuestions(placeRanking(emptyRanking(), inv.required, inv.context), review);
}
function publishNode(input: FinishInputs, dir: string) {
  if (input.mode === 'stale') return { ...currentPage(dir, input.reason), succeeded: false };
  const ranking = rankingForPublication({ exec: runCommand, dir, changeFolder: input.folder }, input.review);
  return publishPackage(defaultTools(), { dir, folder: input.folder, ranking },
    { round: input.round ?? 1, wait: input.wait ?? true, run: input.run ?? '', archonUrl: input.archonUrl ?? '' });
}

function prepareRanking(input: FinishInputs, dir: string) {
  refreshBase(runCommand, dir);
  const inv = inventory({ exec: runCommand, dir, changeFolder: input.folder });
  const media = reviewMedia(dir);
  writeJson(join(dir, 'review/evidence.json'), [...media.shots, ...media.commands]);
  writeJson(join(dir, 'review/media-problems.json'), media.problems);
  writeJson(join(dir, 'review/required.json'), inv.required);
  writeJson(join(dir, 'review/human-checks.json'), humanChecks(input.folder));
  return { accepted_head: inv.accepted_head, later_commits: JSON.stringify(inv.later_commits) };
}

function rankingNode(input: FinishInputs, dir: string): unknown {
  const inv = inventory({ exec: runCommand, dir, changeFolder: input.folder });
  const ranking = JSON.parse(input.result) as Ranking;
  if (input.op === 'place-ranking') {
    writeJson(join(dir, 'review-attention.json'), settleQuestions(placeRanking(ranking, inv.required, inv.context), input.review)); return pass();
  }
  const checked = checkRanking(ranking, inv.required, inv.context);
  if (checked.ok) writeJson(join(dir, 'review-attention.json'), settleQuestions(bindDisputeQuestions(ranking, inv.required), input.review));
  return checked;
}
// The reader check never fails its node: without a usable result the page publishes the ranking it has.
const skipped = (step: string, error: unknown) => process.stderr.write(`reader check: ${step} skipped: ${String(error)}\n`);
function prepareReader(input: FinishInputs, dir: string, ranking: Ranking | null) {
  const skip = { ready: false, items: '', proposal: '' };
  if (!ranking || pageItems(ranking).length === 0) return skip;
  try {
    const items = join(dir, 'review/reader-items.md');
    writeText(items, `${readerItems(ranking)}\n`);
    return { ready: true, items, proposal: join(input.folder, 'proposal.md') };
  } catch (error) { skipped('prepare-reader', error); return skip; }
}
function flagReader(input: FinishInputs, dir: string, ranking: Ranking | null) {
  try {
    const flags = ranking ? flagItems(ranking, JSON.parse(input.result)) : [];
    writeJson(join(dir, 'review/reader-flags.json'), flags);
    return { flagged: flags.length > 0, notes: readerNotes(flags) };
  } catch (error) { skipped('flag-items', error); return { flagged: false, notes: '' }; }
}
// A rewrite changes wording only, so it is checked as leniently as the ranking it rewrites.
function applyReaderRewrite(input: FinishInputs, dir: string, ranking: Ranking | null): CheckResult {
  if (!ranking) return fail('no ranking to rewrite');
  const flagged = readJson<Flag[]>(join(dir, 'review/reader-flags.json'), []).map(flag => flag.number);
  const inv = inventory({ exec: runCommand, dir, changeFolder: input.folder });
  const next = passingRewrite(ranking, JSON.parse(input.result).items, flagged, candidate => checkRanking(candidate, inv.required, inv.context, true).ok);
  if (next === ranking) return fail('no rewrite passed the ranking check');
  writeJson(join(dir, 'review/ranking-before-rewrite.json'), ranking);
  writeJson(join(dir, 'review-attention.json'), next);
  return pass();
}
function readerNode(input: FinishInputs, dir: string): unknown {
  const ranking = readJson<Ranking | null>(join(dir, 'review-attention.json'), null);
  if (input.op === 'prepare-reader') return prepareReader(input, dir, ranking);
  if (input.op === 'flag-items') return flagReader(input, dir, ranking);
  return applyReaderRewrite(input, dir, ranking);
}
function readyNode(input: FinishInputs, dir: string): CheckResult {
  if (input.push) checkPush(acceptancePush(runCommand, 'CI wait repair'), true, input.blocked ? input.reason : '');
  if (input.blocked) {
    // The node's output is only ok and problems; the terminal mark stays in the run file.
    const blocked = fail(`REPAIR_BLOCKED: ${input.reason}`);
    recordFinalizeCheck(dir, input.step, { ...blocked, terminal: true }); return blocked;
  }
  const checked = markReady(defaultTools());
  recordFinalizeCheck(dir, input.step, checked); return checked;
}
/** The IDs of the checklist rows still marked not verified when the acceptance rounds end. */
export function unverifiedRows(folder: string): { rows: string } {
  const rows = evidenceRows(readText(checklistPath(folder))) ?? [];
  return { rows: rows.filter(row => row.status === 'not verified').map(row => row.id).join(', ') };
}
/** The acceptance stop makes this push the top-level resume point. */
export function pushRecheck(dir: string, strict = false, reason = ''): CheckResult {
  const steps = readJson<Record<string, StepResult>>(join(dir, 'step-results.json'), {});
  return checkPush(acceptancePush(runCommand, 'checklist recheck'), strict || steps.acceptance?.push === true, reason);
}
/** A run that stops after acceptance publishes no package; it succeeds when acceptance converged. */
export function endedAfterAcceptance(dir: string): { succeeded: boolean } {
  return { succeeded: stepFailures(dir).length === 0 };
}
function roundNode(input: FinishInputs, dir: string): unknown {
  const round = input.round ?? 1;
  switch (input.op) {
    case 'start-round':
      if (!readText(join(dir, 'review/accepted-head.txt'))) writeText(join(dir, 'review/accepted-head.txt'), acceptedHead({ exec: runCommand, dir, changeFolder: input.folder }));
      return startRound(defaultTools(), { dir, folder: input.folder, text: input.answer ?? '' });
    case 'end-run': {
      const outcome = readJson<{ mode?: string; reason?: string }>(outcomesPath(dir), {});
      return { succeeded: outcome.mode ? outcome.mode === 'merged' : endedAfterAcceptance(dir).succeeded, reason: outcome.reason ?? '' };
    }
    case 'merge-base': {
      const merged = mergeBase(defaultTools(), dir);
      if (!merged.ok) recordStep(dir, 'merge-base', { ...merged, remaining: 'Merge the current remote branch tips.' });
      return merged;
    }
    case 'finish-merge': return finishMerge(runCommand, dir, input.blocked, input.reason);
    case 'check-response': return checkResponse(dir, round, input.blocked, input.reason);
    case 'record-retest': return recordRetest(dir, round, input.status === 'true', input.reason);
    default: return undefined;
  }
}
function pushNode(input: FinishInputs, dir: string): CheckResult {
  if (input.blocked && !input.strict) {
    recordFinalizeCheck(dir, 'fix-pr', { ...fail(`REPAIR_BLOCKED: ${input.reason}`), terminal: true });
  }
  const pushed = acceptancePush(runCommand, input.result || 'review feedback');
  return checkPush(pushed, input.strict === true, input.blocked ? input.reason : '');
}

function dispatch(input: FinishInputs, dir: string): unknown {
  const reviewRound = roundNode(input, dir);
  if (reviewRound !== undefined) return reviewRound;
  switch (input.op) {
    case 'end-after-acceptance': return pass();
    case 'list-unverified': return unverifiedRows(input.folder);
    case 'push-recheck': return pushRecheck(dir, input.strict, input.blocked ? input.reason : '');
    case 'publish-review-package': return input.finish === false ? endedAfterAcceptance(dir) : publishNode(input, dir);
    case 'prepare-ranking': return prepareRanking(input, dir);
    case 'prepare-reader':
    case 'flag-items':
    case 'apply-rewrite': return readerNode(input, dir);
    case 'commit-logs': return commitLogs(runCommand, dir, input.name);
    case 'sync-logs': return syncLogs(runCommand, dir, input.folder, input.name);
    case 'archive-change':
    case 'verify-archive-commit':
    case 'record-archive': return archiveNode(input, dir);
    case 'wait-finalize-ci':
    case 'ci-cycle-status':
    case 'end-ci-cycle':
    case 'final-ci':
    case 'record-finalize': return ciNode(input, dir);
    case 'mark-ready': return readyNode(input, dir);
    case 'finalize-push':
    case 'push-round': return pushNode(input, dir);
    default: return rankingNode(input, dir);
  }
}
function recordRoundException(input: FinishInputs, dir: string, failure: CheckResult): void {
  const steps: Record<string, string> = { 'merge-base': 'merge-base', 'check-response': 'check-response', 'record-retest': 'retest', 'sync-logs': 'logs' };
  const step = steps[input.op];
  if (input.op === 'finish-merge') abortMerge(runCommand, dir, failure.problems);
  if (step) recordStep(dir, step, { ...failure, remaining: 'Resolve this step failure before retrying it.', round: input.round });
}

function failureOutput(op: string, dir: string) {
  if (op === 'merge-base') return { conflict: false };
  if (op === 'verify-archive-commit') return { archive_state: readText(join(dir, 'archive/state.json')) };
  return {};
}

export function finishRun(input: FinishInputs): void {
  const dir = artifactsDir();
  try { process.stdout.write(`${JSON.stringify(dispatch(input, dir))}\n`); }
  catch (error) {
    const failure = fail(String(error));
    recordRoundException(input, dir, failure);
    if (['wait-finalize-ci', 'final-ci'].includes(input.op)) {
      const result = blank(failure.problems); writeJson(join(dir, 'ci/latest.json'), result);
      recordFinalizeCheck(dir, input.step, failure);
      process.stdout.write(`${JSON.stringify({ status: 'error', had_checks: false, head_moved: false, report: '', ci_report: failure.problems, cycle: 0 })}\n`); return;
    }
    if (input.op === 'record-finalize') recordStep(dir, 'finalize', { ...failure, remaining: 'Repair finalization before merging.' });
    if (['prepare-ranking', 'publish-review-package', 'start-round', 'end-run', 'push-recheck', 'finalize-push', 'push-round'].includes(input.op) || input.push) { process.stderr.write(`${String(error)}\n`); process.exit(1); }
    const extra = failureOutput(input.op, dir);
    process.stdout.write(`${JSON.stringify({ ...failure, ...extra })}\n`);
  }
}
export function endAcceptance(dir: string, reason: string, push = false): void {
  writeText(join(dir, 'acceptance-stop.txt'), reason);
  recordAcceptanceFailure(dir, reason, push);
}
