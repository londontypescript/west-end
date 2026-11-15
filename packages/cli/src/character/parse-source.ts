import { CharacterError, position, shown, type Fail } from './errors.ts';
import { checkBytes, checkGrammar } from './preflight.ts';
import { parseSyntax, type HostProbe } from './syntax.ts';

/** The compiler sees only text that has passed the byte and grammar checks. */
export function parseCharacterSource(text: string, file: string, probe?: HostProbe) {
  const fail: Fail = (code, offset, detail) => {
    const { line, column } = position(text, offset);
    throw new CharacterError(code, file, line, column, detail);
  };
  checkBytes(text, fail);
  const grammar = checkGrammar(text, fail);
  const { source, error } = parseSyntax(text, probe);
  if (error !== undefined) fail('SYNTAX', error.offset, shown(error.detail));
  return { source, grammar };
}
