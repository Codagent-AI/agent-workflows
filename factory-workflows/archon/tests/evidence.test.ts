import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { checkEvidence, evidenceRows, manualTestIds } from '../.archon/workflows/codagent/.shared/lib/evidence.ts';
import { planProblems, namedByFinding } from '../.archon/workflows/codagent/.shared/lib/checklist-plan.ts';
import { rawCells } from '../.archon/workflows/codagent/.shared/lib/checklist.ts';
import { type Sandbox, createSandbox } from './helpers.ts';

let box: Sandbox;
beforeEach(() => {
  box = createSandbox();
});
afterEach(() => box.dispose());

const HEADER = '| ID | Behavior | How to verify | Evidence | Status |\n|----|----|----|----|----|\n';
const PLAN_HEADER = '| ID | Behavior | How to verify |\n|----|----|----|\n';

describe('evidenceRows', () => {
  test('reads id, status, cited files and whether the evidence has text', () => {
    const rows = evidenceRows(`${HEADER}| L-1 | x | y | Ran it: \`export.log\`, pass | **Verified** |\n| I-2 | x | y | | Not  Verified |\n`);
    expect(rows).toEqual([
      { id: 'L-1', status: 'verified', cited: ['export.log'], hasText: true },
      { id: 'I-2', status: 'not verified', cited: [], hasText: false },
    ]);
  });

  test('returns undefined without Status and Evidence columns', () => {
    expect(evidenceRows('| ID | Behavior |\n|--|--|\n| L-1 | x |\n')).toBeUndefined();
  });

  test('drops cited paths that climb out of the evidence directory', () => {
    const rows = evidenceRows(`${HEADER}| L-1 | x | y | \`../checklist.md\` \`a/../b\` \`ok.log\` | verified |\n`);
    expect(rows?.[0].cited).toEqual(['ok.log']);
  });

  test('numbers rows that have no ID', () => {
    const rows = evidenceRows('| Evidence | Status |\n|--|--|\n| a | open |\n');
    expect(rows?.[0].id).toBe('row 1');
  });
});

describe('manualTestIds and namedByFinding', () => {
  test('manualTestIds lists each AT or HT id once, sorted', () => {
    expect(manualTestIds('AT-003 and HT-1, AT-003 again; XAT-9 and NAT-2-1 are not ids')).toEqual(['AT-003', 'HT-1']);
  });

  test('a finding names a row by any of its ids', () => {
    expect(namedByFinding('L-1, I-1', '1. I-1: the e2e test never exports')).toBe(true);
  });

  test('an id is not named by a longer or prefixed id', () => {
    expect(namedByFinding('L-1', 'No findings. L-10 and XL-1 are fine.')).toBe(false);
  });

  test('a row without an id-shaped cell is named by its text', () => {
    expect(namedByFinding('new', 'the new row is wrong')).toBe(true);
    expect(namedByFinding('', 'anything')).toBe(false);
  });
});

describe('checkEvidence (check-evidence.sh)', () => {
  const evidenceDir = (): string => box.path('output/evidence');
  const checklistFile = (): string => box.path('checklist.md');
  const planFile = (): string => box.path('output/planned-checklist.md');
  const problemsFile = (): string => box.path('output/problems.txt');

  /** The checklist as it was planned: the same rows without Evidence and Status. */
  function planFrom(checklist: string): string {
    const isTable = (line: string): boolean => line.trimStart().startsWith('|');
    const lines = checklist.split('\n');
    const start = lines.findIndex(line => {
      const names = isTable(line) ? rawCells(line).map(name => name.toLowerCase()) : [];
      return names.includes('status') && names.includes('evidence');
    });
    if (start < 0) return '\n';
    const table: string[] = [];
    for (const line of lines.slice(start)) {
      if (!isTable(line)) break;
      table.push(line);
    }
    const keep = rawCells(table[0]).flatMap((name, index) =>
      ['evidence', 'status'].includes(name.toLowerCase()) ? [] : [index]
    );
    const out = table.map(line => {
      if (/^[ \t]*\|[ \t:|-]*$/.test(line)) return `|${keep.map(() => '----').join('|')}|`;
      const row = rawCells(line);
      return `| ${keep.map(index => (row[index] ?? '').replaceAll('|', '\\|')).join(' | ')} |`;
    });
    return `${out.join('\n')}\n`;
  }

  interface Setup {
    checklist?: string;
    evidence?: Record<string, string>;
    /** The planned checklist; derived from the checklist when omitted. */
    plan?: string;
    findings?: string;
  }
  function check({ checklist, evidence = {}, plan, findings }: Setup) {
    box.write('output/evidence/.keep', '');
    for (const [name, content] of Object.entries(evidence)) box.write(`output/evidence/${name}`, content);
    if (checklist !== undefined) {
      const text = checklist.replaceAll('{{evidence}}', evidenceDir());
      box.write('checklist.md', text);
      box.write('output/planned-checklist.md', plan ?? planFrom(text));
    } else if (plan !== undefined) {
      box.write('output/planned-checklist.md', plan);
    }
    return checkEvidence({
      checklistFile: checklistFile(),
      evidenceDir: `${evidenceDir()}/`,
      problemsFile: problemsFile(),
      planFile: planFile(),
      findings,
    });
  }
  const passes = (setup: Setup): void => {
    const result = check(setup);
    expect(result.problems).toBe('');
    expect(result.ok).toBe(true);
  };
  const failsWith = (setup: Setup, ...wants: string[]): void => {
    const result = check(setup);
    expect(result.ok).toBe(false);
    for (const want of wants) expect(result.problems).toContain(want);
  };

  test('a complete record passes', () => {
    passes({
      checklist: `# Checklist\n\n${HEADER}| L-1 | Export works | e2e | Ran it: \`export.log\`, pass | **Verified** |\n| I-2 | Rejects bad input | unit | Fails: empty input accepted | failed |\n| I-3 | Prints on paper | manual | No printer in the sandbox | Not Verified |\n\nNotes after the table.\n`,
      evidence: { 'export.log': 'PASS\n' },
    });
  });

  test('an absolute path inside the evidence directory counts', () => {
    passes({ checklist: `${HEADER}| L-1 | Export works | e2e | \`{{evidence}}/export.log\` | verified |\n`, evidence: { 'export.log': 'PASS\n' } });
  });

  test('an escaped pipe stays inside its cell', () => {
    passes({ checklist: `${HEADER}| L-1 | Reads a \\| b | e2e | \`export.log\` | verified |\n`, evidence: { 'export.log': 'PASS\n' } });
  });

  test('a glob is not expanded against the working directory', () => {
    failsWith(
      { checklist: `${HEADER}| L-1 | Export works | e2e | \`*\` | verified |\n`, evidence: { 'checklist.md': 'not evidence\n' } },
      'L-1 is verified but cites no non-empty file'
    );
  });

  test('a cited path may contain spaces', () => {
    passes({
      checklist: `${HEADER}| L-1 | Export works | e2e | \`browser journey.log\` | verified |\n| L-2 | Import works | e2e | \`{{evidence}}/browser journey.log\` | verified |\n`,
      evidence: { 'browser journey.log': 'PASS\n' },
    });
  });

  test('an open row fails', () => {
    failsWith({ checklist: `${HEADER}| L-1 | Export works | e2e | | open |\n` }, "L-1 has status 'open'");
  });

  test('a cited acceptance or human-only test fails', () => {
    failsWith(
      {
        checklist: `${HEADER}| L-1 | Export works | AT-003 | \`export.log\` | verified |\n| L-2 | Prints | HT-1 | Needs a printer | not verified |\n`,
        evidence: { 'export.log': 'PASS\n' },
      },
      'cites manual tests, which are not checklist checks: AT-003, HT-1'
    );
  });

  test('a verified row without an evidence file fails', () => {
    failsWith(
      { checklist: `${HEADER}| L-1 | Export works | e2e | Ran \`npm test\`, see \`missing.log\` | verified |\n` },
      'L-1 is verified but cites no non-empty file'
    );
  });

  test('an empty evidence file does not count', () => {
    failsWith(
      { checklist: `${HEADER}| L-1 | Export works | e2e | \`export.log\` | verified |\n`, evidence: { 'export.log': '' } },
      'L-1 is verified but cites no non-empty file'
    );
  });

  test('paths outside the evidence directory do not count', () => {
    failsWith(
      { checklist: `${HEADER}| L-1 | Export works | e2e | \`../checklist.md\` and \`/etc/hosts\` | verified |\n` },
      'L-1 is verified but cites no non-empty file'
    );
  });

  test('a failed or unverified row must say why', () => {
    failsWith(
      { checklist: `${HEADER}| L-1 | Export works | e2e | | failed |\n| L-2 | Import works | e2e |  | not verified |\n` },
      'L-1 is failed but its Evidence cell does not say why',
      'L-2 is not verified but its Evidence cell does not say why'
    );
  });

  test('a list without Status and Evidence columns fails', () => {
    failsWith(
      { checklist: '| ID | Behavior |\n|----|----|\n| L-1 | Export works |\n', plan: PLAN_HEADER },
      'no Markdown table with Status and Evidence columns'
    );
  });

  test('a table without rows fails', () => {
    failsWith({ checklist: HEADER }, 'the checklist table has no rows');
  });

  test('filled-in planned rows match the plan, including repeated rows', () => {
    passes({
      plan: `${PLAN_HEADER}| L-1 | Export works | e2e |\n| L-1 | Export  works | e2e |\n`,
      checklist: `${HEADER}| L-1 | Export works | e2e | \`export.log\` | verified |\n| L-1 | Export works | e2e | \`export.log\` | verified |\n`,
      evidence: { 'export.log': 'PASS\n' },
    });
  });

  test('an annotated ID column header still matches the plan', () => {
    passes({
      plan: '| ID (merged; original IDs) | Behavior | How to verify |\n|----|----|----|\n| M-1 (L-1, I-1) | Export works | e2e |\n',
      checklist:
        '| ID (merged; original IDs) | Behavior | How to verify | Evidence | Status |\n|----|----|----|----|----|\n| M-1 (L-1, I-1) | Export works | e2e | `export.log` | verified |\n',
      evidence: { 'export.log': 'PASS\n' },
    });
  });

  test('an earlier ID table without Status and Evidence is not compared with the plan', () => {
    passes({
      plan: `${PLAN_HEADER}| L-1 | Export works | e2e |\n`,
      checklist: `| ID | Source |\n|----|----|\n| L-1 | spec |\n\n${HEADER}| L-1 | Export works | e2e | \`export.log\` | verified |\n`,
      evidence: { 'export.log': 'PASS\n' },
    });
  });

  test('a changed, removed, or added row fails before the audit', () => {
    failsWith(
      {
        plan: `${PLAN_HEADER}| L-1 | Export works | e2e |\n| L-2 | Import works | unit |\n`,
        checklist: `${HEADER}| L-1 | Export works | build | \`export.log\` | verified |\n| I-9 | Extra | unit | \`export.log\` | verified |\n`,
        evidence: { 'export.log': 'PASS\n' },
      },
      'L-1 was changed or removed',
      'L-2 was changed or removed',
      'I-9 is not in the planned checklist'
    );
  });

  test('a lost planned column fails', () => {
    failsWith(
      {
        plan: '| ID | Behavior | Spec reference | How to verify |\n|----|----|----|----|\n| L-1 | Export works | spec | e2e |\n',
        checklist: `${HEADER}| L-1 | Export works | e2e | \`export.log\` | verified |\n`,
        evidence: { 'export.log': 'PASS\n' },
      },
      'lost the planned column(s) spec reference'
    );
  });

  test('after the audit, named rows may change and rows may be added', () => {
    passes({
      plan: `${PLAN_HEADER}| L-1, I-1 | Export works | e2e |\n`,
      findings: '1. I-1: the e2e test never exports',
      checklist: `${HEADER}| L-1, I-1 | Export works | stronger e2e | \`export.log\` | verified |\n| new | Cleans up | unit | \`export.log\` | verified |\n`,
      evidence: { 'export.log': 'PASS\n' },
    });
  });

  test('after the audit, an unnamed row still may not change', () => {
    failsWith(
      {
        plan: `${PLAN_HEADER}| L-1 | Export works | e2e |\n`,
        findings: 'No findings. L-10 and XL-1 are fine.',
        checklist: `${HEADER}| L-1 | Export works | build | \`export.log\` | verified |\n`,
        evidence: { 'export.log': 'PASS\n' },
      },
      'L-1 was changed or removed',
      'only a row an audit finding names may change them'
    );
  });

  test('a missing list fails', () => {
    failsWith({}, 'is missing or empty');
  });

  test('an unreadable plan fails', () => {
    box.write('checklist.md', `${HEADER}| L-1 | x | y | \`export.log\` | verified |\n`);
    box.write('output/evidence/export.log', 'PASS\n');
    const result = checkEvidence({
      checklistFile: checklistFile(),
      evidenceDir: evidenceDir(),
      problemsFile: problemsFile(),
      planFile: planFile(),
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('cannot read');
  });

  test('the problems file records each failure and is removed on success', () => {
    const input = { checklistFile: checklistFile(), evidenceDir: evidenceDir(), problemsFile: problemsFile(), planFile: planFile() };
    box.write('output/evidence/.keep', '');
    box.write('output/planned-checklist.md', `${PLAN_HEADER}| L-1 | Export works | e2e |\n`);

    expect(checkEvidence(input).ok).toBe(false);
    expect(box.read('output/problems.txt')).toContain('is missing or empty');

    box.write('checklist.md', `${HEADER}| L-1 | Export works | e2e | \`export.log\` | verified |\n`);
    expect(checkEvidence(input).ok).toBe(false);
    expect(box.read('output/problems.txt')).toContain('L-1 is verified but cites no non-empty file');
    expect(box.read('output/problems.txt')).toStartWith('- ');

    box.write('output/evidence/export.log', 'PASS\n');
    expect(checkEvidence(input).ok).toBe(true);
    expect(box.exists('output/problems.txt')).toBe(false);
  });

  test('planProblems reports an unreadable checklist', () => {
    box.write('output/planned-checklist.md', `${PLAN_HEADER}| L-1 | x | y |\n`);
    expect(planProblems(box.path('nope.md'), planFile(), undefined)[0]).toContain('cannot read');
  });
});
