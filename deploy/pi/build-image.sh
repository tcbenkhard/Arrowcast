#!/bin/bash
set -euo pipefail

# Runs on a disposable native ARM64 Linux builder, never on the target SD card.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ $(id -u) != 0 || $(uname -m) != aarch64 ]]; then
  echo 'Run with sudo on a native ARM64 Debian/Ubuntu builder.' >&2
  exit 1
fi
if [[ $repo_dir == *' '* ]]; then
  echo 'pi-gen requires a checkout path without spaces.' >&2
  exit 1
fi
build_dir="$repo_dir/.pi-build"
generator_dir="$build_dir/pi-gen"
mkdir -p "$build_dir" "$build_dir/output"
# Fail on invalid configuration before fetching pi-gen or building its rootfs.
if [[ -n ${ARROWCAST_UPDATE_PUBLIC_KEY:-} ]]; then
  python3 "$repo_dir/deploy/pi/signing.py" --public-output "$build_dir/update-public.pem"
else
  : > "$build_dir/update-public.pem"
fi
if [[ -e $generator_dir ]]; then
  echo 'Use a fresh checkout: .pi-build/pi-gen already exists.' >&2
  exit 1
fi
revision="$(tr -d '\r\n' < "$repo_dir/deploy/pi/pi-gen-revision")"
[[ $revision =~ ^[0-9a-f]{40}$ ]]
git init "$generator_dir"
git -C "$generator_dir" remote add origin https://github.com/RPi-Distro/pi-gen.git
git -C "$generator_dir" fetch --depth 1 origin "$revision"
git -C "$generator_dir" checkout --detach FETCH_HEAD
[[ $(git -C "$generator_dir" rev-parse HEAD) == "$revision" ]]

cp "$repo_dir/deploy/pi/config" "$generator_dir/config"
cp -a "$repo_dir/deploy/pi/stage-arrowcast" "$generator_dir/"
python3 - "$generator_dir/stage-arrowcast/00-install/files/update.json" <<'PY'
import json, os, sys
with open(sys.argv[1], 'w') as stream:
    json.dump({'repository': os.environ.get('ARROWCAST_UPDATE_REPOSITORY', '')}, stream)
PY
cp "$build_dir/update-public.pem" "$generator_dir/stage-arrowcast/00-install/files/update-public.pem"
find "$generator_dir/stage-arrowcast" -name '*.sh' -exec chmod +x {} +
touch "$generator_dir/stage2/SKIP_IMAGES"
# ENABLE_CLOUD_INIT alone does not skip the stage's package installation.
touch "$generator_dir/stage2/04-cloud-init/SKIP"
source_dir="$generator_dir/stage-arrowcast/00-install/files/source"
mkdir -p "$source_dir"
for entry in apps packages migrations package.json package-lock.json tsconfig.base.json .nvmrc; do
  rsync -a --exclude=node_modules --exclude=dist --exclude=.env --exclude='*.sqlite*' \
    "$repo_dir/$entry" "$source_dir/"
done
# sudo runs as root while Actions checkout belongs to the runner. Trust only
# this explicit checkout for metadata reads, without changing global Git policy.
source_revision="$(git -c safe.directory="$repo_dir" -C "$repo_dir" rev-parse HEAD)"
printf '%s\n' "$source_revision" > "$source_dir/REVISION"
cp "$repo_dir/deploy/pi/pi-gen-revision" "$source_dir/PI_GEN_REVISION"
# Git tags are validated before being used as output names; never evaluate inputs.
version="${ARROWCAST_IMAGE_VERSION:-${source_revision:0:12}}"
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]]
printf '%s\n' "$version" > "$source_dir/VERSION"
cd "$generator_dir"
./build.sh
mapfile -t packages < <(find work -path '*/stage-arrowcast/arrowcast-update.tar.xz' -type f)
[[ ${#packages[@]} == 1 ]]
cp "${packages[0]}" "$build_dir/output/arrowcast-update.tar.xz"
shopt -s nullglob
images=(deploy/*.img.xz)
[[ ${#images[@]} == 1 ]]
output="$build_dir/output/arrowcast-pi-$version.img.xz"
cp "${images[0]}" "$output"
xz --test "$output"
# GitHub Releases requires each asset to be smaller than 2 GiB.
[[ $(stat -c %s "$output") -lt 2147483648 ]]
cp "$source_dir/REVISION" "$source_dir/PI_GEN_REVISION" "$source_dir/VERSION" "$build_dir/output/"
cp deploy/*.info "$build_dir/output/OS-PACKAGES.txt"
cp "$repo_dir/docs/pi-image.md" "$build_dir/output/INSTALLATION.md"
cd "$build_dir/output"
sha256sum "$(basename "$output")" > SHA256SUMS
echo "Image ready: $output"
