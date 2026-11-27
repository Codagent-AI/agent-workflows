// Deterministic numbering and isolated commit of the two agent-authored logs.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Exec, output } from './exec.ts';
import { type CheckResult, fail, pass } from './check.ts';
import { readText, writeText, recordStep, readJson, writeJson } from './run-files.ts';

const logs = { decision: 'DECIDE', dispute: 'DISPUTE' };
type LogKind = keyof typeof logs;
const counter = /^## (?:DECIDE|DISPUTE|D|DP)-(\d+): /gm;

export function numberLog(text: string, prefix: string): string {
  let count = 0;
  const existing = [...text.matchAll(counter)].map(match => Number(match[1]));
  let next = Math.max(0, ...existing);
  const numbered = text.replace(/^## (?:(?:DECIDE|DISPUTE|D|DP)-(\d+): )?(.*)$/gm, (_match, id: string | undefined, heading: string) => {
    count += 1; return `## ${prefix}-${id ? Number(id) : ++next}: ${heading}`;
  });
  return count > 0 ? `${numbered.trim()}\n` : 'No entries.\n';
}

export function logMessage(name: string): string {
  const ticket = /^([a-z][a-z0-9]*)-(\d+)-.+$/.exec(name);
  return ticket ? `${ticket[1].toUpperCase()}-${ticket[2]}: Add decision and dispute logs` : `[logs] chore: add the decision and dispute logs for ${name}`;
}

function entries(text: string): string[] {
  return [...text.matchAll(/^## (?:[^\n]+)(?:\n[\s\S]*?)?(?=^## |$(?![\s\S]))/gm)].map(match => match[0].trimEnd());
}

function appendEntries(current: string, added: string[], prefix: string): string {
  let next = Math.max(0, ...[...current.matchAll(counter)].map(match => Number(match[1])));
  const numbered = added.map(entry => entry.replace(/^## (?:(?:DECIDE|DISPUTE|D|DP)-\d+: )?/, () => `## ${prefix}-${++next}: `));
  return `${[current.trim() === 'No entries.' ? '' : current.trimEnd(), ...numbered].filter(Boolean).join('\n\n')}\n`;
}

function commit(exec: Exec, paths: string[], message: string): CheckResult {
  const result = exec('git', ['commit', '--only', '-m', message, '--', ...paths]);
  return result.status === 0 ? pass() : fail(`${result.stdout}\n${result.stderr}`);
}

const kinds = Object.keys(logs) as LogKind[];
const logState = (dir: string) => join(dir, 'review/log-state.json');
const filename = (kind: LogKind) => `${kind}-log.md`;

function runLogs(dir: string) {
  return kinds.map(kind => {
    const text = readText(join(dir, filename(kind)))
      .replace(/^\s*(?:[-*] )?(?:\*\*)?Decision pending from (?:the )?user:(?:\*\*)?[^\n]*\n?/gmi, '');
    return { kind, text, entries: entries(text) };
  });
}

function recordLogFailure(dir: string, result: CheckResult, remaining: string) {
  if (!result.ok) recordStep(dir, 'logs', { ...result, remaining });
  return result;
}

export function commitLogs(exec: Exec, dir: string, name: string): CheckResult {
  const folder = `openspec/changes/${name}`;
  const source = runLogs(dir);
  const paths = source.map(({ kind, text }) => {
    const path = join(folder, filename(kind));
    writeText(path, numberLog(text, logs[kind]));
    return path;
  });
  writeJson(logState(dir), Object.fromEntries(source.map(log => [log.kind, log.entries.length])));
  const indexed = exec('git', ['add', '--', ...paths]);
  const result = indexed.status ? fail(indexed.stderr) : commit(exec, paths, logMessage(name));
  return recordLogFailure(dir, result, 'The archive commit will include these logs.');
}

function syncFile(exec: Exec, path: string, added: string[], prefix: string) {
  const original = existsSync(path) ? readText(path) : undefined;
  const committed = output(exec, 'git', ['show', `HEAD:${path}`]) ?? '';
  writeText(path, appendEntries(committed, added, prefix));
  return { path, original };
}

export function syncLogs(exec: Exec, dir: string, folder: string, name: string): CheckResult {
  const state = logState(dir);
  const prior = readJson<Partial<Record<LogKind, number>>>(state, {});
  const source = runLogs(dir);
  const updates = source.flatMap(log => {
    const added = log.entries.slice(prior[log.kind] ?? 0);
    return added.length > 0 ? [syncFile(exec, join(folder, filename(log.kind)), added, logs[log.kind])] : [];
  });
  if (updates.length === 0) return pass();
  const result = commit(exec, updates.map(update => update.path), logMessage(name));
  if (result.ok) {
    writeJson(state, Object.fromEntries(source.map(log => [log.kind, log.entries.length])));
    recordStep(dir, 'logs', { ...result, remaining: '' });
  }
  else for (const { path, original } of updates) {
    if (original === undefined) rmSync(path, { force: true });
    else writeText(path, original);
  }
  return recordLogFailure(dir, result, 'Commit the updated review logs.');
}
