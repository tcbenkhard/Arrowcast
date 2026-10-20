#!/bin/bash
set -euo pipefail
if [[ ! -d $ROOTFS_DIR ]]; then
  # Last stage owns stage2's filesystem, avoiding another multi-GB copy on CI.
  mv "$PREV_ROOTFS_DIR" "$ROOTFS_DIR"
fi
