#!/bin/sh
# Installs the pinned Node release at /opt/node, with only `node` on PATH:
# code that runs in the image is self-contained, so npm is not needed.
set -eu
. /opt/west-end/steps/common.sh

require NODE_VERSION NODE_URL NODE_SHA256

work=$(mktemp -d)
fetch "$NODE_URL" "$work/node.tar.xz"
check_digest sha256 "$NODE_SHA256" "$work/node.tar.xz"

mkdir -p /opt/node
tar -xJf "$work/node.tar.xz" -C /opt/node --strip-components=1 --no-same-owner
ln -s /opt/node/bin/node /usr/local/bin/node
rm -rf "$work"

[ "$(node --version)" = "v$NODE_VERSION" ] ||
  fail "node reports $(node --version), pinned v$NODE_VERSION"
