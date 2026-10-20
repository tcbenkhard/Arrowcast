# Raspberry Pi installation and update plan

Status: the initial image-building workflow is implemented; see
[build and installation instructions](docs/pi-image.md). It packages the native
app under systemd, with nginx serving the frontend, an always-on open `ArrowCast`
Wi-Fi hotspot at `10.42.0.1`, optional Ethernet networking and a unique first-boot
administrator password displayed on HDMI. The browser wizard, recovery UI,
onboarding onto an existing Wi-Fi network and update system remain proposed work.
The permanent open hotspot replaces the temporary protected setup network proposal
below for the initial image; administrator access still requires a password. Physical Pi boot
validation is still required before publishing an image.

## 1. Goal and recommended approach

Make Arrowcast behave like a small appliance: write a supplied image to an SD
card, power on the Pi, and finish setup in a browser. Owners should never need
to open a terminal, install Docker, edit configuration files, or run migrations.

Ship two artifacts from the same release:

- **Arrowcast Pi image** (`.img.xz`): a complete, bootable 64-bit operating system
  with Node.js, the built Arrowcast application, and systemd services
  already installed. This is the normal installation route.
- **Arrowcast release bundle** (`.tar.xz`): a versioned ARM64 package containing
  the built application, migrations, production dependencies, and its pinned
  Node.js runtime. Used internally by the update system; no registry is needed.

Run Arrowcast directly on Raspberry Pi OS under systemd, without Docker. This
plan supersedes the Docker/Compose deployment proposal in
[the architecture handoff](ARCHITECTURE-HANDOFF.md#12-raspberry-pi-docker-en-persistente-data),
while retaining SQLite, which is already implemented and needs no separate
database server. A command-line installer for an existing Pi
can follow later; it should not determine the beginner experience.

Preinstall software while building the image. First boot expands storage,
generates device-specific identity/secrets, initialises the database, and starts
setup. It must work without internet, downloads, compilation or package installation.

Initial support target: Raspberry Pi 4 and Pi 5, 64-bit Raspberry Pi OS Lite,
with a proposed baseline of 2 GB RAM and a 32 GB microSD card. Confirm these
minimums through physical-device load and storage tests before advertising them.
Use one image for both models only if boot tests prove it works reliably.

## 2. What an owner does

### First installation

1. Follow a short illustrated guide listing the supported Pi, matching power
   supply, microSD card, card reader, and optional Ethernet cable.
2. Download the Arrowcast Pi image and open Raspberry Pi Imager on their computer.
3. Choose the Pi model, choose **Use Custom** and the downloaded image, select
   the SD card, and write it. Clearly explain that writing erases that card.
4. Insert the card, connect Ethernet if available, and connect power.
5. Open `http://arrowcast.local` from a phone or computer on the same network.
   The guide gives a tested waiting time and an alternative for finding the Pi.
6. Complete **Welcome to Arrowcast**: claim the device, create the administrator
   account, choose language/time zone and club name, and check phone connectivity.
7. Save the recovery information and download the first backup. Start using Arrowcast.

Target: no terminal, no Docker account, no Linux login, no manual secrets, no
manual IP configuration. Aim for setup within 15 minutes after the card is written;
measure this with first-time users rather than treating it as a guaranteed time.

### Wi-Fi and finding the device

- Ethernet is the shortest route, but a cable must not be mandatory.
- First investigate and test Imager customisation with the actual Arrowcast image.
  The official Imager supports custom images; customisation support depends on
  the image. Do not assume selecting a custom image automatically configures Wi-Fi.
- Include a temporary setup Wi-Fi network when no configured network is available.
  The owner joins it, opens a printed fixed setup address, and selects their home
  or club Wi-Fi in a browser. Show the next address before disconnecting.
- Device claiming must require physical possession: use a unique setup code shown
  through a local HDMI status screen or a protected, per-device setup Wi-Fi flow.
  Choose and prove the exact mechanism in phase 0; an unclaimed device on the LAN
  must not be claimable by any nearby visitor. No universal setup password.
- Test setup Wi-Fi on supported boards, including phones that abandon Wi-Fi
  without internet. Provide explicit instructions; do not depend on a captive
  portal opening automatically. Confirm connection before saving network changes,
  and return to setup mode after a failed change without erasing application data.
- Advertise a friendly hostname using mDNS. Handle multiple Arrowcast devices
  without name collisions. Provide a fallback through the setup network and an
  optional HDMI status screen showing the current address and QR code.
- Test phone-to-Pi access in the wizard. Guest Wi-Fi isolation and blocked mDNS
  should produce concrete instructions, such as putting all devices on the same
  private network. Do not require editing router settings for the normal route.
- A local network is required for scoring; internet is not. Include the application
  in the SD image so first boot works without downloading dependencies. New
  releases and external participant imports require internet, unless an update
  package is transferred manually.

### Routine updates

In **Settings → System**, show installed version, update availability, release
notes, backup status, storage health, and a single **Update Arrowcast** button.
Explain the expected interruption before starting. Display progress and reconnect
automatically after restart. Use plain messages such as “Downloading update”,
“Saving backup”, and “Checking Arrowcast”.

Downloads/checks may happen automatically. Installation and reboot require an
owner action in v1. Block installation while a competition is in Check-in or
Active, while participant import runs, or while another maintenance task runs.
Pausing scoring alone is insufficient. Recheck under a maintenance lock before
making changes so a competition cannot start between checking and updating.

## 3. Starting point in this repository

| Area | Current implementation | Work needed |
| --- | --- | --- |
| Application | React/Vite frontend and Fastify backend; separate development servers | Serve built frontend, API, and client-side routes from one production origin |
| Packaging | npm workspaces and build scripts; no appliance packaging | Native ARM64 release bundle, systemd services, persistent directories, health checks |
| Database | SQLite with WAL and Drizzle; migrations run in `openDatabase()` | Explicit maintenance migration command, migration locking, schema readiness checks |
| Accounts | `buildApp()` seeds `admin` / `admin` | Production first-run wizard; never create the default account on an appliance |
| Secrets | `JWT_SECRET` must be manually supplied | Generate unique secrets on first boot and preserve them across updates |
| Networking | API defaults to loopback; scoring address entered by administrator | Appliance networking and tested browser-reachable QR address |
| Recovery | No implemented appliance backup/update system | Consistent backup, restore, journalled updater, recovery interface |
| CI | Type check, build, API and browser tests on Ubuntu | Release bundle publishing, SD image builds, device tests, release verification |

The handoff's deployment configuration is illustrative. Implement configuration
against the current JWT authentication model; do not introduce unrelated session
changes or copy nonexistent environment variables into production packaging.

## 4. Implementation architecture

### Application and persistent data

- Build frontend, backend, production dependencies, and migrations in CI. Compile
  or obtain `better-sqlite3` for the target architecture; never copy Windows
  `node_modules`. Build against the supported OS/libc and bundled Node.js version
  so native modules are ABI-compatible. No `npm install` is needed on the device.
- Run as a dedicated unprivileged `arrowcast` user using `arrowcast.service`.
  systemd starts it at boot, restarts it after failure with bounded retries, and
  handles graceful shutdown. Restrict filesystem access and privileges.
- Keep immutable releases under `/opt/arrowcast/releases/<version>/`, each with
  its own runtime and dependencies. `/opt/arrowcast/current` selects the release.
  Root owns release files; the app cannot modify its own executables.
- Store SQLite at `/var/lib/arrowcast/arrowcast.sqlite`, future uploads under
  `/var/lib/arrowcast/uploads/`, configuration/secrets under `/etc/arrowcast/`,
  and backups/update journals in separate persistent directories. Replacing
  releases preserves these. WAL mode creates sidecar files while running; use
  the backup API rather than copying only the main database file.
- Serve a readiness endpoint that checks database access and expected schema;
  expose no credentials or participant data. Routine readiness is read-only.
- Separate migration from ordinary production startup. Startup must refuse an
  incompatible schema rather than run an uncontrolled migration or seed an account.
  Keep any development convenience explicitly restricted to development.
- Generate host identity, SSH host keys if used, machine ID, setup credentials,
  and application secrets per device. Remove all builder identity and credentials
  from the published image. SSH and remote support access are disabled by default.

### Device management service

Run a small host service supervised by systemd, independently of the application.
It controls the app service, handles networking/setup, performs approved update operations,
and serves a minimal maintenance/recovery page even if Arrowcast cannot start.

The web application must not receive arbitrary host command execution or
unrestricted sudo access. Use a narrow local API, validated parameters, authenticated admin
requests, CSRF/origin protection, and a small allowlist of operations. Only the
host service controls release activation, service restarts and privileged network changes. Recovery access must
require an administrator credential or a physically obtained recovery code;
host service availability does not mean public administrative access.

Persist update progress outside application release directories. The browser can reconnect to the
management service while the app is stopped. Redact secrets and participant data
from logs and downloadable diagnostics.

### Release and image creation

- Start from a pinned official 64-bit Raspberry Pi OS Lite base. Select and pin
  the image-building tool in phase 0 after proving repeatable Pi 4/Pi 5 builds.
- Provision the pinned runtime, native application release, systemd units,
  management service, network setup, bounded logs, and first-boot services.
- Preload the exact application release and expand usable storage on first boot.
  Provisioning must be resumable after interruption and must never reset an
  already initialised database.
- Publish immutable versioned release bundles, the compressed SD image,
  checksums, signed release manifest, release notes, and build provenance/SBOM.
  The manifest records app/schema/management versions, supported host versions,
  architecture, required free space, and allowed upgrade paths.
- Embed the release verification public key in the appliance. Verify signed
  metadata and payload integrity before installation, including manually uploaded
  packages. Define key rotation and reject unknown or incompatible releases.
- Build from release tags only after checks pass. Promote the same tested artifacts
  from candidate to stable. Retain the previous working release locally.

### Update transaction and recovery

1. Verify release metadata, compatibility, connectivity, free space for download
   and backup, and exclusive maintenance availability. Download, verify and unpack
   the new bundle into staging before interrupting the running version. Validate
   archive paths, ownership and links; reject path traversal and writes outside
   the release directory. Download failure leaves the old application running.
2. Enter maintenance mode, drain requests and finish writes. Enforce the write
   barrier for every API mutation and background job, not only the browser UI.
3. Make a consistent SQLite backup using the SQLite backup API. Include uploads,
   protected configuration/secrets, app/schema versions, and integrity metadata.
   Coordinate file snapshots while writes are blocked. Abort if backup fails.
4. Stop the old app service. Run exactly one migration process using the candidate
   release and its bundled runtime.
5. Atomically replace the `current` symlink on the same filesystem, start the
   candidate service, and check readiness, authentication, expected schema and
   representative reads. Perform a controlled write/read/delete health probe in
   dedicated diagnostic storage, never in real scoring data.
6. On success, record the installed release atomically, then reopen writes.
7. On failure, retain diagnostics, restore the pre-update data/configuration if
   the schema changed, switch `current` back, and start the previous release. Verify recovery before
   reopening writes. If recovery fails, keep maintenance mode and offer guided restore.

Persist each state atomically so power loss leads to a deterministic resume or
rollback on the next boot. Test interruption at every boundary. Never treat
switching to an older application release as sufficient database rollback. Automatic
restoration is allowed only before writes reopen; later manual rollback must
explain that restoring an older backup loses changes made after that backup.

### Backups, replacement cards, and host updates

- Offer **Download backup**, **Restore backup**, **Restart**, and **Shut down**
  in the browser. Verify archive integrity, compatibility, and available storage
  before replacing data. Preserve the current installation for failed-restore recovery.
- Encrypt portable backups containing secrets or personal data. Give owners a
  recovery key to keep outside the Pi; test recovery when the original Pi is lost.
  Include signing/JWT secrets needed for continuity, while regenerating hardware
  identity and confirming network configuration on replacement devices.
- Automatic local backups help with failed upgrades but not failed SD cards.
  Show when no recent backup exists outside the Pi. Support browser download
  initially, with scheduled USB/network storage as a subsequent improvement.
- Recovery guide: write a fresh image to a replacement card, select **Restore an
  existing Arrowcast**, upload the backup and unlock it, then verify access and
  competition data. Reflashing the original card erases its contents; explain this.
- Track application updates separately from OS and management-service
  updates. V1 must define a supported OS/security-maintenance policy before release:
  publish tested host updates with explicit owner-triggered maintenance and reboots,
  and test service/network compatibility. No unattended reboot during an event.
- For major host upgrades, v1 may use a fresh image plus guided backup/restore.
  Show a clear “Device system update required” message rather than claiming an app
  update patches the OS. An atomic A/B whole-device updater can follow later;
  it is additional engineering beyond application-release rollback. Version the
  management service independently and test its own update/recovery procedure;
  updating it must not remove the only recovery interface.

## 5. Delivery sequence

Estimates are rough engineering days for one developer familiar with the code,
including implementation and focused verification. They exclude hardware delivery
and external release reviews. Re-estimate after phase 0.

| Phase | Deliverables | Exit condition | Estimate |
| --- | --- | --- | --- |
| 0. Prove setup and recovery choices | Pi 4/5 hardware spike; image-builder selection; Imager compatibility; Wi-Fi/claiming prototype; local HTTP/TLS decision; host maintenance policy | A blank card boots, a phone finds and securely claims it without a terminal, and Wi-Fi failure is recoverable | 3–5 days |
| 1. Production application | Single-origin serving, ARM64 release bundle, systemd service, persistent directories, first-admin setup, explicit migrations, readiness | Fresh install and application replacement preserve data and secrets; no default production password | 4–6 days |
| 2. Appliance image | Automated image build, preloaded app, unique first-boot identity, management service, network wizard, illustrated installation guide | First-time users complete Ethernet and Wi-Fi installation; first boot works without internet | 5–8 days |
| 3. Backup and restore | Consistent encrypted backups, download/restore UI, replacement-device flow, recovery credentials | Restore onto a different card/Pi preserves competition data and usable access | 3–5 days |
| 4. Safe updates | Signed releases, durable update journal, Settings UI, maintenance locking, migration and rollback workflow, tested host maintenance | Successful update plus interrupted/failed update cases recover without terminal access | 6–10 days |
| 5. Release validation | Physical device matrix, load tests, failure injection, novice usability sessions, support guide | Release criteria below pass; publish stable image and matching native release bundle | 3–5 days |

Dependency order: 0 → 1 → 2 → 3 → 4 → 5. Backup/restore is required before
enabling updates. Expected initial delivery: **24–39 engineering days**, roughly
5–8 working weeks for one developer. Wi-Fi onboarding and host update scope are
the largest uncertainties.

Suggested repository additions: `deploy/pi/` (image build and first boot),
`deploy/systemd/` (service units), `scripts/package-release.*` (ARM64 bundles),
`apps/device-manager/`,
`docs/installation.md`, `docs/recovery.md`, and a release workflow under
`.github/workflows/`. Keep implementation tickets aligned with the phase exits.

## 6. Release acceptance criteria

- At least three people unfamiliar with Linux/Docker install independently using
  the guide. Test both Ethernet and Wi-Fi, plus Windows and macOS Imager paths.
  Record time, failures and places where assistance was needed.
- Pi 4 and Pi 5 boot, restart and recover after power loss. Verify fresh cards,
  first-boot interruption, hostname collisions, wrong Wi-Fi credentials, blocked
  mDNS, no internet, incorrect device clock, and insufficient disk space.
- Administrator setup requires proof of possession, creates no shared credentials,
  and cannot be repeated after claiming. Test authenticated management access and
  recovery without exposing privileged service controls or arbitrary commands.
- Decide and document local transport in phase 0: isolated-LAN HTTP is an explicit
  limited deployment mode; HTTPS needs a tested trust/provisioning path. Do not
  promise warning-free HTTPS for `.local` without solving certificate trust.
  Do not expose appliance or recovery ports through router forwarding by default.
- QR links work on a separate phone using the chosen address and scheme. Cookies
  and authentication work in that mode. Scores persist across app/device restarts.
- Update from each declared supported version, including skipped versions where
  supported, preserves competitions, participants, scores, accounts, and settings.
  Unsupported paths give a clear next step before any data is changed.
- Competing update requests and a competition-start/update race cannot bypass
  maintenance locking. Active competitions and imports block installation.
- Interrupted download, invalid signature, failed backup, failed migration,
  unhealthy candidate, power loss, and failed rollback all have tested outcomes.
  The recovery page remains reachable when the application fails.
- Restore a downloaded backup to a replacement Pi with the original unavailable.
  Verify integrity, authentication, existing scores, and QR/session continuity
  where the hostname and stored secrets are preserved.
- Load-test the advertised maximum lane devices and viewers on the weakest
  supported Pi. Set the supported capacity and storage headroom from measurements.
- Publish the tested host versions, security-update process, support window and
  end-of-support notices. No release may silently leave the host unmaintained.

## 7. Follow-up improvements

After the first supported release: scheduled external backups, signed offline
update bundles through the browser, optional prewritten cards, an Imager catalogue
entry, and atomic whole-device updates. A custom desktop flasher is only justified
if usability testing shows the standard Imager path remains too difficult.

## References

- [Raspberry Pi installation and Imager documentation](https://www.raspberrypi.com/documentation/computers/getting-started.html): custom image selection, conditional customisation, and local discovery.
- [systemd service documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html): native service supervision and restart behaviour.
- [SQLite file database](https://www.sqlite.org/onefile.html): local storage without a separate database server.
- [SQLite online backup API](https://www.sqlite.org/backup.html): consistent database snapshots.

External documentation checked on 20 October 2026. The architecture, estimates,
UX and release criteria above are project proposals, not vendor guarantees.
