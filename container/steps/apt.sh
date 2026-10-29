#!/bin/sh
# Points apt at snapshot.debian.org and nothing else, brings the base image's
# packages up to the snapshot, installs what the image needs, and proves that
# every installed package is one the snapshot serves.
set -eu
. /opt/west-end/steps/common.sh

require SNAPSHOT_DEBIAN SNAPSHOT_DEBIAN_SECURITY \
  INRELEASE_BOOKWORM_SHA256 INRELEASE_BOOKWORM_UPDATES_SHA256 \
  INRELEASE_BOOKWORM_SECURITY_SHA256

# Plain HTTP because the slim base has no CA certificates yet. Integrity
# comes from apt's signature check with the base's keyring, and from the
# pinned InRelease hashes checked below.
debian="http://snapshot.debian.org/archive/debian/$SNAPSHOT_DEBIAN/"
security="http://snapshot.debian.org/archive/debian-security/$SNAPSHOT_DEBIAN_SECURITY/"
keyring=/usr/share/keyrings/debian-archive-keyring.gpg

# Remove every source the base shipped, so a live mirror can't be used.
rm -f /etc/apt/sources.list
rm -f /etc/apt/sources.list.d/*

# A snapshot's Release files expire like any other; Check-Valid-Until is
# switched off for these two sources only, not in apt's global config.
cat > /etc/apt/sources.list.d/west-end-snapshot.sources <<EOF
Types: deb
URIs: $debian
Suites: bookworm bookworm-updates
Components: main
Signed-By: $keyring
Check-Valid-Until: no

Types: deb
URIs: $security
Suites: bookworm-security
Components: main
Signed-By: $keyring
Check-Valid-Until: no
EOF

cat > /etc/apt/apt.conf.d/80west-end <<EOF
APT::Install-Recommends "false";
APT::Install-Suggests "false";
APT::Get::Assume-Yes "true";
EOF

export DEBIAN_FRONTEND=noninteractive

retry apt-get update

# The snapshot is immutable, so its InRelease files must be byte for byte
# the ones recorded when the timestamps were pinned.
lists=/var/lib/apt/lists
host=snapshot.debian.org_archive
check_digest sha256 "$INRELEASE_BOOKWORM_SHA256" \
  "$lists/${host}_debian_${SNAPSHOT_DEBIAN}_dists_bookworm_InRelease"
check_digest sha256 "$INRELEASE_BOOKWORM_UPDATES_SHA256" \
  "$lists/${host}_debian_${SNAPSHOT_DEBIAN}_dists_bookworm-updates_InRelease"
check_digest sha256 "$INRELEASE_BOOKWORM_SECURITY_SHA256" \
  "$lists/${host}_debian-security_${SNAPSHOT_DEBIAN_SECURITY}_dists_bookworm-security_InRelease"

# Every index apt knows about must come from the two snapshot URLs.
stray=$(apt-get indextargets --format '$(URI)' |
  grep -v -F -e "$debian" -e "$security" || true)
[ -z "$stray" ] || fail "apt has an index outside the snapshot: $stray"

retry apt-get --download-only upgrade
apt-get upgrade

packages="
  ca-certificates
  curl
  ffmpeg
  fonts-dejavu-core
  libegl1
  libfontconfig1
  libgl1
  libgl1-mesa-dri
  libxcursor1
  libxi6
  libxinerama1
  libxkbcommon0
  libxrandr2
  python3
  python3-venv
  unzip
  xauth
  xvfb
  xz-utils
"
# shellcheck disable=SC2086 # the list is meant to split into words
retry apt-get --download-only install $packages
# shellcheck disable=SC2086
apt-get install $packages

# Nothing installed may be missing from the snapshot ("local": a version no
# configured source serves, such as one newer than the snapshot) or older
# than it (upgradable).
local_packages=$(apt list --installed 2>/dev/null | grep -F ',local]' || true)
[ -z "$local_packages" ] ||
  fail "installed packages the snapshot does not serve: $local_packages"
upgradable=$(apt list --upgradable 2>/dev/null | grep -v '^Listing' || true)
[ -z "$upgradable" ] ||
  fail "installed packages older than the snapshot: $upgradable"

mkdir -p /opt/west-end
dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\n' |
  LC_ALL=C sort > /opt/west-end/packages.txt

apt-get clean
rm -rf /var/lib/apt/lists/*
