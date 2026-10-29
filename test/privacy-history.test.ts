import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitEnv, gitHistorySource } from './privacy-git.ts';
import { checkHistory, type HistorySource } from './privacy-history.ts';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const encode = (text: string) => new TextEncoder().encode(text);

const PROVENANCE = ['| Path | Made by |', '| ---- | ------- |', '| art/listed.png | Nnsée |'].join('\n');

// Commits as maps from path to blob id, and the blobs by id. `reads`
// records each call to read, to show every blob is read once.
function fakeHistory(
  commits: Record<string, Record<string, string>> | undefined,
  blobs: Record<string, Uint8Array>,
  provenance?: string,
) {
  const reads: string[][] = [];
  const source: HistorySource = {
    commits: () => (commits === undefined ? undefined : Object.keys(commits)),
    tree: (commit) => Object.entries(commits?.[commit] ?? {}).map(([path, blob]) => ({ path, blob })),
    read: (ids) => {
      reads.push([...ids]);
      return new Map(ids.map((id) => [id, blobs[id] ?? new Uint8Array()]));
    },
    provenance: () => (provenance === undefined ? undefined : encode(provenance)),
  };
  return { source, reads };
}

describe('the commits being pushed', () => {
  it('refuses a raster committed and later deleted, naming the commit and saying to squash', () => {
    const { source } = fakeHistory(
      {
        aaaaaaaaaaaaaaaa: { 'README.md': 'r1', 'art/face.png': 'p1' },
        bbbbbbbbbbbbbbbb: { 'README.md': 'r1' },
      },
      { r1: encode('# hi'), p1: Uint8Array.from(PNG) },
    );

    const problems = checkHistory(source);
    expect(problems.map(({ path, rule, commit }) => ({ path, rule, commit }))).toEqual([
      { path: 'art/face.png', rule: 'raster-image', commit: 'aaaaaaaaaaaaaaaa' },
    ]);
    expect(problems[0]?.detail).toMatch(/in commit aaaaaaaaaaaa; .*squash the branch before pushing/);
  });

  it('checks each path and blob once, reading every blob in one pass', () => {
    const { source, reads } = fakeHistory(
      {
        c1: { 'a.txt': 'x', 'b.txt': 'x' },
        c2: { 'a.txt': 'x', 'b.txt': 'x', 'c.txt': 'y' },
      },
      { x: encode('one'), y: encode('two') },
    );
    expect(checkHistory(source)).toEqual([]);
    expect(reads).toEqual([['x', 'y']]);
  });

  it("takes the listing from HEAD's PROVENANCE.md", () => {
    const commits = { c1: { 'art/listed.png': 'p1' } };
    const blobs = { p1: Uint8Array.from(PNG) };
    expect(checkHistory(fakeHistory(commits, blobs, PROVENANCE).source)).toEqual([]);
    expect(checkHistory(fakeHistory(commits, blobs).source).map(({ rule }) => rule)).toEqual(['raster-image']);
  });

  it('fails, telling you to fetch, when origin/main does not resolve', () => {
    const problems = checkHistory(fakeHistory(undefined, {}).source);
    expect(problems.map(({ path, rule }) => ({ path, rule }))).toEqual([
      { path: 'origin/main', rule: 'unresolved-base' },
    ]);
    expect(problems[0]?.detail).toContain('git fetch origin');
  });
});

describe('the commits being pushed, through real git', () => {
  let root = '';
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const commit = (message: string) => git('commit', '--quiet', '--no-verify', '-m', message);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'west-end-privacy-'));
    git('init', '--quiet', '--initial-branch=main');
    // Local settings only: the global config is never touched, and the
    // user's own hooks and signing stay out of the test.
    git('config', 'user.name', 'Privacy Test');
    git('config', 'user.email', 'privacy-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(root, 'no-hooks'));
    git('config', 'core.hooksPath', join(root, 'no-hooks'));
    writeFileSync(join(root, 'README.md'), '# test\n');
    git('add', 'README.md');
    commit('base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a raster committed then deleted, and passes once the branch is squashed', () => {
    git('switch', '--quiet', '-c', 'feature');
    mkdirSync(join(root, 'art'));
    writeFileSync(join(root, 'art', 'face.png'), Uint8Array.from(PNG));
    git('add', 'art/face.png');
    commit('add a raster');
    const added = git('rev-parse', 'HEAD').trim();
    unlinkSync(join(root, 'art', 'face.png'));
    git('add', '--all');
    writeFileSync(join(root, 'notes.txt'), 'kept\n');
    git('add', 'notes.txt');
    commit('delete it again');

    const problems = checkHistory(gitHistorySource(root));
    expect(problems.map(({ path, rule, commit: sha }) => ({ path, rule, sha }))).toEqual([
      { path: 'art/face.png', rule: 'raster-image', sha: added },
    ]);

    git('reset', '--quiet', '--soft', 'origin/main');
    commit('squashed');
    expect(checkHistory(gitHistorySource(root))).toEqual([]);
  });

  it('fails when origin/main does not resolve', () => {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(checkHistory(gitHistorySource(root)).map(({ rule }) => rule)).toEqual(['unresolved-base']);
  });
});

describe('the repo', () => {
  it('publishes only accepted assets in the commits it would push', () => {
    expect(checkHistory(gitHistorySource(join(import.meta.dirname, '..')))).toEqual([]);
  });
});
