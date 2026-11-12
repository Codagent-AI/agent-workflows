// Shared fixtures for the check-module tests: temp git repos, fake archon/openspec binaries
// and a no-op Sleep. Nothing here reaches a forge or the network.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type Exec, runCommand } from '../.archon/workflows/codagent/.shared/lib/exec.ts';
import { createForge } from '../.archon/workflows/codagent/.shared/lib/forge.ts';
import type { Tools } from '../.archon/workflows/codagent/.shared/lib/pull-request.ts';

export interface FakeResponse {
  status?: number;
  stdout?: string;
  stderr?: string;
}

export interface FakeRule {
  /** Leading arguments a call must start with. */
  args: string[];
  /** Answers in order; the last one repeats. */
  responses: FakeResponse[];
}

export interface FakeCall {
  args: string[];
  /** Contents of any `name=@file` argument, and of the `--data-file` one as `data`, read when the fake ran. */
  files: Record<string, string>;
}

/** A canned reply with a given stdout. */
export const reply = (stdout: string, status = 0, stderr = ''): FakeResponse => ({ status, stdout, stderr });
/** A rule with one repeating reply. */
export const rule = (args: string[], ...responses: FakeResponse[]): FakeRule => ({ args, responses });

const FAKE_SOURCE = `
import { appendFileSync, existsSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const script = process.argv[1];
const name = basename(script);
const dir = dirname(script);
const args = process.argv.slice(2);
const rules = JSON.parse(readFileSync(join(dir, name + '.config.json'), 'utf8'));
const stateFile = join(dir, name + '.state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const files = {};
for (const arg of args) {
  const match = /^([^=]+)=@(.+)$/.exec(arg);
  if (match && existsSync(match[2])) files[match[1]] = readFileSync(match[2], 'utf8');
}
args.forEach((arg, i) => {
  if (arg === '--data-file' && existsSync(args[i + 1])) files.data = readFileSync(args[i + 1], 'utf8');
});
appendFileSync(join(dir, name + '.calls.jsonl'), JSON.stringify({ args, files }) + '\\n');
const index = rules.findIndex(r => r.args.every((token, i) => args[i] === token));
if (index < 0) {
  writeSync(2, 'fake ' + name + ': unexpected call: ' + args.join(' ') + '\\n');
  process.exit(33);
}
const count = state[index] ?? 0;
state[index] = count + 1;
writeFileSync(stateFile, JSON.stringify(state));
const response = rules[index].responses[Math.min(count, rules[index].responses.length - 1)];
if (response.stdout) writeSync(1, response.stdout);
if (response.stderr) writeSync(2, response.stderr);
process.exit(response.status ?? 0);
`;

/** Commands a test must fake: the real ones reach GitHub or the network. */
const GUARDED = new Set(['gh', 'openspec', 'archon']);

export const noSleep = (): void => {};

/** A sleep that records the milliseconds it was asked to wait. */
export function recordingSleep(): { sleep: (ms: number) => void; waits: number[] } {
  const waits: number[] = [];
  return { sleep: ms => void waits.push(ms), waits };
}

export class Sandbox {
  readonly dir: string;
  readonly binDir: string;
  private readonly fakes = new Set<string>();
  private readonly originalCwd = process.cwd();
  private readonly originalPath = process.env.PATH;

  constructor(options: { git: boolean }) {
    this.dir = realpathSync(mkdtempSync(join(tmpdir(), 'archon-check-')));
    // Outside the repository so the fakes never show up in git status.
    this.binDir = realpathSync(mkdtempSync(join(tmpdir(), 'archon-bin-')));
    if (options.git) {
      this.git('init', '-q', '-b', 'feature');
      this.git('config', 'user.name', 'test');
      this.git('config', 'user.email', 'test@example.com');
      this.git('config', 'commit.gpgsign', 'false');
      this.git('config', 'core.hooksPath', '/dev/null');
      this.write('file.txt', 'one\n');
      this.git('add', 'file.txt');
      this.commit('initial');
    }
    process.chdir(this.dir);
  }

  /** Restores cwd and PATH and removes the temp directory. */
  dispose(): void {
    process.chdir(this.originalCwd);
    if (this.originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = this.originalPath;
    rmSync(this.dir, { recursive: true, force: true });
    rmSync(this.binDir, { recursive: true, force: true });
  }

  path(relative: string): string {
    return join(this.dir, relative);
  }

  write(relative: string, content: string): void {
    const target = this.path(relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  read(relative: string): string {
    return readFileSync(this.path(relative), 'utf8');
  }

  exists(relative: string): boolean {
    return existsSync(this.path(relative));
  }

  /** Runs git in the sandbox and returns trimmed stdout; throws when git fails. */
  git(...args: string[]): string {
    return this.gitIn(this.dir, ...args);
  }

  gitIn(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  commit(message: string, ...paths: string[]): string {
    this.git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message, ...paths);
    return this.head();
  }

  /** Changes file.txt and commits it. */
  commitFix(content = 'fixed\n'): string {
    this.write('file.txt', content);
    return this.commit('fix', 'file.txt');
  }

  head(): string {
    return this.git('rev-parse', 'HEAD');
  }

  /** A bare repository outside the sandbox tree, usable as `origin`. */
  addBareOrigin(): string {
    const bare = join(this.dir, 'origin.git');
    this.gitIn(this.dir, 'init', '-q', '--bare', bare);
    this.git('remote', 'add', 'origin', bare);
    return bare;
  }

  /** Installs a fake executable first on PATH, answering by the rules. */
  fake(name: string, rules: FakeRule[]): void {
    const script = join(this.binDir, name);
    writeFileSync(script, `#!${process.execPath}\n${FAKE_SOURCE}`);
    chmodSync(script, 0o755);
    this.fakes.add(name);
    writeFileSync(join(this.binDir, `${name}.config.json`), JSON.stringify(rules));
    const entries = (process.env.PATH ?? '').split(':').filter(entry => entry !== this.binDir);
    process.env.PATH = [this.binDir, ...entries].join(':');
  }

  /**
   * The real `runCommand`, with a faked command resolved to its fake's absolute path.
   * Bun's spawnSync looks commands up on the PATH it started with, so a PATH change made
   * during the test would not find the fake.
   */
  readonly exec: Exec = (command, args, options) => {
    if (this.fakes.has(command)) return runCommand(join(this.binDir, command), args, options);
    if (GUARDED.has(command)) throw new Error(`test called the real ${command}; fake it with box.fake`);
    return runCommand(command, args, options);
  };

  /**
   * Git and the forge for a pull request test: `origin` is a local bare repository whose
   * default branch is main, and the fake archon CLI answers `resolve` with a GitHub repository
   * and everything else by the rules. Nothing reaches a network.
   */
  forgeTools(rules: FakeRule[]): Tools {
    if (!this.git('remote').split('\n').includes('origin')) {
      const bare = this.addBareOrigin();
      this.git('push', '-q', 'origin', 'feature:main');
      this.gitIn(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    }
    this.fake('archon', [...rules, rule(['forge', 'resolve'], ok('resolve', RESOLVED))]);
    return { exec: this.exec, forge: createForge(this.exec, [join(this.binDir, 'archon')]) };
  }

  calls(name: string): FakeCall[] {
    const log = join(this.binDir, `${name}.calls.jsonl`);
    if (!existsSync(log)) return [];
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as FakeCall);
  }
}

export const createSandbox = (git = true): Sandbox => new Sandbox({ git });

// Forge fixtures: the envelopes `archon forge` prints and the records inside them.
export const REPO = { host: 'github.com', path: 'owner/repo' };
const RESOLVED = { kind: 'resolved', forge: 'github', repo: REPO, plugin: { name: 'github', version: '1.0.0' } };

/** A successful envelope for one operation. */
export const ok = (op: string, value: unknown): FakeResponse =>
  reply(JSON.stringify({ operationId: 'test', ok: true, result: { op, value } }));

/** A failed envelope, with the write outcome of a mutation when given. */
export const failed = (kind: string, message: string, mutation?: { outcome: string; leaveBehind?: string }): FakeResponse =>
  reply(JSON.stringify({ operationId: 'test', ok: false, error: { kind, message }, ...(mutation ? { mutation } : {}) }), 1);

/** A `pr.view` answer: the record with the given fields overridden. */
export const prView = (record: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  pr: {
    repo: REPO,
    number: 7,
    schemaVersion: 1,
    url: 'https://github.com/owner/repo/pull/7',
    head: 'feature',
    base: 'main',
    is_draft: true,
    state: 'open',
    head_repo: REPO,
    head_revision: 'abc123',
    base_revision: 'def456',
    maintainer_can_modify: null,
    ...record,
  },
  title: 'A change',
  body: '',
  author: { host: 'github.com', id: '1', login: 'pr-author' },
  ...extra,
});

/** The request an archon call carried in its data file. */
export const requestOf = (call: FakeCall): Record<string, unknown> => JSON.parse(call.files.data) as Record<string, unknown>;

// Pull request comment fixtures in the shape the forge reports them.
export type Author = { login: string } | null;
export const user = (login: string): Author => ({ login });
export const bot = (name: string): Author => ({ login: `${name}[bot]` });

export interface RawComment {
  author: Author;
  body: string;
}
export const inline = (author: Author, body: string): RawComment => ({ author, body });
export const thread = (resolved: boolean, comments: RawComment[], path: string | null = 'openspec/foo.md', line: number | null = 3) => ({
  resolved,
  path,
  line,
  comments,
});
