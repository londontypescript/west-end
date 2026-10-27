#!/bin/sh
# Unpacks the pinned gdUnit4 add-on to /opt/gdunit4/addons/gdUnit4, ready for
# a project to copy. The archive must match its pinned hash and record the
# pinned commit, so a moved tag is caught as well as a swapped file.
set -eu
. /opt/west-end/steps/common.sh

require GDUNIT4_TAG GDUNIT4_COMMIT GDUNIT4_URL GDUNIT4_SHA256

work=$(mktemp -d)
fetch "$GDUNIT4_URL" "$work/gdunit4.tar.gz"
check_digest sha256 "$GDUNIT4_SHA256" "$work/gdunit4.tar.gz"

# GitHub's source archives carry the commit they were made from as the
# comment in the tar's first block, a pax global header ("52 comment=<sha>").
commit=$(gzip -dc "$work/gdunit4.tar.gz" | head -c 1024 | tr '\0' '\n' |
  sed -n 's/^[0-9]* comment=//p')
[ "$commit" = "$GDUNIT4_COMMIT" ] ||
  fail "gdUnit4 archive was made from commit '$commit', pinned $GDUNIT4_COMMIT"

top="gdUnit4-${GDUNIT4_TAG#v}"
mkdir -p /opt/gdunit4
tar -xzf "$work/gdunit4.tar.gz" -C /opt/gdunit4 --strip-components=1 \
  --no-same-owner "$top/addons/gdUnit4"
rm -rf "$work"

version=$(sed -n 's/^version="\(.*\)"$/\1/p' /opt/gdunit4/addons/gdUnit4/plugin.cfg)
[ "$version" = "${GDUNIT4_TAG#v}" ] ||
  fail "gdUnit4 plugin.cfg says $version, pinned $GDUNIT4_TAG"
