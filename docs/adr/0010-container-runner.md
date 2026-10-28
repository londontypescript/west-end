# ADR 0010: Steps that need Godot or Chromium run in one pinned container

Date: 2026-10-27. Status: accepted; partly superseded by ADR 0011, which removes Chromium and the convert run policy and adds an output size bound to the render/check policy.

## Context

ADR 0003 (render only in a Linux container) puts Godot in a container;
this records how steps run there. Rendering, checks and SVG conversion need Godot 4.7.2, a working OpenGL
stack and Chromium. They must give the same result on an arm64 Mac (Apple
`container`) and in CI (Docker), and SVG input from outside has to be
treated as hostile. Installing the tools on each host would drift, and
running everything in the container would put the whole CLI and its
dependencies inside it.

## Decision

- **Host CLI, container steps.** The TypeScript CLI runs on the host for
  everything that needs no engine. Each step that needs Godot or Chromium
  runs in a fresh container, which is removed afterwards.
- **Node in the image.** The image carries Node 24, so an in-container step
  can run JavaScript. It runs only self-contained code: a bundled worker,
  never the host's `node_modules`.
- **One image, pinned.** `debian:bookworm-slim` by digest, Linux arm64 only,
  with every Debian package from snapshot.debian.org at recorded
  timestamps, and every other download checked against a recorded hash.
  The snapshot freezes security fixes too, so it is refreshed at least each
  milestone.
- **A fixed non-root user, UID 10001,** with its home and caches under
  `/tmp/job`. The entry command refuses root.
- **Two run policies.** Both: no network, read-only root filesystem with a
  tmpfs at `/tmp`, CPU, memory and time limits, and nothing from the host's
  home or credentials.
  - _Render/check_: the repository folders the step needs mounted
    read-only, one writable job folder for output. Godot works on a copy of
    the project in `/tmp/job`.
  - _Convert_ (hostile input): no repository mount; only the staged input
    copied into the job folder, the CLI's bundled runtime read-only, output
    bounded in size, and a process limit. Apple `container` 1.5.0 has no
    PID limit, only a per-user process limit, and that gap is recorded
    rather than hidden.
- **Chromium keeps its sandbox.** No `--no-sandbox`, no privileged
  container. If a runtime can't host the sandbox, that is a decision to
  make, not a flag to add.

## What would end it

A need for amd64 hosts or a GPU; Debian bookworm leaving security support
for Chromium; a runtime that can host neither of Chromium's sandboxes; or a
step that has to run on the host for speed.
