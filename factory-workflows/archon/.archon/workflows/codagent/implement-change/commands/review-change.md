You are running autonomously with no human in the loop. Do not stop to ask for confirmation or clarification. Do not say things like "let me know", "ready when you are", or "shall I proceed". Make decisions and complete the entire task.

# Code Quality Review

Review the changed code for defects that could cause bugs, performance problems, or silent failures in production.

## Reasoning Format

For each issue you find, structure your analysis as:

1. **Precondition** — what state or input triggers the problem
2. **Execution trace** — walk through the changed code showing how the precondition leads to failure
3. **Failure** — the concrete consequence (wrong result, crash, data loss, resource leak, etc.)

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Logic errors** — off-by-one, null/undefined access, race conditions, unhandled edge cases, incorrect boolean logic, wrong operator precedence
- **Performance** — algorithmic complexity issues, N+1 queries, unnecessary blocking operations, unbounded allocations, memory leaks
- **Resource leaks** — unclosed file handles, database connections, sockets, event listeners not removed, missing cleanup in error paths
- **Type safety** — types that permit invalid states, missing boundary validation at system edges, unsafe casts or assertions that bypass type guarantees

## Do NOT Report

- Style, formatting, or naming preferences
- Missing documentation, comments, or type annotations
- Code not changed in this diff

## Guidelines

- **Threshold**: could this cause a bug, performance issue, or silent failure in production? When uncertain, report it.
- Explain **why** each issue matters with a concrete failure scenario
- Provide a **concrete fix** with corrected code

---

# Security Review

Review the changed code for security vulnerabilities that could be exploited or expose sensitive data.

## Reasoning Format

For each issue you find, structure your analysis as a taint-flow trace:

1. **Source** — identify the untrusted input (user input, HTTP request, query parameter, environment variable, external API response, file contents, deserialized data)
2. **Flow** — trace the data path from source through the changed code to where it is consumed
3. **Sink** — show where the untrusted data reaches a dangerous operation without adequate sanitization or validation, and describe the exploit scenario

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Injection** — SQL injection, command injection, path traversal, XSS, template injection, LDAP injection, header injection
- **Authentication and authorization** — missing or bypassable auth checks, privilege escalation, insecure session management, broken access control
- **Secrets and credential exposure** — hardcoded secrets, credentials in logs, tokens in URLs, sensitive data in error messages, unprotected API keys
- **Input validation** — missing or insufficient validation of user-controlled data, type confusion, integer overflow, buffer issues
- **Unsafe deserialization** — deserializing untrusted data without validation, prototype pollution, object injection
- **SSRF** — server-side request forgery through user-controlled URLs or hostnames, DNS rebinding

## Do NOT Report

- Style preferences for security patterns (e.g., preferring one crypto library over another when both are safe)
- Code not changed in this diff

## Guidelines

- **Threshold**: could an attacker exploit this with a realistic attack vector? Only report issues where you can describe a concrete exploit scenario using inputs the attacker actually controls. Do not report theoretical vulnerabilities that require multiple simultaneous faults or access the attacker would not plausibly have.
- Explain **why** each issue matters with a concrete exploit scenario
- Provide a **concrete fix** with corrected code

---

# Error Handling Review

Review the changed code for error-handling gaps that could cause silent failures or make debugging harder in production.

## Reasoning Format

For each issue you find, structure your analysis as a counterfactual:

1. **What can fail** — identify the operation that can fail (network call, file I/O, parse operation, database query, external service call, user input processing)
2. **What happens when it fails** — trace the error path through the changed code showing how the failure propagates (or doesn't)
3. **The gap** — show what is lost or hidden (swallowed error, lost stack trace, missing log entry, misleading fallback value, silent retry without observability)

This format structures your thinking — it is not a gate. If you cannot complete a step with certainty, still report the issue and note what is uncertain.

## Categories

- **Swallowed errors** — empty catch blocks on operations whose failure changes program correctness, ignored promise rejections on business-logic paths, callbacks that discard error arguments when the caller needs the result
- **Lost error context** — re-throwing without cause chain when the original error is needed to diagnose the failure, generic error messages that discard the original error on non-trivial operations
- **Missing observability** — error paths with no logging or metrics on operations that require human intervention to recover from
- **Unsafe fallbacks** — fallback values that cause the caller to take a materially wrong action (e.g., proceeding with an empty config as if it were valid, treating a failed auth check as "allowed"). Fallback values that merely degrade gracefully (e.g., returning empty results when a non-critical query fails) are acceptable and should not be reported

## Do NOT Report

- Error handling in test code
- Logging style preferences (e.g., log format, log level choice)
- Code not changed in this diff
- Swallowed errors in cleanup or teardown operations (stream `.cancel()`, connection `.close()`, response body drain) where the primary operation already succeeded or failed independently
- Catch blocks that log `error.message` without the full stack when the message alone identifies the failure location (e.g., includes function name and status code)
- Generic error messages returned to external API callers — this is often intentional for security
- Missing error handling on operations where a failure is already surfaced by a higher-level mechanism (e.g., a transaction rollback, a retry at a higher layer, a health check that would catch the problem)

## Guidelines

- **Threshold**: could this cause data loss, incorrect business logic, or an outage that requires human intervention to diagnose? Only report issues where the failure path is reachable in normal production traffic and the impact is not already mitigated by surrounding code.
- Explain **why** each issue matters with a concrete failure scenario
- Provide a **concrete fix** with corrected code

## Review task

Review only the changed code in $INPUTS.files for $INPUTS.place. The range starts at $INPUTS.start and ends at $INPUTS.end. For acceptance's first review, diff the start revision against the working tree, including tracked uncommitted changes; otherwise diff start..end. Exclude `$INPUTS.change_dir/` throughout. Do not repeat the crosscheck audit against the definition or checklist, and do not review style. Inspect only: change no file, commit, branch or worktree state. Do not run tests or Agent Validator.

Already handed-off findings (title, file, line):
$INPUTS.handed_off
Do not report them again unless the new changes make them worse.

Return JSON only: {"verdicts":[],"findings":[{"title":"...","file":"...","line":0,"severity":"high|medium|low","category":"quality|security|error-handling","problem":"...","fix":"..."}]}. Leave `verdicts` empty; it is for re-reviews. Use integer 0 when there is no line, an empty list when there is no defect, and only the enum values named by the output schema. This JSON output replaces any format the review prompts above give. Do not assign IDs or states; the workflow owns them.
