#!/usr/bin/env python3
"""Scenario dry runs for codagent-implement-change.

Each scenario runs `archon workflow run --dry-run --json` with stubs for every
node, overrides the outputs it is about, and asserts which nodes ran, which
were skipped, and how the run ended. Nodes a scenario lists under `execute`
are left unstubbed and run for real (--exec-code), so the shell wrappers and
Runner scripts are exercised, not only the routing.

Dry runs read the pack from the target checkout, so the script builds a
scratch git repository with `.archon` linked to this pack's `.archon`.

It also checks scripts/codex-launcher.sh (scenario name `codex-launcher`).

Usage, from factory-workflows/archon/: python3 tests/scenarios.py [scenario-name ...]
Needs archon (0.14), git, jq and python3 on PATH. Makes no model calls.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WORKFLOW = "codagent-implement-change"
INPUTS = {
    "change_name": "create-and-scene",
    "change_dir": "openspec/changes/create-and-scene",
    "change_label": "OpenSpec change",
    "change_kind": "openspec",
    "artifact_validation_instruction": "Validate changed artifacts.",
}
V = "verify-change__"
CD = "check-definition__"

# Agent Runner (internal/exec/agent.go) puts this before the prompt of every
# agent invocation that starts a session, and not before a resumed one.
AUTONOMY_PREAMBLE = (
    "You are running autonomously with no human in the loop. "
    "Do not stop to ask for confirmation or clarification. "
    "Do not say things like \"let me know\", \"ready when you are\", or \"shall I proceed\". "
    "Make decisions and complete the entire task.\n\n"
)
# The agent nodes with `context: fresh`. Every other agent node resumes a session.
FRESH_AGENT_NODES = {
    "implementor-checklist", "audit", CD + "repair-definition-1", "commit-definition__commit-definition-repair",
    V + "verify-assumptions-handoff-repair", V + "verify-clean-for-pr-repair", V + "open-draft-pr",
    V + "acceptance-test-0",
}


def check(status, **extra):
    value = {"status": status, "stdout": "", "output": f"check {status}", "evidence": f"<repair-evidence>{status}</repair-evidence>"}
    value.update(extra)
    return value


ALL_REPAIRS = [
    "verify-checklist-repair", "complete-evidence-1", "complete-evidence-2",
    "complete-evidence-after-review-1", "complete-evidence-after-review-2",
    "check-clean-repair", "verify-implementation-commits-repair",
    CD + "repair-definition-1", "commit-definition__commit-definition-repair",
    V + "verify-assumptions-handoff-repair", V + "verify-clean-for-pr-repair", V + "open-draft-pr-2",
    V + "acceptance-push-0-repair", V + "verify-acceptance-pr-0-repair", V + "write-acceptance-status-2",
]

SCENARIOS = [
    {
        "name": "happy-path",
        "stubs": {V + "acceptance-gate-0": {"ready": True}},
        "ran": ["implementor-checklist", "verify-checklist", "implement", "check-evidence", "audit", "resolve-findings",
                "recheck-evidence", "check-clean", "session-report", "save-session-report", V + "open-draft-pr",
                V + "acceptance-test-0", V + "acceptance-gate-0", V + "write-acceptance-status",
                V + "verify-acceptance-handoff", V + "acceptance-handoff-verified", CD + "definition-checked"],
        "skipped": ALL_REPAIRS + ["verify-checklist-2", "check-evidence-2", "check-evidence-3", V + "acceptance-fix-0",
                                  V + "acceptance-test-1", V + "acceptance-test-2", V + "verify-draft-pr-2"],
        "outcome": "completed",
    },
    {
        "name": "max1-repair-recovers",
        "stubs": {"verify-checklist": check("FAIL"), V + "acceptance-gate-0": {"ready": True}},
        "ran": ["verify-checklist-repair", "verify-checklist-repair-blocked", "verify-checklist-2",
                "record-implementation-start", "implement"],
        "outcome": "completed",
    },
    {
        # The fresh-session repairs no other scenario reaches.
        "name": "fresh-session-repairs-recover",
        "stubs": {"commit-definition__commit-definition": check("FAIL"),
                  V + "verify-assumptions-handoff": check("FAIL"), V + "verify-clean-for-pr": check("FAIL"),
                  V + "acceptance-gate-0": {"ready": True}},
        "ran": ["commit-definition__commit-definition-repair", "commit-definition__commit-definition-2",
                V + "verify-assumptions-handoff-repair", V + "verify-assumptions-handoff-2",
                V + "verify-clean-for-pr-repair", V + "verify-clean-for-pr-2", V + "open-draft-pr"],
        "outcome": "completed",
    },
    {
        "name": "max2-repair-recovers-first",
        "stubs": {"check-evidence": check("FAIL"), "check-evidence-2": check("PASS"), V + "acceptance-gate-0": {"ready": True}},
        "ran": ["complete-evidence-1", "check-evidence-not-blocked-1", "check-evidence-2", "audit"],
        "skipped": ["complete-evidence-2", "check-evidence-3"],
        "outcome": "completed",
    },
    {
        "name": "max2-repair-recovers-second",
        "stubs": {"check-evidence": check("FAIL"), "check-evidence-2": check("FAIL"), V + "acceptance-gate-0": {"ready": True}},
        "ran": ["complete-evidence-1", "complete-evidence-2", "check-evidence-3", "audit"],
        "outcome": "completed",
    },
    {
        "name": "max2-repair-exhausted",
        "stubs": {"check-evidence": check("FAIL"), "check-evidence-2": check("FAIL")},
        "execute": ["check-evidence-3"],
        "failed": "check-evidence-3",
        "skipped": ["audit", "session-report"],
        "outcome": "failed",
    },
    {
        "name": "recheck-exhausted",
        "stubs": {"recheck-evidence": check("FAIL"), "recheck-evidence-2": check("FAIL")},
        "execute": ["recheck-evidence-3"],
        "ran": ["complete-evidence-after-review-1", "complete-evidence-after-review-2"],
        "failed": "recheck-evidence-3",
        "skipped": ["check-clean", "session-report"],
        "outcome": "failed",
    },
    {
        "name": "repair-blocked",
        "stubs": {"verify-checklist": check("FAIL"), "verify-checklist-repair": "Cannot fix this.\n\nREPAIR_BLOCKED\n"},
        "execute": ["verify-checklist-repair-blocked"],
        "failed": "verify-checklist-repair-blocked",
        "skipped": ["verify-checklist-2", "implement"],
        "outcome": "failed",
    },
    {
        "name": "repair-not-blocked-passes-blocked-check",
        "stubs": {"verify-checklist": check("FAIL"), "verify-checklist-repair": "Fixed the table; REPAIR_BLOCKED is not my last line.\nDone.",
                  V + "acceptance-gate-0": {"ready": True}},
        "execute": ["verify-checklist-repair-blocked"],
        "ran": ["verify-checklist-repair-blocked", "verify-checklist-2", "implement"],
        "outcome": "completed",
    },
    {
        "name": "blocked-record-stops-run",
        "blocked_record": True,
        "execute": ["check-implementation-not-blocked"],
        "failed": "check-implementation-not-blocked",
        "skipped": ["check-evidence", "audit"],
        "outcome": "failed",
    },
    {
        "name": "check-wrapper-reports-failure",
        "execute": ["verify-checklist"],
        "stubs": {V + "acceptance-gate-0": {"ready": True}},
        "ran": ["verify-checklist-repair", "verify-checklist-2"],
        "output_contains": {"verify-checklist": ["\"status\":\"FAIL\"", "is missing or empty", "Guarded agent response"]},
        "outcome": "completed",
    },
    {
        "name": "definition-repaired-second-try",
        "stubs": {CD + "validate-definition-1": check("FAIL"), CD + "validate-definition-2": check("PASS"),
                  V + "acceptance-gate-0": {"ready": True}},
        "ran": [CD + "repair-definition-1", CD + "validate-definition-2", CD + "definition-checked"],
        "skipped": [CD + "repair-definition-2", CD + "validate-definition-3", CD + "verify-definition"],
        "outcome": "completed",
    },
    {
        "name": "definition-repairs-exhausted",
        "stubs": {CD + "validate-definition-1": check("FAIL"), CD + "validate-definition-2": check("FAIL"),
                  CD + "validate-definition-3": check("FAIL")},
        "execute": [CD + "verify-definition"],
        "ran": [CD + "repair-definition-1", CD + "repair-definition-2", CD + "repair-definition-3"],
        "failed": CD + "verify-definition",
        "skipped": ["implementor-checklist"],
        "outcome": "failed",
    },
    {
        "name": "three-rounds-not-ready",
        "stubs": {V + "acceptance-gate-0": {"ready": False}, V + "acceptance-gate-1": {"ready": False},
                  V + "acceptance-gate-2": {"ready": False},
                  V + "check-acceptance-progress-0": {"progressed": True}, V + "check-acceptance-progress-1": {"progressed": True}},
        "ran": [V + "acceptance-test-0", V + "acceptance-fix-0", V + "acceptance-push-0", V + "verify-acceptance-pr-0",
                V + "acceptance-test-1", V + "acceptance-fix-1", V + "acceptance-push-1", V + "verify-acceptance-pr-1",
                V + "acceptance-test-2", V + "acceptance-gate-2", V + "write-acceptance-status", V + "acceptance-handoff-verified"],
        "order": [V + "acceptance-gate-0", V + "clear-retest-reason-0", V + "acceptance-fix-0", V + "check-acceptance-progress-0",
                  V + "acceptance-push-0", V + "verify-acceptance-pr-0", V + "reset-round-evidence-1", V + "acceptance-test-1",
                  V + "acceptance-gate-2", V + "write-acceptance-status"],
        "outcome": "completed",
    },
    {
        "name": "ready-in-round-1",
        "stubs": {V + "acceptance-gate-0": {"ready": False}, V + "acceptance-gate-1": {"ready": True},
                  V + "check-acceptance-progress-0": {"progressed": True}},
        "ran": [V + "acceptance-test-1", V + "write-acceptance-status"],
        "skipped": [V + "acceptance-fix-1", V + "acceptance-test-2"],
        "outcome": "completed",
    },
    {
        "name": "unchanged-fix-ends-rounds",
        "stubs": {V + "acceptance-gate-0": {"ready": False}, V + "check-acceptance-progress-0": {"progressed": False}},
        "ran": [V + "acceptance-fix-0", V + "write-acceptance-status"],
        "skipped": [V + "acceptance-push-0", V + "acceptance-test-1"],
        "outcome": "completed",
    },
    {
        "name": "push-repair-recovers",
        "stubs": {V + "acceptance-gate-0": {"ready": False}, V + "acceptance-gate-1": {"ready": True},
                  V + "check-acceptance-progress-0": {"progressed": True}, V + "acceptance-push-0": check("FAIL")},
        "ran": [V + "acceptance-push-0-repair", V + "acceptance-push-0-repair-blocked", V + "acceptance-push-0-2",
                V + "verify-acceptance-pr-0", V + "acceptance-test-1"],
        "outcome": "completed",
    },
    {
        "name": "push-repair-exhausted",
        "stubs": {V + "acceptance-gate-0": {"ready": False}, V + "check-acceptance-progress-0": {"progressed": True},
                  V + "acceptance-push-0": check("FAIL")},
        "execute": [V + "acceptance-push-0-2"],
        "failed": V + "acceptance-push-0-2",
        "skipped": [V + "verify-acceptance-pr-0", V + "acceptance-test-1", V + "write-acceptance-status"],
        "outcome": "failed",
    },
    {
        "name": "open-draft-pr-blocked",
        "stubs": {V + "verify-draft-pr": check("FAIL"), V + "open-draft-pr": "No token scope.\nREPAIR_BLOCKED"},
        "execute": [V + "open-draft-pr-blocked"],
        "failed": V + "open-draft-pr-blocked",
        "skipped": [V + "open-draft-pr-2", V + "acceptance-test-0"],
        "outcome": "failed",
    },
    {
        "name": "open-draft-pr-rerun",
        "stubs": {V + "verify-draft-pr": check("FAIL"), V + "acceptance-gate-0": {"ready": True}},
        "ran": [V + "open-draft-pr-blocked", V + "open-draft-pr-2", V + "verify-draft-pr-2", V + "acceptance-test-0"],
        "outcome": "completed",
    },
    {
        "name": "handoff-rerun",
        "stubs": {V + "acceptance-gate-0": {"ready": True}, V + "verify-acceptance-handoff": check("FAIL")},
        "ran": [V + "write-acceptance-status-2", V + "verify-acceptance-handoff-2", V + "acceptance-handoff-verified"],
        "outcome": "completed",
    },
    {
        "name": "real-gate-and-progress",
        # The gate finds no READY status, so round 0 is not ready; the
        # tested revision equals HEAD and nothing asks for a retest, so the
        # fix moved nothing and the rounds end.
        "tested_revision_is_head": True,
        "execute": [V + "acceptance-gate-0", V + "check-acceptance-progress-0"],
        "ran": [V + "acceptance-fix-0", V + "write-acceptance-status"],
        "skipped": [V + "acceptance-push-0", V + "acceptance-test-1"],
        "output_contains": {V + "acceptance-gate-0": ["\"ready\":false"], V + "check-acceptance-progress-0": ["\"progressed\":false"]},
        "outcome": "completed",
    },
]


def run(cmd, cwd, **kwargs):
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, **kwargs)


def archon_args(session_dir):
    args = ["archon", "workflow", "run", WORKFLOW, "--dry-run", "--json"]
    for key, value in {**INPUTS, "session_dir": session_dir}.items():
        args += ["--input", f"{key}={value}"]
    return args


def to_yaml(value):
    # JSON is valid YAML.
    return json.dumps(value, indent=1)


def main(selected):
    scratch = tempfile.mkdtemp(prefix="codagent-scenarios-")
    try:
        repo = os.path.join(scratch, "repo")
        os.makedirs(repo)
        run(["git", "init", "-q"], repo, check=True)
        run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], repo, check=True)
        os.symlink(os.path.join(import_root, ".archon"), os.path.join(repo, ".archon"))
        with open(os.path.join(repo, ".git", "info", "exclude"), "a") as exclude:
            exclude.write("/.archon\n")
        head = run(["git", "rev-parse", "HEAD"], repo, check=True).stdout.strip()

        scaffold_path = os.path.join(scratch, "scaffold.yaml")
        result = run(archon_args(os.path.join(scratch, "session")) + ["--stubs-init", scaffold_path], repo)
        if result.returncode != 0:
            sys.exit(f"stub scaffold failed:\n{result.stdout}\n{result.stderr}")
        # Every scaffold stub becomes a plain value: checks PASS, gates not
        # ready, progress false, prose "stub".
        scaffold = parse_scaffold_keys(scaffold_path)

        failures = 0
        prompted = set()
        for scenario in SCENARIOS:
            if selected and scenario["name"] not in selected:
                continue
            session = os.path.join(scratch, "session-" + scenario["name"])
            os.makedirs(os.path.join(session, "output"), exist_ok=True)
            if scenario.get("blocked_record"):
                with open(os.path.join(session, "output", "implementation-blocked.md"), "w") as record:
                    record.write("## Needs the user\n")
            if scenario.get("tested_revision_is_head"):
                with open(os.path.join(session, "output", "acceptance-tested-revision.txt"), "w") as tested:
                    tested.write(head + "\n")

            stubs = {}
            for key, kind in scaffold.items():
                if kind == "check":
                    stubs[key] = check("PASS")
                elif kind == "gate":
                    stubs[key] = {"ready": False}
                elif kind == "progress":
                    stubs[key] = {"progressed": False}
                else:
                    stubs[key] = "stub"
            stubs.update(scenario.get("stubs", {}))
            for key in scenario.get("execute", []):
                stubs.pop(key, None)
            stubs_path = os.path.join(scratch, scenario["name"] + ".stubs.yaml")
            with open(stubs_path, "w") as handle:
                handle.write(to_yaml(stubs))

            args = archon_args(session) + ["--stubs", stubs_path]
            if scenario.get("execute"):
                args.append("--exec-code")
            result = run(args, repo)
            try:
                # A failed simulation prints the trace, then an error object.
                trace, _ = json.JSONDecoder().raw_decode(result.stdout.lstrip())
            except json.JSONDecodeError:
                print(f"FAIL {scenario['name']}: no JSON trace\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")
                failures += 1
                continue
            problems = assess(scenario, trace)
            prompted.update(entry["nodeId"] for entry in trace["trace"] if entry.get("resolvedText") is not None)
            if problems:
                failures += 1
                print(f"FAIL {scenario['name']}")
                for problem in problems:
                    print(f"     {problem}")
            else:
                print(f"ok   {scenario['name']}")
        if not selected or "codex-launcher" in selected:
            problems = check_codex_launcher(scratch)
            if problems:
                failures += 1
                print("FAIL codex-launcher")
                for problem in problems:
                    print(f"     {problem}")
            else:
                print("ok   codex-launcher")
        unprompted = sorted(FRESH_AGENT_NODES - prompted)
        if not selected and unprompted:
            failures += 1
            print(f"FAIL autonomy preamble: no scenario resolved the prompt of {unprompted}")
        if failures:
            sys.exit(f"{failures} scenario(s) failed")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def check_codex_launcher(scratch):
    """scripts/codex-launcher.sh: app-server threads start at the launcher's
    effort; every other command passes through unchanged."""
    fake = os.path.join(scratch, "fake codex")
    with open(fake, "w") as handle:
        handle.write('#!/bin/sh\nprintf "%s\\n" "$@"\n')
    os.chmod(fake, 0o755)
    script = os.path.join(import_root, "scripts", "codex-launcher.sh")
    launcher = os.path.join(scratch, "codex-launcher")
    written = run([script, fake, "medium", launcher], scratch)
    if written.returncode != 0:
        return [f"writing the launcher failed: {written.stderr.strip()}"]
    problems = []
    served = run([launcher, "app-server", "--listen", "stdio://"], scratch).stdout.splitlines()
    if served != ["app-server", "--listen", "stdio://", "-c", 'model_reasoning_effort="medium"']:
        problems.append(f"app-server ran with {served}")
    other = run([launcher, "login", "status"], scratch).stdout.splitlines()
    if other != ["login", "status"]:
        problems.append(f"login status ran with {other}")
    if run([script, fake, "loud", launcher + "-bad"], scratch).returncode == 0:
        problems.append("accepted an unknown effort")
    return problems


def parse_scaffold_keys(path):
    """Top-level keys of the stub scaffold, with the kind of stub each needs."""
    kinds = {}
    current = None
    with open(path) as handle:
        for line in handle:
            if line and not line[0].isspace() and ":" in line and not line.startswith("#"):
                current = line.split(":", 1)[0].strip()
                kinds[current] = "text"
            elif current and line.strip().startswith("status:"):
                kinds[current] = "check"
            elif current and line.strip().startswith("ready:"):
                kinds[current] = "gate"
            elif current and line.strip().startswith("progressed:"):
                kinds[current] = "progress"
    return kinds


def assess(scenario, trace):
    states = {entry["nodeId"]: entry for entry in trace["trace"]}
    problems = []
    if trace["outcome"] != scenario["outcome"]:
        failed = [node for node, entry in states.items() if entry["state"] == "failed"]
        problems.append(f"outcome {trace['outcome']}, expected {scenario['outcome']} (failed: {failed})")
    for node in scenario.get("ran", []):
        state = states.get(node, {}).get("state")
        if state not in ("stubbed", "completed"):
            problems.append(f"{node} should have run, state {state}")
    for node in scenario.get("skipped", []):
        state = states.get(node, {}).get("state")
        if state not in ("skipped", None):
            problems.append(f"{node} should not have run, state {state}")
    if "failed" in scenario:
        failed = [node for node, entry in states.items() if entry["state"] == "failed"]
        if failed != [scenario["failed"]]:
            problems.append(f"failed nodes {failed}, expected [{scenario['failed']}]")
    for node, needles in scenario.get("output_contains", {}).items():
        output = json.dumps(states.get(node, {}).get("output"))
        compact = output.replace("\\\"", "\"").replace(" ", "")
        for needle in needles:
            if needle.replace(" ", "") not in compact:
                problems.append(f"{node} output lacks {needle!r}: {output[:300]}")
    for node, entry in states.items():
        text = entry.get("resolvedText")
        if entry.get("nodeType") != "prompt" or text is None:
            continue
        if node in FRESH_AGENT_NODES and not text.startswith(AUTONOMY_PREAMBLE):
            problems.append(f"{node} starts a session but its prompt lacks the autonomy preamble: {text[:120]!r}")
        if node not in FRESH_AGENT_NODES and AUTONOMY_PREAMBLE.strip() in text:
            problems.append(f"{node} resumes a session but its prompt repeats the autonomy preamble")
        if "$INPUTS." in text:
            problems.append(f"{node} prompt has an unbound input: {text[text.index('$INPUTS.'):][:60]!r}")
    if "order" in scenario:
        position = {entry["nodeId"]: index for index, entry in enumerate(trace["trace"]) if entry["state"] in ("stubbed", "completed")}
        missing = [node for node in scenario["order"] if node not in position]
        if missing:
            problems.append(f"order: {missing} did not run")
        else:
            indexes = [position[node] for node in scenario["order"]]
            if indexes != sorted(indexes):
                problems.append(f"order: ran out of order {scenario['order']}")
    return problems


if __name__ == "__main__":
    main(sys.argv[1:])
