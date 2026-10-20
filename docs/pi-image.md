# Raspberry Pi installation image

The **Raspberry Pi image** GitHub Actions workflow builds a complete ARM64
Raspberry Pi OS Lite appliance with Arrowcast installed. Docker is not included.
It broadcasts an open Wi-Fi network named **ArrowCast** at each boot. Application
updates, backup/restore UI, browser onboarding and joining an existing Wi-Fi
network are not implemented by this change.

## Build and download

1. Push this implementation to GitHub and open **Actions → Raspberry Pi image**.
2. Choose **Run workflow** on the desired branch. No secrets or registry account
   need to be configured.
3. When the workflow passes, download its `arrowcast-pi-<commit>` artifact and
   extract the artifact ZIP. The `.img.xz` inside is the installation image.
   Build artifacts are retained for 14 days; download them while available.

Pushing a version tag such as `v1.0.0` runs the same checks/build and attaches the
image, SHA256SUMS, installation guide, version and source/build-tool revisions
to a **draft GitHub Release**. Test that exact image on real Pi 4 and Pi 5 hardware
before publishing the draft. Published release files persist independently of
the short-lived Actions artifact. A rerun will not overwrite a published release.

GitHub Actions must be enabled and repository policy must allow the release job
to write repository contents. Manual runs upload artifacts only. Public downloads
without a GitHub login require publishing in a public repository. Private
repository releases remain private. Each image must be smaller than GitHub's
2 GiB per-asset limit; the build fails rather than silently omit an oversized image.

## Install

Initial hardware target: Raspberry Pi 4 or Pi 5, at least 2 GB RAM, a 32 GB or
larger microSD card, matching power supply, and an HDMI screen for the first
administrator password. Ethernet to a router is optional. Hardware boot and load
validation are still required before claiming these as supported minimums.

1. Download the `.img.xz` and `SHA256SUMS`. Optionally verify the checksum using
   `sha256sum -c SHA256SUMS` on Linux or `Get-FileHash <image> -Algorithm SHA256`
   in PowerShell and compare with SHA256SUMS.
2. Open Raspberry Pi Imager. Select the Pi model, **Use Custom**, and the image.
3. Select the SD card carefully and write it. This erases the selected card.
   Skip OS customisation for this first version. Imager Wi-Fi/user
   customisation against this custom image has not been validated.
4. Insert the card, connect HDMI and optionally Ethernet, then connect power. Initial boot
   expands storage and creates credentials; allow several minutes and any reboot
   needed for resizing. No internet connection is required on the Pi.
5. Join **ArrowCast** from your phone or computer; no Wi-Fi password is needed.
   Choose **Stay connected** / **Use without internet** if prompted. Open
   `http://10.42.0.1/admin`. Use username `admin`
   and the unique password shown on the Pi's HDMI screen. Save it privately.
6. Alternatively, connect via the same Ethernet/router network and open
   `http://arrowcast.local/admin`, or use the Ethernet address shown on HDMI.
   The fixed `10.42.0.1` address is for devices joined to **ArrowCast**.
7. Before printing lane QR codes, set the scoring website address to the address
   reachable by phones on this network: `http://10.42.0.1` for hotspot scoring.
   Never use `localhost`. All scorers should join the same chosen network.

## ArrowCast Wi-Fi

- Name: **ArrowCast** (case-sensitive), visible on 2.4 GHz channel 6.
- Password: none. The administrator login still needs the generated password.
- Pi address: **10.42.0.1**; phones receive an address automatically by DHCP.
- The hotspot is always enabled, including when Ethernet is connected. It uses
  the built-in `wlan0` adapter; that adapter cannot also join another Wi-Fi network
  with this configuration. Ethernet remains available independently.
- This is a local scoring network. It does not share Ethernet internet access or
  bridge clients onto the wired LAN. No internet gateway or DNS server is
  advertised. Open the numeric address directly; there is no captive portal.
- Phones may report **No internet**. Keep the connection when prompted; disable
  automatic switching away from this Wi-Fi if it prevents reaching the Pi.
- The Wi-Fi regulatory country is `NL`, matching the current Netherlands setup.
  Change `WPA_COUNTRY` in `deploy/pi/config` before building for another country.
- The network has no wireless encryption. Anyone nearby can join; HTTP traffic
  is unencrypted. Keep administrator credentials private.
- Use one ArrowCast Pi per location with this default configuration. Multiple
  independent hotspots with the same name and subnet can cause phones to roam
  to the wrong Pi. Custom network names/subnets are not yet exposed in a UI.

The credentials screen is available on HDMI at each boot. It is deliberately
not a Linux login prompt. SSH is enabled: run `ssh pi@10.42.0.1` on the hotspot
and use the initial administrator password shown on HDMI. The `pi` account has
sudo access; use `passwd` to change its SSH password independently of the website.
There is no shared Linux password, and the build does not include application
secrets or a populated database. SSH host keys are generated on the device.
First boot generates the password and JWT secret on the Pi. Existing databases
and passwords survive subsequent boots. There is currently no password-change
or password-recovery UI; keep the generated password safe. Anyone with physical
access to the screen can see it, so keep the Pi in a controlled location.

This initial image serves HTTP on the local network. Use it on a trusted LAN;
it does not configure HTTPS or internet exposure. Do not forward its port through
the router. The browser wizard, configuration of an existing Wi-Fi network and
maintenance UI in the broader plan remain future work. Reflashing is a fresh installation and erases local data;
it is not an application-update procedure. Do not reflash an in-use scoring card
without preserving its data separately.

## What the pipeline builds

- Native `ubuntu-24.04-arm` GitHub runner; no emulation or Docker runtime.
- Raspberry Pi's `pi-gen` ARM64 tool, pinned to the commit in
  `deploy/pi/pi-gen-revision`. Stages 0–2 provide Raspberry Pi OS Lite (Trixie),
  boot firmware, storage resizing, DHCP networking and mDNS. A final custom stage
  installs Arrowcast. Only the completed custom image is exported.
- NetworkManager runs the open access point using a root-owned connection
  profile, with a fixed IPv4 address and no default route. `arrowcast-hotspot.service`
  enables the radio and activates it at boot. `arrowcast-dhcp.service` runs a
  dedicated dnsmasq process for hotspot client addresses only, without DNS or NAT.
- The official ARM64 Node.js version from `.nvmrc`, verified against Node's
  published SHA256 checksums over HTTPS. It lives under `/opt/arrowcast/runtime`.
- Application compilation and production dependency installation inside the
  target OS, including native `better-sqlite3`; no compilation at first boot.
- nginx on port 80 serves built React assets with SPA fallback and proxies `/api/`
  to Fastify on loopback port 3000. Static files, API and scoring share one origin.
- `arrowcast.service` runs as an unprivileged user and restarts on failure.
  Its persistent database is `/var/lib/arrowcast/arrowcast.sqlite`; generated
  environment configuration is `/etc/arrowcast/arrowcast.env` (root and service
  group only). The application cannot modify installed code.
- `arrowcast-first-boot.service` creates persistent secrets atomically, before
  the application starts. Production refuses a missing JWT secret or missing/
  short initial administrator password. Development retains its existing seed.
- System logs have bounded storage. Automatic apt timer activity is disabled
  to avoid service restarts during competitions. There is no host update system
  yet: this initial image is for testing, and requires an OS maintenance policy
  before production distribution.

The pipeline checks types, builds both apps, runs API/browser tests, checks shell
scripts, then builds the image. Inside the target rootfs it also checks native
SQLite, migrations, production login and access control, removes the smoke-test
database, validates nginx configuration, parses the access point profile with
the target NetworkManager, and validates dnsmasq configuration. These checks do not prove physical
boot, networking or SD-card behaviour. A maintainer must perform those checks
before publishing the draft release.

For the hotspot, verify on both Pi models: **ArrowCast** appears without a lock,
two phones join without a password and obtain different `10.42.0.x` addresses,
both can reach the website and submit scores, reboot restores the hotspot, and
unplugging Ethernet leaves scoring usable. Also verify the same behaviour while
Ethernet is connected and that hotspot clients cannot route through the Pi to
the wired network. Confirm the administrator password is still required.

Build-tool and Node versions are pinned and npm uses the lockfile. OS packages
come from live Debian/Raspberry Pi repositories, so builds are not bit-for-bit
reproducible and may include newer OS packages on later runs.

## Local builder and troubleshooting

Use a disposable ARM64 Debian/Ubuntu host with root access, internet connectivity,
a Linux filesystem, at least 20 GB free disk recommended, and a checkout path
without spaces. Install the dependency list from `.github/workflows/pi-image.yml`,
then run `sudo bash deploy/pi/build-image.sh`. Output is in `.pi-build/output/`.
The script refuses to reuse `.pi-build/pi-gen`; use a fresh checkout for each
build. Do not delete a failed pi-gen working tree while it has mounted filesystems.

On GitHub, build failures upload available pi-gen logs for seven days. A local
Windows checkout cannot perform the rootfs/image build directly. Physical boot
testing is separate from this workflow and has not been automated.

Upstream references: [pi-gen](https://github.com/RPi-Distro/pi-gen),
[GitHub ARM64 runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
and [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
