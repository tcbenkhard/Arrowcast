#!/usr/bin/env bash
set -euo pipefail

tracked_generated="$(git ls-files | grep -E '(^|/)__pycache__/|\.pyc$' | while IFS= read -r path; do
  [[ ! -e "$path" ]] || echo "$path"
done || true)"
if [[ -n "$tracked_generated" ]]; then
  echo "Generated Python files must not be tracked:" >&2
  echo "$tracked_generated" >&2
  exit 1
fi

redundant_placeholders=""
while IFS= read -r placeholder; do
  [[ -e "$placeholder" ]] || continue
  directory="${placeholder%/.gitkeep}"
  if find "$directory" -mindepth 1 -maxdepth 1 ! -name .gitkeep -print -quit | grep -q .; then
    redundant_placeholders+="$placeholder"$'\n'
  fi
done < <(git ls-files '*/.gitkeep')

if [[ -n "$redundant_placeholders" ]]; then
  echo "Remove .gitkeep files from non-empty directories:" >&2
  printf '%s' "$redundant_placeholders" >&2
  exit 1
fi
