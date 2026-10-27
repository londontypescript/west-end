# Shared helpers for the build steps. Sourced, not run.

fail() {
  echo "west-end image build: $*" >&2
  exit 1
}

# Every pin arrives as a build argument with no default, so an empty one
# means build.sh was bypassed or pins.env lost a line: stop rather than
# build from a guess.
require() {
  for name in "$@"; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || fail "build argument $name is empty; build with container/build.sh"
  done
}

# Bounded retries with exponential backoff (2, 4, 8, 16 seconds), because
# snapshot.debian.org and release hosts drop connections under load. Five
# tries, then give up: never fall back to another source.
retry() {
  attempt=1
  delay=2
  while :; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge 5 ]; then
      fail "gave up after $attempt tries: $*"
    fi
    echo "west-end image build: try $attempt failed, retrying in ${delay}s: $*" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

fetch() {
  retry curl --fail --silent --show-error --location --proto '=https' \
    --tlsv1.2 --output "$2" "$1"
}

# Compares a file's digest with the pinned one and names both on failure,
# so a swapped download is obvious from the build log alone.
check_digest() {
  algorithm=$1
  expected=$2
  file=$3
  actual=$("${algorithm}sum" "$file" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] ||
    fail "$algorithm mismatch for $file: pinned $expected, got $actual"
  echo "west-end image build: $algorithm ok for $file"
}
