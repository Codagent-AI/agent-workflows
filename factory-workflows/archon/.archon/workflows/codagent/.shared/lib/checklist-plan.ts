// The planned checklist: after implementation (and after the audit) every planned row is
// still there with its planned columns unchanged, and no row was added.
import { readFileSync } from 'node:fs';

import { cells, isIdHeader, isSeparatorRow, tableBlocks } from './checklist.ts';

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
  const needed = ['id', ...required];
  for (const block of tableBlocks(text)) {
    const header = cells(block.header).map(name => (isIdHeader(name.toLowerCase()) ? 'id' : name.toLowerCase()));
    if (needed.every(name => header.includes(name))) {
      return { header, rows: block.rows.filter(line => !isSeparatorRow(line)).map(cells) };
    }
  }
  return `${path} has no Markdown table with an ID column`;
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

interface PlanCheck {
  planFile: string;
  /** The planned columns that must stay as planned. */
  columns: string[];
  /** The audit's findings, given only after the audit. */
  findings: string | undefined;
}

const rowKey = (columns: readonly string[], header: readonly string[], row: readonly string[]): string =>
  JSON.stringify(columns.map(name => cell(header, row, name)));

/** How many rows of the table share each key of the planned columns. */
function countRows(table: IdTable, columns: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const key = rowKey(columns, table.header, row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** IDs of planned rows the checklist no longer has as planned; consumes the matched rows. */
function changedRowIds(plan: IdTable, remaining: Map<string, number>, check: PlanCheck): string[] {
  const ids: string[] = [];
  for (const row of plan.rows) {
    const key = rowKey(check.columns, plan.header, row);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      continue;
    }
    const id = cell(plan.header, row, 'id') || 'a row';
    if (check.findings !== undefined && namedByFinding(id, check.findings)) continue;
    ids.push(id);
  }
  return ids;
}

/** Problems for checklist rows that match no planned row and are not a changed planned row. */
function addedRowProblems(remaining: ReadonlyMap<string, number>, changed: ReadonlySet<string>, check: PlanCheck): string[] {
  const idIndex = check.columns.indexOf('id');
  const problems: string[] = [];
  for (const [key, count] of remaining) {
    const id = (JSON.parse(key) as string[])[idIndex] ?? '';
    if (count > 0 && !changed.has(id)) {
      problems.push(`${id || 'a row'} is not in the planned checklist ${check.planFile}: remove the row, or restore the planned row it changed`);
    }
  }
  return problems;
}

/** Problems with the checklist's planned rows and columns, against the plan saved before implementation. */
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
  const check: PlanCheck = { planFile, columns, findings };
  const remaining = countRows(current, columns);
  const changedIds = changedRowIds(plan, remaining, check);
  const rule =
    findings === undefined
      ? 'implementation fills in only Code, Evidence, and Status'
      : 'only a row an audit finding names may change them';
  const problems = changedIds.map(
    id => `${id} was changed or removed: restore its planned cells (${columns.join(', ')}) as they are in ${planFile}; ${rule}`
  );
  if (findings === undefined) problems.push(...addedRowProblems(remaining, new Set(changedIds), check));
  return problems;
}
