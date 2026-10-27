# Container image

One Linux arm64 image that every Godot and Chromium step runs in, built from
the same pinned inputs under Apple `container` locally and Docker in CI.

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
