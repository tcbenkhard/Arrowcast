# Raspberry Pi installation image

The **Raspberry Pi image** GitHub Actions workflow builds a complete ARM64
Raspberry Pi OS Lite appliance with Arrowcast installed. Docker is not included.
Without Ethernet or a working saved Wi-Fi connection, it broadcasts an open
Wi-Fi network named **ArrowCast**. Wi-Fi credentials can be saved in Settings;
connecting an Ethernet cable disables Wi-Fi. Signed
application updates are available in Settings on images configured as described
below. Backup/restore UI and browser onboarding are not implemented.

## Build and download

1. Push this implementation to GitHub and open **Actions → Raspberry Pi image**.
2. Choose **Run workflow** on the desired branch. No secrets or registry account
   need to be configured.
3. When the workflow passes, download its `arrowcast-pi-<commit>` artifact and
   extract the artifact ZIP. The `.img.xz` inside is the installation image.
   Build artifacts are retained for 14 days; download them while available.

`main` is the release branch. Merge changes into `main` and push it before
creating a new version tag; the workflow rejects release tags whose commits are
not on `main`. Do not move existing published tags. For example:

```sh
git switch main
git pull --ff-only origin main
git push origin main
git tag v0.0.8
git push origin v0.0.8
```

Pushing a version tag such as `v1.0.0` runs the same checks/build and attaches the
image, SHA256SUMS, installation guide, version and source/build-tool revisions
to a **GitHub Release**. The workflow creates a draft, uploads all assets, then
automatically publishes the release once the uploads succeed. Failed uploads
leave a draft that can be retried. Published release files persist independently
of the short-lived Actions artifact. A rerun will not overwrite a published release.

GitHub Actions must be enabled and repository policy must allow the release job
to write repository contents. Manual runs upload artifacts only. Public downloads
without a GitHub login require publishing in a public repository. Private
repository releases remain private. Each image must be smaller than GitHub's
2 GiB per-asset limit; the build fails rather than silently omit an oversized image.

## Install

Initial hardware target: Raspberry Pi 4 or Pi 5, at least 2 GB RAM, a 32 GB or
larger microSD card and matching power supply. HDMI for connection information
and Ethernet to a router are optional. Hardware boot and load
validation are still required before claiming these as supported minimums.

1. Download the `.img.xz` and `SHA256SUMS`. Optionally verify the checksum using
   `sha256sum -c SHA256SUMS` on Linux or `Get-FileHash <image> -Algorithm SHA256`
   in PowerShell and compare with SHA256SUMS.
2. Open Raspberry Pi Imager. Select the Pi model, **Use Custom**, and the image.
3. Select the SD card carefully and write it. This erases the selected card.
   Skip OS customisation for this first version. Imager Wi-Fi/user
   customisation against this custom image has not been validated.
4. Insert the card, optionally connect HDMI and Ethernet, then connect power. Initial boot
   expands storage and creates credentials; allow several minutes and any reboot
   needed for resizing. No internet connection is required on the Pi.
5. Without an Ethernet cable connected, join **ArrowCast** from your phone or computer; no Wi-Fi password is needed.
   Choose **Stay connected** / **Use without internet** if prompted. Open
   `http://10.42.0.1/admin`. Log in with username `admin` and password `admin`.
   Before opening the portal, enter the current password and choose and confirm
   a new password of at least 8 characters. Save your chosen password privately.
6. Alternatively, connect via the same Ethernet/router network and open
   `http://arrowcast.local/admin`, or use the Ethernet address shown on HDMI.
   The fixed `10.42.0.1` address is for devices joined to **ArrowCast**.
7. Before printing lane QR codes, set the scoring website address to the address
   reachable by phones on this network: `http://10.42.0.1` for hotspot scoring.
   Never use `localhost`. All scorers should join the same chosen network.

## ArrowCast Wi-Fi

- Name: **ArrowCast** (case-sensitive), visible on 2.4 GHz channel 6.
- Password: none. The administrator login is separate and requires first-login password setup.
- Pi address: **10.42.0.1**; phones receive an address automatically by DHCP.
- Ethernet cable detection takes priority, including while the router assigns
  an IP address: Wi-Fi and hotspot DHCP are disabled. Unplugging Ethernet enables
  `wlan0` and joins saved Wi-Fi, or starts the hotspot if no network is saved or
  joining fails. Normal cable changes are detected within a few seconds; an
  in-progress Wi-Fi connection attempt can take up to 25 seconds.
- In **Settings > Network**, enter the exact SSID and password, then choose
  **Save Wi-Fi settings**. Open and WPA/WPA2 Personal networks are supported,
  including hidden SSIDs. Leave the password empty only for an open network.
  Enterprise networks and WPA3-only networks require separate setup.
- Saving credentials while Ethernet is connected keeps Wi-Fi off; the saved
  network is used after unplugging the cable. Credentials survive reboot in a
  root-only NetworkManager profile and are never returned to the browser.
- Joining Wi-Fi replaces the hotspot. Connect your phone/computer to the same
  network and reopen `http://arrowcast.local/admin`, or use the Pi address shown
  on HDMI. Update the scoring website address before printing new QR codes.
  On failure, reconnect to **ArrowCast** at `http://10.42.0.1/admin` and correct
  the settings. Failed connections are retried after saving settings, rebooting,
  or connecting and unplugging Ethernet, avoiding repeated scoring interruptions.
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
and use the initial SSH password `arrowcast`. The `pi` account has
sudo access; use `passwd` to change its SSH password independently of the website.
The build does not include application secrets or a populated database. SSH host
keys are generated on the device. Raspberry Pi Imager OS customisation is not
needed. The initial website login is `admin` / `admin`; the portal requires a new
password before allowing management actions. First boot generates a unique JWT
secret on the Pi. The chosen password is stored only as a scrypt hash in the
database, and survives subsequent boots and application updates. The console
shows initial setup information; it cannot reveal your changed password. The
environment's `INITIAL_ADMIN_PASSWORD` only seeds a missing account and does not
reset an existing password. Existing accounts still using the default password
are flagged for password setup when upgrading; existing custom passwords remain
unchanged. There is no password-recovery UI.

This initial image serves HTTP on the local network. Use it on a trusted LAN;
it does not configure HTTPS or internet exposure. Do not forward its port through
the router. The browser wizard and maintenance UI in the broader plan remain
future work. Reflashing is a fresh installation and erases local data;
it is not an application-update procedure. Do not reflash an in-use scoring card
without preserving its data separately.

## What the pipeline builds

- Native `ubuntu-24.04-arm` GitHub runner; no emulation or Docker runtime.
- Raspberry Pi's `pi-gen` ARM64 tool, pinned to the commit in
  `deploy/pi/pi-gen-revision`. Stages 0–2 provide Raspberry Pi OS Lite (Trixie),
  boot firmware, storage resizing, DHCP networking and mDNS. A final custom stage
  installs Arrowcast. Only the completed custom image is exported.
- NetworkManager runs the open access point using a root-owned connection
  profile, with a fixed IPv4 address and no default route. `arrowcast-network.service`
  monitors Ethernet carrier, controls the radio and activates saved Wi-Fi or
  the fallback hotspot. Its group-restricted Unix socket accepts credentials
  only through authenticated admin routes; the API remains unprivileged.
  `arrowcast-dhcp.service` runs a
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
  the application starts. Production refuses a missing JWT secret. New
  administrators start with `admin` / `admin` and must change the password.
- System logs have bounded storage. Automatic apt timer activity is disabled
  to avoid service restarts during competitions. There is no host update system
  yet: this initial image is for testing, and requires an OS maintenance policy
  before production distribution.

The pipeline checks types, builds both apps, runs API/browser tests, checks shell
scripts, then builds the image. Inside the target rootfs it also checks native
SQLite, migrations, production login and access control, removes the smoke-test
database, validates nginx configuration, parses the access point profile with
the target NetworkManager, and validates dnsmasq configuration. These checks do not prove physical
boot, networking or SD-card behaviour. Release publication is automatic;
a maintainer must validate the exact image on real Pi 4 and Pi 5 hardware
before using it in production.

For the hotspot, verify on both Pi models: **ArrowCast** appears without a lock,
two phones join without a password and obtain different `10.42.0.x` addresses,
both can reach the website and submit scores, and reboot restores the hotspot
when no saved Wi-Fi or cable is present. Save valid, invalid and hidden Wi-Fi
credentials through Settings; verify successful joining, persistence after
reboot, and fallback after a wrong password or unavailable SSID. Insert Ethernet
while using both client Wi-Fi and the hotspot: the radio must turn off and the
website must be reachable through the router. Unplug it and verify saved Wi-Fi
or hotspot recovery. Confirm the administrator password is still required.

Build-tool and Node versions are pinned and npm uses the lockfile. OS packages
come from live Debian/Raspberry Pi repositories, so builds are not bit-for-bit
reproducible and may include newer OS packages on later runs.

## Application updates

Settings includes an **Updates** section. It shows **No updates available**, or
**Update available** with an **Update** button. The administrator confirms before
installation. Downloads and checks need internet access on the Pi, currently
through Ethernet or saved Wi-Fi. Joining the ArrowCast hotspot alone does not provide this.
The network broker verifies internet reachability using an HTTPS request to
`https://www.gstatic.com/generate_204` every 15 seconds and after network changes.
Update checks and participant imports use this shared result, independently of
Ethernet, Wi-Fi or hotspot mode. Local-only networks and captive portals do not
enable these features. If the probe is blocked, internet access is considered
unavailable even if individual websites remain reachable.
Without internet access, Settings shows the installed version and an informational
message; update offers are hidden and participant imports are disabled. Existing
import results remain visible. Availability refreshes automatically after internet
access returns. An import still requires pressing the import button to start.
Checks run when Settings is opened and are cached for 15 minutes; the page polls
installation progress and reconnects after the application restarts. Connection,
verification and configuration errors are displayed separately from no updates.

Before building the first update-capable image, generate a signing key on a
trusted machine (OpenSSL):

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out update-private.pem
openssl pkey -in update-private.pem -pubout -out update-public.pem
```

In GitHub repository **Settings > Secrets and variables > Actions**, add the
private PEM contents as the secret `ARROWCAST_UPDATE_PRIVATE_KEY` and the public
PEM contents as the variable `ARROWCAST_UPDATE_PUBLIC_KEY`. Keep the private key
out of the repository and retain a secure backup. The image contains only the
public key and repository name. Keep using the same key for releases installed
on those devices. Key rotation requires a separately planned trust migration.
The updater currently supports public GitHub repositories; private releases
need a separate authenticated distribution design.

Paste the file **contents**, including `-----BEGIN PUBLIC KEY-----` and
`-----END PUBLIC KEY-----`, into the public-key variable; do not enter a filename,
an SSH public key, a private key or just the base64 body. Multiline PEM and literal
`\n` separators are accepted. The workflow validates the format and checks that
the public and private keys match before building a tagged image. To re-export
the public key from your existing private key, use the second OpenSSL command
above. There is no need to generate a replacement private key for a formatting
mistake. "Could not read key of Public Key" means the configured public-key value
could not be parsed; Git's default-branch hints are unrelated.

Tag builds require these settings and a stable version such as `v1.2.0`.
Manual image builds without a public key still work, but display that updates
are not configured. A manually built image with the key can install a published
stable release. Previously built images do not acquire the updater automatically;
installing this image on an existing card still requires preserving its data.

The workflow packages the exact compiled ARM64 application from the image,
including Node and native SQLite dependencies, into `arrowcast-update.tar.xz`.
The release must include `arrowcast-update.tar.xz`, a signed `update.json`
manifest and `update.sig`; an SD-card image alone cannot be installed through
Settings. The workflow verifies these files exist before publishing automatically.
Test the exact installation image **and upgrade from the previous release** on
Pi 4 and Pi 5 before using it in production. Devices discover the latest published
stable release through GitHub; they ignore drafts and prereleases and refuse
versions older than or equal to their installed version.

`arrowcast-update.service` is a root-owned broker with a group-restricted Unix
socket. Only authenticated administrator API routes can request checks and
installation through the web application. Requests cannot supply a download URL
or shell command. The broker verifies the manifest signature, compatibility,
package size and SHA256 before extracting into a new release directory. It
requires 3 GiB free plus twice the database size, and refuses installation while
any competition is Active (including a second check after scoring writes stop).

During installation nginx and the API reject normal requests with HTTP 503.
The broker stops Arrowcast, creates a consistent SQLite backup, switches
`/opt/arrowcast/current`, and restarts the application. Database migrations run
on startup. Until the expected version passes its health check, scoring remains
unavailable. A failed activation restores both the previous release and database.
A durable transaction journal also restores an interrupted activation on boot
or broker restart before normal service resumes. The database and device secrets
remain under `/var/lib/arrowcast` and `/etc/arrowcast`; the updater does not
replace the credentials. Recovery artifacts live under `/var/lib/arrowcast-update`,
with the database backup readable only by root. Prior application directories
are retained; monitor available storage over repeated upgrades.

Wi-Fi configuration and Ethernet priority require an image containing the network
broker. Application updates alone cannot install that service on older images.

Updates cover application code and its bundled Node runtime. The systemd units,
updater, nginx configuration, kernel, firmware and OS packages belong to the base
image and require a separate maintenance procedure. This is not a full OS A/B
update system. Simulated recovery tests do not replace physical power-loss,
boot and SD-card testing before production use.

For local builds, pass `ARROWCAST_UPDATE_REPOSITORY=owner/repository` and the
public PEM in `ARROWCAST_UPDATE_PUBLIC_KEY` through sudo alongside
`ARROWCAST_IMAGE_VERSION`. Private signing keys are used only in the release job.

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
