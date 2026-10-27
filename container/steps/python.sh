#!/bin/sh
# Installs gdtoolkit (gdlint, gdformat) into its own venv from hashed wheels
# only, so pip can neither pick an unlisted file nor build anything.
set -eu
. /opt/west-end/steps/common.sh

python3 -m venv /opt/gdtoolkit
/opt/gdtoolkit/bin/pip install \
  --no-cache-dir --disable-pip-version-check --no-input --retries 5 \
  --require-hashes --only-binary=:all: \
  --requirement /opt/west-end/requirements.txt

ln -s /opt/gdtoolkit/bin/gdlint /usr/local/bin/gdlint
ln -s /opt/gdtoolkit/bin/gdformat /usr/local/bin/gdformat

/opt/gdtoolkit/bin/pip --disable-pip-version-check freeze --all |
  LC_ALL=C sort > /opt/west-end/python.txt
