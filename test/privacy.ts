import { classify, extensionOf } from './privacy-formats.ts';
import { rasterMetadata, svgMetadata } from './privacy-metadata.ts';
import { svgRasterReferences, svgText } from './privacy-svg.ts';

// The asset scanner. The repo accepts original vector artwork, and raster
// images or video only once they are reviewed and recorded in PROVENANCE.md;
// it accepts no audio. This checks every file the repo would commit against
// those rules. It is a pure function over file contents, so its tests can
// feed it synthetic files and never need real ones in the repo.

export interface FileEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

type Rule = 'audio-or-video' | 'raster-image' | 'svg-raster' | 'image-metadata' | 'character-unlisted';

export interface Problem {
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
  return scan(entries, provenanceAssetPaths(provenance?.bytes));
}

// The Path column of every Markdown table in PROVENANCE.md. A listed folder
// covers every file under it.
function provenanceAssetPaths(provenance: Uint8Array | undefined): string[] {
  if (provenance === undefined) return [];
  const markdown = new TextDecoder().decode(provenance);
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
    const svg = svgText(extension, bytes);
    const embedded = svg === undefined ? ['a compressed SVG that cannot be unpacked'] : svgRasterReferences(svg, 0);
    for (const target of embedded) {
      problems.push({ path, rule: 'svg-raster', detail: `embeds a raster image (${target})` });
    }
    for (const found of svg === undefined ? [] : svgMetadata(svg)) {
      problems.push({ path, rule: 'image-metadata', detail: `carries metadata (${found}); strip it` });
    }
  }

  for (const found of rasterMetadata(bytes)) {
    problems.push({ path, rule: 'image-metadata', detail: `carries metadata (${found}); strip it` });
  }

  // A character file draws a character, so it is artwork like any other
  // asset and needs its PROVENANCE.md entry.
  if (path.toLowerCase().endsWith('.character.ts') && !listed) {
    problems.push({ path, rule: 'character-unlisted', detail: 'is a character file not listed in PROVENANCE.md' });
  }

  return problems;
}

function isListed(path: string, provenancePaths: readonly string[]): boolean {
  return provenancePaths.some((listed) => {
    const folder = listed.replace(/\/$/, '');
    return path === folder || path.startsWith(`${folder}/`);
  });
}
