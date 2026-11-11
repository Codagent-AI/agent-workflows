// The implementor's verification checklist: a Markdown table with an ID column, written
// before implementation, committed, and filled in with Code, Evidence and Status as the
// implementor works.
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { type CheckResult, fail, pass } from './check.ts';
import type { Exec } from './exec.ts';
import { head, status } from './worktree.ts';

export const checklistPath = (changeDir: string): string => join(changeDir, 'checklist.md');

const nonEmptyFile = (path: string): boolean => existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
const isSeparatorRow = (line: string): boolean => /^[\s:|-]*$/.test(line);
const isIdHeader = (name: string): boolean => /^id(?![a-z0-9_-])/.test(name);

/** A table row's trimmed cells, with an escaped `\|` kept inside its cell. */
export function rawCells(line: string): string[] {
  const inner = line.trim().replaceAll('\\|', '\x01').replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(cell => cell.replaceAll('\x01', '|').trim());
}

/** A table row's cells with whitespace runs collapsed, for comparing rows. */
export function cells(line: string): string[] {
  return rawCells(line).map(cell => cell.split(/\s+/).filter(Boolean).join(' '));
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

/** Checks what the checklist step changed, then commits the checklist. */
export function checkImplementorChecklist(exec: Exec, input: ImplementorChecklistInput): CheckResult {
  const list = checklistPath(input.changeDir);
  if (head(exec) !== input.definitionHead) {
    return fail(`implementor-checklist committed work; it may only write ${list}`);
  }
  const now = status(exec, ['--untracked-files=all']);
  if (now === undefined) return fail('could not inspect the worktree');
  const before = new Set(input.preListStatus.split('\n'));
  // A porcelain line is `XY <path>`; only the checklist's own line is allowed. Quoted paths
  // and renames never equal the checklist path, so they count as other changes.
  const other = now
    .split('\n')
    .filter(line => line !== '' && line.slice(3) !== list && !before.has(line));
  if (other.length > 0) {
    return fail([`implementor-checklist changed files other than ${list}:`, ...other]);
  }
  if (!nonEmptyFile(list)) return fail(`implementor-checklist did not write ${list}`);
  // Empty for a change directory outside the repository, which stays uncommitted.
  if (status(exec, ['--', list])) {
    const message = `[check-implementor-checklist] docs: add verification checklist for ${input.changeName}`;
    for (const args of [['add', '--', list], ['commit', '-m', message, '--', list]]) {
      const result = exec('git', args);
      if (result.status !== 0) return fail([`git ${args[0]} failed:`, result.stderr.trim()]);
    }
  }
  return pass();
}

// ---------------------------------------------------------------------------------------
// verify-checklist: the committed checklist is the plan.

/** Rows that split into the wrong number of cells, in the first table with an ID column. */
export function tableShapeProblems(text: string): string[] {
  let width: number | undefined;
  let found = false;
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!isTableLine(line)) {
      if (width) break;
      width = undefined;
      continue;
    }
    if (width === undefined) {
      const names = cells(line).map(name => name.toLowerCase());
      width = names.some(isIdHeader) ? names.length : 0;
      found ||= width > 0;
    } else if (width && !isSeparatorRow(line) && cells(line).length !== width) {
      bad.push(cells(line)[0] || 'a row');
    }
  }
  if (!found) return ['checklist has no table with an ID column'];
  return bad.map(row => `checklist row ${row} does not have ${String(width)} cells; escape any | inside a cell as \\|`);
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

// ---------------------------------------------------------------------------------------
// check-evidence: the checklist is complete before the audit.
//
//   - Status is `verified`, `failed`, or `not verified`.
//   - A verified row cites, in backticks, at least one non-empty file in the evidence
//     directory: a path relative to it, or an absolute path inside it.
//   - A failed or not-verified row says why in its Evidence cell.
//   - The checklist cites no acceptance (AT-n) or human-only (HT-n) test.
//   - Every planned row is still there with its planned columns unchanged, and no row was
//     added. After the audit, rows may be added, and a planned row may change only if an
//     audit finding names its ID.
//
// It checks that the checklist is complete, not that its claims are true; the audit judges
// whether the evidence proves each behavior. Its columns and statuses must stay in step
// with .shared/verify-behavior.md.

export interface EvidenceInput {
  checklistFile: string;
  evidenceDir: string;
  /** Written with the problem list on failure and removed on success. */
  problemsFile: string;
  /** The checklist as committed before implementation. */
  planFile: string;
  /** The audit's findings, given only after the audit. */
  findings?: string;
}

interface EvidenceRow {
  id: string;
  status: string;
  cited: string[];
  hasText: boolean;
}

/** The rows of the first table with Status and Evidence columns, or undefined if none. */
export function evidenceRows(text: string): EvidenceRow[] | undefined {
  let columns: { status: number; evidence: number; id: number } | undefined;
  let found = false;
  let rowNumber = 0;
  const rows: EvidenceRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!isTableLine(line)) {
      if (columns) break;
      continue;
    }
    if (!columns) {
      const names = cells(line).map(name => name.toLowerCase());
      const status = names.indexOf('status');
      const evidence = names.indexOf('evidence');
      if (status >= 0 && evidence >= 0) {
        columns = { status, evidence, id: names.findIndex(name => /^id([^a-z0-9_-]|$)/.test(name)) };
        found = true;
      }
      continue;
    }
    if (/^[ \t]*\|[ \t:|-]*$/.test(line)) continue;
    rowNumber += 1;
    const row = rawCells(line);
    const id = (columns.id >= 0 && row[columns.id]) || `row ${String(rowNumber)}`;
    const status = (row[columns.status] ?? '')
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    const evidence = row[columns.evidence] ?? '';
    const cited = [...evidence.matchAll(/`([^`]+)`/g)]
      .map(match => match[1])
      .filter(token => !/(^|\/)\.\.(\/|$)/.test(token));
    rows.push({ id, status, cited, hasText: evidence !== '' });
  }
  return found ? rows : undefined;
}

function citesEvidence(cited: readonly string[], evidenceDir: string): boolean {
  return cited.some(token => {
    let path: string;
    if (token.startsWith(`${evidenceDir}/`)) path = token;
    else if (isAbsolute(token)) return false;
    else path = join(evidenceDir, token);
    return nonEmptyFile(path);
  });
}

export function manualTestIds(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(/(?<![A-Za-z0-9-])(?:AT|HT)-[0-9]+/g)) ids.add(match[0]);
  }
  return [...ids].sort();
}

const DONE_COLUMNS = new Set(['code', 'evidence', 'status']);

interface IdTable {
  header: string[];
  rows: string[][];
}

/** The first table with an ID column and the required columns, or a problem. */
function idTable(path: string, required: readonly string[]): IdTable | string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return `cannot read ${path}: ${(error as Error).message}`;
  }
  const complete = (header: string[] | undefined): header is string[] =>
    header !== undefined && ['id', ...required].every(name => header.includes(name));
  let header: string[] | undefined;
  let rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!isTableLine(line)) {
      if (complete(header)) break;
      header = undefined;
      rows = [];
      continue;
    }
    if (header === undefined) {
      header = cells(line).map(name => (isIdHeader(name.toLowerCase()) ? 'id' : name.toLowerCase()));
    } else if (!isSeparatorRow(line)) {
      rows.push(cells(line));
    }
  }
  return complete(header) ? { header, rows } : `${path} has no Markdown table with an ID column`;
}

const cell = (header: readonly string[], row: readonly string[], name: string): string =>
  row[header.indexOf(name)] ?? '';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether an audit finding names the row. */
export function namedByFinding(idCell: string, findings: string): boolean {
  const ids = idCell.match(/[A-Za-z]+-\d+/g);
  if (!ids) return idCell !== '' && findings.includes(idCell);
  return ids.some(id => new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(id)}(?!\\d)`).test(findings));
}

export function planProblems(checklistFile: string, planFile: string, findings: string | undefined): string[] {
  const plan = idTable(planFile, []);
  if (typeof plan === 'string') return [plan];
  const current = idTable(checklistFile, ['status', 'evidence']);
  if (typeof current === 'string') return [current];
  const columns = plan.header.filter(name => name !== '' && !DONE_COLUMNS.has(name));
  const lost = columns.filter(name => !current.header.includes(name));
  if (lost.length > 0) {
    return [`the checklist table lost the planned column(s) ${lost.join(', ')} of ${planFile}`];
  }
  const afterAudit = findings !== undefined;
  const key = (header: readonly string[], row: readonly string[]): string =>
    JSON.stringify(columns.map(name => cell(header, row, name)));
  const remaining = new Map<string, number>();
  for (const row of current.rows) {
    const k = key(current.header, row);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const problems: string[] = [];
  const changed = new Set<string>();
  const rule = afterAudit
    ? 'only a row an audit finding names may change them'
    : 'implementation fills in only Code, Evidence, and Status';
  for (const row of plan.rows) {
    const k = key(plan.header, row);
    const count = remaining.get(k) ?? 0;
    if (count > 0) {
      remaining.set(k, count - 1);
      continue;
    }
    const rowId = cell(plan.header, row, 'id') || 'a row';
    if (afterAudit && namedByFinding(rowId, findings)) continue;
    changed.add(rowId);
    problems.push(
      `${rowId} was changed or removed: restore its planned cells (${columns.join(', ')}) as they are in ${planFile}; ${rule}`
    );
  }
  if (!afterAudit) {
    const idIndex = columns.indexOf('id');
    for (const [k, count] of remaining) {
      const id = (JSON.parse(k) as string[])[idIndex] ?? '';
      if (count > 0 && !changed.has(id)) {
        problems.push(`${id || 'a row'} is not in the planned checklist ${planFile}: remove the row, or restore the planned row it changed`);
      }
    }
  }
  return problems;
}

export function checkEvidence(input: EvidenceInput): CheckResult {
  const evidenceDir = input.evidenceDir.replace(/\/+$/, '');
  const finish = (problems: string[]): CheckResult => {
    if (problems.length === 0) {
      rmSync(input.problemsFile, { force: true });
      return pass();
    }
    writeFileSync(input.problemsFile, problems.map(problem => `- ${problem}\n`).join(''));
    return fail([
      `evidence check: ${input.checklistFile} is not complete:`,
      ...problems.map(problem => `- ${problem}`),
      `Cite evidence files in backticks, relative to ${evidenceDir} or as absolute paths inside it.`,
    ]);
  };

  if (!nonEmptyFile(input.checklistFile)) return finish([`${input.checklistFile} is missing or empty`]);
  const text = readFileSync(input.checklistFile, 'utf8');
  const rows = evidenceRows(text);
  if (!rows) return finish([`${input.checklistFile} has no Markdown table with Status and Evidence columns`]);

  const problems: string[] = [];
  for (const row of rows) {
    if (row.status === 'verified') {
      if (!citesEvidence(row.cited, evidenceDir)) {
        problems.push(`${row.id} is verified but cites no non-empty file in ${evidenceDir}`);
      }
    } else if (row.status === 'failed' || row.status === 'not verified') {
      if (!row.hasText) problems.push(`${row.id} is ${row.status} but its Evidence cell does not say why`);
    } else {
      problems.push(
        `${row.id} has status '${row.status}'; Status holds only verified, failed, or not verified, and evidence file names go in the Evidence column`
      );
    }
  }
  if (rows.length === 0) problems.push('the checklist table has no rows');
  const manual = manualTestIds(text);
  if (manual.length > 0) {
    problems.push(
      `the checklist cites manual tests, which are not checklist checks: ${manual.join(', ')}; verify each behavior with an automated test, a scripted command, or inspection`
    );
  }
  problems.push(...planProblems(input.checklistFile, input.planFile, input.findings));
  return finish(problems);
}
