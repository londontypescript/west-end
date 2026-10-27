# ADR 0004: Render at 2× and scale down

Date: 2026-10-27. Status: accepted.

## Context

Drawn characters are made of thin lines and curves, whose edges look jagged
when rendered straight at the output size in the container.

## Decision

Every render is drawn at twice the output size in each direction and scaled
down to it. That smooths edges the same way in every environment, at the
cost of render time. Effects that depend on size, such as a blur's radius,
are scaled by the node's on-screen scale so they look the same at any
supersampling.

## What would end it

Anti-aliasing in the container matching 2× supersampling in quality, or
render time becoming the limit, so a cheaper method is worth the loss.
