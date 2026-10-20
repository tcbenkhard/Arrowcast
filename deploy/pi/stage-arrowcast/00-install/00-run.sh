#!/bin/bash
set -euo pipefail
install -d "$ROOTFS_DIR/opt/arrowcast" "$ROOTFS_DIR/usr/local/lib/arrowcast"
cp -a files/source/. "$ROOTFS_DIR/opt/arrowcast/"
install -m 0755 files/first-boot.sh "$ROOTFS_DIR/usr/local/lib/arrowcast/first-boot.sh"
install -m 0755 files/console.sh "$ROOTFS_DIR/usr/local/lib/arrowcast/console.sh"
install -m 0644 files/arrowcast.service "$ROOTFS_DIR/etc/systemd/system/arrowcast.service"
install -m 0644 files/arrowcast-first-boot.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-first-boot.service"
install -m 0644 files/arrowcast-console.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-console.service"
install -m 0644 files/arrowcast-hotspot.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-hotspot.service"
install -m 0644 files/arrowcast-dhcp.service "$ROOTFS_DIR/etc/systemd/system/arrowcast-dhcp.service"
install -d -m 0700 "$ROOTFS_DIR/etc/NetworkManager/system-connections"
install -m 0600 files/arrowcast.nmconnection "$ROOTFS_DIR/etc/NetworkManager/system-connections/arrowcast.nmconnection"
install -d -m 0750 "$ROOTFS_DIR/etc/arrowcast"
install -m 0644 files/dnsmasq.conf "$ROOTFS_DIR/etc/arrowcast/dnsmasq.conf"
install -m 0644 files/hotspot-sysctl.conf "$ROOTFS_DIR/etc/sysctl.d/90-arrowcast-hotspot.conf"
install -m 0644 files/nginx.conf "$ROOTFS_DIR/etc/nginx/sites-available/arrowcast"
on_chroot < files/install.sh
