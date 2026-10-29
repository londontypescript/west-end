import { execFileSync } from 'node:child_process';
import type { HistorySource, TreeEntry } from './privacy-history.ts';

// The real history seam: the commits a push from this checkout would
// publish, read from git.

// Large enough for every blob on a branch in one read.
const MAX_GIT_OUTPUT = 1024 * 1024 * 1024;

export function gitHistorySource(root: string): HistorySource {
  const env = gitEnv();
  const git = (args: readonly string[], input?: Buffer) =>
    execFileSync('git', args, { cwd: root, env, input, maxBuffer: MAX_GIT_OUTPUT, stdio: ['pipe', 'pipe', 'pipe'] });

  return {
    commits: () => {
      try {
        git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
      } catch {
        return undefined;
      }
      return git(['rev-list', '--reverse', 'origin/main..HEAD'])
        .toString('utf8')
        .split('\n')
        .filter((sha) => sha !== '');
    },
    tree: (commit) => parseTree(git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8')),
    read: (blobs) => parseBatch(git(['cat-file', '--batch'], Buffer.from(blobs.map((blob) => `${blob}\n`).join('')))),
    provenance: () => {
      const listed = git(['ls-tree', 'HEAD', '--', 'PROVENANCE.md']).toString('utf8');
      return listed === '' ? undefined : git(['cat-file', 'blob', 'HEAD:PROVENANCE.md']);
    },
  };
}

// The repository is the one at `root`, even when this runs inside a git
// hook, which sets variables pointing git at the repository it fired in.
export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
    delete env[name];
  }
  return env;
}

// Each record is `<mode> <type> <object>\t<path>\0`. Submodules (type
// `commit`) hold no files of this repo, so only blobs are kept.
function parseTree(listing: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of listing.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [, type, blob] = record.slice(0, tab).split(' ');
    if (type === 'blob' && blob !== undefined) entries.push({ path: record.slice(tab + 1), blob });
  }
  return entries;
}

// Each object comes back as `<object> <type> <size>\n<content>\n`.
function parseBatch(output: Buffer): Map<string, Uint8Array> {
  const blobs = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error('git cat-file --batch output ended inside a header');
    const [object = '', type, size] = output.subarray(offset, newline).toString('utf8').split(' ');
    if (type !== 'blob' || size === undefined) throw new Error(`git cat-file --batch could not read ${object}`);
    const start = newline + 1;
    const end = start + Number(size);
    if (end + 1 > output.length) throw new Error(`git cat-file --batch output ended inside ${object}`);
    blobs.set(object, output.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}
