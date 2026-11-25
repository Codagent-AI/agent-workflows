import { isAbsolute, join, relative } from 'node:path';
import { rawCells, tableBlocks } from './checklist.ts';
import { type Exec, output } from './exec.ts';
import { journeys } from './review-media.ts';
import type { Item } from './review-inventory.ts';
import { readText } from './run-files.ts';

interface SourceLink { title: string; href: string }
interface Links { base: string; head: string; dir: string; folder: string; exec: Exec }

export const urlPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export function sourceLink(link: string, input: Links): string {
  if (/^https?:\/\//i.test(link)) return link;
  if (/^[\da-f]{40,64}$/.test(link)) return `${input.base}/commit/${link}`;
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(link);
  const path = match?.[1] ?? link;
  if (!path) return '';
  const artifact = isAbsolute(path) ? relative(input.dir, path) : path;
  if (artifact.startsWith('..') || isAbsolute(artifact)) return '';
  const committed = !isAbsolute(path) && output(input.exec, 'git', ['cat-file', '-t', `${input.head}:${path}`]) === 'blob';
  if (!committed) return urlPath(artifact);
  const lines = lineAnchor(match);
  return `${input.base}/blob/${input.head}/${urlPath(path)}${lines}`;
}

function lineAnchor(match: RegExpExecArray | null): string {
  if (!match) return '';
  const end = match[3] ? `-L${match[3]}` : '';
  return `#L${match[2]}${end}`;
}

function checklistLinks(input: Links): [string, SourceLink][] {
  const file = join(input.folder, 'checklist.md');
  const text = readText(file);
  const lines = text.split('\n');
  return tableBlocks(text).flatMap(block => {
    const columns = rawCells(block.header);
    return block.rows.flatMap(row => {
      const cells = rawCells(row);
      const id = cells[columns.indexOf('ID')];
      const title = cells[columns.indexOf('Behavior')]?.split(/(?<=\.)\s/)[0];
      if (!(id && title)) return [];
      return [[id, { title, href: sourceLink(`${file}:${lines.indexOf(row) + 1}`, input) }]];
    });
  });
}

function headingLinks(file: string, input: Links): [string, SourceLink][] {
  return readText(file).split('\n').flatMap((line, index) => {
    const match = /^#{2,4}\s+([A-Z][A-Z0-9]*-\d+|R\d+)\s*:\s*(.+)/.exec(line);
    return match ? [[match[1], { title: match[2], href: sourceLink(`${file}:${index + 1}`, input) }]] : [];
  });
}

export function codeLinks(input: Links, items: Item[]): Record<string, SourceLink> {
  const paths = ['decision-log.md', 'dispute-log.md', 'test-plan.md'].map(path => join(input.folder, path));
  paths.push(...['acceptance-findings.md', 'acceptance-handoff.md'].map(name => join(input.dir, name)));
  paths.push(...['before-pr', 'acceptance', 'feedback'].map(place => join(input.dir, 'review', `${place}.md`)));
  const entries = [...checklistLinks(input), ...paths.flatMap(path => headingLinks(path, input))];
  const known = Object.fromEntries(entries);
  for (const journey of journeys(input.dir)) {
    known[journey.code] ??= { title: journey.title, href: sourceLink(join(input.dir, journey.artifact), input) };
  }
  for (const item of items) {
    for (const code of item.source) known[code] ??= { title: item.title, href: sourceLink(item.link, input) };
  }
  return known;
}
