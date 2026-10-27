#!/bin/sh
# Runs the smoke checks in the image under the render/check policy (see
# container/README.md): no network, the repository's container/ folder
# mounted read-only, one fresh job folder as the only writable mount, CPU,
# memory, process and time limits, and the container removed afterwards,
# however the run ends.
#
#   container/smoke/run.sh <apple|docker> <image> [step...]
#
# SMOKE_TIME_LIMIT (whole seconds, default 600) bounds the whole run;
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

case $tool in
  apple | docker) ;;
  *) fail "tool must be apple or docker, not $tool" ;;
esac

# Steps are known words only, so they can be kept as one string.
for step in "$@"; do
  case $step in
    versions | gl | check | gdtoolkit | gdunit | chromium) ;;
    *) fail "unknown step '$step'" ;;
  esac
done
steps="$*"

limit=${SMOKE_TIME_LIMIT:-600}
case $limit in
  '' | *[!0-9]* | 0*) fail "SMOKE_TIME_LIMIT must be a positive whole number of seconds" ;;
esac

driver=${SMOKE_RENDERING_DRIVER:-}
if [ -n "$driver" ] && ! printf '%s' "$driver" | grep -E -q '^[a-z0-9_]+$'; then
  fail "SMOKE_RENDERING_DRIVER may only hold a-z, 0-9 and _"
fi

here=$(cd "$(dirname "$0")" && pwd)
# Only the repository's container/ folder is mounted: everything the checks
# read is there, and the host's node_modules must never reach the image.
source=$(cd "$here/.." && pwd)
name="west-end-smoke-$$"

# The caller owns the job folder. The image's user is UID 10001, which has
# no account on the host, so the folder is opened to it here; see the
# README for the stricter Linux form.
job=$(mktemp -d "${TMPDIR:-/tmp}/west-end-smoke.XXXXXX")
chmod 0777 "$job"

# Whether the named container exists: 0 yes, 1 no, 2 can't tell.
exists() {
  if [ "$tool" = apple ]; then
    answer=$(container inspect "$name" 2>&1 > /dev/null) && return 0
    case $answer in *"not found"*) return 1 ;; esac
  else
    answer=$(docker container inspect "$name" 2>&1 > /dev/null) && return 0
    case $answer in *"No such container"*) return 1 ;; esac
  fi
  return 2
}

# A time-out or an interrupt means stop now: the step runs as PID 1, which
# ignores SIGTERM, so a polite stop would only wait out its grace period.
remove() {
  if [ "$tool" = apple ]; then
    container kill "$name" > /dev/null 2>&1 || true
    container delete --force "$name" > /dev/null 2>&1 || true
  else
    docker kill "$name" > /dev/null 2>&1 || true
    docker rm --force "$name" > /dev/null 2>&1 || true
  fi
}

# Whether the client process is still running. An exited client stays a
# zombie until it is reaped, which counts as gone.
client_alive() {
  process_state=$(ps -o stat= -p "$run" 2> /dev/null) || return 1
  case $process_state in
    Z*) return 1 ;;
  esac
  return 0
}

# Stops and removes the container, then confirms it is gone. The client may
# still be creating it, so keep trying until both the client has exited and
# the container is gone, for at most 60 tries a second apart; then kill the
# client and make one last removal.
stop_container() {
  tries=0
  while [ "$tries" -lt 60 ]; do
    state=0
    exists || state=$?
    if [ "$state" -ne 1 ]; then
      remove
    elif ! client_alive; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  kill -9 "$run" 2> /dev/null || true
  remove
  state=0
  exists || state=$?
  [ "$state" -eq 1 ] && return 0
  echo "run.sh: could not confirm that container $name was removed" >&2
  return 1
}

run=
watchdog=
cleaned=
cleanup() {
  [ -z "$cleaned" ] || return 0
  cleaned=yes
  [ -z "$watchdog" ] || kill "$watchdog" 2> /dev/null || true
  [ -z "$run" ] || stop_container || status=1
}
status=0
trap 'cleanup; echo "run.sh: job folder $job"; exit "$status"' EXIT
trap 'status=130; exit' INT
trap 'status=143; exit' TERM

if [ "$tool" = apple ]; then
  set -- container run --rm --name "$name" --network none \
    --read-only --tmpfs /tmp --shm-size 1G \
    --cpus 4 --memory 4G --ulimit nproc=2048
else
  set -- docker run --rm --name "$name" --network none \
    --read-only --tmpfs /tmp:size=2g --shm-size 1g \
    --cpus 4 --memory 4g --pids-limit 2048
fi
set -- "$@" --user 10001:10001
if [ -n "$driver" ]; then
  set -- "$@" --env "SMOKE_RENDERING_DRIVER=$driver"
fi
set -- "$@" \
  --mount "type=bind,source=$source,target=/repo/container,readonly" \
  --volume "$job:/out" \
  "$image" sh /repo/container/smoke/smoke.sh
for step in $steps; do
  set -- "$@" "$step"
done

"$@" &
run=$!

# On timeout stop and remove the whole container, not just the client
# process, so no step is left running inside it. The sleep's own output is
# detached so a leftover sleep can't hold the caller's pipe open.
(
  trap - EXIT INT TERM
  sleep "$limit" < /dev/null > /dev/null 2>&1
  echo "run.sh: time limit of ${limit}s reached; stopping $name" >&2
  stop_container
) &
watchdog=$!

wait "$run" || status=$?
