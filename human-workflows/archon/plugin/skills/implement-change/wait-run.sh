#!/bin/bash
# Waits on one Archon run until it stops for a reason someone must act on, then
# prints a summary. Meant to run as a background command; it costs no model time.
#
# Usage: wait-run.sh <run-id> <launch-checkout> [--out FILE] [--max-hours N] [--stall-minutes N]
#
# Keeps waiting while the run is pending or running, and while it is parked on a
# provider usage limit (Archon resumes those by itself). Stops when the run ends,
# pauses for an answer, loses its owner, has a tool call stalled longer than
# --stall-minutes, or the wait itself fails three times in a row.
#
# Exit: 0 stopped (read the summary), 1 the wait or read kept failing, 2 timed out
# with the run still live.

set -u

run_id=${1:?run id}
cwd=${2:?launch checkout}
shift 2
out=""
max_hours=24
stall_minutes=30
while [ $# -gt 0 ]; do
  case $1 in
    --out) out=$2; shift 2 ;;
    --max-hours) max_hours=$2; shift 2 ;;
    --stall-minutes) stall_minutes=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

archon=$(command -v archon) || { echo "archon not found on PATH" >&2; exit 1; }
jq=$(command -v jq) || { echo "jq not found on PATH" >&2; exit 1; }
[ -n "$out" ] || out=${TMPDIR:-/tmp}/archon-run-$run_id.json
wait_out=${out%.json}-wait.json

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

failures=0
fail_once() {
  failures=$((failures + 1))
  log "$1 ($failures in a row): $(tail -n 3 "$2" | tr '\n' ' ')"
  if [ "$failures" -ge 3 ]; then
    log "STOPPED wait-failed: run $run_id could not be read three times in a row"
    exit 1
  fi
  sleep 60
}

stop() {
  log "STOPPED $1"
  $jq -r '"run: \(.id)",
          "workflow: \(.workflow_name // "unknown")",
          "status: \(.status // "unknown")",
          "outcome: \(.outcome // "none")",
          "reason: \(.reason // "")",
          "artifacts: \(.terminal_record.artifacts.root // "unknown")"' "$out"
  $jq -r 'select(.attention != null) | "attention: \(.attention | tojson)"' "$wait_out" 2>/dev/null
  echo "run record: $out"
  echo "last wait result: $wait_out"
  exit 0
}

deadline=$(($(date +%s) + max_hours * 3600))
last=""
log "watching run $run_id from $cwd"
while :; do
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    log "TIMEOUT run $run_id is still live after ${max_hours}h"
    exit 2
  fi
  window=$((deadline - now))
  [ "$window" -gt 1800 ] && window=1800

  "$archon" workflow wait "$run_id" --cwd "$cwd" --json --timeout "$window" >"$tmp/wait.json" 2>"$tmp/wait.err"
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then
    fail_once "wait failed (exit $rc)" "$tmp/wait.err"
    continue
  fi
  if ! "$archon" workflow get "$run_id" --cwd "$cwd" --json >"$tmp/get.json" 2>"$tmp/get.err"; then
    fail_once "get failed" "$tmp/get.err"
    continue
  fi
  failures=0
  cp "$tmp/get.json" "$out"
  cp "$tmp/wait.json" "$wait_out"

  status=$($jq -r '.status // "unknown"' "$tmp/get.json")
  result=$($jq -r '.result // ""' "$tmp/wait.json" 2>/dev/null)
  kind=$($jq -r '.attention.kind // ""' "$tmp/wait.json" 2>/dev/null)
  line="status=$status${kind:+ attention=$kind}"
  [ "$line" != "$last" ] && log "$line"
  last=$line

  case $status in
    completed | failed | cancelled)
      stop "$status" ;;
    pending | running)
      [ "$result" = owner_lost ] && stop "owner_lost: the run's process is gone but its status is still $status"
      if [ "$kind" = stalled_tool_calls ]; then
        stalled_ms=$($jq '[.attention.calls[]?.stalledForMs // 0] | max // 0' "$tmp/wait.json")
        if [ "$stalled_ms" -ge $((stall_minutes * 60000)) ]; then
          stop "stalled: a tool call has been silent for $((stalled_ms / 60000)) minutes"
        fi
      fi
      # A wait on an active run with attention returns at once, so pause between reads.
      [ "$rc" -eq 0 ] && sleep 60
      ;;
    paused)
      if [ "$kind" = usage_limit ]; then
        sleep 300
      else
        stop "paused${kind:+ ($kind)}: the run is waiting for an answer"
      fi
      ;;
    *)
      stop "unknown status '$status'" ;;
  esac
done
