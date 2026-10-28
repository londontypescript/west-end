# ADR 0001: Characters built from primitives, not imported SVGs

Date: 2026-10-27. Status: superseded by ADR 0011.

## Context

Characters are drawn as SVG, but Godot imports an SVG as a flat texture. A
texture can't be rigged part by part, loses sharpness when a part is scaled
or rotated, and can't take effects such as group opacity or glow on its
pieces. The options were importing each part's SVG as a texture, or
converting the drawing into Godot's own shapes.

## Decision

The converter reads the SVG and emits Godot primitives (polygons, lines and
the nodes that group them), one node per part, so every part can be posed,
masked and given effects in Godot and stays sharp at any scale. The
converter supports a documented subset of SVG and refuses or reports
anything outside it, rather than drawing it wrongly.

## What would end it

Godot gaining a vector import that keeps an SVG's structure as separate,
riggable nodes with the effects we need, or characters needing SVG features
that can't be expressed as primitives at a reasonable cost.
