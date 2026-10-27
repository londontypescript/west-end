// What every command is given and must provide. Commands never touch
// `process` themselves: they write through `Io` and return their exit code,
// so tests can run them in-process and read exactly what they said.

/** Where a command writes. The real one is `process.stdout`/`stderr`. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface Command {
  /** The word typed after `west-end`. */
  readonly name: string;
  /** One line for the help listing. */
  readonly summary: string;
  /** Runs with the arguments after the command's name; resolves to the exit code. */
  run(args: readonly string[], io: Io): Promise<number>;
}
