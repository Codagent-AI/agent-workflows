#!/bin/sh
# Runner's validate-boolean-param / validate-nonempty-param steps.
# Usage: validate-param.sh boolean|nonempty <name> <value>
set -eu
kind=$1 name=$2 value=$3
jq -n --arg name "$name" --arg value "$value" '{name: $name, value: $value}' \
  | sh "$PACK_DIR/.shared/core/validate-$kind-param.sh"
