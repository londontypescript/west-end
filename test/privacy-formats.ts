// What a file is, by its extension and then by its content, so a renamed
// file is still caught.

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
export const RASTER_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'avif',
  'tif',
  'tiff',
  'bmp',
]);

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

type Kind = 'audio' | 'video' | 'raster';

// The extension is checked first and then the content, so a renamed file
// is still caught.
export function classify(extension: string, bytes: Uint8Array): { kind: Kind; format: string } | undefined {
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

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
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
