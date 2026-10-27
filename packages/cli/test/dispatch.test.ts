import { describe, expect, it } from 'vitest';
import type { Command, Io } from '../src/command.ts';
import { commands } from '../src/commands.ts';
import { dispatch, USAGE_ERROR } from '../src/dispatch.ts';

function recordingIo(): Io & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
  };
  return io;
}

describe('dispatch', () => {
  it('runs the named command with the remaining arguments and returns its exit code', async () => {
    const calls: (readonly string[])[] = [];
    const echo: Command = {
      name: 'echo',
      summary: 'Echoes',
      run(args, io) {
        calls.push(args);
        io.stdout(args.join(' '));
        return Promise.resolve(7);
      },
    };
    const io = recordingIo();

    expect(await dispatch(['echo', 'a', '--b'], [echo], io)).toBe(7);
    expect(calls).toEqual([['a', '--b']]);
    expect(io.out).toBe('a --b');
  });

  it('lists every registered command on --help and succeeds', async () => {
    const io = recordingIo();

    expect(await dispatch(['--help'], commands, io)).toBe(0);
    for (const name of ['convert', 'render', 'publish']) {
      expect(io.out).toMatch(new RegExp(`^  ${name} +\\S`, 'm'));
    }
    expect(io.err).toBe('');
  });

  it('lists the commands as a usage error when given no command', async () => {
    const io = recordingIo();

    expect(await dispatch([], commands, io)).toBe(USAGE_ERROR);
    expect(io.err).toContain('convert');
    expect(io.out).toBe('');
  });

  it('names an unknown command and exits with a usage error', async () => {
    const io = recordingIo();

    expect(await dispatch(['frobnicate'], commands, io)).toBe(USAGE_ERROR);
    expect(io.err).toContain("unknown command 'frobnicate'");
    expect(io.out).toBe('');
  });

  it.each(['convert', 'render', 'publish'])('fails %s until it is implemented', async (name) => {
    const io = recordingIo();

    expect(await dispatch([name], commands, io)).toBe(1);
    expect(io.err).toContain(`'${name}' is not implemented yet`);
  });
});
