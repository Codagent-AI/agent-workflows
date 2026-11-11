// The implementor's verification checklist: a Markdown table with an ID column, written
// before implementation, committed, and filled in with Code, Evidence and Status as the
// implementor works.
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { head, status } from './worktree.ts';

export const checklistPath = (changeDir: string): string => join(changeDir, 'checklist.md');

export const nonEmptyFile = (path: string): boolean =>
  existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;

export const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
export const isSeparatorRow = (line: string): boolean => /^[\s:|-]*$/.test(line);
export const isIdHeader = (name: string): boolean => /^id(?![a-z0-9_-])/.test(name);

/** A table row's trimmed cells, with an escaped `\|` kept inside its cell. */
export function rawCells(line: string): string[] {
  const inner = line.trim().replaceAll('\\|', '\x01').replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(cell => cell.replaceAll('\x01', '|').trim());
}

/** A table row's cells with whitespace runs collapsed, for comparing rows. */
export function cells(line: string): string[] {
  return rawCells(line).map(cell => cell.split(/\s+/).filter(Boolean).join(' '));
}

/** A run of consecutive table lines: the header line, then every line after it. */
export interface TableBlock {
  header: string;
  rows: string[];
}

/** The tables in the text, in order, each a run of consecutive table lines. */
export function tableBlocks(text: string): TableBlock[] {
  const blocks: TableBlock[] = [];
  let current: TableBlock | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!isTableLine(line)) {
      current = undefined;
    } else if (current) {
      current.rows.push(line);
    } else {
      current = { header: line, rows: [] };
      blocks.push(current);
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------
// check-implementor-checklist: the checklist step may only write the checklist.

export interface ImplementorChecklistInput {
  changeDir: string;
  changeName: string;
  definitionHead: string;
  /** `git status --porcelain --untracked-files=all` before the checklist step. */
  preListStatus: string;
}

/** Status lines for changes other than the checklist and those already there before the step. */
function otherChanges(now: string, before: ReadonlySet<string>, list: string): string[] {
  // A porcelain line is `XY <path>`; only the checklist's own line is allowed. Quoted paths
  // and renames never equal the checklist path, so they count as other changes.
  return now.split('\n').filter(line => line !== '' && line.slice(3) !== list && !before.has(line));
}

/** Commits the checklist, unless it is outside the repository. */
function commitChecklist(exec: Exec, list: string, changeName: string): CheckResult {
  // Empty for a change directory outside the repository, which stays uncommitted.
  if (!status(exec, ['--', list])) return pass();
  const message = `[check-implementor-checklist] docs: add verification checklist for ${changeName}`;
  for (const args of [['add', '--', list], ['commit', '-m', message, '--', list]]) {
    const result = exec('git', args);
    if (result.status !== 0) return fail([`git ${args[0]} failed:`, result.stderr.trim()]);
  }
  return pass();
}

/** Checks what the checklist step changed, then commits the checklist. */
export function checkImplementorChecklist(exec: Exec, input: ImplementorChecklistInput): CheckResult {
  const list = checklistPath(input.changeDir);
  if (head(exec) !== input.definitionHead) {
    return fail(`implementor-checklist committed work; it may only write ${list}`);
  }
  const now = status(exec, ['--untracked-files=all']);
  if (now === undefined) return fail('could not inspect the worktree');
  const other = otherChanges(now, new Set(input.preListStatus.split('\n')), list);
  if (other.length > 0) {
    return fail([`implementor-checklist changed files other than ${list}:`, ...other]);
  }
  if (!nonEmptyFile(list)) return fail(`implementor-checklist did not write ${list}`);
  return commitChecklist(exec, list, input.changeName);
}

// ---------------------------------------------------------------------------------------
// verify-checklist: the committed checklist is the plan.

/** The header's cell count when it has an ID column, else 0. */
function idTableWidth(headerLine: string): number {
  const names = cells(headerLine).map(name => name.toLowerCase());
  return names.some(isIdHeader) ? names.length : 0;
}

/** Rows that split into the wrong number of cells, in the first table with an ID column. */
export function tableShapeProblems(text: string): string[] {
  const table = tableBlocks(text).find(block => idTableWidth(block.header) > 0);
  if (!table) return ['checklist has no table with an ID column'];
  const width = idTableWidth(table.header);
  return table.rows
    .filter(line => !isSeparatorRow(line) && cells(line).length !== width)
    .map(line => `checklist row ${cells(line)[0] || 'a row'} does not have ${String(width)} cells; escape any | inside a cell as \\|`);
}

/** Checks the committed checklist and, when it passes, saves it as the plan. */
export function verifyChecklist(exec: Exec, changeDir: string, planFile: string): CheckResult {
  const list = checklistPath(changeDir);
  if (!nonEmptyFile(list)) return fail(`${list} is missing or empty`);
  // Empty for a change directory outside the repository, which stays uncommitted.
  if (status(exec, ['--', list])) return fail(`${list} has uncommitted changes`);
  const problems = tableShapeProblems(readFileSync(list, 'utf8'));
  if (problems.length > 0) return fail(problems);
  copyFileSync(list, planFile);
  return pass();
}
