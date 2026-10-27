# Container image

One Linux arm64 image that every Godot and Chromium step runs in, built from
the same pinned inputs under Apple `container` locally and Docker in CI.

## Building

Always through the wrapper, which reads and checks [`pins.env`](pins.env)
and passes every pin as an explicit `--build-arg` with
`--platform linux/arm64`:

```sh
container/build.sh apple west-end:<tag>             # Apple container
container/build.sh docker west-end:<tag>            # Docker
container/build.sh apple west-end:<tag> --no-cache  # every step again
```

It stops before building on a missing, unknown, repeated or malformed pin,
or on pins that disagree (a Godot URL that isn't the named ZIP, for
example). `--no-cache` is the only extra option it accepts, so a pin can't
be overridden from the command line. The [`Containerfile`](Containerfile)
gives no argument a default, so building it directly fails instead of
guessing.

Built and checked locally with Apple `container` 1.5.0 on an arm64 Mac.
Docker build parity is checked in CI (phase I); Docker isn't installed
locally. The image is Linux arm64 only: an amd64 build stops at the first
step with `architecture is amd64, expected arm64`.

## What is in the image

| Path                            | What                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `/opt/godot/godot`              | Godot, also on `PATH` as `godot`                         |
| `/opt/node`                     | Node; only `node` is on `PATH`                           |
| `/opt/gdtoolkit`                | venv with `gdlint` and `gdformat`, both on `PATH`        |
| `/opt/gdunit4/addons/gdUnit4`   | the gdUnit4 add-on, for a project to copy                |
| `/opt/west-end/packages.txt`    | every installed Debian package, version and architecture |
| `/opt/west-end/python.txt`      | every Python package in the venv                         |
| `/opt/west-end/pins.txt`        | the pins the image was built from                        |
| `/opt/west-end/steps/`          | the build steps that ran                                 |
| `/usr/local/bin/west-end-entry` | the entry command ([`entry.sh`](entry.sh))               |

Debian packages come only from the snapshot (see below), with xvfb, Mesa
(llvmpipe), the X libraries Godot needs, ffmpeg, Chromium and its setuid
sandbox helper, Python and fonts. `LIBGL_ALWAYS_SOFTWARE=1` and
`GALLIUM_DRIVER=llvmpipe` are set, so rendering never touches a host GPU.

The build fails if any of these hold: the architecture isn't arm64; a
snapshot `InRelease` differs from its pinned hash; apt has an index from
anywhere but the two snapshot URLs; an installed package is one the
snapshot doesn't serve (for example newer than it) or is older than the
snapshot's; `chrome-sandbox` isn't setuid root; the Godot ZIP, the Godot
binary, the Node tarball or the gdUnit4 archive doesn't match its hash; the
gdUnit4 archive wasn't made from the pinned commit; pip meets a file
without a listed hash, or would need to build from source.

## Running steps: the contract

The TypeScript CLI runs on the host for everything that needs no engine.
Steps that need Godot or Chromium run in this image, one container per
step, under one of two policies.

Both policies:

- `--network none`.
- Run as the image's user, `--user 10001:10001`. The entry command refuses
  root.
- Nothing from the host's home: no credentials, no SSH agent (never
  `--ssh`), no host `node_modules`. Node in the image runs only
  self-contained code (pure JavaScript or a bundled worker).
- Root filesystem read-only (`--read-only`) with a tmpfs at `/tmp`.
  [`entry.sh`](entry.sh) creates `HOME` and the `XDG_*` folders (and with
  them Godot's and gdtoolkit's caches) under `/tmp/job`, each mode 0700,
  then `exec`s the step with umask 022, so it receives the caller's signals
  directly and what it writes to the job folder is readable by the host
  user. Under Docker on Linux those files belong to UID 10001; the caller
  may need `sudo chown -R "$(id -u):$(id -g)" "$job"` before handling them.
- CPU, memory and time limits set by the caller. On timeout or interrupt
  the caller kills and removes the whole container (`container kill` then
  `container delete --force`, or `docker kill` then `docker rm --force`),
  never just the client process, and confirms it is gone. The step runs as
  PID 1, which ignores SIGTERM, so a polite stop only waits out its grace
  period. [`smoke/run.sh`](smoke/run.sh) does this from a watchdog and
  from `EXIT`, `INT` and `TERM` traps, retrying for up to a minute while
  the client may still be creating the container. A time limit is
  not optional: Godot that can't start its renderer opens an alert dialog
  under Xvfb and waits for a click forever (seen with Mesa's drivers
  missing), so the smoke checks also wrap each engine and browser run in
  `timeout`.
- `--rm`: the container is removed after the run.
- Shared memory for Chromium: `--shm-size 1G` on both tools. Debian's
  Chromium wrapper (`/etc/chromium.d/dev-shm`) adds
  `--disable-dev-shm-usage` whenever `/dev/shm` is under 3.8 GB, so
  Chromium then keeps that memory in the `/tmp` tmpfs instead; this changes
  where shared memory lives, not the sandbox.

**Render/check policy** (Godot renders, checks, tests): the repository's
needed folders mounted read-only, never including `node_modules`; one
writable job folder for output. Godot runs on a copy of the project in
`/tmp/job/work`, so its import cache never lands in a mount.

**Convert policy** (hostile input, such as an SVG from outside): no
repository mount at all. Only the staged input file, copied by the caller
into the job folder; the CLI's runtime mounted read-only; output bounded in
size; a process limit. Docker has `--pids-limit`. Apple `container` 1.5.0
has no PID limit: the nearest is `--ulimit nproc=<n>`, a per-user process
limit, which bounds the step's user only. That gap is real and is
documented rather than faked; the hostile-SVG policy itself is phase E's.

The caller creates the job folder and makes it writable by UID 10001:

```sh
# Apple container on macOS: UID 10001 has no host account.
job=$(mktemp -d) && chmod 0777 "$job"
# Docker on Linux: give it to UID 10001 alone.
job=$(mktemp -d) && sudo chown 10001:10001 "$job" && chmod 0700 "$job"
```

A render/check run with Apple `container`, as
[`smoke/run.sh`](smoke/run.sh) does it:

```sh
container run --rm --name <job> --network none \
  --read-only --tmpfs /tmp --shm-size 1G \
  --cpus 4 --memory 4G --ulimit nproc=2048 --user 10001:10001 \
  --mount type=bind,source=<repo>/container,target=/repo/container,readonly \
  --volume "$job:/out" \
  west-end:<tag> <command> [argument...]
```

With Docker the same run uses `--tmpfs /tmp:size=2g --pids-limit 2048` in
place of the `--tmpfs` and `--ulimit` options.

## Smoke checks

[`smoke/run.sh`](smoke/run.sh) runs [`smoke/smoke.sh`](smoke/smoke.sh) in the
image under the render/check policy against the throwaway project in
[`smoke/project`](smoke/project):

```sh
container/smoke/run.sh apple west-end:<tag>          # every check
container/smoke/run.sh apple west-end:<tag> gl       # one check
```

- `versions`: Godot, Node and gdtoolkit match the pins; Chromium matches
  its Debian package; ffmpeg runs.
- `gl`: a graphical run, not `--headless`, under `xvfb-run` with the X11
  display driver, the Compatibility renderer on OpenGL 3 and llvmpipe. The
  log must name llvmpipe as the OpenGL renderer, and a frame written with
  `--write-movie` must show the scene's red rectangle on its blue
  background.
- `check`: `godot --headless --check-only` parses the project's script.
- `gdtoolkit`: `gdlint` and `gdformat --check` accept that script.
- `gdunit`: one gdUnit4 test, run headless, writes a JUnit report.
  [`smoke/junit.py`](smoke/junit.py) parses it and requires exactly one
  suite with exactly one test case that ran and passed, and totals of one
  test, no failures, no errors and no skips.
- `chromium`: headless Chromium, as UID 10001 with its sandbox on (no
  `--no-sandbox`, no `--disable-setuid-sandbox`, no extra privileges),
  renders a one-rectangle SVG to a PNG that shows the rectangle. It then
  starts Chromium again, inspects each live renderer in `/proc`, names the
  sandbox it is under, and fails if neither holds:
  - both kinds: the renderer is in seccomp mode 2 with more seccomp filters
    (`Seccomp_filters`) than the checking shell, so Chromium's own
    seccomp-bpf filter is loaded. A container runtime's filter, such as
    Docker's default profile, sits on both processes and so can't pass for
    it;
  - namespace sandbox: the renderer is in a user namespace of its own;
  - setuid sandbox: the renderer shares the shell's user namespace but has
    PID and network namespaces of its own, and descends from the
    `chrome-sandbox` helper.

  Under Apple `container` 1.5.0 the result is the namespace sandbox. The
  setuid helper can't work there: its attempt to make PID and network
  namespaces fails with `Operation not permitted`, so that branch is first
  exercised in CI. Under Docker the expected result is the namespace
  sandbox if the runtime allows unprivileged user namespaces, otherwise the
  setuid sandbox if the helper may create namespaces. With Docker's
  default seccomp profile and capabilities, neither may be possible, and
  the check then fails rather than passing on Docker's own filter.

Each Godot and Chromium run has its own time limit, `SMOKE_STEP_LIMIT`
seconds (default 120), and the whole run `SMOKE_TIME_LIMIT` (a positive
whole number, default 600). The sandbox probe stops Chromium with SIGTERM,
then SIGKILL after a short grace, and fails if any Chromium process
outlives both. `SMOKE_RENDERING_DRIVER` (letters, digits and `_` only)
replaces `opengl3` in the `gl` check, only to show that check failing.
`run.sh` accepts only the known step names. Logs and outputs stay in the
job folder the script prints at the end.

## Refreshing the pins

A frozen snapshot also freezes Chromium's security fixes, so refresh at
least once a milestone. The snapshot timestamps, the base image digest and
Chromium move together: take a new base digest, then snapshot timestamps no
older than the base's archive date, then record the new `InRelease` hashes.
For each pin, follow its source below, change its one line in `pins.env`
(or `requirements.txt`), rebuild with `--no-cache` and run the smoke
checks.

## Pins

Every input is pinned in [`pins.env`](pins.env), except the Python wheels,
which are pinned with their hashes in [`requirements.txt`](requirements.txt)
because that is where pip reads them. Updating a pin means changing its line
there, after checking the new value against the source given below. All
values below were looked up on 27 October 2026.

### Base image

- `BASE_IMAGE`: `debian:bookworm-slim` pinned by its multi-arch index digest
  `sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8`,
  read from Docker Hub's registry API
  (`registry-1.docker.io/v2/library/debian/manifests/bookworm-slim`, the
  `docker-content-digest` header, which matches the SHA-256 of the index
  body). Its arm64 manifest is
  `sha256:991827bb788d78bbc130dcb851913beecff43296360f48838aca7cbdfae4375c`.
  The image config records how it was made: `debuerreotype 0.17`,
  `debian.sh --arch 'arm64' out/ 'bookworm' '@1792531975'`, that is from the
  Debian archive as it stood at 2026-10-20 21:32:55 UTC.

### Debian snapshot

Packages come from [snapshot.debian.org](https://snapshot.debian.org/), never
a live mirror. Timestamps were chosen from snapshot's own list
(`/mr/timestamp/?archive=debian` and `?archive=debian-security`) as the
newest available, and both are a week later than the base image's archive
date above, so the snapshot is never older than the packages already in the
base.

| Pin                        | Value              | Serves                         |
| -------------------------- | ------------------ | ------------------------------ |
| `SNAPSHOT_DEBIAN`          | `20261027T143223Z` | `bookworm`, `bookworm-updates` |
| `SNAPSHOT_DEBIAN_SECURITY` | `20261027T204336Z` | `bookworm-security`            |

SHA-256 of each suite's `InRelease` at those timestamps, also in `pins.env`
so the build can check what apt fetched:

| Suite               | `InRelease` SHA-256                                                | `Date` inside it              |
| ------------------- | ------------------------------------------------------------------ | ----------------------------- |
| `bookworm`          | `77737fa4b34f2693e982cc9ee35736816c35a7778fc2d326cc1bbf5b301fe1aa` | Sat, 11 Jul 2026 10:16:37 UTC |
| `bookworm-updates`  | `5b16e36816b3b678bf8741c5bdc7f748f24bb4e8e3df23b79059414747e00170` | Tue, 27 Oct 2026 14:10:58 UTC |
| `bookworm-security` | `a8201320a40fd8213991516946f76247cbade840cecfe31edb7e2702905b28ed` | Tue, 27 Oct 2026 20:43:09 UTC |

Bookworm is Debian's oldstable (12.15) at these timestamps. Its signatures are
checked by apt with the keyring already in the base image. Versions this
snapshot resolves for the packages that matter most (arm64): `chromium`
`156.0.8078.47-1~deb12u1` (bookworm-security), `ffmpeg` `7:5.1.9-0+deb12u1`,
`libgl1-mesa-dri` `22.3.6-1+deb12u2`, `xvfb` `2:21.1.7-3+deb12u13`
(bookworm-security), `python3.11` `3.11.2-6+deb12u9` (bookworm-security).

### Godot

- `GODOT_URL`, `GODOT_ZIP`: the `Godot_v4.7.2-stable_linux.arm64.zip` asset
  of the [4.7.2-stable release](https://github.com/godotengine/godot/releases/tag/4.7.2-stable).
- `GODOT_ZIP_SHA512`: the line for that file in the release's
  `SHA512-SUMS.txt`. The downloaded ZIP's SHA-512 matched it, and its SHA-256
  matched the digest GitHub reports for the asset
  (`5dd0d86405cf7e8adf79fb6377b38ba682a2846cb378ffe5364f38c01ad29b9d`).
- `GODOT_BINARY_SHA512`: the SHA-512 of the binary inside the ZIP, which
  equals the owner's independently verified local copy. The build checks
  both: the ZIP before extracting, the binary after.

### Node

- `NODE_VERSION`, `NODE_URL`: Node 24.22.1, the newest 24.x release (an LTS
  security release of 20 October 2026, from `nodejs.org/dist/index.json`),
  official `linux-arm64` tarball. It needs glibc 2.28 or later; bookworm has
  2.36.
- `NODE_SHA256`: the tarball's line in
  `nodejs.org/dist/v24.22.1/SHASUMS256.txt`, and the downloaded tarball's
  SHA-256 matched it. That file's signatures (`SHASUMS256.txt.asc`, clear
  signed, and `SHASUMS256.txt.sig`, detached) were verified on the host with
  `gpgv` against the active-keys keyring of
  [nodejs/release-keys](https://github.com/nodejs/release-keys) at commit
  `481637f813e912c4aa3622d7964ab426c97b8e8d`
  (`gpg-only-active-keys/pubring.kbx`). The signing key was
  `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`, one of the primary releaser
  keys listed in Node's own README at `v24.22.1`. The other active releaser
  keys in that list are:
  - `DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7`
  - `CC68F5A3106FF448322E48ED27F5E38D5B0A215F`
  - `890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4`
  - `C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C`
  - `108F52B48DB57BB0CC439B2997B01419BD92F80A`
  - `655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD`
  - `A363A499291CBBC940DD62E41F10027AF002F8B0`

  The build itself only enforces `NODE_SHA256`: the signature check happens
  when the pin changes.

### gdtoolkit

- `gdtoolkit==4.5.0` (9 October 2025) is the newest release on PyPI, and the
  repository has no commits after it. Its
  [changelog](https://github.com/Scony/godot-gdscript-toolkit/blob/master/CHANGELOG.md)
  adds Godot 4.5's new syntax (`@abstract` functions, variadic functions).
  Godot added no GDScript syntax between 4.5 and 4.7.2 at the lexical level:
  the token list (`enum Type` in `modules/gdscript/gdscript_tokenizer.h`) and
  the registered annotations (`register_annotation` in
  `gdscript_parser.cpp`) are identical at `4.5-stable` and `4.7.2-stable`.
  The smoke project runs gdlint and gdformat against a Godot 4.7 script.
- Its dependencies are pinned to the versions gdtoolkit and radon require
  (`lark[regex]==1.2.2`, `docopt-ng==0.9.0`, `radon==6.0.1`, which needs
  `mando<0.8`, which needs `six`; `colorama`) or to the newest release
  where only a floor is given (`pyyaml`, `regex`, `setuptools`).
- Each hash is PyPI's SHA-256 (`/pypi/<name>/<version>/json`) for the one
  wheel pip selects on CPython 3.11, Linux aarch64: pure-Python
  `py3-none-any` wheels, and `cp311` `manylinux_2_17_aarch64` wheels for
  `pyyaml` and `regex`.
- pip itself is not pinned here: the venv's pip is Debian's 23.0.1
  (`python3-pip-whl` `23.0.1+dfsg-1`), fixed by the snapshot, and it
  installs every wheel above. If a future wheel needs a newer pip, pin pip
  as one more hashed wheel installed first.
- Known open upstream issues that may matter later:
  gdformat can indent closers after a multi-line lambda in a way Godot
  rejects (issue 424), and concurrent gdlint/gdformat runs can race on the
  parser cache directory (issue 428).

### gdUnit4

- `GDUNIT4_TAG`: `v6.2.2` (7 October 2026), the newest release of
  [gdUnit4](https://github.com/godot-gdunit-labs/gdUnit4). Its README's
  compatibility table at that tag lists v6.2.x as compatible with Godot
  v4.5 to v4.7.1, including v4.7 and v4.7.1, and its pull-request CI matrix
  (`.github/workflows/ci-pr.yml`) runs Godot 4.7 and 4.7.1. Neither names
  4.7.2, a maintenance release of the same branch; the smoke run here is the
  check that it works with 4.7.2.
- `GDUNIT4_COMMIT`: what `refs/tags/v6.2.2` points to (a lightweight tag on
  a commit), from GitHub's API `git/ref/tags/v6.2.2`.
- `GDUNIT4_URL`, `GDUNIT4_SHA256`: GitHub's source archive of the tag and its
  SHA-256. The archive records the commit it was made from in its tar
  header, which the build checks against `GDUNIT4_COMMIT`. GitHub does not
  promise that generated archives keep the same bytes forever; if the
  SHA-256 ever changes while the commit stays the same, the archive was
  regenerated and the pin needs re-checking, not just a new hash.
