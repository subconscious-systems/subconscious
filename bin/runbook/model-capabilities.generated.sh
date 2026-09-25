#!/usr/bin/env bash
# Generated from agents/registry.json. Do not edit by hand.
# Exact IDs only: similarly named models do not inherit capabilities.
subc_model_supports_vision() {
  case "${1:-}" in
    'subconscious/deepseek-v4.1-flash-marathon') return 0 ;;
    *) return 1 ;;
  esac
}
