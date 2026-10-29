import { gunzipSync } from 'node:zlib';
import { extensionOf, RASTER_EXTENSIONS } from './privacy-formats.ts';

// Rasters hidden inside SVG text.

// How deep an SVG may nest further SVGs as data: URLs before it is refused
// outright rather than inspected.
const MAX_SVG_DEPTH = 4;

// A compressed SVG is unpacked to be inspected; past this size it is refused.
const MAX_SVGZ_BYTES = 32 * 1024 * 1024;

// The text of an SVG or compressed SVG, or undefined for a compressed one
// that cannot be unpacked.
export function svgText(extension: string, bytes: Uint8Array): string | undefined {
  const svg = extension === 'svgz' ? gunzip(bytes) : bytes;
  return svg === undefined ? undefined : decodeSvg(svg);
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
export function svgRasterReferences(svg: string, depth: number): string[] {
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
