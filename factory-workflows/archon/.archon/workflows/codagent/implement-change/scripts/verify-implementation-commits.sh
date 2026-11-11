#!/bin/sh
# Runner's verify-implementation-commits command (implement-change-v2.0.yaml);
# the start head arrives in IMPLEMENTATION_START_HEAD.
count=$(git rev-list --count "$IMPLEMENTATION_START_HEAD..HEAD")
if [ "$count" -eq 0 ]; then
  echo "no commits since $IMPLEMENTATION_START_HEAD; the change was not implemented" >&2
  exit 1
fi
echo "$count commit(s) since $IMPLEMENTATION_START_HEAD"
