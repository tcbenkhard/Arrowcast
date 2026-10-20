#!/bin/bash
set -euo pipefail
umask 027
install -d -m 0750 -o root -g arrowcast /etc/arrowcast
install -d -m 0750 -o arrowcast -g arrowcast /var/lib/arrowcast
if [[ ! -f /etc/arrowcast/arrowcast.env ]]; then
  # Atomic replacement makes interruption before completion safe to retry.
  /opt/arrowcast/runtime/bin/node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
const env = ['NODE_ENV=production', 'HOST=127.0.0.1', 'PORT=3000',
  'DATABASE_PATH=/var/lib/arrowcast/arrowcast.sqlite',
  `JWT_SECRET=${randomBytes(48).toString('hex')}`,
  'INITIAL_ADMIN_PASSWORD=admin', ''].join('\n');
writeFileSync('/etc/arrowcast/arrowcast.env.tmp', env, { mode: 0o640, flush: true });
renameSync('/etc/arrowcast/arrowcast.env.tmp', '/etc/arrowcast/arrowcast.env');
JS
fi
chown root:arrowcast /etc/arrowcast/arrowcast.env
chmod 0640 /etc/arrowcast/arrowcast.env
# Set the initial SSH password once; preserve later changes made with passwd.
if [[ ! -f /etc/arrowcast/ssh-password-initialised ]]; then
  printf 'pi:arrowcast\n' | chpasswd
  touch /etc/arrowcast/ssh-password-initialised
fi
# The image contains no shared host keys.
ssh-keygen -A
