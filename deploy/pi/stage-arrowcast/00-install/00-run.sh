#!/bin/bash
set -euo pipefail
install -d "$ROOTFS_DIR/opt/arrowcast" "$ROOTFS_DIR/usr/local/lib/arrowcast"
cp -a files/source/. "$ROOTFS_DIR/opt/arrowcast/"
install -m 0755 files/first-boot.sh "$ROOTFS_DIR/usr/local/lib/arrowcast/first-boot.sh"
install -m 0755 files/console.sh "$ROOTFS_DIR/usr/local/lib/arrowcast/console.sh"
install -m 0755 files/updater.py "$ROOTFS_DIR/usr/local/lib/arrowcast/updater.py"
install -m 0755 files/network.py "$ROOTFS_DIR/usr/local/lib/arrowcast/network.py"
install -m 0644 files/arrowcast-network.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-network.service"
install -m 0644 files/arrowcast-update.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-update.service"
install -m 0644 files/arrowcast.service "$ROOTFS_DIR/etc/systemd/system/arrowcast.service"
install -m 0644 files/arrowcast-first-boot.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-first-boot.service"
install -m 0644 files/arrowcast-console.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-console.service"
install -m 0644 files/arrowcast-dhcp.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-dhcp.service"
install -d -m 0700 "$ROOTFS_DIR/etc/NetworkManager/system-connections"
install -m 0600 files/arrowcast.nmconnection "$ROOTFS_DIR/etc/NetworkManager/system-connections/arrowcast.nmconnection"
install -d -m 0750 "$ROOTFS_DIR/etc/arrowcast"
install -m 0644 files/update.json "$ROOTFS_DIR/etc/arrowcast/update.json"
if [[ -s files/update-public.pem ]]; then
  install -m 0644 files/update-public.pem "$ROOTFS_DIR/etc/arrowcast/update-public.pem"
fi
install -m 0644 files/dnsmasq.conf "$ROOTFS_DIR/etc/arrowcast/dnsmasq.conf"
install -m 0644 files/hotspot-sysctl.conf "$ROOTFS_DIR/etc/sysctl.d/90-arrowcast-hotspot.conf"
install -m 0644 files/nginx.conf "$ROOTFS_DIR/etc/nginx/sites-available/arrowcast"
on_chroot < files/install.sh
# Package the exact native build included in the image, excluding device data.
tar -cJf "$ROOTFS_DIR/../arrowcast-update.tar.xz" \
  -C "$ROOTFS_DIR/opt/arrowcast/releases/factory" \
  apps packages migrations node_modules runtime package.json package-lock.json VERSION REVISION
