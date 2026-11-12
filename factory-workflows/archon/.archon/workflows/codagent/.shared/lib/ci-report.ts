// The CI report the wait-ci node writes for the tester's handoff.
import type { Comment, Thread } from './ci-comments.ts';
import type { Check, CiResult } from './ci.ts';

const checkLine = (check: Check): string => `- **${check.name}** (${check.detail})`;
const threadLine = (thread: Thread): string =>
  `- **${thread.author}** on \`${thread.file}\` line ${String(thread.line ?? '?')}: ${thread.body}`;
const commentLine = (comment: Comment, kind = ''): string => `- **${comment.author}**${kind}: ${comment.body}`;

/** The report as Markdown, for the tester to read. */
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
      const log = result.failedLogs.find(entry => entry.name === check.name)?.log;
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
  section('Passing Checks', result.passedChecks.map(check => `- ${check.name} (${check.detail})`));
  section('Still Running', result.pendingChecks.map(check => `- ${check.name} (${check.detail})`));
  return `${lines.join('\n')}\n`;
}
