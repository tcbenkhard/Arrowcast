#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' script; do
  bash -n "$script"
done < <(find deploy/pi -name '*.sh' -print0)

python3 -m unittest discover -s deploy/pi/tests -v
