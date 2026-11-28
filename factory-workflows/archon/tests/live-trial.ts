// Starts or cleans up a live trial: codagent-implement-change with real agents on a small public
// repository kept for this. See AGENTS.md, "Live trials". Start one only when the user allows it.
//
//   bun run live-trial [--change <name>] [--branch <name>] [--from <branch>] [--input <name=value>]...
//   bun run live-trial cleanup <branch>
//
// LIVE_TRIAL_REPO names another repository and LIVE_TRIAL_DIR another local clone. Set ARCHON to
// run an Archon other than the one on PATH, as for run-fixtures.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const repo = process.env.LIVE_TRIAL_REPO ?? 'pacaplan/archon-live-trial';
const clone = process.env.LIVE_TRIAL_DIR ?? join(homedir(), '.agent-workflows', 'live-trial', basename(repo));
const pack = dirname(import.meta.dir);
const archon = (process.env.ARCHON ?? 'archon').split(/\s+/).filter(Boolean);

interface Launch {
  change: string;
  branch: string;
  from?: string;
  inputs: string[];
}

function succeeds(command: string[]): boolean {
  const [program = '', ...args] = command;
  return spawnSync(program, args, { stdio: 'ignore' }).status === 0;
}

function output(command: string[]): string {
  const [program = '', ...args] = command;
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) {
    throw new Error(`${command.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function remoteBranchExists(branch: string): boolean {
  const result = spawnSync('git', ['-C', clone, 'ls-remote', '--exit-code', '--heads', 'origin', branch], { stdio: 'ignore' });
  if (result.status === 0 || result.status === 2) {
    return result.status === 0;
  }
  throw new Error(`could not check ${repo} for branch ${branch} (is ${clone} a clone?)`);
}

function updateClone(): void {
  if (!existsSync(clone)) {
    mkdirSync(dirname(clone), { recursive: true });
    output(['gh', 'repo', 'clone', repo, clone]);
    return;
  }
  output(['git', '-C', clone, 'fetch', '-q', 'origin']);
  const current = output(['git', '-C', clone, 'branch', '--show-current']);
  if (current !== 'main' || output(['git', '-C', clone, 'status', '--porcelain'])) {
    throw new Error(`${clone} must be a clean checkout of main`);
  }
  output(['git', '-C', clone, 'merge', '-q', '--ff-only', 'origin/main']);
}

function packState(): string {
  const branch = output(['git', '-C', pack, 'branch', '--show-current']) || 'detached';
  const commit = output(['git', '-C', pack, 'rev-parse', '--short', 'HEAD']);
  const edited = output(['git', '-C', pack, 'status', '--porcelain', '--', '.']) ? ', with edits' : '';
  return `${branch} at ${commit}${edited}`;
}

function start(launch: Launch): void {
  updateClone();
  if (remoteBranchExists(launch.branch) || succeeds(['git', '-C', clone, 'show-ref', '--quiet', `refs/heads/${launch.branch}`])) {
    throw new Error(`branch ${launch.branch} already exists; pass another with --branch`);
  }
  const from = launch.from ? ['--from', launch.from] : [];
  const inputs = launch.inputs.flatMap(input => ['--input', input]);
  const ack = JSON.parse(
    output([
      ...archon,
      ...['workflow', 'run', 'codagent-implement-change', '--cwd', clone, '--branch', launch.branch],
      ...['--workflow-source', pack, '--input', `change_name=${launch.change}`, ...inputs, ...from],
      ...['--detach', '--json'],
    ]),
  ) as { runId?: string };
  if (!ack.runId) {
    throw new Error('archon did not return a run id');
  }
  console.log(`Started run ${ack.runId}: ${launch.change} on branch ${launch.branch} of ${repo}.`);
  console.log(`Pack: ${packState()}.`);
  console.log(`Wait:     ${archon.join(' ')} workflow wait ${ack.runId} --cwd ${clone}`);
  console.log(`Clean up: bun run live-trial cleanup ${launch.branch}`);
}

function cleanup(branch: string): void {
  if (branch === 'main') {
    throw new Error('main is the fixture; clean up a trial branch');
  }
  const open = output(['gh', 'pr', 'list', '-R', repo, '--head', branch, '--state', 'open', '--json', 'number', '-q', '.[].number']);
  const numbers = open.split('\n').filter(Boolean);
  for (const number of numbers) {
    output(['gh', 'pr', 'close', number, '-R', repo, '--comment', 'Live trial finished.']);
    console.log(`Closed pull request ${number} on ${repo}.`);
  }
  const pushed = remoteBranchExists(branch);
  if (pushed) {
    output(['git', '-C', clone, 'push', '-q', 'origin', '--delete', branch]);
    console.log(`Deleted branch ${branch} from ${repo}.`);
  }
  if (numbers.length === 0 && !pushed) {
    console.log(`Nothing to clean up: ${repo} has no open pull request or branch named ${branch}.`);
  }
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      change: { type: 'string', default: 'add-greeting-config' },
      branch: { type: 'string' },
      from: { type: 'string' },
      input: { type: 'string', multiple: true, default: [] },
    },
  });
  const [command, branch] = positionals;
  if (command === 'cleanup' && branch && positionals.length === 2) {
    cleanup(branch);
    return;
  }
  if (command !== undefined) {
    throw new Error('usage: live-trial [--change <name>] [--branch <name>] [--from <branch>] [--input <name=value>]... | live-trial cleanup <branch>');
  }
  start({ change: values.change, branch: values.branch ?? `trial-${utcStamp()}`, from: values.from, inputs: values.input });
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
