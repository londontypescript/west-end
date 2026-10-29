import { describe, expect, it } from 'vitest';
import { scan } from './privacy.ts';

// Synthetic images built inline, as in privacy.test.ts, so the repo check
// never meets them as files. Each is listed, so the only refusal left is
// for what it carries.

function bytesOf(...parts: (string | readonly number[])[]): Uint8Array {
  return Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : [...part])),
  );
}

const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value: number) => [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];

// The CRC isn't checked, so zeros stand in for it.
const pngChunk = (type: string, data = '') => bytesOf(be32(data.length), type, data, be32(0));
const png = (...chunks: Uint8Array[]) =>
  bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ...chunks.map((chunk) => [...chunk]));
const plainPng = (...extra: Uint8Array[]) =>
  png(pngChunk('IHDR', 'x'.repeat(13)), ...extra, pngChunk('IDAT', 'xx'), pngChunk('IEND'));

const jpegSegment = (marker: number, payload: string) => bytesOf([0xff, marker], be16(payload.length + 2), payload);
const jpeg = (...segments: Uint8Array[]) =>
  bytesOf([0xff, 0xd8], ...segments.map((segment) => [...segment]), [0xff, 0xda], be16(2), [0xff, 0xd9]);
const app0 = jpegSegment(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0');

const webpChunk = (type: string, data: string) => bytesOf(type, le32(data.length), data, data.length % 2 ? [0] : []);
const webp = (...chunks: Uint8Array[]) => {
  const body = chunks.flatMap((chunk) => [...chunk]);
  return bytesOf('RIFF', le32(body.length + 4), 'WEBP', body);
};

function findings(path: string, bytes: Uint8Array | string, provenance: readonly string[] = [path]) {
  const content = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return scan([{ path, bytes: content }], provenance).map(({ rule, detail }) => ({ rule, detail }));
}

const metadata = (detail: string) => [{ rule: 'image-metadata', detail }];

describe('metadata in PNG', () => {
  it('allows a PNG of only IHDR, IDAT and IEND', () => {
    expect(findings('art/plain.png', plainPng())).toEqual([]);
  });

  it.each(['tEXt', 'iTXt', 'zTXt', 'eXIf'])('refuses a %s chunk, naming it and never quoting it', (type) => {
    const found = findings('art/tagged.png', plainPng(pngChunk(type, 'Author\0Jo Bloggs')));
    expect(found).toEqual(metadata(`carries metadata (a PNG ${type} chunk); strip it`));
    expect(JSON.stringify(found)).not.toContain('Bloggs');
  });

  it('refuses a truncated chunk', () => {
    const cut = plainPng().subarray(0, 8 + 12 + 5);
    expect(findings('art/cut.png', cut)).toEqual(metadata('carries metadata (a truncated PNG chunk (IHDR)); strip it'));
  });
});

describe('metadata in JPEG', () => {
  it('allows a JPEG with only an APP0 segment', () => {
    expect(findings('art/plain.jpg', jpeg(app0))).toEqual([]);
  });

  it.each([
    ['an APP1 Exif segment', jpegSegment(0xe1, 'Exif\0\0GPS 51.5N'), 'a JPEG APP1 Exif segment'],
    ['an APP1 XMP segment', jpegSegment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'), 'a JPEG APP1 XMP segment'],
    ['a COM segment', jpegSegment(0xfe, 'shot by Jo Bloggs'), 'a JPEG COM segment'],
  ])('refuses %s', (_name, segment, what) => {
    const found = findings('art/tagged.jpg', jpeg(app0, segment));
    expect(found).toEqual(metadata(`carries metadata (${what}); strip it`));
    expect(JSON.stringify(found)).not.toMatch(/Bloggs|51\.5/);
  });

  it('refuses a truncated segment', () => {
    const cut = jpeg(app0).subarray(0, 8);
    expect(findings('art/cut.jpg', cut)).toEqual(metadata('carries metadata (a truncated JPEG segment); strip it'));
  });

  it('refuses a scan header cut off before its length runs out', () => {
    const cut = bytesOf([...jpeg(app0)].slice(0, -6), [0xff, 0xda, 0x00, 0x0c, 0x01]);
    expect(findings('art/cut.jpg', cut)).toEqual(metadata('carries metadata (a truncated JPEG segment); strip it'));
  });

  it('stops at the image data, where FF bytes are not markers', () => {
    const data = bytesOf([...jpeg(app0)].slice(0, -2), [0xff, 0x00, 0xfe, 0x12], [0xff, 0xd9]);
    expect(findings('art/data.jpg', data)).toEqual([]);
  });
});

describe('metadata in WebP', () => {
  it('allows a WebP with only image data', () => {
    expect(findings('art/plain.webp', webp(webpChunk('VP8L', 'pixels')))).toEqual([]);
  });

  it.each([
    ['EXIF', 'EXIF'],
    ['XMP ', 'XMP'],
  ])('refuses a %s chunk', (type, named) => {
    const image = webp(webpChunk('VP8X', 'x'.repeat(10)), webpChunk('VP8L', 'pixels'), webpChunk(type, 'odd'));
    expect(findings('art/tagged.webp', image)).toEqual(metadata(`carries metadata (a WebP ${named} chunk); strip it`));
  });
});

describe('metadata in SVG', () => {
  it('allows a plain SVG', () => {
    expect(findings('art/plain.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" /></svg>')).toEqual([]);
  });

  it.each([
    ['a comment', '<svg><!-- drawn at 12 Baker St --><circle r="5" /></svg>', 'an XML comment'],
    ['a <metadata> element', '<svg><metadata><rdf:RDF /></metadata></svg>', 'a <metadata> element'],
    [
      'a <metadata> element under a non-ASCII prefix',
      '<é:svg xmlns:é="http://www.w3.org/2000/svg"><é:metadata>Baker</é:metadata></é:svg>',
      'a <metadata> element',
    ],
    ['a sodipodi: name', '<svg><sodipodi:namedview id="base" /></svg>', 'a name in the sodipodi namespace'],
    ['an inkscape: attribute', '<svg><g inkscape:label="Layer 1" /></svg>', 'a name in the inkscape namespace'],
    [
      'an inkscape namespace declaration',
      '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"></svg>',
      'a name in the inkscape namespace',
    ],
  ])('refuses %s', (_name, svg, what) => {
    const found = findings('art/tagged.svg', svg, []);
    expect(found).toEqual(metadata(`carries metadata (${what}); strip it`));
    expect(JSON.stringify(found)).not.toContain('Baker');
  });
});

describe('character files', () => {
  it('refuses a character file not listed in PROVENANCE.md', () => {
    expect(findings('characters/nnsee.character.ts', 'export default {}', [])).toEqual([
      { rule: 'character-unlisted', detail: 'is a character file not listed in PROVENANCE.md' },
    ]);
  });

  it('allows a character file listed by itself or by its folder', () => {
    expect(findings('characters/nnsee.character.ts', 'export default {}')).toEqual([]);
    expect(findings('characters/nnsee.character.ts', 'export default {}', ['characters/'])).toEqual([]);
  });

  it('does not take the hostile .character.txt fixtures for character files', () => {
    expect(findings('fixtures/hostile/loop.character.txt', 'not code', [])).toEqual([]);
  });
});
