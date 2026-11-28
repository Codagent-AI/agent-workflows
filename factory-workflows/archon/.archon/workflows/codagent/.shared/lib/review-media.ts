import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
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

function evidenceRounds(dir: string, kind: string): string[] {
  const root = join(dir, kind);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^round-\d+$/.test(entry.name))
    .map(entry => entry.name).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}

export interface CommandEvidence {
  file: string; title: string; shows: string; revision: string; command: string; excerpt: string; round: number;
}
type CommandManifest = Omit<CommandEvidence, 'file' | 'round'> & { output: string };

function plain(text: string): string {
  return stripVTControlCharacters(text).replace(/\r\n?/g, '\n');
}

function matchingExcerpt(excerpt: string, fullOutput: string): boolean {
  return excerpt.trim() !== '' && excerpt.split('\n').length <= 20 && `\n${plain(fullOutput)}\n`.includes(`\n${excerpt}\n`);
}

function readCommand(folder: string, entry: CommandManifest, problems: ManifestProblem[]): CommandEvidence[] {
  const { output: filename, revision, title, shows, command } = entry;
  const file = `${folder}/${filename}`;
  const excerpt = plain(entry.excerpt).replace(/\n$/, '');
  try {
    if (!filename || basename(filename) !== filename || /[\\]/.test(filename)) throw new Error('output must be a file in the round folder');
    if (!lstatSync(file).isFile()) throw new Error('output must be a regular file');
    if (!matchingExcerpt(excerpt, readFileSync(file, 'utf8'))) throw new Error('excerpt must match up to 20 whole lines of the saved output');
    const name = basename(folder);
    return [{ file: `acceptance-commands/${name}/${filename}`, round: Number(name.slice(6)), revision, title, shows, command, excerpt }];
  } catch (error) {
    problems.push({ path: file, detail: String(error) });
    return [];
  }
}

function distinctCommandEntries(entries: CommandEvidence[], manifest: string, problems: ManifestProblem[]): CommandEvidence[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (seen.has(entry.file)) {
      problems.push({ path: manifest, detail: `Duplicate command output ${basename(entry.file)}. Use a separate file for each entry.` });
      return false;
    }
    seen.add(entry.file);
    return true;
  });
}

export function commands(dir: string, problems: ManifestProblem[] = []): CommandEvidence[] {
  return evidenceRounds(dir, 'acceptance-commands').flatMap(name => {
    const folder = join(dir, 'acceptance-commands', name);
    const manifest = join(folder, 'manifest.json');
    if (!existsSync(manifest)) return [];
    const entries = manifestEntries<CommandManifest>(manifest, ['title', 'shows', 'revision', 'command', 'excerpt', 'output'], problems)
      .flatMap(entry => readCommand(folder, entry, problems));
    return distinctCommandEntries(entries, manifest, problems);
  });
}

const screenshotExtension = /^[^\\]+\.(png|jpe?g|gif|webp)$/i;

function containsScreenshots(folder: string): boolean {
  return readdirSync(folder, { withFileTypes: true }).some(entry => !entry.isDirectory() && screenshotExtension.test(entry.name));
}

export function screenshots(dir: string, problems: ManifestProblem[] = []): Screenshot[] {
  return evidenceRounds(dir, 'acceptance-screenshots').flatMap(name => {
    const folder = join(dir, 'acceptance-screenshots', name);
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
  return { shots: screenshots(dir, problems), commands: commands(dir, problems), journeys: journeys(dir, problems), problems };
}

// The problems the review page would report in one round's evidence, listed while its tester can still fix them.
export function roundProblems(dir: string, round: number): string {
  const name = `round-${round}`;
  const places = [join(dir, 'acceptance-commands', name), join(dir, 'acceptance-screenshots', name), join(dir, 'acceptance-journeys', `${name}.json`)];
  return reviewMedia(dir).problems
    .filter(problem => places.some(place => problem.path === place || problem.path.startsWith(`${place}/`)))
    .map(problem => `- ${problem.path}: ${problem.detail}`).join('\n') || 'none';
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
