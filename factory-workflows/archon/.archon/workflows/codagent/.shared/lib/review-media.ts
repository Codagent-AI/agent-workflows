import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { readJson } from './run-files.ts';

export interface Screenshot {
  file: string; title: string; shows: string; revision: string; alt: string; round: number;
}
export interface Journey {
  code: string; title: string; scenario: string; repeat: string;
}

export function screenshots(dir: string): Screenshot[] {
  const root = join(dir, 'acceptance-screenshots');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => /^round-\d+$/.test(name)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))).flatMap(name => {
    const entries = readJson<Omit<Screenshot, 'round'>[]>(join(root, name, 'manifest.json'), []);
    return entries.filter(entry => typeof entry.file === 'string' && basename(entry.file) === entry.file && /^[^\\]+\.(png|jpe?g|gif|webp)$/i.test(entry.file) && existsSync(join(root, name, entry.file)))
      .map(entry => ({ ...entry, file: `acceptance-screenshots/${name}/${entry.file}`, round: Number(name.slice(6)) }));
  });
}

export function journeys(dir: string): Journey[] {
  const root = join(dir, 'acceptance-journeys');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(file => /^round-\d+\.json$/.test(file)).flatMap(file => readJson<Journey[]>(join(root, file), []));
}

interface ClocCount { nFiles?: number; code?: number }
type ClocDiff = Record<'added' | 'modified' | 'removed', Record<string, ClocCount>>;
const lockFiles = '(^|/)([^/]+\\.lockb?|[^/]+-lock\\.[^/]+|npm-shrinkwrap\\.json|Cargo\\.lock|go\\.sum)$';

export function changeSize(exec: Exec, base: string): { language: string; files: number; added: number; modified: number; removed: number }[] | null {
  const from = output(exec, 'git', ['merge-base', 'HEAD', base]);
  if (!from) return null;
  const result = output(exec, 'cloc', ['--git', '--diff', '--json', '--quiet', `--not-match-f=${lockFiles}`, from, 'HEAD']);
  if (!result) return null;
  try {
    const table = JSON.parse(result) as ClocDiff;
    const groups = [table.added, table.modified, table.removed];
    if (!groups.every(group => group && typeof group === 'object')) return null;
    const languages = new Set(groups.flatMap(group => Object.keys(group)));
    return [...languages].map(language => ({
      language, files: groups.reduce((sum, group) => sum + (group[language]?.nFiles ?? 0), 0),
      added: table.added[language]?.code ?? 0, modified: table.modified[language]?.code ?? 0,
      removed: table.removed[language]?.code ?? 0,
    }));
  } catch {
    return null;
  }
}
