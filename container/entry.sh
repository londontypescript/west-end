#!/bin/sh
# The image's entry command. Gives the step a private home, XDG and Godot
# cache folders under /tmp/job (inside the container, never in a mount),
# then replaces itself with the step so the caller's signals reach it.
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: <image> <command> [argument...]" >&2
  exit 2
fi

# Steps run as the image's fixed user; running one as root would hand it
# write access to the toolchain.
if [ "$(id -u)" = 0 ]; then
  echo "west-end entry: refusing to run as root; run as 10001:10001" >&2
  exit 2
fi

# The private folders are the user's alone, set explicitly rather than
# through the umask.
job=/tmp/job
for dir in "$job" "$job/home" "$job/config" "$job/cache" "$job/data" \
  "$job/state" "$job/runtime" "$job/work"; do
  mkdir -p "$dir"
  chmod 0700 "$dir"
done

# What the step writes to the job folder mount must be readable by the
# host user who collects it, so the step itself runs with umask 022.
umask 022

export HOME="$job/home"
export XDG_CONFIG_HOME="$job/config"
export XDG_CACHE_HOME="$job/cache"
export XDG_DATA_HOME="$job/data"
export XDG_STATE_HOME="$job/state"
export XDG_RUNTIME_DIR="$job/runtime"

cd "$job"
exec "$@"
