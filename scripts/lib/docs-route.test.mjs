// docs-route.test.mjs: the product gate that admits a push to main only when every changed path is
// qualifying documentation or media. First the pure allowlist, then the real wire through git.
//
// Every path list is hand-written and the manifest list is fabricated: they are the oracle, so none
// is read from the classifier, the real manifest or a document.
//
// The wire tests push from a scratch clone to a scratch bare remote with the REAL .githooks/pre-push,
// scripts/gates/pre-push-main and docs-route.mjs copied in. Git's global and system config and every
// inherited GIT_* variable are shut out; the hook's lint gate meets a fake npm and its script suite
// meets the scratch repository's own single passing test, so this repository's suite never runs.
//
// The two fake-git tests run the gate outside any repository, because the failure each one needs
// cannot be staged through a real git.
//
// Recurring cost, on every run of the script suite: four scratch repositories, two hooked pushes of
// which one runs the scratch suite, and six direct gate runs.
// Removal condition: remove with scripts/gates/pre-push-main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docsRouteRefusals } from "./docs-route.mjs";
import { fixtureShell } from "./posix-shell.mjs";

const REASON = {
  location: /outside the documentation locations/,
  fileType: /not a documentation or media file type/,
  shared: /a shared factory file/,
};

// A fabricated manifest list, so the shared-file rule is proven to follow its argument.
const MANIFEST = [
  "AGENTS.md",
  "docs/research/shared-guide.md",
  "scripts/board.mjs",
];

// The index, each listed location and each admitted type.
const QUALIFYING = [
  "docs/README.md",
  "docs/commercial/Muntajaa-Cost-Plan.docx",
  "docs/design/visual-audit-2026-10/01-home.jpg",
  "docs/design/photo.webp",
  "docs/discovery/sketch.jpeg",
  "docs/engineering/Diagram.PNG",
  "docs/engineering/steps.gif",
  "docs/research/future-study.md",
  "docs/research/chart.svg",
];

// One path per kind of file that must never take the direct route, then lookalikes of a listed location.
const OUTSIDE = [
  // Guards.
  "scripts/lib/unsafe-git.mjs",
  ".claude/hooks/block-unsafe-git.mjs",
  ".codex/hooks/block-unsafe-git.mjs",
  // Hooks, the gate and its classifier.
  ".githooks/pre-push",
  ".githooks/README.md",
  "scripts/gates/pre-push-main",
  "scripts/lib/docs-route.mjs",
  // Permission files.
  ".claude/settings.json",
  ".codex/hooks.json",
  ".codex/rules/playwright.rules",
  // Seat files.
  ".claude/agents/builder.md",
  ".codex/agents/builder.toml",
  // The manifest, skills and templates.
  ".agents/factory-manifest.json",
  ".agents/skills/resume/SKILL.md",
  ".claude/skills/resume/SKILL.md",
  ".claude/templates/builder-handoff.md",
  // Scripts and tests.
  "scripts/verify.mjs",
  "package.json",
  "scripts/lib/docs-route.test.mjs",
  "tests/access.spec.ts",
  "supabase/tests/database/booking_quotes.test.sql",
  // Product files.
  "src/app/page.tsx",
  "supabase/migrations/20260908120000_booking_request_payment_history.sql",
  "supabase/schemas/50_privileges.sql",
  "custom-worker.ts",
  "wrangler.jsonc",
  "public/_headers",
  // Workflows.
  ".github/workflows/ci.yml",
  ".github/pull_request_template.md",
  // Root documents.
  "README.md",
  "CLAUDE.md",
  "GLOSSARY.md",
  "AGENTS.md",
  // Lookalikes of a listed location.
  "docsx/research/note.md",
  "src/docs/research/note.md",
  "public/docs/research/note.md",
  "Docs/research/note.md",
  "docs/Research/note.md",
  "docs/researchx/note.md",
  "docs/README.md.md",
  // Git prints a path that holds a line break quoted, with a leading double quote.
  '"docs/research/line\\nbreak.md"',
];

// Under docs/ but in no listed location: the instruction documents, the architecture decisions, the
// product agreement, and a new file and a new directory nobody has listed.
const UNLISTED_DOCUMENTS = [
  "docs/CODING-STANDARDS.md",
  "docs/TESTING-STRATEGY.md",
  "docs/DESIGN-SYSTEM.md",
  "docs/ISSUE-TRACKER.md",
  "docs/DOC-SWEEP.md",
  "docs/SWEEP-TRIAGE.md",
  "docs/demo.md",
  "docs/agents/domain.md",
  "docs/adr/0002-database-integrity-application-orchestration.md",
  "docs/adr/0003-future-decision.md",
  "docs/product/rentcottage-mvp-prd.md",
  "docs/product/RentCottage-MVP-PRD.docx",
  "docs/product/assets/journeys/RentCottage-Journey-1-How-a-cottage-becomes-available.png",
  "docs/new-note.md",
  "docs/operations/runbook.md",
];

// Copied by hand from the wide reach row of the Surfaces table in AGENTS.md, which
// scripts/lib/product-manual.test.mjs pins; a file added to that row is added here.
const WIDE_REACH = [
  "AGENTS.md",
  ".agents/REPOSITORY.md",
  "GLOSSARY.md",
  "docs/CODING-STANDARDS.md",
  "docs/TESTING-STRATEGY.md",
  "docs/DESIGN-SYSTEM.md",
  "docs/ISSUE-TRACKER.md",
];

function refusalReason(path, manifest = MANIFEST) {
  const refusals = docsRouteRefusals([path], manifest);
  assert.equal(refusals.length, 1, `${path} must be refused exactly once`);
  assert.equal(refusals[0].path, path);
  return refusals[0].reason;
}

test("qualifying documentation and media paths are admitted", () => {
  assert.deepEqual(docsRouteRefusals(QUALIFYING, MANIFEST), []);
});

test("a path outside the documentation locations is refused for its location", () => {
  for (const path of OUTSIDE)
    assert.match(refusalReason(path), REASON.location, path);
});

test("a document under docs/ outside the listed locations is refused for its location", () => {
  for (const path of UNLISTED_DOCUMENTS)
    assert.match(refusalReason(path), REASON.location, path);
});

// Inside a listed location, of a type that is neither documentation nor media.
const WRONG_TYPE = [
  "docs/research/x.js",
  "docs/research/runtime.mjs",
  "docs/engineering/run.sh",
  "docs/research/data.csv",
  "docs/research/config.json",
  "docs/design/page.html",
  "docs/research/notes.txt",
  "docs/commercial/deck.pdf",
  "docs/design/clip.mp4",
  "docs/design/image.avif",
  "docs/research/noextension",
  "docs/research/guide.md.sh",
];

test("a documentation path of a non-documentation type is refused for its file type", () => {
  for (const path of WRONG_TYPE)
    assert.match(refusalReason(path), REASON.fileType, path);
});

test("no file the wide reach row names is admitted", () => {
  // An empty manifest, so each refusal comes from the path rules and never from the shared-file rule.
  for (const path of WIDE_REACH) refusalReason(path, []);
});

test("a path the manifest lists is refused as a shared factory file", () => {
  assert.match(refusalReason("docs/research/shared-guide.md"), REASON.shared);
  const withoutManifest = docsRouteRefusals(
    ["docs/research/shared-guide.md"],
    [],
  );
  assert.deepEqual(
    withoutManifest,
    [],
    "the rule follows the manifest argument",
  );
});

const MIXED = [
  "docs/research/note.md",
  "src/x.js",
  "docs/research/shared-guide.md",
];

test("every refused path in a mixed list is named", () => {
  const refused = docsRouteRefusals(MIXED, MANIFEST).map(({ path }) => path);
  assert.deepEqual(refused, ["src/x.js", "docs/research/shared-guide.md"]);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHELL = fixtureShell();
const NO_SHELL = "a POSIX shell is required";
const MANIFEST_PATH = ".agents/factory-manifest.json";
const FIXTURE_MANIFEST = JSON.stringify({
  entries: MANIFEST.map((path) => ({ path })),
});
const PASSING_TEST = [
  'import { test } from "node:test";',
  'test("passes", () => {});',
  "",
].join("\n");

function executable(path, source) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

// The real gate and classifier beside a manifest the test controls.
function installGate(root, manifest) {
  const gate = "scripts/gates/pre-push-main";
  const classifier = "scripts/lib/docs-route.mjs";
  executable(join(root, gate), readFileSync(join(ROOT, gate)));
  mkdirSync(join(root, "scripts/lib"), { recursive: true });
  writeFileSync(join(root, classifier), readFileSync(join(ROOT, classifier)));
  mkdirSync(join(root, ".agents"));
  writeFileSync(join(root, MANIFEST_PATH), manifest);
}

// The inherited environment without Git's variables or the outer test runner's context, with `bin` first
// on PATH.
function scratchEnvironment(bin) {
  const dropped = /^(GIT_.*|NODE_TEST_CONTEXT|PATH)$/i;
  const kept = Object.entries(process.env).filter(
    ([key]) => !dropped.test(key),
  );
  return {
    ...Object.fromEntries(kept),
    PATH: `${bin}${delimiter}${process.env.PATH}`,
  };
}

// A scratch clone armed with the real hook and gate, and the scratch bare remote it pushes to.
function withScratchRemote(fn) {
  // realpath: on macOS tmpdir() is a symlink, and git reports the resolved path.
  const root = mkdtempSync(join(realpathSync(tmpdir()), "docs-route-"));
  try {
    const bin = join(root, "bin");
    executable(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
    const env = {
      ...scratchEnvironment(bin),
      HOME: root,
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.dev",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.dev",
    };
    const remote = join(root, "remote.git");
    const repo = join(root, "repo");
    const git = (cwd, ...args) => {
      const run = spawnSync("git", args, { cwd, env, encoding: "utf8" });
      assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
      return run.stdout.trim();
    };
    const write = (path) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), `${path}\n`);
    };
    git(root, "init", "-q", "--bare", "-b", "main", remote);
    git(root, "init", "-q", "-b", "main", repo);
    executable(
      join(repo, ".githooks/pre-push"),
      readFileSync(join(ROOT, ".githooks/pre-push")),
    );
    installGate(repo, FIXTURE_MANIFEST);
    writeFileSync(join(repo, "scripts/lib/pass.test.mjs"), PASSING_TEST);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "seed");
    git(repo, "remote", "add", "origin", remote);
    // Seeded before the hook is armed: creating main is never the gate's route.
    git(repo, "push", "-q", "origin", "HEAD:main");
    git(repo, "config", "core.hooksPath", ".githooks");
    fn({
      commit: (paths) => {
        paths.forEach((path) => write(path));
        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "change");
        return git(repo, "rev-parse", "HEAD");
      },
      gate: (before, after) => {
        assert.ok(SHELL, NO_SHELL);
        return spawnSync(
          SHELL,
          ["scripts/gates/pre-push-main", before, after],
          { cwd: repo, env, encoding: "utf8" },
        );
      },
      push: () =>
        spawnSync("git", ["push", "origin", "HEAD:main"], {
          cwd: repo,
          env,
          encoding: "utf8",
        }),
      remoteMain: () => git(remote, "rev-parse", "refs/heads/main"),
      repo,
      reset: (ref) => git(repo, "reset", "-q", "--hard", ref),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The real gate over a fake git, outside any repository. The fake answers the fast-forward check with
// success and the path listing with one qualifying path and the given exit status; anything else fails.
function gateOverFakeGit({ diffStatus, manifest }) {
  assert.ok(SHELL, NO_SHELL);
  const root = mkdtempSync(join(realpathSync(tmpdir()), "docs-route-"));
  try {
    const bin = join(root, "bin");
    const fakeGit = [
      "#!/bin/sh",
      'for arg in "$@"; do',
      "  case $arg in",
      "    (merge-base) exit 0 ;;",
      `    (diff) echo docs/research/note.md; exit ${diffStatus} ;;`,
      "  esac",
      "done",
      "exit 2",
      "",
    ].join("\n");
    executable(join(bin, "git"), fakeGit);
    installGate(root, manifest);
    const shas = ["1".repeat(40), "2".repeat(40)];
    return spawnSync(SHELL, ["scripts/gates/pre-push-main", ...shas], {
      cwd: root,
      env: scratchEnvironment(bin),
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the gate refuses when listing the changed paths fails", () => {
  const run = gateOverFakeGit({
    diffStatus: 1,
    manifest: JSON.stringify({ entries: [] }),
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /listing the changed paths failed/);
});

test("the gate refuses when the manifest cannot be read", () => {
  // The one listed path qualifies, so a classifier that read a malformed manifest as an empty list would
  // admit it and the gate would refuse only later, with a different message.
  const run = gateOverFakeGit({ diffStatus: 0, manifest: '{"entries":[{}]}' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /\.agents\/factory-manifest\.json/);
  assert.match(run.stderr, /pull request route/);
  assert.doesNotMatch(run.stderr, /not the checked-out content/);
});

test("a docs-only push to main is admitted", () => {
  withScratchRemote(({ commit, push, remoteMain }) => {
    const head = commit(["docs/design/shot.png", "docs/research/note.md"]);
    const run = push();
    assert.equal(run.status, 0, run.stderr);
    assert.equal(remoteMain(), head);
  });
});

test("a push to main the gate refuses is blocked by the pre-push hook", () => {
  withScratchRemote(({ commit, push, remoteMain }) => {
    const seed = remoteMain();
    commit([
      "docs/research/note.md",
      "src/x.js",
      "docs/research/shared-guide.md",
    ]);
    const run = push();
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /src\/x\.js/);
    assert.match(
      run.stderr,
      /docs\/research\/shared-guide\.md: a shared factory file/,
    );
    assert.doesNotMatch(run.stderr, /docs\/research\/note\.md/);
    assert.match(run.stderr, /pull request route/);
    assert.equal(remoteMain(), seed);
  });
});

test("a non-fast-forward of main is refused by the gate", () => {
  withScratchRemote(({ commit, gate, remoteMain, reset }) => {
    const seed = remoteMain();
    const first = commit(["docs/research/first.md"]);
    reset(seed);
    const second = commit(["docs/research/second.md"]);
    const run = gate(first, second);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /not a fast-forward/);
    assert.match(run.stderr, /pull request route/);
  });
});

test("the gate refuses a push whose content is not the clean checked-out tree", () => {
  withScratchRemote(({ commit, gate, remoteMain, repo, reset }) => {
    const seed = remoteMain();
    const head = commit(["docs/research/note.md"]);
    const admitted = gate(seed, head);
    assert.equal(admitted.status, 0, admitted.stderr);

    writeFileSync(join(repo, "docs/research/note.md"), "edited\n");
    const dirty = gate(seed, head);
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /uncommitted changes/);

    reset(seed);
    const elsewhere = gate(seed, head);
    assert.notEqual(elsewhere.status, 0);
    assert.match(elsewhere.stderr, /not the checked-out content/);
  });
});
