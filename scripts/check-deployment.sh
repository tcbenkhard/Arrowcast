#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find deploy/pi -name '*.sh' -print0)

mapfile -d '' shell_scripts < <(find deploy/pi -name '*.sh' -print0)
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "${shell_scripts[@]}"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:v0.10.0 "${shell_scripts[@]}"
else
  echo 'ShellCheck 0.10.0 or Docker is required for deployment checks.' >&2
  exit 1
fi

python3 -m unittest discover -s deploy/pi/tests -v
