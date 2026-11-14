import type { Action, Defect, Verdict } from './review.ts';
import { result } from './review-files.ts';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const fields = (value: RecordValue, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const strings = (value: RecordValue, keys: string[]): boolean => keys.every(key => typeof value[key] === 'string');
function defect(value: unknown): boolean {
  if (!object(value)) return false;
  return fields(value, ['title', 'file', 'line', 'severity', 'category', 'problem', 'fix']) &&
    strings(value, ['title', 'file', 'problem', 'fix']) && Number.isInteger(value.line) &&
    ['high', 'medium', 'low'].includes(String(value.severity)) &&
    ['quality', 'security', 'error-handling'].includes(String(value.category));
}
function list(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}
function action(value: unknown): boolean {
  return object(value) && fields(value, ['id', 'action', 'note']) && strings(value, ['id', 'note']) &&
    ['fixed', 'declined', 'replied'].includes(String(value.action));
}
function verdict(value: unknown): boolean {
  return object(value) && fields(value, ['id', 'verdict', 'reason']) && strings(value, ['id', 'reason']) &&
    ['confirmed', 'rejected', 'accepted', 'contested'].includes(String(value.verdict));
}
function shape(text: string | undefined, name: string, valid: (value: RecordValue) => boolean): RecordValue {
  const parsed = result<RecordValue>(text, name);
  if (!valid(parsed)) throw new Error(`${name}: invalid findings shape; see output under artifacts/nodes/${name}.md`);
  return parsed;
}
export function reviewOutput(text: string | undefined, name: string): { findings: Defect[] } {
  return shape(text, name, v => fields(v, ['findings']) && list(v.findings, defect)) as { findings: Defect[] };
}
export function fixerOutput(text: string | undefined, name: string): { blocked: boolean; reason: string; actions: Action[] } {
  return shape(text, name, v => fields(v, ['blocked', 'reason', 'actions']) && typeof v.blocked === 'boolean' &&
    typeof v.reason === 'string' && list(v.actions, action)) as { blocked: boolean; reason: string; actions: Action[] };
}
export function reReviewOutput(text: string | undefined, name: string): { verdicts: Verdict[]; findings: Defect[] } {
  return shape(text, name, v => fields(v, ['verdicts', 'findings']) && list(v.verdicts, verdict) &&
    list(v.findings, defect)) as { verdicts: Verdict[]; findings: Defect[] };
}
