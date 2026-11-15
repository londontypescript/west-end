import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES, MAX_NESTING } from '../../src/character/budgets.ts';
import { parseCharacterSource } from '../../src/character/parse-source.ts';
import { PROGRAM_FILE } from '../../src/character/syntax.ts';

it('parses only the supplied text and leaves a type import unresolved', () => {
  const read = vi.fn();
  const resolve = vi.fn();
  const unexpected = vi.fn();
  const filesystem = vi.spyOn(ts.sys, 'readFile');
  try {
    const text = "import type { Character } from './local.ts'; export default {} satisfies Character;";
    const { source } = parseCharacterSource(text, 'fixture.json', { read, resolve, unexpected });
    expect(source.fileName).toBe(PROGRAM_FILE);
    expect(source.text).toBe(text);
    expect(read.mock.calls).toEqual([[PROGRAM_FILE]]);
    expect(resolve.mock.calls).toEqual([[['./local.ts']]]);
    expect(unexpected).not.toHaveBeenCalled();
    expect(filesystem).not.toHaveBeenCalled();
  } finally {
    filesystem.mockRestore();
  }
});

it('refuses over-budget and invalid grammar before invoking the compiler host', () => {
  const read = vi.fn();
  const probe = { read, resolve: vi.fn(), unexpected: vi.fn() };
  expect(() => parseCharacterSource(' '.repeat(MAX_FILE_BYTES + 1), 'size.ts', probe)).toThrow(
    expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
  );
  expect(() => parseCharacterSource('export default input satisfies Character;', 'grammar.ts', probe)).toThrow(
    expect.objectContaining({ code: 'IDENTIFIER_VALUE' }),
  );
  expect(read).not.toHaveBeenCalled();
});

it('does not load files named by reference directives', () => {
  const read = vi.fn();
  const resolve = vi.fn();
  const unexpected = vi.fn();
  const text = [
    '/// <reference path="./other.ts" />',
    '/// <reference types="example" />',
    '/// <reference lib="esnext" />',
    'export default {} satisfies Character;',
  ].join('\n');
  expect(() => parseCharacterSource(text, 'fixture.ts', { read, resolve, unexpected })).not.toThrow();
  expect(read.mock.calls).toEqual([[PROGRAM_FILE]]);
  expect(unexpected).not.toHaveBeenCalled();
});

it('parses the maximum permitted nesting without parsing comment types', () => {
  const comment = '/** @type {string} */\n';
  const text =
    comment + 'export default ' + '['.repeat(MAX_NESTING) + '0' + ']'.repeat(MAX_NESTING) + ' satisfies Character;';
  const { source, grammar } = parseCharacterSource(text, 'nested.ts');
  expect(grammar.nesting).toBe(MAX_NESTING);
  expect(source.statements).toHaveLength(1);
  expect(source.statements[0]).not.toHaveProperty('jsDoc', expect.any(Array));
});
