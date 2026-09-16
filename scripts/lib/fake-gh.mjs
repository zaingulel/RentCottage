// Shared PATH-prepended fake `gh` scaffold for the gh-calling CLI tests.
//
// Owns only the plumbing: a temporary bin directory, the executable bit, per-run calls files, and
// the PATH-prepending environment. Each test file supplies its own `gh` script source, so reply
// behaviour and call-log format stay with the test that asserts on them.
//
// Keys in `env(extra)` override the helper's defaults, PATH included, which is the supported way for
// a caller to compose its own PATH precedence (the board CLI tests rely on it). The second
// argument is a list of key names, `env(extra, ['GH_TOKEN'])`, deleted after that composition, so a
// credential-absence test can state the key is absent instead of omitting it and inheriting
// whatever the ambient environment exports.
//
// Recurring cost: negligible — one mkdtemp and one file write per importing test file.
// Removal condition: retire when the gh-calling CLI tests stop faking `gh` via PATH.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function installFakeGh(prefix, ghScript) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const fakeGh = join(root, 'gh');
  writeFileSync(fakeGh, ghScript);
  chmodSync(fakeGh, 0o755);

  let runCount = 0;
  return {
    root,
    // A fresh calls path per run, never reused, so one run's log cannot satisfy another run's
    // "no external call happened" assertion.
    newCallsFile: () => join(root, `gh-calls-${runCount++}`),
    env: (extra = {}, removeKeys = []) => {
      // `extra` is a plain object of overrides. Spreading anything else silently removes nothing:
      // an array or a string adds junk index keys and leaves the named key in place, and a Set or a
      // Map contributes nothing at all.
      if (
        extra === null ||
        typeof extra !== 'object' ||
        Object.getPrototypeOf(extra) !== Object.prototype
      ) {
        throw new Error(
          `extra must be a plain object of overrides; pass the removal list as the second argument, env({}, [...]), got: ${extra === null ? 'null' : typeof extra}`,
        );
      }
      // Array-only, because the other iterable shapes fail quietly: a string deletes its characters
      // and a Map deletes a stringified pair, so the test still passes while removing no key.
      if (!Array.isArray(removeKeys)) {
        throw new Error(
          `removeKeys must be an array of key names, got: ${removeKeys === null ? 'null' : typeof removeKeys}`,
        );
      }
      const composed = { ...process.env, PATH: `${root}:${process.env.PATH}`, ...extra };
      for (const key of removeKeys) delete composed[key];
      return composed;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
