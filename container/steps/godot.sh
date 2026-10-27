#!/bin/sh
# Installs the pinned Godot build at /opt/godot/godot. The ZIP is checked
# before it is opened, and the binary inside is checked again against the
# owner's verified copy, so a swapped release asset fails twice over.
set -eu
. /opt/west-end/steps/common.sh

require GODOT_VERSION GODOT_URL GODOT_ZIP GODOT_ZIP_SHA512 GODOT_BINARY_SHA512

work=$(mktemp -d)
fetch "$GODOT_URL" "$work/$GODOT_ZIP"
check_digest sha512 "$GODOT_ZIP_SHA512" "$work/$GODOT_ZIP"

binary="Godot_v${GODOT_VERSION}-stable_linux.arm64"
unzip -q "$work/$GODOT_ZIP" "$binary" -d "$work"
check_digest sha512 "$GODOT_BINARY_SHA512" "$work/$binary"

install -D -m 0755 "$work/$binary" /opt/godot/godot
ln -s /opt/godot/godot /usr/local/bin/godot
rm -rf "$work"
