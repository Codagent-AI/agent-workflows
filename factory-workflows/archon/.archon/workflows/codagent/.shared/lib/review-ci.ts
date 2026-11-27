import type { CiResult } from './ci.ts';
import { type Exec, output } from './exec.ts';

function isTestPath(path: string): boolean {
  if (/\.(?:md|markdown|mdx|rst|adoc|txt)$/i.test(path)) return false;
  return /(?:^|\/)(?:tests?|__tests__)\//i.test(path) || /(?:^|\/)(?:test[_-]|spec[_-])|[._-](?:test|spec)\.[\w]+$/i.test(path);
}

export function passedFinalizeChecks(exec: Exec, ci: Partial<CiResult>): boolean {
  const head = output(exec, 'git', ['rev-parse', 'HEAD']);
  return Boolean(head && ci.headSha === head && ci.status === 'passed' && ci.hadChecks && ci.passedChecks?.length);
}

export function citesExistingTest(exec: Exec, text: string): boolean {
  const paths = text.match(/[\w./-]+\.[\w]+/g) ?? [];
  return paths.map(path => path.replace(/^\.\//, '')).some(path =>
    isTestPath(path) && output(exec, 'git', ['cat-file', '-t', `HEAD:${path}`]) === 'blob');
}
