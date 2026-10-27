#!/usr/bin/env node
// The only file that touches `process`: it hands the real argv and streams
// to the dispatcher and sets the exit code from what comes back.
import { commands } from './commands.ts';
import { dispatch } from './dispatch.ts';

process.exitCode = await dispatch(process.argv.slice(2), commands, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
