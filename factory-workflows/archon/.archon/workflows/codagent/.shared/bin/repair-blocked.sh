#!/bin/sh
# Fails when an agent's final response ends with the line REPAIR_BLOCKED,
# which in Agent Runner stops further repair attempts: the failure needs a
# human. The response arrives in AGENT_RESPONSE.
set -u

last=$(printf '%s\n' "${AGENT_RESPONSE:-}" | sed '/^[[:space:]]*$/d' | tail -n 1 | tr -d '[:space:]')
if [ "$last" = REPAIR_BLOCKED ]; then
  printf 'the repair agent reported REPAIR_BLOCKED: the failure needs a human\n' >&2
  exit 1
fi
