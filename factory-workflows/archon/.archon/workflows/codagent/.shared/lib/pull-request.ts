// The change's draft pull request: finding it, checking it, restoring its draft state,
// pushing to it, and publishing its description. Every forge read and write goes through
// `archon forge` (forge.ts); git does the pushing.
import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, type Sleep, output, sleep as wait } from './exec.ts';
import { type Forge, OPS, type PrView, type Repo, type Reply, problem, remoteOf, resolveRepo } from './forge.ts';
import { status } from './worktree.ts';

/** What the pack's scripts need to reach git and the forge. */
export interface Tools {
  exec: Exec;
  forge: Forge;
}

/** The pull request a check found, as the tester and the later steps read it. */
export interface PrSummary {
  url: string;
  number: number;
  branch: string;
  base: string;
  draft: boolean;
  head_revision: string;
}

export interface DraftPrResult extends CheckResult {
  prUrl: string;
  pr?: PrSummary;
}

const failedAttempt = (detail: string): DraftPrResult => ({ ...fail(detail), prUrl: '' });

export interface Located {
  repo: Repo;
  branch: string;
}

/** The current branch and the forge repository it pushes to. */
export function locate({ exec, forge }: Tools): Reply<Located> {
  const branch = output(exec, 'git', ['branch', '--show-current']);
  if (!branch) return problem('HEAD is detached; check out the change branch before using its pull request');
  const repo = resolveRepo(exec, forge);
  return repo.ok ? { ok: true, value: { repo: repo.value, branch } } : repo;
}

export interface Lookup extends Located {
  /** The branch's one open pull request, or null when it has none. */
  view: PrView | null;
}

/** The branch's open pull request. The forge refuses a head that matches more than one. */
export function lookupPr(tools: Tools): Reply<Lookup> {
  const located = locate(tools);
  if (!located.ok) return located;
  const { repo, branch } = located.value;
  const viewed = tools.forge.call<PrView | null>(OPS.view, {
    selector: { kind: 'head', repo, headRepo: repo, head: branch },
  });
  return viewed.ok ? { ok: true, value: { repo, branch, view: viewed.value } } : viewed;
}

const summary = (found: Lookup, view: PrView): PrSummary => ({
  url: view.pr.url,
  number: view.pr.number,
  branch: found.branch,
  base: view.pr.base,
  draft: view.pr.is_draft,
  head_revision: view.pr.head_revision ?? '',
});

/** One look at the branch's open pull request. */
function draftPrAttempt(tools: Tools, localHead: string): DraftPrResult {
  const found = lookupPr(tools);
  if (!found.ok) return failedAttempt(found.problem);
  const { view, branch } = found.value;
  if (view === null) return failedAttempt(`expected exactly one open pull request for branch '${branch}', found 0`);
  const { pr } = view;
  const seen = summary(found.value, view);
  if (pr.state === 'open' && pr.is_draft && pr.base !== '' && pr.head_revision === localHead) {
    return { ...pass(), prUrl: pr.url, pr: seen };
  }
  return failedAttempt(
    `open pull request does not match required draft state or local HEAD (state ${pr.state}, ` +
      `draft ${String(pr.is_draft)}, base '${pr.base}', head ${pr.head_revision ?? 'unknown'}, local HEAD ${localHead})`
  );
}

/**
 * The current branch has exactly one open pull request, a draft with a non-empty base
 * branch whose head equals local HEAD. Retries `attempts` times, `intervalSeconds` apart,
 * so a just-pushed head has time to reach the forge.
 */
export function checkDraftPr(tools: Tools, sleep: Sleep, attempts: number, intervalSeconds: number): DraftPrResult {
  const localHead = output(tools.exec, 'git', ['rev-parse', 'HEAD']) ?? '';
  let result: DraftPrResult = failedAttempt('');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = draftPrAttempt(tools, localHead);
    if (result.ok) return result;
    if (attempt < attempts) sleep(intervalSeconds * 1000);
  }
  return result;
}

/** Converts the branch's open pull request back to draft; one already a draft is left as it is. */
export function restoreDraft(tools: Tools): CheckResult {
  const found = lookupPr(tools);
  if (!found.ok) return fail(found.problem);
  const { view, repo, branch } = found.value;
  if (view === null) return fail(`no open pull request for branch '${branch}' to keep as a draft`);
  const drafted = tools.forge.call(OPS.draft, { ref: { repo, number: view.pr.number } });
  return drafted.ok ? pass() : fail(drafted.problem);
}

type PushResult = CheckResult & { person: boolean };

const transient = /ETIMEDOUT|timed? out|could not resolve host|connection reset|RPC failed|early EOF|remote end hung up unexpectedly|(?:returned error:|HTTP(?:\/\S+)?) 5\d\d|internal server error|bad gateway|service unavailable/i;
const credentials = /authentication failed|could not read username|invalid username or password|terminal prompts disabled|permission denied \(publickey\)|returned error: 40[13]/i;
const workflowScope = /refusing to allow[^\n]*workflow/i;
const retryDelays = [10_000, 30_000, 90_000];

function personFailure(detail: string): string {
  if (workflowScope.test(detail)) {
    return "GitHub refused the push because it changes .github/workflows and the token lacks the workflow scope. Push with a token that has it, then resume the run.";
  }
  if (credentials.test(detail)) {
    return 'GitHub refused the push because the credentials are expired, invalid or lack access. Log in again, then resume the run.';
  }
  return '';
}

export function gitNetwork(exec: Exec, args: string[], sleep: Sleep = wait): PushResult {
  for (const delay of [...retryDelays, 0]) {
    const result = exec('git', args, { timeout: 300_000, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    if (result.status === 0) return { ...pass(), person: false };
    const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    const person = personFailure(detail);
    if (person) return { ...fail(person), person: true };
    if (!transient.test(detail)) return { ...fail(detail || `git ${args[0]} exited ${result.status}`), person: false };
    if (delay === 0) return { ...fail(`GitHub was unavailable after 3 retries: ${detail.split('\n').at(-1)}. Resume the run when GitHub is back.`), person: true };
    sleep(delay);
  }
  throw new Error('Git retry loop exhausted without a result');
}

function mergeFetched(exec: Exec): CheckResult {
  if (exec('git', ['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD']).status === 0) return pass();
  const merged = exec('git', ['merge', '--no-edit', 'FETCH_HEAD']);
  if (merged.status === 0) return pass();
  const files = output(exec, 'git', ['diff', '--name-only', '--diff-filter=U']);
  if (!files) return fail(merged.stderr.trim() || merged.stdout.trim());
  const aborted = exec('git', ['merge', '--abort']);
  return fail(`The branch moved on GitHub and merging it conflicts in:\n${files}${aborted.status === 0 ? '' : `\nMerge abort failed: ${aborted.stderr.trim()}`}`);
}

function branchTarget(exec: Exec, branch: string) {
  const remote = output(exec, 'git', ['config', `branch.${branch}.remote`]);
  const mergeRef = output(exec, 'git', ['config', `branch.${branch}.merge`]);
  return remote && mergeRef
    ? { remote, mergeRef, push: ['push', remote, `HEAD:${mergeRef}`], newUpstream: false }
    : { remote: 'origin', mergeRef: branch, push: ['push', '--set-upstream', 'origin', branch], newUpstream: true };
}

function fetchAndMerge(exec: Exec, branch: ReturnType<typeof branchTarget>, sleep: Sleep): PushResult {
  const fetched = gitNetwork(exec, ['fetch', branch.remote, branch.mergeRef], sleep);
  if (fetched.ok) return { ...mergeFetched(exec), person: false };
  const missing = branch.newUpstream && !fetched.person && fetched.problems.includes("couldn't find remote ref");
  return missing ? { ...pass(), person: false } : fetched;
}

export function acceptancePush(exec: Exec, pushed = 'acceptance fixes', sleep: Sleep = wait): PushResult {
  const unable = (reason: string) => ({ ...fail(`${pushed} push: ${reason}`), person: false });
  const branch = output(exec, 'git', ['branch', '--show-current']);
  if (!branch) return unable('HEAD is detached; check out the change branch');
  const changes = status(exec, ['--untracked-files=no']);
  if (changes === undefined) return unable('could not inspect tracked changes');
  if (changes) return unable(`tracked changes are uncommitted; commit them before pushing\n${changes}`);
  const target = branchTarget(exec, branch);
  const fetched = fetchAndMerge(exec, target, sleep);
  const result = fetched.ok ? gitNetwork(exec, target.push, sleep) : fetched;
  return result.ok || result.person ? result : unable(result.problems);
}

export function checkPush(result: PushResult, strict: boolean, reason = ''): CheckResult {
  if (!result.ok && (strict || result.person)) {
    throw new Error([result.problems, reason].filter(Boolean).join('\n'));
  }
  return { ok: result.ok, problems: result.problems };
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

/** The generated block, between the markers that let a later run replace only that block. */
export const markBlock = (block: string): string => `${BODY_START}\n${block.trim()}\n${BODY_END}\n`;

export interface Description {
  /** The pull request's title, needed only when the pull request does not exist yet. */
  title: string;
  /** The generated description, written without markers. */
  block: string;
}

/** The base branch a new pull request targets: the remote's default branch. */
function defaultBranch(exec: Exec): Reply<string> {
  const remote = remoteOf(exec);
  if (!remote.ok) return remote;
  const head = exec('git', ['ls-remote', '--symref', remote.value.name, 'HEAD']);
  const name = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head.stdout)?.[1];
  return name ? { ok: true, value: name } : problem(`could not read the default branch of the remote '${remote.value.name}'`);
}

/** Opens the branch's pull request as a draft with the generated description as its body. */
function createDraft(tools: Tools, found: Lookup, description: Description): CheckResult {
  const { exec, forge } = tools;
  if (description.title.trim() === '') return fail('the pull request title is missing or empty');
  const base = defaultBranch(exec);
  if (!base.ok) return fail(base.problem);
  const created = forge.call(OPS.create, {
    repo: found.repo,
    headRepo: found.repo,
    head: found.branch,
    headRevision: output(exec, 'git', ['rev-parse', 'HEAD']) ?? '',
    base: base.value,
    title: description.title.trim(),
    body: markBlock(description.block),
    draft: true,
  });
  return created.ok ? pass() : fail(created.problem);
}

/** Puts the description into the existing pull request's body, keeping what a human added, and keeps it a draft. */
function updateDraft(tools: Tools, found: Lookup, view: PrView, block: string): CheckResult {
  const ref = { repo: found.repo, number: view.pr.number };
  const edited = tools.forge.call(OPS.editBody, { ref, body: spliceBody(view.body, markBlock(block)) });
  if (!edited.ok) return fail(edited.problem);
  const drafted = tools.forge.call(OPS.draft, { ref });
  return drafted.ok ? pass() : fail(drafted.problem);
}

/**
 * Publishes the open-draft-pr agent's title and description: opens the branch's pull request
 * as a draft, or, when one exists, puts the description into its body between the generated
 * markers and keeps it a draft.
 */
export function publishDraftPr(tools: Tools, description: Description): CheckResult {
  const { block } = description;
  if (block.trim() === '') return fail('the generated pull request description is missing or empty');
  if (block.includes(BODY_START) || block.includes(BODY_END)) {
    return fail('the generated pull request description must not contain the body markers; the workflow adds them');
  }
  const found = lookupPr(tools);
  if (!found.ok) return fail(found.problem);
  return found.value.view === null
    ? createDraft(tools, found.value, description)
    : updateDraft(tools, found.value, found.value.view, block);
}

/** Finalize changes only draft state, never merging the pull request. */
export function markReady(tools: Tools): CheckResult {
  const found = lookupPr(tools);
  if (!found.ok) return fail(found.problem);
  const { view, repo } = found.value;
  if (!view) return fail('no open pull request to mark ready');
  const ready = tools.forge.call(OPS.ready, { ref: { repo, number: view.pr.number } });
  return ready.ok ? pass() : fail(ready.problem);
}
