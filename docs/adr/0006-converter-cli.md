# ADR 0006: The converter is a TypeScript CLI

Date: 2026-10-27. Status: accepted.

## Context

The converter could be a command-line tool or a Godot editor import plugin
that converts SVGs as they're added to a project. The prototype's working
converter is TypeScript, which temple-bar's gate checks fully; a plugin
would need checks of its own and would run inside the editor, which here
only runs in a container.

## Decision

The converter is a TypeScript CLI. An editor import plugin is deferred, not
ruled out: if one is built, it calls the CLI rather than reimplementing it,
so there is only ever one converter.

## What would end it

Working inside the Godot editor becoming the main way characters are
updated, so an import plugin is worth building on top of the CLI.
