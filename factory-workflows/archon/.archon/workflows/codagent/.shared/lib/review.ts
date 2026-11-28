// Finding IDs, transitions and bounded debate are owned by the workflow, never by agents.
export type Place = 'before-pr' | 'acceptance' | 'feedback' | 'finalize';
export type FindingState = 'open' | 'fixed' | 'declined' | 'contested' | 'replied' | 'closed' | 'disputed';
export interface Defect {
  title: string;
  file: string;
  line: number;
  severity: 'high' | 'medium' | 'low';
  category: 'quality' | 'security' | 'error-handling';
  problem: string;
  fix: string;
}
export interface Action { id: string; action: 'fixed' | 'declined' | 'replied'; note: string }
export interface Verdict { id: string; verdict: 'confirmed' | 'rejected' | 'accepted' | 'contested'; reason: string }
export interface History { round: number; actor: 'fixer' | 'reviewer'; action: string; note: string }
export interface Finding extends Defect {
  id: string;
  cycle: number;
  state: FindingState;
  contested: boolean;
  handed_off: boolean;
  accepted_decline: boolean;
  /** Set when the person asked for a handed-off finding to be fixed, so it is not a new finding of the round. */
  reopened?: boolean;
  history: History[];
}
export interface Cycle {
  place: Place;
  round: number;
  start: string;
  end: string;
  blocked: string;
  turn: number;
  /** Set when the reviewer ran, so a cycle without findings found no problems rather than skipped its review. */
  reviewed?: boolean;
}
export interface ReviewState {
  findings: Finding[];
  cycles: Cycle[];
  current: number;
  next_id: number;
  last_reviewed: string;
  ignored: (History & { cycle: number; id: string; reason: string })[];
}
export const emptyState = (): ReviewState => ({
  findings: [], cycles: [], current: -1, next_id: 1, last_reviewed: '', ignored: [],
});
export function currentCycle(state: ReviewState): Cycle {
  const cycle = state.cycles[state.current];
  if (!cycle) throw new Error('review has no prepared cycle');
  return cycle;
}
export function startCycle(state: ReviewState, cycle: Omit<Cycle, 'blocked' | 'turn'>): void {
  state.cycles.push({ ...cycle, blocked: '', turn: 0 });
  state.current = state.cycles.length - 1;
}
export const currentFindings = (state: ReviewState): Finding[] => state.findings.filter(f => f.cycle === state.current);
export const activeFindings = (state: ReviewState): Finding[] => currentFindings(state)
  .filter(f => !f.handed_off && f.state !== 'closed' && f.state !== 'disputed');
export const settled = (state: ReviewState): boolean => activeFindings(state).length === 0;
export const handedOff = (state: ReviewState): string => state.findings.filter(f => f.handed_off)
  .map(f => `${f.id}: ${f.title} (${f.file}:${String(f.line)})`).join('\n');
export const findingText = (state: ReviewState): string => activeFindings(state)
  .map(f => `${f.id} [${f.state}, ${f.severity}] ${f.title} (${f.file}:${String(f.line)})\n${f.problem}\nSuggested fix: ${f.fix}\n${f.history.map(h => `${h.actor} ${h.action}: ${h.note}`).join('\n')}`)
  .join('\n\n');
export function addFindings(state: ReviewState, defects: Defect[]): void {
  currentCycle(state);
  for (const defect of defects) {
    state.findings.push({ ...defect, id: `REVIEW-${String(state.next_id++)}`, cycle: state.current,
      state: 'open', contested: false, handed_off: false, accepted_decline: false, history: [] });
  }
}
function target(state: ReviewState, id: string): Finding | undefined {
  return currentFindings(state).find(f => f.id === id && !f.handed_off);
}
function rejectionReason(state: ReviewState, id: string): string {
  const finding = state.findings.find(entry => entry.id === id);
  if (!finding) return 'unknown finding ID';
  if (finding.handed_off) return 'finding was already handed off';
  if (finding.cycle !== state.current) return 'finding belongs to a different cycle';
  return `invalid action for finding state ${finding.state}`;
}
function ignore(state: ReviewState, submission: Action | Verdict): void {
  const fixer = 'action' in submission;
  state.ignored.push({ cycle: state.current, id: submission.id, round: currentCycle(state).turn,
    actor: fixer ? 'fixer' : 'reviewer', action: fixer ? submission.action : submission.verdict,
    note: fixer ? submission.note : submission.reason, reason: rejectionReason(state, submission.id) });
}
function fixerState(finding: Finding, action: Action['action']): FindingState | undefined {
  if (finding.state === 'open' && (action === 'fixed' || action === 'declined')) return action;
  if (finding.state === 'contested' && (action === 'fixed' || action === 'replied')) return action;
  return undefined;
}
export function applyActions(state: ReviewState, actions: Action[]): void {
  const cycle = currentCycle(state);
  cycle.turn += 1;
  for (const action of actions) {
    const finding = target(state, action.id);
    const next = finding && fixerState(finding, action.action);
    if (!(finding && next)) { ignore(state, action); continue; }
    finding.state = next;
    finding.history.push({ round: cycle.turn, actor: 'fixer', action: action.action, note: action.note });
  }
}
function reviewerState(finding: Finding, verdict: Verdict['verdict']): FindingState | undefined {
  const transitions: Partial<Record<FindingState, Partial<Record<Verdict['verdict'], FindingState>>>> = {
    fixed: { confirmed: 'closed', rejected: 'open' },
    declined: { accepted: 'closed', contested: finding.contested ? 'disputed' : 'contested' },
    replied: { accepted: 'closed', contested: 'disputed' },
  };
  return transitions[finding.state]?.[verdict];
}
export function applyVerdicts(state: ReviewState, verdicts: Verdict[]): void {
  const cycle = currentCycle(state);
  for (const verdict of verdicts) {
    const finding = target(state, verdict.id);
    const next = finding && reviewerState(finding, verdict.verdict);
    if (!(finding && next)) { ignore(state, verdict); continue; }
    finding.accepted_decline = verdict.verdict === 'accepted';
    finding.state = next;
    if (verdict.verdict === 'contested') finding.contested = true;
    finding.history.push({ round: cycle.turn, actor: 'reviewer', action: verdict.verdict, note: verdict.reason });
  }
}
const location = (f: Finding): string => `${f.file}:${String(f.line)}, ${f.severity} ${f.category}`;
function findingDetails(f: Finding): string {
  return `### ${f.id}: ${f.title} [${f.state}]\n\n${location(f)}\n\n${f.problem}\n\nSuggested fix: ${f.fix}\n${f.history.map(h => `- ${h.actor} ${h.action}: ${h.note}`).join('\n')}`;
}
export function renderResult(state: ReviewState): string {
  const current = currentCycle(state);
  const indices = state.cycles.map((c, i) => ({ c, i })).filter(({ c, i }) =>
    c.place === current.place && (current.place === 'before-pr' || i === state.current));
  const findings = state.findings.filter(f => indices.some(({ i }) => f.cycle === i));
  const visible = findings.filter(f => f.state !== 'closed' || f.accepted_decline);
  const ranges = indices.map(({ c }) => `${c.start}..${c.end}`).join('\n');
  const ignored = state.ignored.filter(a => indices.some(({ i }) => a.cycle === i))
    .map(a => `Ignored ${a.id}: ${a.actor} ${a.action} (${a.note}); ${a.reason}`).join('\n');
  const blocked = indices.filter(({ c }) => c.blocked).map(({ c }) => `Fixer blocked: ${c.blocked}`).join('\n');
  return `# Review ${current.place}\n\n${ranges}\n\n${visible.length === 0 ? 'No open findings.' : visible.map(findingDetails).join('\n\n')}\n${ignored}\n${blocked}\n`;
}
export function handoffSection(state: ReviewState, finding: Finding): string {
  const cycle = state.cycles[finding.cycle];
  if (!cycle) throw new Error(`missing cycle for ${finding.id}`);
  const place = cycle.place === 'before-pr' ? 'before the pull request' : `${cycle.place} round ${String(cycle.round)}`;
  const declined = finding.history.filter(h => h.action === 'declined' || h.action === 'replied')
    .map(h => h.note).join('; ');
  const ruling = declined ? `Declined to fix: ${declined}` : 'None: the finding was still open when the fix rounds stopped.';
  const accepted = finding.accepted_decline ? ' The reviewer accepted it.' : '';
  const history = finding.history.map(h => `${h.actor} ${h.action}: ${h.note}`).join('; ');
  // The problem is stated once, under What breaks if wrong; the other fields point at it.
  return `## Review finding ${finding.id}, ${place}: ${finding.title}\n\n- Question: Must this finding be fixed before the change is accepted? (${location(finding)})\n- Requirement: the ${finding.category} review instructions.\n- Step: ${place} review handoff.\n- Decision: ${ruling}${accepted}\n- Alternatives: fix or leave the finding open.\n- What breaks if wrong: ${finding.problem}\n- Rationale: suggested fix: ${finding.fix}; ${history}${cycle.blocked ? `; Fixer blocked: ${cycle.blocked}` : ''}. Result: review/${cycle.place}.md\n`;
}
export function handoff(state: ReviewState, ledger: string, decisions?: boolean): string {
  const selected = state.findings.filter(f => !f.handed_off && f.severity !== 'low' && (decisions === undefined || f.accepted_decline === decisions) &&
    (f.state !== 'closed' || f.accepted_decline));
  if (selected.length === 0) return ledger;
  const sections = selected.map(f => handoffSection(state, f)).join('\n');
  for (const finding of selected) finding.handed_off = true;
  return `${ledger.replace(/^No unresolved assumptions or context gaps\.\s*$/gm, '').trim()}\n\n${sections}`.trimStart();
}

export function reopenRequested(state: ReviewState, text: string): void {
  const requested = new Set(text.match(/\b(?:REVIEW-\d+|R\d+)\b/g) ?? []);
  for (const finding of state.findings) {
    if (!(requested.has(finding.id) && finding.handed_off)) continue;
    finding.cycle = state.current;
    finding.state = 'fixed';
    finding.handed_off = false;
    finding.accepted_decline = false;
    finding.reopened = true;
  }
}

function reviewOutcome(finding: Finding): string {
  if (finding.handed_off) return '. It is on this page.';
  return finding.state === 'closed' && !finding.accepted_decline ? ', and it was fixed.' : ', a minor problem left unfixed.';
}
/** What a review round's own code reviews found and what became of each finding, for the recap on that round's page. */
export function roundReview(state: ReviewState, round: number): string[] {
  const notes = state.cycles.flatMap((cycle, index) => {
    if (cycle.round !== round || !(cycle.place === 'feedback' || cycle.place === 'finalize')) return [];
    const found = state.findings.filter(finding => finding.cycle === index && !finding.reopened);
    if (found.length > 0) return found.map(finding => `Code review found “${finding.title}”${reviewOutcome(finding)}`);
    if (!cycle.reviewed) return [];
    return [cycle.place === 'finalize' ? 'Code review found no problems in a CI fix.' : "Code review found no problems in this round's changes."];
  });
  return [...new Set(notes)];
}
