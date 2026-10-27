import type { Command } from './command.ts';

// Each stub fails until its phase replaces it, so nothing downstream can
// mistake a placeholder for a real conversion, render or publish.
function notImplemented(name: string, summary: string): Command {
  return {
    name,
    summary,
    run(_args, io) {
      io.stderr(`west-end: '${name}' is not implemented yet\n`);
      return Promise.resolve(1);
    },
  };
}

/** Every command `west-end` knows, in the order help lists them. */
export const commands: readonly Command[] = [
  notImplemented('convert', 'Convert a character from SVG into a Godot scene'),
  notImplemented('render', 'Render an animation with Godot'),
  notImplemented('publish', 'Publish rendered videos, posters and stills'),
];
