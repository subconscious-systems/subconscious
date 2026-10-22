# shellcheck shell=bash
# subc sets every value a runbook reads, so a runbook declares no defaults
# of its own.

# Exact IDs only: similarly named models do not inherit capabilities.
subc_model_supports_vision() {
  local model
  while IFS= read -r model; do
    [[ -n "$model" && "$model" == "${1:-}" ]] && return 0
  done <<< "${SUBC_VISION_MODELS:-}"
  return 1
}

# Quote a value for a line of shell source: ' becomes '\''.
#
# Credentials reach us from --api-key, a profile, or the environment, and the
# env files that hold them are sourced by hook.sh. Interpolating a raw value
# into single quotes means a quote in the value is read as shell syntax: a
# stray one leaves an unmatched quote, so the source fails and the hook sees no
# credentials; a balanced pair runs what follows as a command. ' is the only
# character affected — a newline and every metacharacter are already literal
# between single quotes. This round-trips any byte.
subc_shell_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

# One `export NAME=VALUE` line, quoted.
subc_env_line() {
  printf 'export %s=%s\n' "$1" "$(subc_shell_quote "$2")"
}

# Replace this shell with the agent argv subc built:
#   subc_exec [PLACEHOLDER VALUE]... -- ARGV...
# Only the first SUBC_TEMPLATE_WORDS words came from the agent's argv
# template; passed-through arguments and the prompt after them are never
# rewritten, whatever they contain.
subc_exec() {
  local names=() values=() argv=() word index=0 i
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    names+=("$1")
    values+=("$2")
    shift 2
  done
  shift
  local limit="${SUBC_TEMPLATE_WORDS:-0}"
  unset SUBC_TEMPLATE_WORDS SUBC_MODEL_IDS SUBC_VISION_MODELS
  for word in "$@"; do
    if [[ "$index" -lt "$limit" ]]; then
      for ((i = 0; i < ${#names[@]}; i++)); do
        if [[ "$word" == *"${names[i]}"* ]]; then
          word="${word%%"${names[i]}"*}${values[i]}${word#*"${names[i]}"}"
        fi
      done
    fi
    argv+=("$word")
    index=$((index + 1))
  done
  exec "${argv[@]}"
}
