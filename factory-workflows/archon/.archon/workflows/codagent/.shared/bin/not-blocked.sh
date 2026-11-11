#!/bin/sh
# Runner's check-not-blocked step: fails when an agent wrote the blocked
# record under the session directory.
set -eu
jq -n --arg blocked_file "$INPUTS_SESSION_DIR/output/implementation-blocked.md" '{blocked_file: $blocked_file}' \
  | sh "$PACK_DIR/.shared/core/check-not-blocked.sh"
