import { ascii } from './privacy-formats.ts';

// Metadata inside an image: camera EXIF (location, serial numbers), XMP
// (author names, editing history), text chunks and comments. A listed
// image is reviewed by eye, and none of this shows when it is viewed, so
// the scanner looks for it. It names what it found and never quotes it,
// so the refusal itself can't leak what the file was hiding.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf']);
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);

// What metadata a raster's content holds, by its format's magic bytes.
export function rasterMetadata(bytes: Uint8Array): string[] {
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return pngMetadata(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegMetadata(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpMetadata(bytes);
  return [];
}

// What metadata an SVG's text holds: comments, a <metadata> element, or
// names in the namespaces Inkscape and Sodipodi write.
export function svgMetadata(svg: string): string[] {
  const found: string[] = [];
  if (svg.includes('<!--')) found.push('an XML comment');
  if (/<(?:[\w.-]+:)?metadata[\s/>]/i.test(svg)) found.push('a <metadata> element');
  for (const editor of ['sodipodi', 'inkscape']) {
    if (new RegExp(`(?:\\b${editor}:[\\w.-]|xmlns:${editor}\\b)`, 'i').test(svg))
      found.push(`a name in the ${editor} namespace`);
  }
  return found;
}

// Chunks are a 4-byte length, a 4-byte type, the data and a 4-byte CRC.
function pngMetadata(bytes: Uint8Array): string[] {
  const view = viewOf(bytes);
  const found: string[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return [...found, 'a truncated PNG chunk'];
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (offset + 12 + length > bytes.length) return [...found, `a truncated PNG chunk (${printable(type)})`];
    if (PNG_TEXT_CHUNKS.has(type)) found.push(`a PNG ${type} chunk`);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return found;
}

// Segments are a marker (FF and a code) and, for most codes, a 2-byte
// length that counts itself. Metadata sits before the image data, which
// starts at the first SOS, so the walk stops there.
function jpegMetadata(bytes: Uint8Array): string[] {
  const view = viewOf(bytes);
  const found: string[] = [];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return [...found, 'a JPEG segment that cannot be read'];
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    if (marker === undefined) return [...found, 'a truncated JPEG segment'];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return [...found, 'a truncated JPEG segment'];
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return [...found, 'a truncated JPEG segment'];
    const payload = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && ascii(payload, 0, 5) === 'Exif\0') found.push('a JPEG APP1 Exif segment');
    if (marker === 0xe1 && ascii(payload, 0, 20) === 'http://ns.adobe.com/') found.push('a JPEG APP1 XMP segment');
    if (marker === 0xfe) found.push('a JPEG COM segment');
    offset += 2 + length;
  }
  return found;
}

// After the 12-byte RIFF header, chunks are a 4-byte type, a 4-byte
// little-endian size and the data, padded to an even length.
function webpMetadata(bytes: Uint8Array): string[] {
  const view = viewOf(bytes);
  const found: string[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return [...found, 'a truncated WebP chunk'];
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) return [...found, `a truncated WebP chunk (${printable(type)})`];
    if (WEBP_METADATA_CHUNKS.has(type)) found.push(`a WebP ${type.trim()} chunk`);
    offset += 8 + size + (size % 2);
  }
  return found;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// A chunk type is four letters in a well-formed file; anything else is
// not repeated back.
function printable(type: string): string {
  return /^[A-Za-z ]{4}$/.test(type) ? type : 'unnamed';
}
