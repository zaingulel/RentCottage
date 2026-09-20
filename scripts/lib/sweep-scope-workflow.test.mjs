// sweep-scope-workflow.test.mjs — the safe shape required before the tracked `sweep-scope` workflow is activated in
// .github/workflows/sweep-scope.yml.
//
// The check judges a pull request the sweep opened and lands itself, so the enforcer must not come
// from the pull request it judges: the workflow runs on pull_request_target, checks out the base
// branch, executes nothing from the pull request's tree, and passes at once off a sweep or triage
// branch so branch protection can require it. Each assertion goes red if the corresponding line is removed
// (`docs/engineering/testing-strategy.md`, a deterministic guard over the committed bytes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const WORKFLOW = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.github/workflows/sweep-scope.yml",
  ),
  "utf8",
);
test("the check runs from the base branch on pull_request_target, on every pull request event the suite uses", () => {
  assert.match(
    WORKFLOW,
    /^on:\n  pull_request_target:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n/m,
  );
  assert.doesNotMatch(
    WORKFLOW,
    /^\s+ref:/m,
    "a ref on the checkout would fetch the pull request's tree",
  );
  assert.match(WORKFLOW, /fetch-depth: 0/);
});
test("the check executes nothing from the pull request and holds a read-only token", () => {
  assert.match(WORKFLOW, /^permissions:\n  contents: read$/m);
  assert.equal(
    (WORKFLOW.match(/^    permissions:/gm) ?? []).length,
    0,
    "no job may widen the token",
  );
  assert.doesNotMatch(WORKFLOW, /npm (ci|install|run)|npx|secrets\./);
  assert.match(WORKFLOW, /persist-credentials: false/);
  assert.match(
    WORKFLOW,
    /node scripts\/sweep-scope-check\.mjs "\$BASE_SHA" "\$HEAD_SHA"/,
  );
});
// The run block is executed, not pattern-matched, for the branch it can decide without git.
function runBlock() {
  const m = WORKFLOW.match(/run: \|\n([\s\S]*?)(?=\n\S|$)/);
  assert.ok(m, "the check step must have a run block");
  return m[1].replace(/^ {10}/gm, "");
}
test("a pull request off a sweep or triage branch passes at once, so requiring the check never blocks ordinary work", () => {
  const result = spawnSync("bash", ["-c", runBlock()], {
    env: {
      ...process.env,
      HEAD_REF: "job/1227",
      HEAD_SHA: "unused",
      BASE_SHA: "unused",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /job\/1227 is not a sweep or triage branch/);
});
// The triage lands on the same allowlist as the sweep, so a triage branch must reach the check:
// a gate that only knew the sweep's prefix would let a triage pull request through unjudged.
for (const head of ["docs-sweep/2026-09-14", "docs-triage/2026-09-15"]) {
  test(`a ${head.split("/")[0]} branch whose head is missing fails loud instead of passing on an empty check`, () => {
    const result = spawnSync("bash", ["-c", runBlock()], {
      env: {
        ...process.env,
        HEAD_REF: head,
        HEAD_SHA: "0".repeat(40),
        BASE_SHA: "unused",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /was not fetched/);
  });
}
