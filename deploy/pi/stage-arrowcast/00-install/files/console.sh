#!/bin/bash
set -euo pipefail
# Only the physical console receives credentials; never the journal or network.
# shellcheck source=/dev/null
source /etc/arrowcast/arrowcast.env
printf '\033[2J\033[HArrowcast\n\nJoin Wi-Fi: ArrowCast (no password)\n'
printf 'On that Wi-Fi, open http://10.42.0.1/admin\n'
printf 'On Ethernet, open http://arrowcast.local/admin\n\n'
printf 'Username: admin\nPassword: %s\n\n' "$INITIAL_ADMIN_PASSWORD"
printf 'If the name does not work, try an address below in your browser:\n'
# DHCP may still be negotiating when network-online.target is reached.
for ((attempt = 0; attempt < 30; attempt++)); do
  [[ -n $(hostname -I) ]] && break
  sleep 2
done
hostname -I
printf '\nKeep this password private. This is not a Linux login console.\n'
