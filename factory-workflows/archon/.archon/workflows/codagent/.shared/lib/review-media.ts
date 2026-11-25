import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Exec, output } from './exec.ts';

export interface Screenshot {
  file: string; title: string; shows: string; revision: string; alt: string; round: number;
}
export interface Journey {
  code: string; title: string; scenario: string; repeat: string;
}

export interface ManifestProblem { path: string; detail: string }

function manifestEntries<T>(path: string, fields: (keyof T)[], problems: ManifestProblem[]): T[] {
  try {
    const entries: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('expected an array');
    return entries.flatMap((entry, index) => {
      if (entry && typeof entry === 'object' && fields.every(field => typeof entry[field] === 'string')) return [entry as T];
      problems.push({ path, detail: `entry ${index + 1} needs string fields ${fields.join(', ')}` });
      return [];
    });
  } catch (error) {
    problems.push({ path, detail: String(error) });
    return [];
  }
}

const screenshotExtension = /^[^\\]+\.(png|jpe?g|gif|webp)$/i;

function containsScreenshots(folder: string): boolean {
  return readdirSync(folder, { withFileTypes: true }).some(entry => !entry.isDirectory() && screenshotExtension.test(entry.name));
}

export function screenshots(dir: string, problems: ManifestProblem[] = []): Screenshot[] {
  const root = join(dir, 'acceptance-screenshots');
  if (!existsSync(root)) return [];
  const rounds = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^round-\d+$/.test(entry.name));
  return rounds.map(entry => entry.name).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))).flatMap(name => {
    const folder = join(root, name);
    const manifest = join(folder, 'manifest.json');
    if (!(existsSync(manifest) || containsScreenshots(folder))) return [];
    const entries = manifestEntries<Omit<Screenshot, 'round'>>(manifest, ['file', 'title', 'shows', 'revision', 'alt'], problems);
    return entries.filter(entry => basename(entry.file) === entry.file && screenshotExtension.test(entry.file) && existsSync(join(folder, entry.file)))
      .map(entry => ({ ...entry, file: `acceptance-screenshots/${name}/${entry.file}`, round: Number(name.slice(6)) }));
  });
}

export function journeys(dir: string, problems: ManifestProblem[] = []): (Journey & { artifact: string })[] {
  const root = join(dir, 'acceptance-journeys');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(file => /^round-\d+\.json$/.test(file)).flatMap(file => {
    const entries = manifestEntries<Journey>(join(root, file), ['code', 'title', 'scenario', 'repeat'], problems);
    return entries.map(journey => ({ ...journey, artifact: `acceptance-journeys/${file}` }));
  });
}

export function reviewMedia(dir: string) {
  const problems: ManifestProblem[] = [];
  return { shots: screenshots(dir, problems), journeys: journeys(dir, problems), problems };
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
