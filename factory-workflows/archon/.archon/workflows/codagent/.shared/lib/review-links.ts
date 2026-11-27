import { isAbsolute, posix } from 'node:path';
import { type Exec, output } from './exec.ts';
import { baseRevisions } from './review-revisions.ts';

export interface TargetLink { label: string; target: string }
export interface LinkContext { base: string; head: string; dir: string; folder: string; exec: Exec; bases?: string[] }

export const urlPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const forgeBase = (repo: { host: string; path: string }) => `https://${repo.host}/${repo.path}`;

function blobUrl(context: LinkContext, path: string) {
  return `${context.base}/blob/${context.head}/${urlPath(path)}`;
}

function committedFile(context: LinkContext, path: string): boolean {
  return output(context.exec, 'git', ['cat-file', '-t', `${context.head}:${path}`]) === 'blob';
}

function logPath(context: LinkContext, kind: string) {
  return posix.join(context.folder, `${kind}-log.md`);
}

export function logUrl(context: LinkContext, kind: string): string | undefined {
  const path = logPath(context, kind);
  return committedFile(context, path) ? blobUrl(context, path) : undefined;
}

function logTarget(context: LinkContext, code: string) {
  const decision = /^(?:D|DECIDE)-/.test(code);
  const path = logPath(context, decision ? 'decision' : 'dispute');
  const result = context.exec('git', ['show', `${context.head}:${path}`]);
  if (result.status !== 0) return;
  const text = result.stdout;
  const prefix = decision ? 'DECIDE' : 'DISPUTE';
  const wanted = code.replace(/^.+?-/, `${prefix}-`);
  const lines = text.replace(/\n$/, '').split('\n');
  const start = lines.findIndex(line => /^## ([\w-]+):/.exec(line)?.[1].replace(/^.+?-/, `${prefix}-`) === wanted);
  if (start < 0) return;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return `${blobUrl(context, path)}#L${start + 1}-L${end < 0 ? lines.length : end}`;
}

function commitTarget(context: LinkContext, revision: string) {
  if (!/^[a-f0-9]{7,64}$/i.test(revision)) return;
  const { exec, head } = context;
  const sha = output(exec, 'git', ['rev-parse', '--verify', `${revision}^{commit}`]);
  if (!sha || exec('git', ['merge-base', '--is-ancestor', sha, head]).status !== 0) return;
  const bases = context.bases ?? baseRevisions(exec, context.dir);
  if (bases.some(base => exec('git', ['merge-base', '--is-ancestor', sha, base]).status === 0)) return;
  return `${context.base}/commit/${sha}`;
}

function fileTarget(context: LinkContext, target: string) {
  const match = /^(.+?)(#L[1-9]\d*(?:-L[1-9]\d*)?)?$/.exec(target);
  if (!match) return;
  const [, path, anchor = ''] = match;
  if (isAbsolute(path) || /[:#\\]/.test(path) || path.split('/').some(part => !part || part === '..' || part === '.')) return;
  return committedFile(context, path) ? blobUrl(context, path) + anchor : undefined;
}

export function resolveTarget(target: string, context: LinkContext): { href: string } | { problem: string } {
  let href: string | undefined;
  if (/^log:(?:DECIDE|DISPUTE|D|DP)-\d+$/.test(target)) href = logTarget(context, target.slice(4));
  else if (target.startsWith('commit:')) href = commitTarget(context, target.slice(7));
  else href = fileTarget(context, target);
  return href ? { href } : { problem: `unresolved GitHub link target ${target}` };
}
