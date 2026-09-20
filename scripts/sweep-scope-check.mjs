#!/usr/bin/env node
// sweep-scope-check.mjs — the future hosted check for the inactive documentation sweep's scope.
//
//   node scripts/sweep-scope-check.mjs <base-commit> <head-commit>
//
// Fails (exit 1) when the branch's own changes, merge-base to head, do anything but modify files in
// the may-edit column of the scope table in docs/DOC-SWEEP.md, add a URI or host name that the base
// tree does not already carry anywhere, or add markup GitHub would render into a link the text does
// not show. The table and the tree are read at the BASE commit (the tip of `main`, not the merge
// base) so a diff cannot widen its own scope and a host `main` gained since the branch point still
// counts as known. If the routine and hosted protection are separately activated, it runs from
// `main`'s own copy in .github/workflows/sweep-scope.yml and before the routine pushes. Exit 2 is a
// usage error; a git failure exits with git's own message, never as a clean result.
import { spawnSync } from "node:child_process";
import {
  addedNetworkTokens,
  outOfScope,
  parseMayEdit,
  renderedLinkMarkup,
} from "./lib/sweep-scope.mjs";
const [base, head, ...extra] = process.argv.slice(2);
if (!base || !head || extra.length > 0) {
  console.error(
    "usage: node scripts/sweep-scope-check.mjs <base-commit> <head-commit>",
  );
  process.exit(2);
}
function git(...args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(
      `sweep-scope: git ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}
for (const commit of [base, head])
  git("rev-parse", "--verify", "--quiet", `${commit}^{commit}`);
// Two-dot `base head` would report every commit `main` gained after the branch point as if the
// branch had made it; the merge base isolates the branch's own changes.
const from = git("merge-base", base, head).trim();
const at = base.slice(0, 12);
const mayEdit = parseMayEdit(git("show", `${base}:docs/DOC-SWEEP.md`));
const failures = [];
// The sweep repairs existing documents: a modification is the only change it may make. A status of
// `M` names one path; every other status (added, deleted, renamed, copied, type-changed) is refused
// with every path it names.
const modified = [];
for (const entry of git("diff", "--name-status", from, head)
  .split("\n")
  .filter(Boolean)) {
  const [status, ...paths] = entry.split("\t");
  if (status === "M") modified.push(paths[0]);
  else
    failures.push(
      `${paths.join(" -> ")} is ${status.startsWith("R") ? "renamed" : status === "A" ? "added" : status === "D" ? "deleted" : `status ${status}`}; the sweep only modifies existing documents`,
    );
}
for (const path of outOfScope(modified, mayEdit)) {
  failures.push(
    `${path} is not in the may-edit column of docs/DOC-SWEEP.md at ${at}`,
  );
}
const diff = git("diff", from, head);
const tokens = addedNetworkTokens(diff);
for (const token of tokens) {
  const found = spawnSync(
    "git",
    ["grep", "--quiet", "--fixed-strings", "-e", token, base],
    { encoding: "utf8" },
  );
  if (found.status === 0) continue;
  if (found.status !== 1) {
    console.error(`sweep-scope: git grep failed: ${found.stderr.trim()}`);
    process.exit(found.status ?? 1);
  }
  failures.push(
    `${token} is added by this diff and appears nowhere in the tree at ${at}`,
  );
}
for (const fragment of renderedLinkMarkup(diff)) {
  failures.push(
    `${fragment} is markup GitHub would render into a link the text does not show`,
  );
}
if (failures.length > 0) {
  console.error(
    "sweep-scope: the sweep left its scope; nothing lands until the diff is confined to it:",
  );
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `sweep-scope: ${modified.length} modified path${modified.length === 1 ? "" : "s"}, all in the may-edit column; ` +
    `${tokens.length} network token${tokens.length === 1 ? "" : "s"} added, all already in the tree`,
);
