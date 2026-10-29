# Container image

One Linux arm64 image that every Godot step runs in, built from the same
pinned inputs under Apple `container` locally and Docker in CI. Why it is
shaped this way is in [ADR 0010](../docs/adr/0010-container-runner.md), as
amended by [ADR 0011](../docs/adr/0011-characters-as-data.md).

## Building

```sh
container/build.sh apple west-end:<tag>             # Apple container
container/build.sh docker west-end:<tag>            # Docker
container/build.sh apple west-end:<tag> --no-cache  # every step again
```

[`build.sh`](build.sh) reads [`pins.env`](pins.env), refuses a missing,
unknown, repeated, malformed or inconsistent pin, and passes each one as its
own `--build-arg` with `--platform linux/arm64`. `--no-cache` is the only
option it accepts. The [`Containerfile`](Containerfile) gives no argument a
default, so building it directly fails.

The build stops if: the architecture isn't arm64; a snapshot `InRelease`
differs from its pinned hash; apt has an index from anywhere but the two
snapshot URLs; an installed package is one the snapshot doesn't serve or is
older than the snapshot's; the Godot ZIP, the Godot binary, the Node
tarball or the gdUnit4 archive doesn't match its hash; the gdUnit4 archive
wasn't made from the pinned commit; or pip meets a file without a listed
hash or a source build.

Built and checked with Apple `container` 1.5.0 on an arm64 Mac. Docker build
parity is checked in CI (phase I).

## What is in the image

| Path                            | What                                              |
| ------------------------------- | ------------------------------------------------- |
| `/opt/godot/godot`              | Godot, also `godot` on `PATH`                     |
| `/opt/node`                     | Node; only `node` is on `PATH`                    |
| `/opt/gdtoolkit`                | venv with `gdlint` and `gdformat`, both on `PATH` |
| `/opt/gdunit4/addons/gdUnit4`   | the gdUnit4 add-on, for a project to copy         |
| `/opt/west-end/packages.txt`    | every Debian package, version and architecture    |
| `/opt/west-end/python.txt`      | every Python package in the venv                  |
| `/opt/west-end/pins.txt`        | the pins the image was built from                 |
| `/usr/local/bin/west-end-entry` | the entry command, [`entry.sh`](entry.sh)         |

Debian packages: xvfb, Mesa (llvmpipe), the X libraries Godot needs,
ffmpeg, Python for gdtoolkit, and fonts. `LIBGL_ALWAYS_SOFTWARE=1` and
`GALLIUM_DRIVER=llvmpipe` are set.

## Running a step

One container per step, as UID 10001, under ADR 0010's render/check policy.
With Apple `container`:

```sh
job=$(mktemp -d) && chmod 0777 "$job"   # UID 10001 has no host account
container run --rm --name <job> --network none \
  --read-only --tmpfs /tmp \
  --cpus 4 --memory 4G --ulimit nproc=2048 --user 10001:10001 \
  --mount type=bind,source=<folder>,target=<path>,readonly \
  --volume "$job:/out" \
  west-end:<tag> <command> [argument...]
```

With Docker, use `--tmpfs /tmp:size=2g --pids-limit 2048` in place of the
`--tmpfs` and `--ulimit` options, and on Linux give the job folder to UID
10001 (`sudo chown 10001:10001 "$job" && chmod 0700 "$job"`), then `chown`
it back before reading the output.

- [`entry.sh`](entry.sh) refuses root, creates `HOME` and the `XDG_*`
  folders under `/tmp/job` (mode 0700), and `exec`s the step with umask
  022, so its signals arrive directly and its output is readable.
- The step runs as PID 1, which ignores SIGTERM: on a time-out the caller
  kills and removes the container (`container kill`, `container delete
--force`; `docker kill`, `docker rm --force`) and confirms it is gone.
- Time limits aren't optional: Godot that can't start its renderer opens an
  alert under Xvfb and waits for a click forever.
- Never mount the host's home, credentials, SSH agent or `node_modules`.
- Apple `container` 1.5.0 has no PID limit; `--ulimit nproc` bounds the
  step's user only.

## Refreshing the pins

A frozen snapshot also freezes security fixes, so refresh at least once a
milestone. The base digest and the snapshot timestamps move together: take
a new base digest, then timestamps no older than the base's archive date,
then their `InRelease` hashes. Change each pin's one line in `pins.env`
(wheels in `requirements.txt`), checked against its source below, then rebuild with `--no-cache`.

## Pins and their sources

Looked up on 27 October 2026.

- **`BASE_IMAGE`**: `debian:bookworm-slim` by index digest
  `sha256:7ff6ba31…e3f8`, from Docker Hub's registry API
  (`docker-content-digest`, equal to the index body's SHA-256). Its config
  says debuerreotype built it from the Debian archive at 2026-10-20
  21:32:55 UTC.
- **`SNAPSHOT_DEBIAN`** `20261027T143223Z` (bookworm, bookworm-updates) and
  **`SNAPSHOT_DEBIAN_SECURITY`** `20261027T204336Z` (bookworm-security):
  the newest in snapshot.debian.org's `/mr/timestamp/` lists, a week after
  the base's archive date. Packages come over plain HTTP, since the slim
  base has no CA certificates; apt checks signatures with the base's
  keyring.
- **`INRELEASE_*_SHA256`**: each suite's `InRelease` at those timestamps,
  checked by the build against what apt fetched. Bookworm is oldstable
  (12.15) there. Notable versions: `ffmpeg` `7:5.1.9-0+deb12u1`,
  `libgl1-mesa-dri` `22.3.6-1+deb12u2`.
- **`GODOT_*`**: the `Godot_v4.7.2-stable_linux.arm64.zip` asset of the
  [4.7.2-stable release](https://github.com/godotengine/godot/releases/tag/4.7.2-stable).
  `GODOT_ZIP_SHA512` is its line in the release's `SHA512-SUMS.txt`, which
  the download matched, as did GitHub's asset digest.
  `GODOT_BINARY_SHA512` is the binary inside, equal to the owner's verified
  copy.
- **`NODE_*`**: Node 24.22.1, the newest 24.x (an LTS security release),
  official `linux-arm64` tarball. `NODE_SHA256` is its line in
  `SHASUMS256.txt`, whose `.asc` and `.sig` signatures were verified with
  `gpgv` against [nodejs/release-keys](https://github.com/nodejs/release-keys)
  at `481637f8`. Signing key: `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`;
  the other active releaser keys in Node's README are
  `DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7`,
  `CC68F5A3106FF448322E48ED27F5E38D5B0A215F`,
  `890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4`,
  `C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C`,
  `108F52B48DB57BB0CC439B2997B01419BD92F80A`,
  `655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD` and
  `A363A499291CBBC940DD62E41F10027AF002F8B0`. The build enforces the
  SHA-256; the signatures are checked when the pin changes.
- **`GDUNIT4_*`**: [gdUnit4](https://github.com/godot-gdunit-labs/gdUnit4)
  `v6.2.2`, the newest release. Its README's compatibility table lists
  v6.2.x for Godot v4.5 to v4.7.1 and its CI tests 4.7 and 4.7.1; 4.7.2,
  a maintenance release, is proved by running it (phase G). The commit is
  what the tag points to; the archive's first tar block records the commit
  it was made from, which the build checks. GitHub doesn't promise its
  archives keep the same bytes: if the hash changes while the commit
  doesn't, re-check the pin.
- **`requirements.txt`**: gdtoolkit 4.5.0, the newest release, which adds
  Godot 4.5's syntax. Godot's GDScript token list and annotations are
  identical at `4.5-stable` and `4.7.2-stable`. Dependencies are at the
  versions gdtoolkit and radon require, or the newest where only a floor is
  given. Each hash is PyPI's for the one wheel pip picks on CPython 3.11,
  Linux aarch64. The venv's pip is Debian's 23.0.1, which installs them
  all.
