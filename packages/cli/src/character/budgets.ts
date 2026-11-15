// Every limit the reader enforces, in one place. A budget refuses only when a
// count goes past it: exactly at the limit is accepted. Each is set so the
// calibration character (Rad Dad, 900×1200) uses at most an eighth of it.

// ---- The file, before and while it is parsed ----

/** Bytes of UTF-8: bounds everything the scanner and parser allocate. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Tokens the scanner may return, so the parser's work is bounded. */
export const MAX_TOKENS = 400_000;
/** Open brackets of any kind at once: bounds the parser's recursion. Rad Dad nests 16 deep. */
export const MAX_NESTING = 128;
