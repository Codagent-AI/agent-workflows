// The files a run shares under `$ARTIFACTS_DIR`, by name, in one place. Agents write and read
// the same names in their prompts and .shared/*.md, and README.md lists them: rename one
// only everywhere at once.
import { existsSync, statSync } from 'node:fs';

export const ARTIFACTS = {
  blocked: 'implementation-blocked.md',
  assumptions: 'acceptance-assumptions.md',
  evidenceDir: 'evidence',
  plannedChecklist: 'planned-checklist.md',
  evidenceProblems: 'evidence-problems.txt',
  ciDir: 'ci',
  testerScratch: '.archon/scratch/acceptance-test',
  roundStatus: 'acceptance-round-status.txt',
  testedRevision: 'acceptance-tested-revision.txt',
  explorationLog: 'exploration-log.md',
  handoff: 'acceptance-handoff.md',
  testerHandoff: 'acceptance-handoff-tester.md',
  preparationStatus: 'acceptance-preparation-status.txt',
  retestReason: 'acceptance-retest-reason.txt',
  findings: 'acceptance-findings.md',
} as const;

/** A regular file with content. */
export const nonEmptyFile = (path: string): boolean =>
  existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
