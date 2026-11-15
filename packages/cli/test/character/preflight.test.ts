import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_NESTING, MAX_TOKENS } from '../../src/character/budgets.ts';
import { CharacterError, position, shown, type Fail } from '../../src/character/errors.ts';
import { checkBytes, checkGrammar } from '../../src/character/preflight.ts';

function diagnose(text: string): Fail {
  return (code, offset, detail) => {
    const { line, column } = position(text, offset);
    throw new CharacterError(code, 'character.ts', line, column, detail);
  };
}

const file = (literal: string): string => `export default ${literal} satisfies Character;`;
const scan = (text: string): { tokens: number; nesting: number } => checkGrammar(text, diagnose(text));

describe('character grammar preflight', () => {
  it('counts bytes as UTF-8 and refuses only past the limit', () => {
    const limit = 'é'.repeat(MAX_FILE_BYTES / 2);
    expect(() => checkBytes(limit, diagnose(limit))).not.toThrow();
    const over = limit + ' ';
    expect(() => checkBytes(over, diagnose(over))).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
  });

  it('accepts a type-only import and nested literal data', () => {
    const text = "import type { Character } from './type.ts'; " + file("{ name: 'Test', points: [-2, true] }");
    expect(scan(text).nesting).toBe(2);
  });

  it('refuses the first level past the nesting limit', () => {
    const nested = (count: number): string => file('['.repeat(count) + '0' + ']'.repeat(count));
    expect(scan(nested(MAX_NESTING)).nesting).toBe(MAX_NESTING);
    expect(() => scan(nested(MAX_NESTING + 1))).toThrow(expect.objectContaining({ code: 'TOO_DEEP' }));
  });

  it('refuses the first token past the token limit', () => {
    const list = (count: number, trailing: string): string => file('[' + '0,'.repeat(count) + trailing + ']');
    const count = (MAX_TOKENS - scan(list(0, '0')).tokens) / 2;
    expect(scan(list(count, '0')).tokens).toBe(MAX_TOKENS);
    expect(() => scan(list(count + 1, ''))).toThrow(expect.objectContaining({ code: 'TOO_MANY_TOKENS' }));
  });

  it.each([
    ['{name}', 'SHORTHAND'],
    ['{value: input}', 'IDENTIFIER_VALUE'],
    ['{value: 1n}', 'BAD_NUMBER'],
    ['[0,,1]', 'EMPTY_SLOT'],
    ['{[name]: 1}', 'COMPUTED_KEY'],
    ['{1: "name"}', 'NUMERIC_KEY'],
    ['{...other}', 'SPREAD'],
    ['{value: (1)}', 'GRAMMAR'],
    ['[1}', 'UNMATCHED_BRACKET'],
  ])('refuses %s during grammar preflight', (value, code) => {
    expect(() => scan(file(value))).toThrow(expect.objectContaining({ code }));
  });
});

describe('scanner diagnostics', () => {
  it.each([
    ['export default {', 'GRAMMAR'],
    ['export default {} satisfies', 'GRAMMAR'],
    ['/* unfinished', 'SYNTAX'],
    [file('1e999'), 'BAD_NUMBER'],
    [file('- 1'), 'BAD_NUMBER'],
    [file('-x'), 'BAD_NUMBER'],
    [file('01'), 'SYNTAX'],
    [file('1_0'), 'BAD_NUMBER'],
    [String.raw`exp\u006frt default {} satisfies Character;`, 'SYNTAX'],
    [file("{name: 'unfinished}"), 'SYNTAX'],
    [file('`name${true}`'), 'TEMPLATE_SUBSTITUTION'],
    [file('0x10'), 'BAD_NUMBER'],
  ])('reports the expected syntax or grammar refusal for %s', (text, code) => {
    expect(() => scan(text)).toThrow(expect.objectContaining({ code }));
  });

  it('accepts escaped keyword keys and templates without substitutions', () => {
    expect(() => scan(file(String.raw`{def\u0061ult: \`name\`}`.replaceAll('\\`', '`')))).not.toThrow();
  });

  it.each(['\n', '\r', '\r\n', '\u2028', '\u2029'])('reports the position after %j', (lineBreak) => {
    const text = 'export default {' + lineBreak + '  field: input} satisfies Character;';
    expect(() => scan(text)).toThrow(expect.objectContaining({ line: 2, column: 10 }));
  });

  it('counts parentheses around the entire expression', () => {
    const wrapped = (count: number): string =>
      'export default ' + '('.repeat(count) + '0 satisfies Character' + ')'.repeat(count) + ';';
    expect(scan(wrapped(MAX_NESTING)).nesting).toBe(MAX_NESTING);
    expect(() => scan(wrapped(MAX_NESTING + 1))).toThrow(expect.objectContaining({ code: 'TOO_DEEP' }));
  });

  it('escapes unsafe filename characters and counts CRLF as one line break', () => {
    const text = 'first\r\nsecond';
    const { line, column } = position(text, 8);
    const error = new CharacterError('GRAMMAR', 'a\u202eb.ts' + 'x'.repeat(60), line, column, 'unexpected token');
    expect(error.message).toMatch(/^a\\u\{202e\}b\.ts[x]+…:2:2: GRAMMAR: unexpected token$/u);
  });
});

describe('scanner boundaries for expressions and diagnostics', () => {
  it.each(['!true', 'true ? 1 : 2'])('rejects the expression %s', (value) => {
    expect(() => scan(file(value))).toThrow(expect.objectContaining({ code: 'GRAMMAR' }));
  });

  it.each([0x1b, 0xd800, 0x2028, 0xfdd0, 0x1ffff])('escapes unsafe code point %s', (codePoint) => {
    expect(shown(String.fromCodePoint(codePoint))).toBe('\\u{' + codePoint.toString(16) + '}');
  });

  it('keeps printable astral text and truncates at 40 units without splitting an escape', () => {
    expect(shown('🚀')).toBe('🚀');
    expect(shown('a'.repeat(40))).toBe('a'.repeat(40));
    expect(shown('a'.repeat(41))).toBe('a'.repeat(40) + '…');
    expect(shown('a'.repeat(39) + String.fromCodePoint(0x1b))).toBe('a'.repeat(39) + '…');
  });
});
