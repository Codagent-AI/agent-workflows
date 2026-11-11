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
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { type CheckResult, artifactsDir, checkMode, fail, pass, report, requireOk, stopIfBlocked } from './check.ts';
import { cells, checklistPath, isTableLine, nonEmptyFile, rawCells } from './checklist.ts';
import { planProblems } from './checklist-plan.ts';
import { checkNotBlocked } from './worktree.ts';

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

interface EvidenceColumns {
  status: number;
  evidence: number;
  id: number;
}

/** The Status, Evidence and ID column positions of a header line, if it has Status and Evidence. */
function evidenceColumns(line: string): EvidenceColumns | undefined {
  const names = cells(line).map(name => name.toLowerCase());
  const status = names.indexOf('status');
  const evidence = names.indexOf('evidence');
  if (status < 0 || evidence < 0) return undefined;
  return { status, evidence, id: names.findIndex(name => /^id([^a-z0-9_-]|$)/.test(name)) };
}

/** The evidence-relevant parts of one table row. */
function evidenceRow(line: string, columns: EvidenceColumns, rowNumber: number): EvidenceRow {
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
  return { id, status, cited, hasText: evidence !== '' };
}

/** The rows of the first table with Status and Evidence columns, or undefined if none. */
export function evidenceRows(text: string): EvidenceRow[] | undefined {
  const lines = text.split(/\r?\n/);
  let columns: EvidenceColumns | undefined;
  let start = 0;
  for (; start < lines.length && !columns; start += 1) {
    if (isTableLine(lines[start])) columns = evidenceColumns(lines[start]);
  }
  if (!columns) return undefined;
  const rows: EvidenceRow[] = [];
  for (const line of lines.slice(start)) {
    if (!isTableLine(line)) break;
    if (/^[ \t]*\|[ \t:|-]*$/.test(line)) continue;
    rows.push(evidenceRow(line, columns, rows.length + 1));
  }
  return rows;
}

/** The file a cited token names inside the evidence directory, or undefined for an outside path. */
function evidencePath(token: string, evidenceDir: string): string | undefined {
  if (token.startsWith(`${evidenceDir}/`)) return token;
  return isAbsolute(token) ? undefined : join(evidenceDir, token);
}

function citesEvidence(cited: readonly string[], evidenceDir: string): boolean {
  return cited.some(token => {
    const path = evidencePath(token, evidenceDir);
    return path !== undefined && nonEmptyFile(path);
  });
}

export function manualTestIds(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(/(?<![A-Za-z0-9-])(?:AT|HT)-[0-9]+/g)) ids.add(match[0]);
  }
  return [...ids].sort();
}

/** What is wrong with one row's status and evidence, if anything. */
function rowProblem(row: EvidenceRow, evidenceDir: string): string | undefined {
  if (row.status === 'verified') {
    return citesEvidence(row.cited, evidenceDir)
      ? undefined
      : `${row.id} is verified but cites no non-empty file in ${evidenceDir}`;
  }
  if (row.status === 'failed' || row.status === 'not verified') {
    return row.hasText ? undefined : `${row.id} is ${row.status} but its Evidence cell does not say why`;
  }
  return `${row.id} has status '${row.status}'; Status holds only verified, failed, or not verified, and evidence file names go in the Evidence column`;
}

/** Writes or removes the problems file and returns the check result. */
function finish(input: EvidenceInput, evidenceDir: string, problems: string[]): CheckResult {
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
}

export function checkEvidence(input: EvidenceInput): CheckResult {
  const evidenceDir = input.evidenceDir.replace(/\/+$/, '');
  if (!nonEmptyFile(input.checklistFile)) return finish(input, evidenceDir, [`${input.checklistFile} is missing or empty`]);
  const text = readFileSync(input.checklistFile, 'utf8');
  const rows = evidenceRows(text);
  if (!rows) {
    return finish(input, evidenceDir, [`${input.checklistFile} has no Markdown table with Status and Evidence columns`]);
  }

  const problems: string[] = [];
  for (const row of rows) {
    const problem = rowProblem(row, evidenceDir);
    if (problem) problems.push(problem);
  }
  if (rows.length === 0) problems.push('the checklist table has no rows');
  const manual = manualTestIds(text);
  if (manual.length > 0) {
    problems.push(
      `the checklist cites manual tests, which are not checklist checks: ${manual.join(', ')}; verify each behavior with an automated test, a scripted command, or inspection`
    );
  }
  problems.push(...planProblems(input.checklistFile, input.planFile, input.findings));
  return finish(input, evidenceDir, problems);
}

/** What an evidence check script reads from its bindings, read after the blocked checks. */
export interface EvidenceScriptInputs {
  changeDir: string;
  findings?: string;
}

/** The body of the check-evidence scripts: stop on a blocked repair or record, then check. */
export function runEvidenceScript(readInputs: () => EvidenceScriptInputs): void {
  const mode = checkMode();
  stopIfBlocked(mode);
  const dir = artifactsDir();
  const notBlocked = checkNotBlocked(dir);
  if (!notBlocked.ok) requireOk(notBlocked, '');
  const { changeDir, findings } = readInputs();
  const result = checkEvidence({
    checklistFile: checklistPath(changeDir),
    evidenceDir: join(dir, 'evidence'),
    problemsFile: join(dir, 'evidence-problems.txt'),
    planFile: join(dir, 'planned-checklist.md'),
    ...(findings === undefined ? {} : { findings }),
  });
  report(result, mode);
}
