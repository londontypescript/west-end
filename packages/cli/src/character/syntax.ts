// Step 3: syntax errors, through TypeScript's public API. A one-file program
// over an in-memory host parses the text and reports its syntactic
// diagnostics. Nothing is type-checked, resolved or loaded: the host answers
// only for this one file, says every module and type reference is
// unresolved, and has no library. Any other call that would reach the
// filesystem goes to `probe.unexpected`, which tests turn into a failure.
import ts from 'typescript';

/** The name the program knows the file by. The caller's name never reaches
 * TypeScript, so a name ending `.json`, `.tsx` or `.d.ts` can't change how
 * the text is parsed. */
export const PROGRAM_FILE = '/character.ts';

/** What the host reports to a test that instruments it. */
export interface HostProbe {
  /** The host read or looked up this file name. */
  read(fileName: string): void;
  /** The program asked to resolve modules or type references. */
  resolve(names: readonly string[]): void;
  /** The program called a method that would reach the filesystem. */
  unexpected(method: string, argument: string): void;
}

const quiet: HostProbe = { read() {}, resolve() {}, unexpected() {} };

/** Parses the text and returns the tree with the first syntax error, if any. */
export function parseSyntax(
  text: string,
  probe: HostProbe = quiet,
): { source: ts.SourceFile; error?: { offset: number; detail: string } } {
  const source = ts.createSourceFile(
    PROGRAM_FILE,
    text,
    // JSDoc is never parsed: a comment is trivia the preflight doesn't
    // bound, and its type syntax would be parsed recursively.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    ts.ScriptKind.TS,
  );
  const ours = (fileName: string): boolean => {
    probe.read(fileName);
    return fileName === PROGRAM_FILE;
  };
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => (ours(fileName) ? source : undefined),
    fileExists: (fileName) => ours(fileName),
    readFile: (fileName) => (ours(fileName) ? text : undefined),
    getDefaultLibFileName: () => '/no-lib.d.ts',
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
    resolveModuleNameLiterals: (literals) => {
      probe.resolve(literals.map((literal) => literal.text));
      return literals.map(() => ({ resolvedModule: undefined }));
    },
    resolveTypeReferenceDirectiveReferences: (references) => {
      probe.resolve(references.map((reference) => (typeof reference === 'string' ? reference : reference.fileName)));
      return references.map(() => ({ resolvedTypeReferenceDirective: undefined }));
    },
    writeFile: (fileName) => probe.unexpected('writeFile', fileName),
    directoryExists: (name) => {
      probe.unexpected('directoryExists', name);
      return false;
    },
    getDirectories: (name) => {
      probe.unexpected('getDirectories', name);
      return [];
    },
    realpath: (name) => {
      probe.unexpected('realpath', name);
      return name;
    },
    readDirectory: (name) => {
      probe.unexpected('readDirectory', name);
      return [];
    },
    getEnvironmentVariable: (name) => {
      probe.unexpected('getEnvironmentVariable', name);
      return undefined;
    },
  };
  const program = ts.createProgram({
    rootNames: [PROGRAM_FILE],
    options: { noResolve: true, noLib: true, types: [], noEmit: true, allowJs: false, target: ts.ScriptTarget.Latest },
    host,
  });
  const [first] = program.getSyntacticDiagnostics(source);
  if (first === undefined) return { source };
  return {
    source,
    error: { offset: first.start ?? 0, detail: ts.flattenDiagnosticMessageText(first.messageText, ' ') },
  };
}
