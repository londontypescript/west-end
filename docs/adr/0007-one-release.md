# ADR 0007: One release holds the CLI and the Godot addon

Date: 2026-10-27. Status: accepted.

## Context

The CLI emits scenes that the Godot addon's code runs, so the two must
match: a scene from one version of the converter can break under another
version of the addon. Releasing them separately would let them drift.

## Decision

The CLI (built) and the Godot addon ship together as one versioned npm
package. Its `sync-addon` command copies the addon into a production's
Godot project and records the version and a hash, and a check fails if the
copy has changed. Publishing to npm starts at milestone 5, with the owner's
yes; until then, users point at a local checkout.

## What would end it

The addon gaining users who don't use the CLI, or the CLI and addon
settling on a stable, versioned scene format that lets them release apart.
