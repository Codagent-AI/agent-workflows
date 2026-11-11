#!/bin/sh
# Runner's verify-acceptance-handoff command (verify-change-v1.0.yaml),
# unchanged except that session_dir comes from the environment.
if [ ! -s "$INPUTS_SESSION_DIR/output/acceptance-handoff.md" ]; then
  echo "acceptance handoff is missing or empty" >&2
  exit 1
fi
status=$(sed '/^[[:space:]]*$/d' "$INPUTS_SESSION_DIR/output/acceptance-preparation-status.txt" | tail -n 1)
case "$status" in
  ACCEPTANCE_COMPLETE|ACCEPTANCE_FAILED)
    ;;
  *)
    echo "invalid acceptance preparation status: $status" >&2
    exit 1
    ;;
esac
