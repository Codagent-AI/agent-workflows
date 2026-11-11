// The CI report in the wait-ci skill's output format.
import type { Comment, Thread } from './ci-comments.ts';
import { type Check, type CiResult, failedRunIds } from './ci.ts';

const checkLine = (check: Check): string =>
  `- **${check.name}** (${check.state})${check.link ? `\n  Link: ${check.link}` : ''}`;
const threadLine = (thread: Thread): string =>
  `- **${thread.author}** on \`${thread.file}\` line ${String(thread.line ?? '?')}: ${thread.body}`;
const commentLine = (comment: Comment, kind = ''): string => `- **${comment.author}**${kind}: ${comment.body}`;

/** The report in the wait-ci skill's output format. */
export function renderReport(result: CiResult): string {
  const lines = [`## CI Status: ${result.status}`, '', `**PR:** ${result.prUrl || 'unknown'}`];
  lines.push(`**Head:** ${result.headSha || 'unknown'}${result.headMoved ? ' (local HEAD or the PR head has since moved)' : ''}`);
  lines.push(`**Elapsed:** ~${String(result.elapsedMinutes)} minutes`);
  if (result.error) lines.push('', `**Error:** ${result.error}`);
  if (!result.hadChecks && result.status !== 'error') lines.push('', 'No CI checks are configured or reported for this pull request.');
  const section = (title: string, items: string[]): void => {
    if (items.length > 0) lines.push('', `### ${title}`, ...items);
  };
  section(
    'Failed Checks',
    result.failedChecks.map(check => {
      const runId = failedRunIds([check])[0];
      const log = result.failedLogs.find(entry => entry.runId === runId)?.log;
      return log ? `${checkLine(check)}\n  Logs:\n  \`\`\`\n${log}\n  \`\`\`` : checkLine(check);
    })
  );
  section('Merge Conflicts', result.conflictingFiles.map(file => `- \`${file}\``));
  section('Blocking Reviews', result.blockingReviews.map(review => `- **${review.login}**: ${review.body}`));
  const comments = result.comments;
  if (comments) {
    section('PR Comments', [
      ...comments.unresolvedThreads.map(threadLine),
      ...comments.issueComments.map(comment => commentLine(comment, ' (issue comment)')),
    ]);
    section('Deferred Threads', comments.deferredThreads.map(threadLine));
    section('Informational Bot Comments', comments.informationalBotComments.map(comment => commentLine(comment)));
  }
  section('Passing Checks', result.passedChecks.map(check => `- ${check.name} (${check.state})`));
  section('Still Running', result.pendingChecks.map(check => `- ${check.name} (${check.state})`));
  return `${lines.join('\n')}\n`;
}
