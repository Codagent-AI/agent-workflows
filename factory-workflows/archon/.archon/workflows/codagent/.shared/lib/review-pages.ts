import { join } from 'node:path';
import { OPS, type PrView, type Repo } from './forge.ts';
import { type Tools, markBlock, spliceBody } from './pull-request.ts';
import { readJson, readText } from './run-files.ts';

export interface PageEntry {
  round: number;
  file: string;
  head: string;
  message: string;
  state: string;
  status: 'current' | 'feedback sent' | 'merged' | 'Merge refused';
  time: string;
  reason?: string;
  refresh?: boolean;
  refusals?: string[];
  ref: { repo: Repo; number: number };
  run: string;
  archonUrl: string;
}

export const pagesPath = (dir: string) => join(dir, 'review/pages.json');
export const readPages = (dir: string) => readJson<PageEntry[]>(pagesPath(dir), []);
export const prefix = (round: number) => `Review round ${round}:`;

function pageEntry(page: PageEntry): string {
  const label = `Review round ${page.round}`;
  const where = page.archonUrl
    ? `[${label}](${page.archonUrl.replace(/\/+$/, '')}/api/artifacts/${encodeURIComponent(page.run)}/${page.file})`
    : `${label} (run ${page.run})`;
  const refusals = page.refusals ?? (page.status === 'Merge refused' && page.reason ? [page.reason] : []);
  const history = refusals.map(reason => `Merge was chosen and refused: ${reason}`);
  const status = page.status === 'Merge refused' ? history : [...history, page.status];
  return `- ${where} — ${status.join(' · ')}`;
}

export function description(dir: string, pages: PageEntry[]): string {
  const page = pages.at(-1);
  const guidance = page?.archonUrl ? '' : '\n\nOpen the pages from Archon’s UI or with the implement-change skill.';
  return [readText(join(dir, 'pr-body.md')).trim(), page?.state ?? '', pages.map(pageEntry).join('\n') + guidance].join('\n\n');
}

export function viewNumber(tools: Tools, ref: PageEntry['ref']) {
  return tools.forge.call<PrView | null>(OPS.view, { selector: { kind: 'number', ref } });
}

export function updateDescription(tools: Tools, view: PrView, block: string): void {
  const ref = { repo: view.pr.repo, number: view.pr.number };
  const body = spliceBody(view.body, markBlock(block));
  const changed = tools.forge.call(OPS.editBody, { ref, body });
  if (!changed.ok) throw new Error(changed.problem);
  const after = viewNumber(tools, ref);
  if (!after.ok || after.value?.body !== body) throw new Error('review package read-back did not match');
}

export function embeddedJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export const sentBlock = (value: unknown) => `<script type="application/json" id="sent-answers">${embeddedJson(value)}</script>`;
