import type { Command, Io } from './command.ts';

/** Exit code for a command line the tool can't act on, kept apart from 1 so
 * a caller can tell "you typed it wrong" from "the command failed". */
export const USAGE_ERROR = 2;

function helpText(commands: readonly Command[]): string {
  const width = Math.max(...commands.map((command) => command.name.length));
  const lines = commands.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return ['Usage: west-end <command> [args]', '', 'Commands:', ...lines, ''].join('\n');
}

/**
 * Runs the command `argv[0]` names with the rest of `argv`, and resolves to
 * the exit code. `--help` lists the commands and succeeds; no command at all
 * lists them as a usage error, so a script that lost its argument fails
 * rather than passing silently.
 */
export async function dispatch(argv: readonly string[], commands: readonly Command[], io: Io): Promise<number> {
  const [name, ...args] = argv;
  if (name === '--help' || name === '-h') {
    io.stdout(helpText(commands));
    return 0;
  }
  if (name === undefined) {
    io.stderr(helpText(commands));
    return USAGE_ERROR;
  }
  const command = commands.find((candidate) => candidate.name === name);
  if (command === undefined) {
    io.stderr(`west-end: unknown command '${name}'\n\n${helpText(commands)}`);
    return USAGE_ERROR;
  }
  return command.run(args, io);
}
