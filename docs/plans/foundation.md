# Foundation

Milestone 0: the minimal fixture goes convert → render → publish in the
container, locally and in CI; a packed tarball installs cleanly into a sample
folder; Godot is a required check proven by a broken pull request; the
privacy and hostile-SVG defences each run in a named check.

## Phases

| Phase                 | Issue | Rating   | After | Files                                                                                                              | Merge  |
| --------------------- | ----- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| A. Bootstrap          | #10   | involved | —     | root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.js`, `packages/cli/` | admin  |
| B. Privacy            | #2    | involved | A     | `AGENTS.md`, `test/privacy.test.ts`, `fixtures/privacy/`                                                           | normal |
| C. Records            | #3    | routine  | —     | `docs/adr/`, `PROVENANCE.md`                                                                                       | normal |
| D. Container          | #4    | delicate | —     | `container/`                                                                                                       | normal |
| E. Converter          | #5    | delicate | A, B  | `packages/cli/src/convert/`, `fixtures/minimal/`, `fixtures/hostile/`                                              | normal |
| F. Render and publish | #6    | involved | D, E  | `packages/cli/src/{runner,render,publish}/`, `godot/`                                                              | normal |
| G. check:godot        | #7    | delicate | F     | `scripts/check-godot/`, `fixtures/broken/`, root `package.json` (one script)                                       | admin  |
| H. Pack and install   | #8    | involved | F     | `packages/cli/src/sync-addon/`, `packages/cli/package.json`, `godot/addons/puppet/`, `test/install/`               | normal |
| I. Required check     | #9    | delicate | G, H  | `.github/workflows/godot.yml`, the `main` ruleset, `docs/`                                                         | admin  |

## Order

- A, C and D can start at once: C and D touch nothing A does.
- B follows A and lands before any asset is pushed.
- E follows A and B; F follows D and E.
- G and H run in parallel after F: G alone touches root `package.json`, H
  alone the CLI's.
- I comes last and reruns every check on the merged result.

## Rules for this milestone

- Admin merges (the judge guards scripts, workflows and install settings):
  A, G and I. A refusal on any other phase is diagnosed, not bypassed.
- Each phase is one pull request closing one issue. A phase over the size
  limits splits, or carries a real `One concern:` reason.
- Delicate phases get an adversarial review of their brief before building,
  and a re-check of the revised brief.
- Every pull request gets a security note: downloads and pins, new
  dependencies and their source, CLI input, filesystem writes.
- The owner reviews every asset, and the outgoing files of each pull
  request, before it is pushed.
