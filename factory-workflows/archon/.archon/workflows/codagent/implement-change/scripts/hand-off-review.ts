import { artifactsDir } from '../../.shared/lib/check.ts';
import { runCommand } from '../../.shared/lib/exec.ts';
import { readState, saveHandoff, script } from '../../.shared/lib/review-files.ts';

script(() => {
  const dir = artifactsDir();
  const folder = process.env.INPUTS_CHANGE_DIR;
  saveHandoff(dir, readState(dir), folder);
  if (folder) {
    const logs = [`${folder}/decision-log.md`, `${folder}/dispute-log.md`];
    const changed = runCommand('git', ['status', '--porcelain', '--', ...logs]);
    if (changed.status !== 0) throw new Error(changed.stderr);
    if (changed.stdout.trim()) {
      const commit = runCommand('git', ['commit', '--only', '-m', 'chore: record feedback review findings', '--', ...logs]);
      if (commit.status !== 0) throw new Error(commit.stderr);
    }
  }
  return { ok: true };
});
