import { gunzipSync } from 'node:zlib';

// The asset scanner. The repo accepts original vector artwork, and raster
// images or video only once they are reviewed and recorded in PROVENANCE.md;
// it accepts no audio. This checks every file the repo would commit against
// those rules. It is a pure function over file contents, so its tests can
// feed it synthetic files and never need real ones in the repo.

export interface FileEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

type Rule = 'audio-or-video' | 'raster-image' | 'svg-raster';

interface Problem {
  readonly path: string;
  readonly rule: Rule;
  readonly detail: string;
}

// Everything the repo would commit, behind a seam so tests can fake git and
// the filesystem. `read` returns undefined for a listed file that is gone
// (deleted in the working tree but still in the index).
export interface RepoSource {
  list(): readonly string[];
  read(path: string): Uint8Array | undefined;
}

// Audio is never accepted, listed or not.
const AUDIO_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'aif',
  'aiff',
  'caf',
  'wma',
  'weba',
  'mka',
]);

// Video can carry a sound track, so it is accepted only once recorded in
// PROVENANCE.md, like a raster.
const VIDEO_EXTENSIONS = new Set(['webm', 'mkv', 'mp4', 'm4v', 'mov']);

// Characters are drawn from vector primitives (ADR 0001); a raster is
// accepted only once recorded in PROVENANCE.md.
const RASTER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'bmp']);

// ISO-BMFF brands (the `ftyp` box) by what they hold.
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1', 'avif', 'avis']);
const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'qt  ',
  'dash',
  '3gp4',
  '3gp5',
  '3gp6',
  '3g2a',
  'f4v ',
]);

// How deep an SVG may nest further SVGs as data: URLs before it is refused
// outright rather than inspected.
const MAX_SVG_DEPTH = 4;

// A compressed SVG is unpacked to be inspected; past this size it is refused.
const MAX_SVGZ_BYTES = 32 * 1024 * 1024;

type Kind = 'audio' | 'video' | 'raster';

export function scan(entries: readonly FileEntry[], provenancePaths: readonly string[]): Problem[] {
  return entries.flatMap((entry) => scanFile(entry, provenancePaths));
}

export function checkRepo(source: RepoSource): Problem[] {
  const entries: FileEntry[] = [];
  for (const path of source.list()) {
    const bytes = source.read(path);
    if (bytes !== undefined) entries.push({ path, bytes });
  }
  const provenance = entries.find((entry) => entry.path === 'PROVENANCE.md');
  const listed = provenance === undefined ? [] : provenanceAssetPaths(new TextDecoder().decode(provenance.bytes));
  return scan(entries, listed);
}

// The Path column of every Markdown table in PROVENANCE.md. A listed folder
// covers every file under it.
function provenanceAssetPaths(markdown: string): string[] {
  const paths: string[] = [];
  let pathColumn = -1;
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      inTable = false;
      pathColumn = -1;
      continue;
    }
    const cells = splitRow(trimmed);
    if (!inTable) {
      inTable = true;
      pathColumn = cells.findIndex((cell) => cell.toLowerCase() === 'path');
      continue;
    }
    if (pathColumn < 0 || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const cell = cells[pathColumn]?.replace(/^`|`$/g, '').trim();
    if (cell) paths.push(cell.replace(/^\.\//, ''));
  }
  return paths;
}

function splitRow(row: string): string[] {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function scanFile(entry: FileEntry, provenancePaths: readonly string[]): Problem[] {
  const { path, bytes } = entry;
  const problems: Problem[] = [];
  const extension = extensionOf(path);
  const listed = isListed(path, provenancePaths);

  const found = classify(extension, bytes);
  if (found?.kind === 'audio') {
    problems.push({ path, rule: 'audio-or-video', detail: `is audio (${found.format})` });
  } else if (found?.kind === 'video' && !listed) {
    problems.push({
      path,
      rule: 'audio-or-video',
      detail: `is video (${found.format}) not listed in PROVENANCE.md`,
    });
  } else if (found?.kind === 'raster' && !listed) {
    problems.push({
      path,
      rule: 'raster-image',
      detail: `is a raster image (${found.format}) not listed in PROVENANCE.md`,
    });
  }

  if (extension === 'svg' || extension === 'svgz') {
    const svg = extension === 'svgz' ? gunzip(bytes) : bytes;
    const embedded =
      svg === undefined ? ['a compressed SVG that cannot be unpacked'] : svgRasterReferences(decodeSvg(svg), 0);
    for (const target of embedded) {
      problems.push({ path, rule: 'svg-raster', detail: `embeds a raster image (${target})` });
    }
  }

  return problems;
}

// The extension is checked first and then the content, so a renamed file
// is still caught.
function classify(extension: string, bytes: Uint8Array): { kind: Kind; format: string } | undefined {
  const byName = `.${extension} file`;
  if (AUDIO_EXTENSIONS.has(extension)) return { kind: 'audio', format: byName };
  if (VIDEO_EXTENSIONS.has(extension)) return { kind: 'video', format: byName };
  if (RASTER_EXTENSIONS.has(extension)) return { kind: 'raster', format: byName };
  const audio = audioMagic(bytes);
  if (audio !== undefined) return { kind: 'audio', format: audio };
  const raster = rasterMagic(bytes);
  if (raster !== undefined) return { kind: 'raster', format: raster };
  const video = videoMagic(bytes);
  if (video !== undefined) return { kind: 'video', format: video };
  return undefined;
}

function isListed(path: string, provenancePaths: readonly string[]): boolean {
  return provenancePaths.some((listed) => {
    const folder = listed.replace(/\/$/, '');
    return path === folder || path.startsWith(`${folder}/`);
  });
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function gunzip(bytes: Uint8Array): Uint8Array | undefined {
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_SVGZ_BYTES });
  } catch {
    return undefined;
  }
}

// SVG text may be UTF-16, marked by a byte-order mark or, without one, by
// the zero byte beside the opening `<`; anything else is read as UTF-8.
function decodeSvg(bytes: Uint8Array): string {
  const [first, second] = bytes;
  if (first === 0xff && second === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (first === 0xfe && second === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (first === 0x3c && second === 0x00) return new TextDecoder('utf-16le').decode(bytes);
  if (first === 0x00 && second === 0x3c) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

function audioMagic(bytes: Uint8Array): string | undefined {
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'RIFF WAVE';
  if (ascii(bytes, 0, 3) === 'ID3') return 'ID3 tag';
  if (ascii(bytes, 0, 4) === 'OggS') return 'Ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'FLAC';
  if (ascii(bytes, 0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(bytes, 8, 4))) return 'AIFF';
  if (isMpegFrame(bytes)) return 'MPEG audio frame';
  if (ftypBrands(bytes).some((brand) => AUDIO_BRANDS.has(brand))) return 'ISO-BMFF audio';
  return undefined;
}

// An MPEG audio frame starts with eleven set bits, and its header names a
// layer, bitrate and sample rate that exist. FF FE is the UTF-16LE
// byte-order mark, so a file starting with it is text, not a frame.
function isMpegFrame(bytes: Uint8Array): boolean {
  const [first, second, third] = bytes;
  if (first !== 0xff || second === undefined || third === undefined) return false;
  if (second === 0xfe || (second & 0xe0) !== 0xe0) return false;
  const layer = (second >> 1) & 0x03;
  const bitrate = third >> 4;
  const sampleRate = (third >> 2) & 0x03;
  return layer !== 0 && bitrate !== 0x0f && sampleRate !== 0x03;
}

function rasterMagic(bytes: Uint8Array): string | undefined {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => bytes[index] === byte)) return 'PNG';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'GIF';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'WebP';
  if (['II*\0', 'MM\0*'].includes(ascii(bytes, 0, 4))) return 'TIFF';
  if (isBmp(bytes)) return 'BMP';
  if (ftypBrands(bytes).some((brand) => IMAGE_BRANDS.has(brand))) return 'HEIF/AVIF';
  return undefined;
}

// EBML is the container under WebM and Matroska, which hold audio, video or
// both.
function videoMagic(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'EBML';
  if (ftypBrands(bytes).some((brand) => VIDEO_BRANDS.has(brand))) return 'ISO-BMFF video';
  return undefined;
}

// "BM" alone could start a text file, so the reserved bytes (always zero)
// and the size of the header that follows (one of the known versions) must
// agree too.
function isBmp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 2) !== 'BM' || bytes.length < 18) return false;
  if (bytes[6] !== 0 || bytes[7] !== 0 || bytes[8] !== 0 || bytes[9] !== 0) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [12, 40, 52, 56, 64, 108, 124].includes(view.getUint32(14, true));
}

// The major and compatible brands of an ISO-BMFF file's leading `ftyp` box.
function ftypBrands(bytes: Uint8Array): string[] {
  if (ascii(bytes, 4, 4) !== 'ftyp') return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxEnd = Math.min(view.getUint32(0), bytes.length);
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  return brands;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Attribute values may spell characters as XML references (`&#58;` for a
// colon), so they are decoded before being tested.
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// A raster pulled into an SVG, inline as a data: URL or by pointing at an
// image file, through any href or url(). An SVG nested as a data: URL is
// accepted when it is itself vector-only, so it is inspected the same way.
function svgRasterReferences(svg: string, depth: number): string[] {
  const found: string[] = [];
  const references = [
    ...svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gis),
    ...svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gis),
  ];
  for (const match of references) {
    // A url() written inside an attribute may quote with `&quot;`, which
    // only becomes a quote once decoded.
    const target = decodeEntities(match[2] ?? '')
      .trim()
      .replace(/^(["'])(.*)\1$/s, '$2');
    const dataUrl = /^data:([^,]*),(.*)$/is.exec(target);
    if (dataUrl !== null) {
      found.push(...dataUrlRasters(dataUrl[1] ?? '', dataUrl[2] ?? '', depth));
    } else if (RASTER_EXTENSIONS.has(extensionOf(target.replace(/[?#].*$/, '')))) {
      found.push(target);
    }
  }
  return found;
}

function dataUrlRasters(header: string, payload: string, depth: number): string[] {
  const [mediaType = '', ...parameters] = header.split(';').map((part) => part.trim().toLowerCase());
  if (!mediaType.startsWith('image/')) return [];
  const label = `data:${mediaType}`;
  if (mediaType !== 'image/svg+xml') return [label];
  if (depth + 1 >= MAX_SVG_DEPTH) return [`${label} nested too deep to inspect`];
  const nested = parameters.includes('base64') ? fromBase64(payload) : fromPercentEncoding(payload);
  if (nested === undefined) return [`${label} that cannot be decoded`];
  return svgRasterReferences(decodeSvg(nested), depth + 1).map((inner) => `${inner} inside ${label}`);
}

function fromBase64(payload: string): Uint8Array | undefined {
  const compact = payload.replace(/\s+/g, '');
  if (!/^[a-z0-9+/]*={0,2}$/i.test(compact)) return undefined;
  return Buffer.from(compact, 'base64');
}

// Each `%XX` escape becomes its byte and everything else is kept as
// written, so a bare `%` (as in `width="100%"`) can't stop the rest being
// decoded, and the bytes then go through the same UTF-8/UTF-16 detection.
function fromPercentEncoding(payload: string): Uint8Array {
  const bytes: number[] = [];
  const plain = new TextEncoder();
  for (const part of payload.split(/(%[0-9a-f]{2})/i)) {
    if (/^%[0-9a-f]{2}$/i.test(part)) bytes.push(parseInt(part.slice(1), 16));
    else bytes.push(...plain.encode(part));
  }
  return Uint8Array.from(bytes);
}
