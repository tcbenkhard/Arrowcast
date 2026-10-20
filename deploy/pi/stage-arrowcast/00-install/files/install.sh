#!/bin/bash
set -euo pipefail
cd /opt/arrowcast
node_version="$(tr -d '\r\n' < .nvmrc)"
[[ $node_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
archive="node-v$node_version-linux-arm64.tar.xz"
mkdir -p /tmp/arrowcast-node
cd /tmp/arrowcast-node
curl --fail --location --retry 3 --output "$archive" "https://nodejs.org/dist/v$node_version/$archive"
curl --fail --location --retry 3 --output SHASUMS256.txt "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
awk -v name="$archive" '$2 == name' SHASUMS256.txt > selected.sha256
[[ $(wc -l < selected.sha256) == 1 ]]
sha256sum --check selected.sha256
mkdir -p /opt/arrowcast/runtime
tar -xJf "$archive" --strip-components=1 -C /opt/arrowcast/runtime
export PATH="/opt/arrowcast/runtime/bin:$PATH"
cd /opt/arrowcast
npm ci
npm run typecheck
npm run build
npm prune --omit=dev
# Exercise the packaged native SQLite module, migrations, auth and shutdown inside
# the actual target OS. No database or device secrets may remain in the image.
NODE_ENV=production JWT_SECRET=build-smoke-secret-at-least-thirty-two-bytes \
  INITIAL_ADMIN_PASSWORD=build-smoke-password-not-shipped DATABASE_PATH=/tmp/arrowcast-smoke.sqlite \
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { buildApp } from './apps/api/dist/app.js';
const app = buildApp();
try {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
    payload: { username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD } });
  assert.equal(response.statusCode, 200);
  const denied = await app.inject('/api/v1/admin/me');
  assert.equal(denied.statusCode, 401);
} finally { await app.close(); }
JS
rm -f /tmp/arrowcast-smoke.sqlite*
rm -rf /tmp/arrowcast-node /root/.npm
groupadd --system arrowcast
useradd --system --gid arrowcast --home-dir /var/lib/arrowcast --shell /usr/sbin/nologin arrowcast
install -d -m 0750 -o arrowcast -g arrowcast /var/lib/arrowcast
install -d -m 0750 -o root -g arrowcast /etc/arrowcast
# Keep the account locked until first boot replaces the build-time password.
usermod --lock --shell /bin/bash pi
ln -sf /etc/nginx/sites-available/arrowcast /etc/nginx/sites-enabled/arrowcast
rm -f /etc/nginx/sites-enabled/default
nginx -t
nmcli --offline connection modify connection.id ArrowCast \
  < /etc/NetworkManager/system-connections/arrowcast.nmconnection > /dev/null
dnsmasq --test --conf-file=/etc/arrowcast/dnsmasq.conf
systemctl enable arrowcast-first-boot.service arrowcast.service arrowcast-console.service nginx avahi-daemon
systemctl enable NetworkManager arrowcast-hotspot.service arrowcast-dhcp.service
mkdir -p /etc/systemd/system/ssh.service.d /etc/ssh/sshd_config.d
cat > /etc/systemd/system/ssh.service.d/arrowcast.conf <<'SSH'
[Unit]
Requires=arrowcast-first-boot.service
After=arrowcast-first-boot.service
SSH
printf 'PasswordAuthentication yes\n' > /etc/ssh/sshd_config.d/00-arrowcast.conf
systemctl enable ssh
systemctl mask getty@tty1.service
# Keep unattended package activity from restarting services during competition use.
systemctl disable apt-daily.timer apt-daily-upgrade.timer
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=64M\nRuntimeMaxUse=16M\n' > /etc/systemd/journald.conf.d/arrowcast.conf
# HTTP access logging is unnecessary and can otherwise fill the card.
rm -f /var/lib/systemd/random-seed /etc/ssh/ssh_host_* /var/log/nginx/*.log
