#!/bin/sh
# Runs the smoke checks in the image under the render/check policy (see
# container/README.md): no network, the repository's container/ folder
# mounted read-only, one fresh job folder as the only writable mount, CPU, memory, process and time
# limits, and the container removed afterwards.
#
#   container/smoke/run.sh <apple|docker> <image> [step...]
#
# SMOKE_TIME_LIMIT (seconds, default 600) bounds the whole run;
# SMOKE_RENDERING_DRIVER is passed through for the GL break-it check.
set -eu

fail() {
  echo "run.sh: $*" >&2
  exit 1
}

[ "$#" -ge 2 ] || fail "usage: run.sh <apple|docker> <image> [step...]"
tool=$1
image=$2
shift 2

here=$(cd "$(dirname "$0")" && pwd)
# Only the repository's container/ folder is mounted: everything the checks
# read is there, and the host's node_modules must never reach the image.
source=$(cd "$here/.." && pwd)
limit=${SMOKE_TIME_LIMIT:-600}
name="west-end-smoke-$$"

# The caller owns the job folder. The image's user is UID 10001, which has
# no account on the host, so the folder is opened to it here; see the
# README for the stricter Linux form.
job=$(mktemp -d "${TMPDIR:-/tmp}/west-end-smoke.XXXXXX")
chmod 0777 "$job"

driver_env=
if [ -n "${SMOKE_RENDERING_DRIVER:-}" ]; then
  driver_env="--env SMOKE_RENDERING_DRIVER=$SMOKE_RENDERING_DRIVER"
fi

set -f
case $tool in
  apple)
    stop="container stop $name"
    # shellcheck disable=SC2086
    container run --rm --name "$name" --network none \
      --read-only --tmpfs /tmp --shm-size 1G \
      --cpus 4 --memory 4G --ulimit nproc=2048 \
      --user 10001:10001 $driver_env \
      --mount "type=bind,source=$source,target=/repo/container,readonly" \
      --volume "$job:/out" \
      "$image" sh /repo/container/smoke/smoke.sh "$@" &
    ;;
  docker)
    stop="docker kill $name"
    # shellcheck disable=SC2086
    docker run --rm --name "$name" --network none \
      --read-only --tmpfs /tmp:size=2g --shm-size 1g \
      --cpus 4 --memory 4g --pids-limit 2048 \
      --user 10001:10001 $driver_env \
      --mount "type=bind,source=$source,target=/repo/container,readonly" \
      --volume "$job:/out" \
      "$image" sh /repo/container/smoke/smoke.sh "$@" &
    ;;
  *) fail "tool must be apple or docker, not $tool" ;;
esac
run=$!
set +f

# On timeout stop the whole container, not just the client process, so no
# step is left running inside it.
# The sleep's own output is detached so that, once the watchdog is killed,
# a leftover sleep can't hold the caller's pipe open.
(
  sleep "$limit" < /dev/null > /dev/null 2>&1
  echo "run.sh: time limit of ${limit}s reached; stopping $name" >&2
  $stop > /dev/null 2>&1
) &
watchdog=$!

status=0
wait "$run" || status=$?
kill "$watchdog" 2> /dev/null || true

echo "run.sh: job folder $job"
exit "$status"
