# ADR 0003: Render only in a Linux container

Date: 2026-10-27. Status: accepted.

## Context

Running Godot natively on the owner's machine steals focus, even for
renders that need no window, which interrupts whatever the owner is doing.
Native renders would also differ between the owner's machine and CI, so a
render couldn't be checked the same way in both.

## Decision

Godot runs only inside a Linux container: Apple's `container` locally and
Docker in CI, from the same pinned image, with a virtual display and
software rendering, so nothing ever opens a window on the owner's machine.
The pinned engine is Godot 4.7.2 with the GL Compatibility renderer.

## What would end it

Godot gaining a native headless renderer that never takes focus, or the
container's software rendering proving too slow, or too far from what
viewers see, for the work it has to do.
