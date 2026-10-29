import { provenanceAssetPaths, scan, type Problem } from './privacy.ts';

// The tree check sees only the files as they stand, but a push publishes
// every commit on the branch: a file committed and later deleted is still
// in the history GitHub receives. This applies the same rules to every
// file in every commit being pushed.

export interface TreeEntry {
  readonly path: string;
  readonly blob: string;
}

// The commits a push would publish, behind a seam so tests can fake git.
export interface HistorySource {
  // The commits after origin/main up to HEAD, oldest first, or undefined
  // when origin/main doesn't resolve.
  commits(): readonly string[] | undefined;
  // Every file in a commit's tree.
  tree(commit: string): readonly TreeEntry[];
  // The content of each blob, read in one pass.
  read(blobs: readonly string[]): ReadonlyMap<string, Uint8Array>;
  // PROVENANCE.md as HEAD has it, or undefined if HEAD has none.
  provenance(): Uint8Array | undefined;
}

export interface HistoryProblem {
  readonly path: string;
  readonly rule: Problem['rule'] | 'unresolved-base';
  readonly detail: string;
  readonly commit?: string;
}

export function checkHistory(source: HistorySource): HistoryProblem[] {
  const commits = source.commits();
  // Skipping here would let the push through unchecked, so a missing base
  // is a failure of its own.
  if (commits === undefined) {
    return [
      {
        path: 'origin/main',
        rule: 'unresolved-base',
        detail: 'does not resolve, so the commits being pushed cannot be checked: run `git fetch origin` and try again',
      },
    ];
  }

  // Each (path, blob) pair is checked once, against the first commit that
  // brings it in, since the rules depend on the path as well as the content.
  const firstSeen = new Map<string, { commit: string; entry: TreeEntry }>();
  for (const commit of commits) {
    for (const entry of source.tree(commit)) {
      const key = `${entry.blob}\0${entry.path}`;
      if (!firstSeen.has(key)) firstSeen.set(key, { commit, entry });
    }
  }

  const blobs = source.read([...new Set([...firstSeen.values()].map(({ entry }) => entry.blob))]);
  const listed = provenanceAssetPaths(source.provenance());
  const problems: HistoryProblem[] = [];
  for (const { commit, entry } of firstSeen.values()) {
    const bytes = blobs.get(entry.blob);
    if (bytes === undefined) throw new Error(`git did not return blob ${entry.blob} (${entry.path})`);
    for (const problem of scan([{ path: entry.path, bytes }], listed)) {
      problems.push({
        ...problem,
        commit,
        detail: `${problem.detail}, in commit ${commit.slice(0, 12)}; a push publishes every commit, so fix it and squash the branch before pushing`,
      });
    }
  }
  return problems;
}
