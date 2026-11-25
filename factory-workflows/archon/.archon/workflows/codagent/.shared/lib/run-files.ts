// Small filesystem boundary shared by the completion and finish scripts.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function readText(file: string): string { return existsSync(file) ? readFileSync(file, 'utf8') : ''; }
export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text);
}
export function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
}
export function writeJson(file: string, value: unknown): void { writeText(file, `${JSON.stringify(value, null, 2)}\n`); }
export function appendLine(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(value)}\n`);
}
export interface StepResult { round?: number; ok: boolean; problems: string; remaining: string; }
export function recordStep(dir: string, step: string, result: StepResult): void {
  const file = join(dir, 'step-results.json');
  writeJson(file, { ...readJson<Record<string, StepResult>>(file, {}), [step]: result });
}
