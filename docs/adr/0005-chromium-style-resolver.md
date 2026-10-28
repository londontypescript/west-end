# ADR 0005: Chromium resolves SVG styles and is a visual reference only

Date: 2026-10-27. Status: superseded by ADR 0011.

## Context

An SVG's final look depends on CSS: classes, inheritance and computed
values that are hard to resolve correctly by hand, and that Chromium
resolves exactly. Early work also tried to make Godot's output match
Chromium's pixels, which cost a lot of effort for differences nobody would
see.

## Decision

The converter uses Chromium to resolve each element's computed style from
the SVG input. Because a public converter will meet hostile SVGs, Chromium
runs with JavaScript disabled, every network request blocked, no file
access beyond the input, and time and size limits. Chromium's rendering is
a visual reference for what each effect should look like, not a parity
target: only the Godot render is published, so effects are judged by eye in
Godot.

## What would end it

A style resolver as exact as Chromium without a browser, or a need to
publish both renders side by side, which would make parity matter.
