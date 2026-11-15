// The checks that run before any syntax tree exists. TypeScript's parser is
// recursive, so text it would recurse deeply on (thousands of brackets, or a
// bracket-free chain like `!!!…` or `a ? b : c ? …`) could overflow the stack.
// This recogniser reads the scanner's tokens with an explicit, bounded stack
// and accepts exactly the character file grammar, so the parser only ever
// sees text whose depth is bounded by MAX_NESTING:
//
//   file    = [ "import" "type" "{" "Character" "}" "from" string ";" ]
//             "export" "default" wrapped [ ";" ]
//   wrapped = "(" wrapped ")" | value "satisfies" "Character"
//   value   = object | array | string | template-without-substitutions
//           | [ "-" ] number | "true" | "false"
//   object  = "{" [ key ":" value { "," key ":" value } [ "," ] ] "}"
//   array   = "[" [ value { "," value } [ "," ] ] "]"
//   key     = identifier | keyword | string
import ts from 'typescript';
import { MAX_FILE_BYTES, MAX_NESTING, MAX_TOKENS } from './budgets.ts';
import { shown, type Fail } from './errors.ts';

const SyntaxKind = ts.SyntaxKind;

// The only number spellings accepted: no `.5`, `1.`, hex, octal, binary,
// separators or bigint, so every number reads the same in any tool.
const NUMBER = /^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;

/** Step 1: refuses decoded text over its UTF-8 byte budget before scanning. */
export function checkBytes(text: string, fail: Fail): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_FILE_BYTES) {
    fail('FILE_TOO_LARGE', 0, `${String(bytes)} bytes is over the ${String(MAX_FILE_BYTES)}-byte limit`);
  }
}

type Frame = 'object' | 'array' | 'paren';

// Where the recogniser is. A `word` is one fixed token of the top level; the
// other states are inside or after a value.
type State =
  | { readonly kind: 'word'; readonly expect: ts.SyntaxKind; readonly text?: string; readonly next: State }
  | { readonly kind: 'start' | 'wrapped' | 'value' | 'elements' | 'after' | 'key' | 'colon' | 'close' | 'end' };

function word(expect: ts.SyntaxKind, next: State, text?: string): State {
  return text === undefined ? { kind: 'word', expect, next } : { kind: 'word', expect, text, next };
}
const AFTER_EXPORT = word(SyntaxKind.DefaultKeyword, { kind: 'wrapped' });
const AFTER_IMPORT = [
  [SyntaxKind.TypeKeyword],
  [SyntaxKind.OpenBraceToken],
  [SyntaxKind.Identifier, 'Character'],
  [SyntaxKind.CloseBraceToken],
  [SyntaxKind.FromKeyword],
  [SyntaxKind.StringLiteral],
  [SyntaxKind.SemicolonToken],
  [SyntaxKind.ExportKeyword],
].reduceRight<State>(
  (next, [expect, text]) => word(expect as ts.SyntaxKind, next, text as string | undefined),
  AFTER_EXPORT,
);
const AFTER_SATISFIES = word(SyntaxKind.Identifier, { kind: 'close' }, 'Character');

const CLOSERS = new Map<ts.SyntaxKind, Frame>([
  [SyntaxKind.CloseBraceToken, 'object'],
  [SyntaxKind.CloseBracketToken, 'array'],
  [SyntaxKind.CloseParenToken, 'paren'],
]);

/** Step 2: the grammar, token counts and nesting, before the parser runs. */
export function checkGrammar(text: string, fail: Fail): { tokens: number; nesting: number } {
  let scanError: { offset: number; detail: string } | undefined;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    text,
    (message, _length, argument) => {
      scanError ??= { offset: scanner.getTokenEnd(), detail: message.message.replace('{0}', String(argument ?? '')) };
    },
  );
  const stack: Frame[] = [];
  let state: State = { kind: 'start' };
  let tokens = 0;
  let nesting = 0;
  // Widened, so TypeScript doesn't narrow it across the closures that set it.
  let token = SyntaxKind.Unknown as ts.SyntaxKind;
  let start = 0;
  // Where the last key began, so a key with no value is refused at the key.
  let keyStart = 0;

  // Scans one token, refusing a scanner error and counting it.
  const scan = (): ts.SyntaxKind => {
    token = scanner.scan();
    start = scanner.getTokenStart();
    if (scanError !== undefined) fail('SYNTAX', scanError.offset, shown(scanError.detail));
    if (token !== SyntaxKind.EndOfFileToken && ++tokens > MAX_TOKENS) {
      fail('TOO_MANY_TOKENS', start, `more than ${String(MAX_TOKENS)} tokens`);
    }
    return token;
  };
  const tokenText = (): string => shown(scanner.getTokenText());
  const isWord = (): boolean => scanner.isIdentifier() || scanner.isReservedWord();
  const unexpected = (): never => fail('GRAMMAR', start, `'${tokenText()}' is not allowed here`);
  const push = (frame: Frame): void => {
    if (stack.length >= MAX_NESTING) fail('TOO_DEEP', start, `brackets nested deeper than ${String(MAX_NESTING)}`);
    stack.push(frame);
    nesting = Math.max(nesting, stack.length);
  };
  // A closer either ends the frame on top of the stack or is unmatched.
  const close = (): void => {
    if (CLOSERS.get(token) !== stack[stack.length - 1]) {
      fail('UNMATCHED_BRACKET', start, `'${tokenText()}' does not close the bracket that is open`);
    }
    stack.pop();
  };
  // Numbers are checked as they were spelled, then as the value they make.
  const number = (): void => {
    const raw = scanner.getTokenText();
    if (!NUMBER.test(raw)) fail('BAD_NUMBER', start, `write numbers as plain decimals, not '${tokenText()}'`);
    if (!Number.isFinite(Number(raw))) fail('BAD_NUMBER', start, `'${tokenText()}' is not a finite number`);
  };

  // The state after the first token of a value.
  const value = (): State => {
    switch (token) {
      case SyntaxKind.OpenBraceToken:
        push('object');
        return { kind: 'key' };
      case SyntaxKind.OpenBracketToken:
        push('array');
        return { kind: 'elements' };
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NoSubstitutionTemplateLiteral:
      case SyntaxKind.TrueKeyword:
      case SyntaxKind.FalseKeyword:
        return { kind: 'after' };
      case SyntaxKind.NumericLiteral:
        number();
        return { kind: 'after' };
      case SyntaxKind.MinusToken: {
        const minus = start;
        const end = scanner.getTokenEnd();
        if (scan() !== SyntaxKind.NumericLiteral || start !== end) {
          fail('BAD_NUMBER', minus, 'a `-` must come directly before a number');
        }
        number();
        return { kind: 'after' };
      }
      case SyntaxKind.TemplateHead:
        return fail('TEMPLATE_SUBSTITUTION', start, 'a template may not hold `${…}`');
      case SyntaxKind.BigIntLiteral:
        return fail('BAD_NUMBER', start, 'a bigint is not allowed');
      case SyntaxKind.DotDotDotToken:
        return fail('SPREAD', start, 'a spread is not allowed');
      case SyntaxKind.CommaToken:
        return stack[stack.length - 1] === 'array'
          ? fail('EMPTY_SLOT', start, 'a list may not have an empty slot')
          : unexpected();
      default:
        if (CLOSERS.has(token) && CLOSERS.get(token) !== stack[stack.length - 1]) close();
        if (isWord()) return fail('IDENTIFIER_VALUE', start, `a name like '${tokenText()}' can't be a value`);
        return unexpected();
    }
  };

  // After a value: a separator, the frame's closer, or at the top level `satisfies`.
  const after = (): State => {
    const frame = stack[stack.length - 1];
    if (frame === 'object' || frame === 'array') {
      if (token === SyntaxKind.CommaToken) return { kind: frame === 'object' ? 'key' : 'elements' };
      if (CLOSERS.has(token)) {
        close();
        return { kind: 'after' };
      }
      return unexpected();
    }
    if (token === SyntaxKind.SatisfiesKeyword) return AFTER_SATISFIES;
    if (CLOSERS.has(token) && CLOSERS.get(token) !== frame) close();
    return unexpected();
  };

  for (;;) {
    scan();
    if (token === SyntaxKind.EndOfFileToken) {
      if (state.kind !== 'end' && !(state.kind === 'close' && stack.length === 0)) {
        fail('GRAMMAR', start, 'the file ends before the character does');
      }
      return { tokens, nesting };
    }
    // A keyword spelled with escapes is a syntax error in TypeScript; in a
    // key it is only a name, and allowed.
    if (
      state.kind !== 'key' &&
      scanner.hasUnicodeEscape() &&
      token >= SyntaxKind.FirstKeyword &&
      token <= SyntaxKind.LastKeyword
    ) {
      fail('SYNTAX', start, 'a keyword may not be spelled with escapes');
    }

    switch (state.kind) {
      case 'start':
        if (token === SyntaxKind.ImportKeyword) state = AFTER_IMPORT;
        else if (token === SyntaxKind.ExportKeyword) state = AFTER_EXPORT;
        else unexpected();
        break;
      case 'word':
        if (token !== state.expect || (state.text !== undefined && scanner.getTokenValue() !== state.text))
          unexpected();
        state = state.next;
        break;
      case 'wrapped':
        if (token === SyntaxKind.OpenParenToken) push('paren');
        else state = value();
        break;
      case 'value':
        state = value();
        break;
      case 'elements':
        if (token === SyntaxKind.CloseBracketToken) {
          close();
          state = { kind: 'after' };
        } else state = value();
        break;
      case 'after':
        state = after();
        break;
      case 'key':
        if (CLOSERS.has(token)) {
          close();
          state = { kind: 'after' };
        } else if (token === SyntaxKind.StringLiteral || isWord()) {
          keyStart = start;
          state = { kind: 'colon' };
        } else if (token === SyntaxKind.NumericLiteral || token === SyntaxKind.BigIntLiteral) {
          fail('NUMERIC_KEY', start, 'a key must be a name or a string, not a number');
        } else if (token === SyntaxKind.OpenBracketToken) {
          fail('COMPUTED_KEY', start, 'a computed key is not allowed');
        } else if (token === SyntaxKind.DotDotDotToken) {
          fail('SPREAD', start, 'a spread is not allowed');
        } else unexpected();
        break;
      case 'colon':
        if (token === SyntaxKind.ColonToken) state = { kind: 'value' };
        else if (token === SyntaxKind.CommaToken || token === SyntaxKind.CloseBraceToken) {
          fail('SHORTHAND', keyStart, 'every key needs `: value`');
        } else unexpected();
        break;
      case 'close':
        if (CLOSERS.has(token)) close();
        else if (token === SyntaxKind.SemicolonToken && stack.length === 0) state = { kind: 'end' };
        else unexpected();
        break;
      case 'end':
        unexpected();
    }
  }
}
