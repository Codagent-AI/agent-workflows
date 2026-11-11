// The change's draft pull request: checking it, pushing to it, and updating its body.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, type Sleep, output } from './exec.ts';
import { status } from './worktree.ts';

export interface DraftPrResult extends CheckResult {
  prUrl: string;
}

interface PrListEntry {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
}

/**
 * The current branch has exactly one open pull request, a draft with a non-empty base
 * branch whose head equals local HEAD. Retries `attempts` times, `intervalSeconds` apart,
 * so a just-pushed head has time to reach GitHub.
 */
export function checkDraftPr(exec: Exec, sleep: Sleep, attempts: number, intervalSeconds: number): DraftPrResult {
  const branch = output(exec, 'git', ['branch', '--show-current']);
  if (!branch) {
    return { ...fail('HEAD is detached; check out the change branch before checking its pull request'), prUrl: '' };
  }
  const localHead = output(exec, 'git', ['rev-parse', 'HEAD']) ?? '';
  let detail = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const listed = exec('gh', [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'number,url,state,isDraft,baseRefName,headRefOid',
      '--limit',
      '2',
    ]);
    if (listed.status !== 0) {
      detail = `could not query the open pull request for branch '${branch}'`;
    } else {
      const prs = JSON.parse(listed.stdout) as PrListEntry[];
      if (prs.length !== 1) {
        detail = `expected exactly one open pull request for branch '${branch}', found ${String(prs.length)}`;
      } else {
        const pr = prs[0];
        if (pr.state === 'OPEN' && pr.isDraft && pr.baseRefName !== '' && pr.headRefOid === localHead) {
          return { ...pass(), prUrl: pr.url };
        }
        detail =
          `open pull request does not match required draft state or local HEAD (state ${pr.state}, ` +
          `draft ${String(pr.isDraft)}, base '${pr.baseRefName}', head ${pr.headRefOid}, local HEAD ${localHead})`;
      }
    }
    if (attempt < attempts) sleep(intervalSeconds * 1000);
  }
  return { ...fail(detail), prUrl: '' };
}

/** Pushes the current branch after an acceptance fix, without force-pushing. */
export function acceptancePush(exec: Exec): CheckResult {
  const branch = output(exec, 'git', ['branch', '--show-current']);
  if (!branch) return fail('acceptance push: HEAD is detached; check out the change branch');
  const changes = status(exec, ['--untracked-files=no']);
  if (changes === undefined) return fail('acceptance push: could not inspect tracked changes');
  if (changes !== '') {
    return fail(['acceptance push: tracked changes are uncommitted; commit them before pushing', changes]);
  }
  const remote = output(exec, 'git', ['config', `branch.${branch}.remote`]) ?? '';
  const mergeRef = output(exec, 'git', ['config', `branch.${branch}.merge`]) ?? '';
  const args =
    remote && mergeRef ? ['push', remote, `HEAD:${mergeRef}`] : ['push', '--set-upstream', 'origin', branch];
  const pushed = exec('git', args);
  if (pushed.status !== 0) {
    return fail([`acceptance push: git ${args.join(' ')} failed:`, pushed.stdout.trim(), pushed.stderr.trim()]);
  }
  return pass();
}

export const BODY_START = '<!-- codagent:generated-body:start -->';
export const BODY_END = '<!-- codagent:generated-body:end -->';

/** Whether `text` holds a start marker with an end marker after it. */
function hasOrderedMarkers(text: string): boolean {
  const start = text.indexOf(BODY_START);
  return start >= 0 && text.indexOf(BODY_END) > start && !text.slice(0, start).includes(BODY_END);
}

/**
 * Splices the generated block into a pull request body. With both markers present in order,
 * only the text from the first start marker through the end marker after it is replaced, so
 * human additions survive; otherwise the block is prepended to the old body.
 */
export function spliceBody(oldBody: string, block: string): string {
  if (!hasOrderedMarkers(block)) throw new Error('generated block must contain ordered body markers');
  if (hasOrderedMarkers(oldBody)) {
    const start = oldBody.indexOf(BODY_START);
    const end = oldBody.indexOf(BODY_END, start);
    const trimmed = block.endsWith('\n') ? block.slice(0, -1) : block;
    return oldBody.slice(0, start) + trimmed + oldBody.slice(end + BODY_END.length);
  }
  if (oldBody === '') return block;
  return `${block}${block.endsWith('\n') ? '\n' : '\n\n'}${oldBody}`;
}

/** Replaces the generated block in a pull request's body through the REST API. */
export function updatePrBody(exec: Exec, number: string, block: string): CheckResult {
  if (!/^[0-9]+$/.test(number) || Number(number) === 0) {
    return fail('pull request number must be a positive integer');
  }
  const viewed = exec('gh', ['pr', 'view', number, '--json', 'body', '-q', '.body']);
  if (viewed.status !== 0) return fail(`could not read pull request ${number} body`);
  let body: string;
  try {
    body = spliceBody(viewed.stdout.replace(/\n$/, ''), block);
  } catch (error) {
    return fail(`could not splice generated pull request body: ${(error as Error).message}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'update-pr-body-'));
  try {
    const file = join(dir, 'body');
    writeFileSync(file, body);
    const patched = exec('gh', ['api', '--method', 'PATCH', `repos/{owner}/{repo}/pulls/${number}`, '-F', `body=@${file}`]);
    if (patched.status !== 0) return fail(`could not update pull request ${number} body via REST`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return pass();
}
