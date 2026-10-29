#!/bin/sh
# Builds the west-end image from pins.env with Apple container or Docker.
#
#   container/build.sh <apple|docker> <tag> [--no-cache]
#
# Every pin is read from pins.env, checked for shape, and passed as an
# explicit --build-arg; a missing, unknown, repeated or malformed pin stops
# the build before anything is fetched, as does a URL pin whose host isn't
# in download-hosts.txt. Only --no-cache may be added, so a caller can't
# override a pin from the command line.
set -eu

fail() {
  echo "build.sh: $*" >&2
  exit 1
}

[ "$#" -ge 2 ] || fail "usage: build.sh <apple|docker> <tag> [--no-cache]"
tool=$1
tag=$2
shift 2

no_cache=
for option in "$@"; do
  case $option in
    --no-cache) no_cache=--no-cache ;;
    *) fail "unknown option $option (only --no-cache is allowed)" ;;
  esac
done

case $tool in
  apple) command -v container > /dev/null || fail "Apple container is not installed" ;;
  docker) command -v docker > /dev/null || fail "Docker is not installed" ;;
  *) fail "tool must be apple or docker, not $tool" ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
pins="$here/pins.env"
[ -f "$pins" ] || fail "$pins not found"
hosts="$here/download-hosts.txt"
[ -f "$hosts" ] || fail "$hosts not found"

# Every pin, separated by single spaces (the backslashes join the lines).
# Globbing is off for the rest of the script, so the constant list can be
# split into words safely.
set -f
keys="BASE_IMAGE SNAPSHOT_DEBIAN SNAPSHOT_DEBIAN_SECURITY \
INRELEASE_BOOKWORM_SHA256 INRELEASE_BOOKWORM_UPDATES_SHA256 \
INRELEASE_BOOKWORM_SECURITY_SHA256 GODOT_VERSION GODOT_URL GODOT_ZIP \
GODOT_ZIP_SHA512 GODOT_BINARY_SHA512 NODE_VERSION NODE_URL NODE_SHA256 \
GDUNIT4_TAG GDUNIT4_COMMIT GDUNIT4_URL GDUNIT4_SHA256"

hex() {
  printf '%s' "$1" | grep -E -q "^[0-9a-f]{$2}\$"
}

matches() {
  printf '%s' "$1" | grep -E -q "$2"
}

# The allowed download hosts, each followed by a space, so a host is
# matched whole and never as part of a longer name.
allowed=" "
while IFS= read -r host || [ -n "$host" ]; do
  case $host in
    '' | '#'*) continue ;;
  esac
  matches "$host" '^[a-z0-9.-]+$' || fail "download-hosts.txt has a malformed host '$host'"
  allowed="$allowed$host "
done < "$hosts"

valid() {
  key=$1
  value=$2
  case $key in
    BASE_IMAGE) matches "$value" '^[a-z0-9./_-]+:[a-z0-9._-]+@sha256:[0-9a-f]{64}$' ;;
    SNAPSHOT_*) matches "$value" '^[0-9]{8}T[0-9]{6}Z$' ;;
    *_SHA256) hex "$value" 64 ;;
    *_SHA512) hex "$value" 128 ;;
    GDUNIT4_COMMIT) hex "$value" 40 ;;
    *_URL) matches "$value" '^https://[A-Za-z0-9./_+-]+$' ;;
    *_VERSION) matches "$value" '^[0-9]+\.[0-9]+\.[0-9]+$' ;;
    GODOT_ZIP) matches "$value" '^[A-Za-z0-9._-]+\.zip$' ;;
    GDUNIT4_TAG) matches "$value" '^v[0-9]+\.[0-9]+\.[0-9]+$' ;;
    *) return 1 ;;
  esac
}

# The build arguments are collected as positional parameters, one word
# each, so no value is ever split or re-read by the shell.
set --
seen=" "
line_number=0
while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))
  case $line in
    '' | '#'*) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  [ "$key" != "$line" ] || fail "pins.env line $line_number has no '='"
  case " $keys " in
    *" $key "*) ;;
    *) fail "pins.env line $line_number: unknown pin '$key'" ;;
  esac
  case $seen in
    *" $key "*) fail "pins.env line $line_number: $key is set twice" ;;
  esac
  valid "$key" "$value" || fail "pins.env line $line_number: $key has a malformed value"
  case $key in
    *_URL)
      # valid() has already pinned the scheme and ruled out a user or
      # port, so the host is everything up to the first slash.
      host=${value#https://}
      host=${host%%/*}
      case $allowed in
        *" $host "*) ;;
        *) fail "pins.env line $line_number: $key downloads from $host, which is not in download-hosts.txt" ;;
      esac
      ;;
  esac
  seen="$seen$key "
  eval "pin_$key=\$value"
  set -- "$@" --build-arg "$key=$value"
done < "$pins"

for key in $keys; do
  case $seen in
    *" $key "*) ;;
    *) fail "pins.env is missing $key" ;;
  esac
done

# The pins that name the same thing twice must agree.
# shellcheck disable=SC2154 # set by the eval above
case $pin_GODOT_URL in
  */"$pin_GODOT_ZIP") ;;
  *) fail "GODOT_URL does not end in GODOT_ZIP" ;;
esac
case $pin_GODOT_ZIP in
  "Godot_v${pin_GODOT_VERSION}-stable_linux.arm64.zip") ;;
  *) fail "GODOT_ZIP is not the linux.arm64 build of GODOT_VERSION" ;;
esac
case $pin_NODE_URL in
  */"v$pin_NODE_VERSION/node-v$pin_NODE_VERSION-linux-arm64.tar.xz") ;;
  *) fail "NODE_URL is not the linux-arm64 tarball of NODE_VERSION" ;;
esac
case $pin_GDUNIT4_URL in
  */"refs/tags/$pin_GDUNIT4_TAG.tar.gz") ;;
  *) fail "GDUNIT4_URL is not the source archive of GDUNIT4_TAG" ;;
esac

if [ -n "$no_cache" ]; then
  set -- --no-cache "$@"
fi
case $tool in
  apple)
    exec container build --platform linux/arm64 --file "$here/Containerfile" \
      --tag "$tag" "$@" "$here"
    ;;
  docker)
    exec docker build --platform linux/arm64 --file "$here/Containerfile" \
      --tag "$tag" "$@" "$here"
    ;;
esac
