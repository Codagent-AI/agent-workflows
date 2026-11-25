Re-review the $INPUTS.place cycle in this reviewer session. Inspect only and change no file, commit, branch or worktree state. Do not run tests or Agent Validator.

Pending findings and actions:
$INPUTS.findings

Confirm or reject each fixed finding; accept each declined/replied finding or contest it with your reason. A decline can be contested once; disagreement after the fixer's reply becomes disputed. Do not act on closed, disputed or handed-off findings. Look for new defects of any severity only in the changes from $INPUTS.start to $INPUTS.end, excluding `$INPUTS.change_dir/`; do not look for new defects in previously reviewed code. Apply the same quality, security and error-handling instructions as the first review, without repeating the definition/checklist audit or reviewing style.

Return JSON only: {"verdicts":[{"id":"REVIEW-1","verdict":"confirmed|rejected|accepted|contested","reason":"..."}],"findings":[{"title":"...","file":"...","line":0,"severity":"high|medium|low","category":"quality|security|error-handling","problem":"...","fix":"..."}]}. Use only schema enum values. Empty arrays mean no verdicts or new defects; line 0 means no line.
