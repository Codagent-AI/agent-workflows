import { artifactsDir } from '../../.shared/lib/check.ts';
import { readState, saveHandoff, script } from '../../.shared/lib/review-files.ts';

script(() => {
  const dir = artifactsDir();
  saveHandoff(dir, readState(dir));
  return { ok: true };
});
