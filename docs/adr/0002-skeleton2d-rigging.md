# ADR 0002: Godot's Skeleton2D for rigging, with our own limits and fallback solver

Date: 2026-10-27. Status: accepted. Since ADR 0011, a character's manifest is its character file.

## Context

Puppets need joints that bend naturally and inverse kinematics for reaching
and pointing. A rig system written from scratch is a lot of code to own.
Godot's Skeleton2D and its IK already exist, but they don't enforce the
joint limits each character needs, and their solving can't be relied on
for every pose.

## Decision

Rig with Godot's Skeleton2D. Each character's manifest gives its pivots and
joint limits, which our addon enforces on top of Skeleton2D. Where Godot's
solver can't give a pose within those limits, our own fallback solver takes
over. This keeps the rig inside Godot's tooling while giving us the control
the puppets need.

## What would end it

Godot's 2D skeleton gaining reliable joint limits and solving, so our
limits and fallback aren't needed, or Skeleton2D proving unable to drive
the puppets' parts.
