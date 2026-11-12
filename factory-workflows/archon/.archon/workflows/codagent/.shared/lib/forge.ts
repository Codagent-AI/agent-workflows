// The pack's one way to read and write the forge: `archon forge <op> --data-file <file>`, run
// through the same `Exec` as git, so a test fakes the archon CLI like it fakes everything else.
//
// The CLI prints one JSON envelope. `ok: false` and a write's `mutation.outcome` become a
// problem message, which the check scripts report as an ordinary failed check.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import { type Exec, output, runCommand } from './exec.ts';

/** Every forge operation the pack calls. `forge check` verifies exactly these before a run. */
export const OPS = {
  resolve: 'resolve',
  view: 'pr.view',
  create: 'pr.create',
  editBody: 'pr.edit-body',
  draft: 'pr.draft',
  checks: 'checks.state',
  logs: 'checks.logs',
  reviews: 'pr.reviews',
  mergeState: 'pr.merge-state',
} as const;

export const FORGE_OPERATIONS: string[] = Object.values(OPS);

export interface Repo {
  host: string;
  path: string;
}

export interface PrRecord {
  repo: Repo;
  number: number;
  url: string;
  head: string;
  base: string;
  is_draft: boolean;
  state: 'open' | 'closed' | 'merged';
  head_revision: string | null;
  base_revision: string | null;
}

/** `pr.view`: the record plus the fields the pack reads. */
export interface PrView {
  pr: PrRecord;
  title: string;
  body: string;
  author?: { login: string | null } | null;
}

export type Reply<T> = { ok: true; value: T } | { ok: false; problem: string };

export const problem = (text: string): { ok: false; problem: string } => ({ ok: false, problem: text });

export interface Forge {
  call<T>(op: string, request: object): Reply<T>;
}

interface Envelope {
  ok?: boolean;
  result?: { op?: string; value?: unknown };
  error?: { kind?: string; message?: string };
  mutation?: { outcome?: string; leaveBehind?: string };
}

function parseEnvelope(stdout: string): Envelope | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Envelope) : undefined;
  } catch {
    return undefined;
  }
}

/** Why an operation failed: a write names its outcome, any other failure its error kind. */
function describeFailure(op: string, envelope: Envelope): string {
  const message = envelope.error?.message ?? 'no reason given';
  const { mutation } = envelope;
  if (mutation?.outcome !== undefined) {
    const left = mutation.leaveBehind === undefined ? '' : ` (may remain on the forge: ${mutation.leaveBehind})`;
    return `forge ${op} ${mutation.outcome}: ${message}${left}`;
  }
  return `forge ${op} failed (${envelope.error?.kind ?? 'unknown'}): ${message}`;
}

/** The reply to one operation, from the CLI's exit status and its envelope. */
export function interpret(op: string, status: number, stdout: string, stderr: string): Reply<never> | Reply<unknown> {
  const envelope = parseEnvelope(stdout);
  if (envelope === undefined) {
    return problem(`forge ${op} printed no JSON envelope (exit ${String(status)}): ${stderr.trim()}`);
  }
  // Exit 2 means the answer is real but its run audit was not persisted; a caller must not
  // act on it as if nothing were wrong, least of all retry a write.
  if (status === 2) {
    const said = envelope.ok === true ? 'succeeded' : (envelope.mutation?.outcome ?? 'failed');
    return problem(`forge ${op} ${said}, but its run audit could not be persisted; check the forge before retrying`);
  }
  if (envelope.ok !== true) return problem(describeFailure(op, envelope));
  if (envelope.result?.op !== op) return problem(`forge ${op} answered for ${envelope.result?.op ?? 'no operation'}`);
  return { ok: true, value: envelope.result.value };
}

/** A forge that runs `cli` (the argv of `ARCHON_CLI_COMMAND`) with `forge <op>` appended. */
export function createForge(exec: Exec, cli: readonly string[]): Forge {
  const [program = '', ...prefix] = cli;
  return {
    call<T>(op: string, request: object): Reply<T> {
      const dir = mkdtempSync(join(tmpdir(), 'forge-request-'));
      try {
        // Authored content (a pull request body) goes in a file, never in the argument list.
        const file = join(dir, 'request.json');
        writeFileSync(file, JSON.stringify(request));
        const result = exec(program, [...prefix, 'forge', op, '--data-file', file]);
        return interpret(op, result.status, result.stdout, result.stderr) as Reply<T>;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** The CLI argv Archon publishes to script nodes, or undefined when it is missing or malformed. */
export function cliFromEnv(env: NodeJS.ProcessEnv): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(env.ARCHON_CLI_COMMAND ?? '');
    const argv = Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? (parsed as string[]) : [];
    return argv.length > 0 ? argv : undefined;
  } catch {
    return undefined;
  }
}

/** The host of a git remote URL, in the form a forge plugin claims it, or undefined. */
export function remoteHost(url: string): string | undefined {
  const scp = /^[^@/:]+@([^:/]+):(?!\/\/)/.exec(url);
  if (scp?.[1]) return scp[1].toLowerCase();
  try {
    return new URL(url).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export interface Remote {
  name: string;
  url: string;
}

/** The remote the current branch pushes to: its configured remote, else origin. */
export function remoteOf(exec: Exec): Reply<Remote> {
  const branch = output(exec, 'git', ['branch', '--show-current']) ?? '';
  const name = (branch && output(exec, 'git', ['config', `branch.${branch}.remote`])) || 'origin';
  const url = output(exec, 'git', ['remote', 'get-url', name]);
  return url ? { ok: true, value: { name, url } } : problem(`the git remote '${name}' has no URL; the pull request lives on that remote`);
}

interface Resolved {
  kind: 'none' | 'resolved';
  repo?: Repo;
}

/** The forge repository behind the current branch's remote. */
export function resolveRepo(exec: Exec, forge: Forge): Reply<Repo> {
  const remote = remoteOf(exec);
  if (!remote.ok) return remote;
  const resolved = forge.call<Resolved>(OPS.resolve, { remote: remote.value.url });
  if (!resolved.ok) return resolved;
  const { repo } = resolved.value;
  return resolved.value.kind === 'resolved' && repo ? { ok: true, value: repo } : problem(`no forge plugin claims the git remote '${remote.value.name}'`);
}

/** The forge for the Archon CLI this script runs under; ends the script when there is none. */
export function forgeFromEnv(exec: Exec, env: NodeJS.ProcessEnv): Forge {
  const cli = cliFromEnv(env);
  if (cli === undefined) {
    process.stderr.write('ARCHON_CLI_COMMAND is not set to a JSON argv array; run this script as an Archon node\n');
    process.exit(1);
  }
  return createForge(exec, cli);
}

/** Forge and git, as the scripts reach them. */
export function defaultTools(): { exec: Exec; forge: Forge } {
  return { exec: runCommand, forge: forgeFromEnv(runCommand, process.env) };
}

interface Access {
  plugin: { name: string; version: string };
  credentialSource?: string;
}

/**
 * Whether the forge serving the remote's host is ready for every operation the pack uses: a
 * plugin that advertises them all and a credential that resolves. It contacts no forge, so
 * a missing plugin or token refuses a run before any agent spends.
 */
export function checkForgeAccess(exec: Exec, env: NodeJS.ProcessEnv): CheckResult & { message: string } {
  const cli = cliFromEnv(env);
  if (cli === undefined) return { ...fail('ARCHON_CLI_COMMAND is not set to a JSON argv array'), message: '' };
  const remote = remoteOf(exec);
  if (!remote.ok) return { ...fail(remote.problem), message: '' };
  const host = remoteHost(remote.value.url);
  if (host === undefined) return { ...fail(`cannot read a host from the git remote '${remote.value.name}'`), message: '' };
  const checked = createForge(exec, cli).call<Access>('check', { host, operations: FORGE_OPERATIONS });
  if (!checked.ok) return { ...fail(checked.problem), message: '' };
  const { plugin, credentialSource } = checked.value;
  const source = credentialSource === undefined ? '' : `, credential from ${credentialSource}`;
  return { ...pass(), message: `forge ready: ${plugin.name} ${plugin.version} serves ${host}${source}` };
}
