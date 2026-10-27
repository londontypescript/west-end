#!/bin/sh
# Smoke checks, run inside the image by container/smoke/run.sh under the
# render/check policy: the repository read-only at /repo, the job folder
# writable at /out, no network. Each step prints PASS or stops with FAIL.
#
#   smoke.sh [versions|gl|check|gdtoolkit|gdunit|chromium]...
set -eu

out=/out
work=/tmp/job/work
project=/repo/container/smoke/project
steps=${*:-versions gl check gdtoolkit gdunit chromium}

pass() {
  echo "PASS $*"
}

fail() {
  echo "FAIL $*" >&2
  exit 1
}

# Godot that can't start its renderer opens an alert and waits for a click
# that never comes, so every engine and browser run gets its own limit.
limited() {
  timeout --kill-after=10 "${SMOKE_STEP_LIMIT:-120}" "$@"
}

# Names a failed exit status, telling a time-out apart from a crash.
exit_reason() {
  case $1 in
    124 | 137) echo "timed out after ${SMOKE_STEP_LIMIT:-120}s" ;;
    *) echo "exited $1" ;;
  esac
}

pinned() {
  sed -n "s/^$1=//p" /opt/west-end/pins.txt
}

# Prints a pixel as "r g b", read with ffmpeg so no image library is needed.
pixel() {
  ffmpeg -v error -i "$1" -vf "crop=1:1:$2:$3" -f rawvideo -pix_fmt rgb24 - |
    od -An -tu1 | tr -s ' ' | sed 's/^ //; s/ $//'
}

# Checks a pixel is close to a pure colour: each channel within 40 of 0 or
# 255 as the name says.
expect_colour() {
  rgb=$(pixel "$1" "$2" "$3")
  case $4 in
    red) want="255 0 0" ;;
    green) want="0 255 0" ;;
    blue) want="0 0 255" ;;
    white) want="255 255 255" ;;
  esac
  set -- $rgb $want "$1" "$2" "$3" "$4"
  [ "$#" -eq 10 ] || fail "could not read pixel ($8, $9) of $7"
  for channel in 1 2 3; do
    eval "got=\${$channel}; target=\${$((channel + 3))}"
    difference=$((got - target))
    [ "${difference#-}" -le 40 ] ||
      fail "pixel ($8, $9) of $7 is '$rgb', expected ${10}"
  done
}

prepare() {
  [ -f "$work/project.godot" ] && return 0
  cp -R "$project/." "$work/"
  mkdir -p "$work/addons"
  cp -R /opt/gdunit4/addons/gdUnit4 "$work/addons/"
  # Godot writes its import cache into the project, which is why the
  # project is copied out of the read-only mount first.
  limited godot --headless --path "$work" --import > "$out/import.log" 2>&1 ||
    fail "godot --import failed; see import.log"
}

step_versions() {
  godot_version=$(godot --version)
  case $godot_version in
    "$(pinned GODOT_VERSION).stable."*) ;;
    *) fail "godot reports $godot_version, pinned $(pinned GODOT_VERSION)" ;;
  esac
  [ "$(node --version)" = "v$(pinned NODE_VERSION)" ] ||
    fail "node reports $(node --version), pinned $(pinned NODE_VERSION)"
  chromium_package=$(sed -n 's/^chromium\t\([^-]*\)-.*/\1/p' /opt/west-end/packages.txt)
  chromium_version=$(chromium --version)
  case $chromium_version in
    *" $chromium_package "*) ;;
    *) fail "chromium reports '$chromium_version', package is $chromium_package" ;;
  esac
  ffmpeg_version=$(ffmpeg -version | sed -n '1s/^ffmpeg version \([^ ]*\).*/\1/p')
  [ -n "$ffmpeg_version" ] || fail "ffmpeg -version printed no version"
  gdtoolkit=$(sed -n 's/^gdtoolkit==//p' /opt/west-end/python.txt)
  gdlint --version | grep -q -F "$gdtoolkit" || fail "gdlint is not $gdtoolkit"
  gdformat --version | grep -q -F "$gdtoolkit" || fail "gdformat is not $gdtoolkit"
  pass "versions: godot $godot_version, node $(node --version)," \
    "$chromium_version, ffmpeg $ffmpeg_version, gdlint and gdformat $gdtoolkit"
}

# A real graphical run: X11 display server, the Compatibility renderer on
# OpenGL 3, Mesa's llvmpipe. Headless mode would use a dummy renderer and
# write blank frames, so the log must name llvmpipe and a frame must show
# the scene's red rectangle on its blue background.
step_gl() {
  prepare
  driver=${SMOKE_RENDERING_DRIVER:-opengl3}
  rm -rf "$out/gl"
  mkdir -p "$out/gl"
  status=0
  limited xvfb-run --auto-servernum --server-args "-screen 0 320x180x24 -nolisten tcp" \
    godot --path "$work" --display-driver x11 \
    --rendering-method gl_compatibility --rendering-driver "$driver" \
    --audio-driver Dummy --resolution 320x180 --fixed-fps 10 \
    --write-movie "$out/gl/frame.png" --quit-after 3 \
    > "$out/gl.log" 2>&1 || status=$?
  [ "$status" -eq 0 ] || fail "gl: godot $(exit_reason "$status"); see gl.log"
  renderer=$(grep -E '^OpenGL API ' "$out/gl.log" || true)
  case $renderer in
    *llvmpipe*) ;;
    *) fail "gl: the log names no llvmpipe OpenGL renderer: '$renderer'" ;;
  esac
  frame=$(find "$out/gl" -name 'frame*.png' | LC_ALL=C sort | tail -n 1)
  [ -n "$frame" ] || fail "gl: no frame was written"
  expect_colour "$frame" 160 90 red
  expect_colour "$frame" 5 5 blue
  pass "gl: $renderer; $(basename "$frame") shows the red rectangle on blue"
}

step_check() {
  prepare
  status=0
  limited godot --headless --path "$work" --check-only --script res://main.gd \
    > "$out/check.log" 2>&1 || status=$?
  [ "$status" -eq 0 ] || fail "check: godot --check-only $(exit_reason "$status"); see check.log"
  if grep -q -E 'SCRIPT ERROR|Parse Error' "$out/check.log"; then
    fail "check: parse errors; see check.log"
  fi
  pass "check: main.gd parses with --headless --check-only"
}

step_gdtoolkit() {
  gdlint "$project/main.gd" > "$out/gdlint.log" 2>&1 ||
    fail "gdlint: main.gd has problems; see gdlint.log"
  gdformat --check "$project/main.gd" > "$out/gdformat.log" 2>&1 ||
    fail "gdformat: main.gd is not formatted; see gdformat.log"
  pass "gdtoolkit: gdlint and gdformat --check accept main.gd"
}

step_gdunit() {
  prepare
  rm -rf "$out/gdunit" "$work/reports"
  status=0
  # gdUnit4 resolves its report folder inside the project, so the report is
  # written there and copied out.
  (cd "$work" && GODOT_BIN=/opt/godot/godot limited bash addons/gdUnit4/runtest.sh \
    --headless --ignoreHeadlessMode -a res://test -rd reports) \
    > "$out/gdunit.log" 2>&1 || status=$?
  [ "$status" -eq 0 ] || fail "gdunit: runtest.sh $(exit_reason "$status"); see gdunit.log"
  [ -d "$work/reports" ] || fail "gdunit: no report folder written"
  cp -R "$work/reports" "$out/gdunit"
  report=$(find "$out/gdunit" -name results.xml | head -n 1)
  [ -n "$report" ] || fail "gdunit: no JUnit report written"
  summary=$(grep -o -m 1 '<testsuites [^>]*>' "$report")
  case $summary in
    *'tests="1"'*'failures="0"'*) ;;
    *) fail "gdunit: report does not show one passing test: $summary" ;;
  esac
  pass "gdunit: ${report#"$out/"}: $summary"
}

# Chromium as the non-root user with its sandbox on: no --no-sandbox, no
# --disable-setuid-sandbox. Chromium refuses to start without a working
# sandbox unless told to, so a screenshot here means the sandbox started.
step_chromium() {
  prepare
  rm -rf "$out/chromium"
  mkdir -p "$out/chromium"
  status=0
  limited chromium --headless --user-data-dir=/tmp/job/chromium-profile \
    --no-first-run --hide-scrollbars --window-size=200,200 \
    --screenshot="$out/chromium/rect.png" "file://$work/rect.svg" \
    > "$out/chromium.log" 2>&1 || status=$?
  [ "$status" -eq 0 ] || fail "chromium: $(exit_reason "$status"); see chromium.log"
  [ -s "$out/chromium/rect.png" ] || fail "chromium: no screenshot written"
  expect_colour "$out/chromium/rect.png" 100 100 green
  expect_colour "$out/chromium/rect.png" 5 5 white
  pass "chromium: headless render of rect.svg shows the green rectangle"
  sandbox_proof
}

# Prints the PIDs of running Chromium processes of one --type.
chromium_pids() {
  for dir in /proc/[0-9]*; do
    tr '\0' ' ' < "$dir/cmdline" 2> /dev/null | grep -q -e "--type=$1 " &&
      echo "${dir#/proc/}"
  done
  return 0
}

# Starting is not proof enough: look at a live renderer. Each must run under
# a seccomp-bpf filter (mode 2) and in a user namespace of its own, which is
# what Chromium's sandbox sets up.
sandbox_proof() {
  chromium --headless --user-data-dir=/tmp/job/chromium-probe --no-first-run \
    --remote-debugging-port=0 about:blank > "$out/chromium-sandbox.log" 2>&1 &
  renderers=
  tries=0
  while [ -z "$renderers" ] && [ "$tries" -lt 40 ]; do
    sleep 0.5
    renderers=$(chromium_pids renderer)
    tries=$((tries + 1))
  done
  own_namespace=$(readlink /proc/self/ns/user)
  verdict=ok
  for pid in $renderers; do
    seccomp=$(sed -n 's/^Seccomp:[[:space:]]*//p' "/proc/$pid/status")
    namespace=$(readlink "/proc/$pid/ns/user")
    [ "$seccomp" = 2 ] && [ "$namespace" != "$own_namespace" ] ||
      verdict="renderer $pid has seccomp mode '$seccomp' in $namespace"
  done
  for pid in $(chromium_pids zygote) $(chromium_pids renderer) \
    $(chromium_pids gpu-process) $(chromium_pids utility) "$!"; do
    kill "$pid" 2> /dev/null || true
  done
  wait 2> /dev/null || true
  [ -n "$renderers" ] || fail "chromium: no renderer process appeared"
  [ "$verdict" = ok ] || fail "chromium: sandbox not in force: $verdict"
  pass "chromium: sandbox in force, renderers $(echo $renderers) under" \
    "seccomp-bpf in their own user namespace, as UID $(id -u)"
}

for step in $steps; do
  case $step in
    versions | gl | check | gdtoolkit | gdunit | chromium) "step_$step" ;;
    *) fail "unknown step $step" ;;
  esac
done
