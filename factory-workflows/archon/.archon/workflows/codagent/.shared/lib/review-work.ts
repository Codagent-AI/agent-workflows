import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, output } from './exec.ts';
import { OPS, remoteOf } from './forge.ts';
import type { Tools } from './pull-request.ts';
import { readPages } from './review-pages.ts';
import { readJson, readText, recordStep, writeJson, writeText } from './run-files.ts';
import { answersPath, responsePath, selectedJourneys } from './review-round.ts';

function result(dir: string, step: string, check: CheckResult, remaining: string): CheckResult {
  recordStep(dir, step, { ...check, remaining });
  return check;
}

function mergeOne(exec: Exec, ref: string) {
  const checked = exec('git', ['merge', '--no-edit', '--no-ff', ref]);
  return checked.status === 0 ? pass() : fail(`${checked.stdout}\n${checked.stderr}`.trim());
}

export function mergeBase(tools: Tools, dir: string) {
  const page = readPages(dir).at(-1);
  const remote = remoteOf(tools.exec);
  if (!(page && remote.ok)) return { ...fail(remote.ok ? 'No review page' : remote.problem), conflict: false };
  const pr = tools.forge.call<{ pr: { base: string; head: string } }>(OPS.view, { selector: { kind: 'number', ref: page.ref } });
  if (!(pr.ok && pr.value)) return { ...fail(pr.ok ? 'No pull request' : pr.problem), conflict: false };
  const fetch = tools.exec('git', ['fetch', remote.value.name]);
  if (fetch.status !== 0) return { ...fail(fetch.stderr), conflict: false };
  const refs = [pr.value.pr.head, pr.value.pr.base].map(branch => `${remote.value.name}/${branch}`);
  const dirPath = join(dir, 'review/merge-targets.json');
  writeJson(dirPath, refs);
  return mergeTargets(tools.exec, dir, refs);
}

function mergeTargets(exec: Exec, dir: string, refs: string[]) {
  for (const ref of refs) {
    const check = mergeOne(exec, ref);
    if (!check.ok) {
      const conflict = output(exec, 'git', ['rev-parse', '--verify', 'MERGE_HEAD']) !== undefined;
      const recorded = result(dir, 'merge-base', check, `Merge ${ref} before completing review feedback.`);
      return { ...recorded, conflict };
    }
  }
  rmSync(join(dir, 'review/merge-conflicts.md'), { force: true });
  return { ...result(dir, 'merge-base', pass(), 'Merged current pull request and base branch tips.'), conflict: false };
}

export function abortMerge(exec: Exec, dir: string, reason: string) {
  const pending = output(exec, 'git', ['rev-parse', '--verify', 'MERGE_HEAD']) !== undefined;
  const aborted = pending ? exec('git', ['merge', '--abort']) : undefined;
  const message = [reason || 'The merge conflict remains unresolved.', aborted?.stderr].filter(Boolean).join('\n');
  writeText(join(dir, 'review/merge-conflicts.md'), message);
  return result(dir, 'merge-base', fail(message), 'Resolve the merge conflict before merging the pull request.');
}

export function finishMerge(exec: Exec, dir: string, blocked: boolean, reason: string) {
  const pending = output(exec, 'git', ['rev-parse', '--verify', 'MERGE_HEAD']) !== undefined;
  if (blocked || pending) return abortMerge(exec, dir, reason);
  const merged = mergeTargets(exec, dir, readJson<string[]>(join(dir, 'review/merge-targets.json'), []));
  return merged.conflict ? abortMerge(exec, dir, merged.problems) : { ok: merged.ok, problems: merged.problems };
}

interface Response { item: string; status: string; note?: string; commit?: string; requestedFindings?: string[] }
const responseStates = ['fixed', 'declined', 'no-change', 'unchanged', 'settled', 'spec-change'];

function responseEntries(file: string): Response[] | undefined {
  try {
    const parsed = readJson<unknown>(file, []);
    return Array.isArray(parsed) ? parsed as Response[] : undefined;
  } catch {
    return undefined;
  }
}
function responseSources(dir: string) {
  const page = readPages(dir).at(-1);
  const html = page ? readText(join(dir, page.file)) : '';
  const block = /<script type="application\/json" id="page-data">([^<]*)<\/script>/.exec(html)?.[1];
  const data = JSON.parse(block ?? '{}') as Record<string, { source: string[] }[]>;
  return new Set(['note', ...['red', 'orange', 'yellow'].flatMap(tier => (data[tier] ?? []).flatMap(item => item.source))]);
}

export function checkResponse(dir: string, round: number, blocked: boolean, reason: string) {
  if (blocked) result(dir, 'address-feedback', fail(reason), 'Address the saved review feedback.');
  const file = responsePath(dir, round - 1);
  const saved = readJson<{ action?: string; screenshotComments?: { file: string }[]; commandComments?: { ref: string }[] }>(answersPath(dir, round - 1), {});
  if (!(existsSync(file) || blocked) && saved.action !== 'merge') {
    return result(dir, 'check-response', fail('Review response file is missing.'), 'Write the review response before publishing.');
  }
  const entries = responseEntries(file);
  if (!entries) {
    writeText(`${file}.rejected`, readText(file));
    writeJson(file, []);
    return result(dir, 'check-response', fail('Review response is not a JSON array.'), 'Rewrite the review response as an array.');
  }
  const known = responseSources(dir);
  for (const shot of saved.screenshotComments ?? []) known.add(shot.file);
  for (const command of saved.commandComments ?? []) known.add(command.ref);
  const valid = entries.filter(entry => known.has(entry?.item) && responseStates.includes(entry.status));
  if (entries.length === valid.length) return pass();
  writeJson(file, valid);
  return result(dir, 'check-response', fail('Review response contains an unknown item or status.'), 'Correct the rejected review response entries.');
}

export function recordRetest(dir: string, round: number, ready: boolean, reason: string) {
  const outcome = ready ? pass() : fail(reason || 'Acceptance retest did not pass.');
  const remaining = ready ? 'The selected acceptance journeys passed.' : 'Address the acceptance failure in a later round.';
  if (ready) {
    const file = join(dir, 'review/retested-commits.json');
    const covered = selectedJourneys(dir, round - 1).flatMap(entry => [entry.commit, ...entry.coveredCommits]);
    writeJson(file, [...new Set([...readJson<string[]>(file, []), ...covered])]);
    result(dir, 'acceptance', pass(), '');
  }
  recordStep(dir, 'retest', { ...outcome, remaining, round });
  return outcome;
}
