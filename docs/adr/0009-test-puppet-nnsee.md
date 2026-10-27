# ADR 0009: The test puppet is Nnsée

Date: 2026-10-27. Status: accepted.

## Context

The pipeline needs a test puppet that grows feature by feature as
milestones add them. The options were drawing a new character from scratch
or using one that already exists. Nnsée is the owner's own character, the
public name the owner uses for all public tech and social media; it's
already designed, and the owner is London TypeScript's organiser and public
face.

## Decision

The test puppet is Nnsée, rather than a new character. It is the only thing
that comes across from the owner's private productions, and it is scrubbed
by hand with the owner before its first push. Nnsée's artwork, rig and
likeness are not covered by the code's MIT licence:
[PROVENANCE.md](../../PROVENANCE.md) gives the terms.

## What would end it

The owner no longer using the Nnsée name or likeness in public, or the
pipeline needing a test puppet anyone may reuse freely, so an original,
openly licensed character is drawn instead.
