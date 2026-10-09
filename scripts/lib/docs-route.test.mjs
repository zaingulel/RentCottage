// docs-route.test.mjs: the path definition of the direct route to main, a fail-closed allowlist.
//
// Every path list is hand-written and the manifest list is fabricated: they are the oracle, so none
// is read from the classifier, the real manifest or a document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { docsRouteRefusals } from "./docs-route.mjs";

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
