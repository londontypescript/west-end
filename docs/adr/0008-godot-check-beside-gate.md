# ADR 0008: Godot is checked beside temple-bar's gate, not inside it

Date: 2026-10-27. Status: accepted.

## Context

temple-bar's gate runs four scripts, and its coverage check accepts only
`tsc`, `vitest` or `node --test` commands in `typecheck` and `test`. Its
fixed gate workflow only installs pnpm packages, so it can't provide Godot
or a container. Godot's checks can't run inside the gate without weakening
it or hiding a skip.

## Decision

Godot is checked by a second required check beside the gate:
`pnpm check:godot`, a script outside the gate's four, run in CI by the
`godot-check` workflow job. It lints and formats the GDScript, parses every
script, runs the GDScript test suites against an expected list, and checks
the fixtures' renders, all in the container. The `main` branch requires
both checks: a green gate means the TypeScript is good, and a green Godot
check means the Godot side is good.

## What would end it

temple-bar supporting non-TypeScript test suites in the gate: a coverage
form for an external runner that lists what it ran, and a way to give the
gate workflow extra setup. Then `check:godot` moves into the gate.
