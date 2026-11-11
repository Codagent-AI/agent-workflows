// Runs the workflows' dry-run fixtures. Archon reads .archon/ only at a git repository's root and
// runs exec-code fixtures in a scratch worktree of HEAD, so this commits a copy of the pack to a
// temporary repository and runs Archon there with a throwaway home. Set ARCHON to run an Archon
// other than the one on PATH, such as `bun <archon checkout>/packages/cli/src/cli.ts`.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const SKIPPED = new Set(['.git', 'node_modules']);

function run(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const [program = '', ...args] = command;
  const result = spawnSync(program, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command.join(' ')} failed`);
  }
}

function commitPack(pack: string, repo: string): void {
  cpSync(pack, repo, { recursive: true, filter: source => !SKIPPED.has(basename(source)) });
  run(['git', 'init', '-q'], repo);
  run(['git', 'add', '-A'], repo);
  run(['git', '-c', 'user.name=fixtures', '-c', 'user.email=fixtures@localhost', 'commit', '-qm', 'fixtures'], repo);
}

const scratch = mkdtempSync(join(tmpdir(), 'archon-fixtures-'));
try {
  const home = join(scratch, 'home');
  const repo = join(scratch, 'pack');
  mkdirSync(home);
  writeFileSync(join(home, 'config.yaml'), 'defaultAssistant: claude\n');
  commitPack(dirname(import.meta.dir), repo);
  const archon = (process.env.ARCHON ?? 'archon').split(/\s+/).filter(Boolean);
  const env = { ...process.env, ARCHON_HOME: home, ARCHON_TELEMETRY_DISABLED: '1' };
  run([...archon, 'validate', 'workflows'], repo, env);
  run([...archon, 'workflow', 'test', '.archon/workflows/codagent'], repo, env);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
