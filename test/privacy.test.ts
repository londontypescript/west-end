import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkRepo, scan, type FileEntry, type RepoSource } from './privacy.ts';

// Every synthetic file lives inline here, never as a fixture on disk, so the
// repo check below never has to make an exception for the test's own inputs.
function file(path: string, content: string | readonly number[]): FileEntry {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content);
  return { path, bytes };
}

function bytesOf(...parts: (string | readonly number[])[]): number[] {
  return parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : [...part]));
}

const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
const be32 = (value: number) => [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

function rulesFor(entry: FileEntry, provenance: readonly string[] = []) {
  return scan([entry], provenance).map(({ path, rule }) => ({ path, rule }));
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

function utf16le(text: string): number[] {
  return [0xff, 0xfe, ...Buffer.from(text, 'utf16le')];
}

function fakeSource(files: Record<string, string>): RepoSource {
  return {
    list: () => Object.keys(files),
    read: (path) => (path in files ? new TextEncoder().encode(files[path]) : undefined),
  };
}

// The real seam: what git would commit from this checkout, read from disk.
function gitSource(root: string): RepoSource {
  return {
    list: () =>
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
        .toString('utf8')
        .split('\0')
        .filter((path) => path !== ''),
    read: (path) => {
      try {
        return readFileSync(join(root, path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
  };
}

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('the repo', () => {
  it('holds only accepted assets: no audio, and no unlisted rasters or video', () => {
    expect(checkRepo(gitSource(join(import.meta.dirname, '..')))).toEqual([]);
  });
});

describe('audio and video', () => {
  it.each([
    '.wav',
    '.mp3',
    '.m4a',
    '.aac',
    '.ogg',
    '.oga',
    '.opus',
    '.flac',
    '.aif',
    '.aiff',
    '.caf',
    '.wma',
    '.weba',
    '.mka',
  ])('refuses a %s file by its extension, listed or not', (extension) => {
    const path = `sound/clip${extension}`;
    expect(rulesFor(file(path, 'x'), [path])).toEqual([{ path, rule: 'audio-or-video' }]);
  });

  it.each(['.webm', '.mkv', '.mp4', '.m4v', '.mov'])('refuses an unlisted %s file by its extension', (extension) => {
    const path = `video/clip${extension}`;
    expect(rulesFor(file(path, 'x'))).toEqual([{ path, rule: 'audio-or-video' }]);
  });

  it.each([
    ['RIFF WAVE', bytesOf('RIFF', le32(36), 'WAVEfmt ')],
    ['ID3', bytesOf('ID3', [4, 0, 0])],
    ['an MPEG frame', [0xff, 0xfb, 0x90, 0x64]],
    ['Ogg', bytesOf('OggS', [0, 2])],
    ['FLAC', bytesOf('fLaC', [0, 0, 0, 34])],
    ['AIFF', bytesOf('FORM', be32(4), 'AIFF')],
    ['an M4A ftyp', bytesOf(be32(20), 'ftypM4A ', be32(0), 'isom')],
    ['EBML (WebM or Matroska)', [0x1a, 0x45, 0xdf, 0xa3, 0x9f]],
    ['an MP4 video ftyp', bytesOf(be32(20), 'ftypisom', be32(0), 'mp41')],
  ])('refuses %s content under a harmless name', (_name, content) => {
    expect(rulesFor(file('notes/readme.txt', content))).toEqual([{ path: 'notes/readme.txt', rule: 'audio-or-video' }]);
  });

  it('allows a video listed in PROVENANCE.md', () => {
    expect(rulesFor(file('video/intro.webm', [0x1a, 0x45, 0xdf, 0xa3]), ['video/'])).toEqual([]);
  });

  it.each([
    ['a byte-order mark and text', [0xff, 0xfe, 0x61, 0x00]],
    ['a byte-order mark and markup', [0xff, 0xfe, 0x3c, 0x00]],
  ])('does not take UTF-16LE text starting with %s for an MP3', (_name, content) => {
    expect(rulesFor(file('notes/utf16.txt', content))).toEqual([]);
  });
});

describe('raster images', () => {
  it.each(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.tif', '.tiff', '.bmp'])(
    'refuses an unlisted %s file by its extension',
    (extension) => {
      expect(rulesFor(file(`art/photo${extension}`, 'x'))).toEqual([
        { path: `art/photo${extension}`, rule: 'raster-image' },
      ]);
    },
  );

  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    // A whole APP0 segment, since a cut-off one is refused as unreadable.
    ['JPEG', bytesOf([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0])],
    ['GIF', bytesOf('GIF89a')],
    ['WebP', bytesOf('RIFF', le32(4), 'WEBP')],
    ['TIFF', bytesOf('II*', [0])],
    ['BMP', bytesOf('BM', le32(58), le32(0), le32(54), le32(40))],
    ['HEIC', bytesOf(be32(16), 'ftypheic', be32(0))],
  ])('refuses %s content under a harmless name', (_name, content) => {
    expect(rulesFor(file('art/data.bin', content))).toEqual([{ path: 'art/data.bin', rule: 'raster-image' }]);
  });

  it('allows a raster listed in the PROVENANCE.md assets table', () => {
    const source = fakeSource({
      'PROVENANCE.md': [
        '## Assets',
        '',
        '| Path | Made by | How | Licence |',
        '| ---- | ------- | --- | ------- |',
        '| `fixtures/minimal/poster.png` | Nnsée | drawn by hand | MIT |',
        '| fixtures/stills/ | Nnsée | rendered | MIT |',
      ].join('\n'),
      'fixtures/minimal/poster.png': 'x',
      'fixtures/stills/one.jpg': 'x',
      'fixtures/minimal/other.png': 'x',
    });

    expect(checkRepo(source).map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: 'fixtures/minimal/other.png', rule: 'raster-image' },
    ]);
  });
});

describe('rasters embedded in SVG', () => {
  const vector = "<svg xmlns='http://www.w3.org/2000/svg'><circle r='5' width='100%' /></svg>";
  const withRaster = `<svg xmlns='http://www.w3.org/2000/svg'><image href='${PNG_DATA_URL}' /></svg>`;

  it.each([
    ['a data: URL', `<svg><image href="${PNG_DATA_URL}" /></svg>`],
    ['an xlink:href to a JPEG', '<svg><image xlink:href="../photos/face.jpg" /></svg>'],
    ['a pattern fill pointing at a PNG', '<svg><rect style="fill: url(\'tex.png\')" /></svg>'],
    ['a decimal character reference', '<svg><image href="data&#58;image/png;base64,iVBORw0KGgo=" /></svg>'],
    ['a hex character reference', '<svg><image href="face&#x2E;jpg" /></svg>'],
    ['a url() quoted with &quot;', '<svg><rect style="fill: url(&quot;tex.png&quot;)" /></svg>'],
    [
      'a raster inside a plain nested SVG',
      `<svg><image href="data:image/svg+xml,${encodeURIComponent(withRaster)}" /></svg>`,
    ],
    [
      'a raster inside a nested SVG that keeps a bare % unescaped',
      `<svg><image href="data:image/svg+xml,%3Csvg width='100%'%3E%3Cimage href%3D%27tex.png%27/%3E%3C/svg%3E" /></svg>`,
    ],
    [
      'a raster inside a base64 nested SVG',
      `<svg><image href="data:image/svg+xml;base64,${base64(withRaster)}" /></svg>`,
    ],
  ])('refuses %s', (_name, svg) => {
    expect(rulesFor(file('art/face.svg', svg))).toEqual([{ path: 'art/face.svg', rule: 'svg-raster' }]);
  });

  it('refuses a UTF-16LE SVG embedding a PNG', () => {
    const svg = utf16le(`<svg><image href="${PNG_DATA_URL}" /></svg>`);
    expect(rulesFor(file('art/face.svg', svg))).toEqual([{ path: 'art/face.svg', rule: 'svg-raster' }]);
  });

  it('refuses SVGs nested past the depth it inspects', () => {
    let svg = vector;
    for (let level = 0; level < 5; level += 1) {
      svg = `<svg><image href="data:image/svg+xml;base64,${base64(svg)}" /></svg>`;
    }
    expect(rulesFor(file('art/deep.svg', svg))).toEqual([{ path: 'art/deep.svg', rule: 'svg-raster' }]);
  });

  it('inspects a compressed SVG once unpacked, and refuses one that cannot be', () => {
    expect(rulesFor(file('art/face.svgz', [...gzipSync(withRaster)]))).toEqual([
      { path: 'art/face.svgz', rule: 'svg-raster' },
    ]);
    expect(rulesFor(file('art/broken.svgz', 'not gzip'))).toEqual([{ path: 'art/broken.svgz', rule: 'svg-raster' }]);
    expect(rulesFor(file('art/vector.svgz', [...gzipSync(vector)]))).toEqual([]);
  });

  it('allows an SVG of vector shapes that references its own gradients', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" /></defs>' +
      '<path d="M0 0L10 10" fill="url(#shade)" /><use href="#shade" /></svg>';
    expect(rulesFor(file('art/vector.svg', svg))).toEqual([]);
  });

  it.each([
    ['plain', `data:image/svg+xml,${encodeURIComponent(vector)}`],
    ['base64', `data:image/svg+xml;base64,${base64(vector)}`],
  ])('allows a vector-only %s nested SVG', (_name, url) => {
    expect(rulesFor(file('art/outer.svg', `<svg><image href="${url}" /></svg>`))).toEqual([]);
  });
});
