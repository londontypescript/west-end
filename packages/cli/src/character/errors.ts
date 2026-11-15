// The one error that leaves the reader. Everything an attacker controls that
// ends up in its message (the file name, a quoted name or key, a TypeScript
// diagnostic, a cycle chain) goes through `shown` first, so a message printed
// to a terminal or written into a log can't carry control, format or bidi
// characters, or run on for pages.

/** Every refusal code, in the order the reader's steps can raise them. */
export type Code =
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_TOKENS'
  | 'TOO_DEEP'
  | 'GRAMMAR'
  | 'IDENTIFIER_VALUE'
  | 'SHORTHAND'
  | 'COMPUTED_KEY'
  | 'NUMERIC_KEY'
  | 'SPREAD'
  | 'TEMPLATE_SUBSTITUTION'
  | 'EMPTY_SLOT'
  | 'BAD_NUMBER'
  | 'UNMATCHED_BRACKET'
  | 'SYNTAX';

/** How many characters of one attacker-controlled item a message shows. */
const SHOWN_LENGTH = 40;

// Control (Cc), format (Cf, which holds the bidi controls), line and
// paragraph separators, lone surrogates and noncharacters: anything that can
// move a terminal's cursor, reorder text or fail to encode.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\u{fdd0}-\u{fdef}\u{fffe}\u{ffff}]/u;

/**
 * One attacker-controlled item, made safe to print: unsafe characters become
 * `\u{…}`, and anything past 40 characters becomes `…`. An escape is never
 * cut in half.
 */
export function shown(text: string): string {
  let out = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const piece = UNSAFE.test(char) || (codePoint & 0xfffe) === 0xfffe ? `\\u{${codePoint.toString(16)}}` : char;
    if (out.length + piece.length > SHOWN_LENGTH) return `${out}…`;
    out += piece;
  }
  return out;
}

/** A one-based line and column in the file. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** How many template placements a trace keeps: the outermost ones. */
const MAX_TRACE = 4;

export class CharacterError extends Error {
  /** Stable: tests and callers match on this, never on the wording. */
  readonly code: Code;
  /** The file name exactly as the caller gave it, unescaped. */
  readonly file: string;
  /** One-based. */
  readonly line: number;
  /** One-based, in UTF-16 code units, as editors count. */
  readonly column: number;
  /**
   * For a fault inside a template: the placements that reached it, outermost
   * first, at most MAX_TRACE of them. For a fault a placement caused: the
   * template's own position. Empty otherwise, or for an unused template.
   */
  readonly trace: readonly Position[];

  constructor(
    code: Code,
    file: string,
    line: number,
    column: number,
    detail: string,
    trace: readonly Position[] = [],
    cut = false,
  ) {
    // Positions only: nothing quoted from the file goes into the trace.
    const through = trace.map((entry) => `${String(entry.line)}:${String(entry.column)}`).join(' → ');
    const shorter = cut ? `, cut to the outermost ${String(MAX_TRACE)}` : '';
    const placed = trace.length === 0 ? '' : ` (placed from ${through}${shorter})`;
    super(`${shown(file)}:${String(line)}:${String(column)}: ${code}: ${detail}${placed}`);
    this.name = 'CharacterError';
    this.code = code;
    this.file = file;
    this.line = line;
    this.column = column;
    this.trace = Object.freeze(trace.map((entry) => Object.freeze({ line: entry.line, column: entry.column })));
  }
}

/** Throws the refusal at a character offset in the text. */
export type Fail = (code: Code, offset: number, detail: string) => never;

/**
 * The one-based line and column of an offset, counting the line breaks
 * ECMAScript counts (LF, CR, CRLF, U+2028, U+2029) so positions agree with
 * TypeScript's and an editor's. It allocates nothing and reads only up to
 * the offset: a refusal is found once, and a file refused for its size,
 * at 1:1, is never scanned at all.
 */
export function position(text: string, offset: number): { line: number; column: number } {
  if (offset === 0) return { line: 1, column: 1 };
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x0d && text.charCodeAt(index + 1) === 0x0a) continue;
    if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
