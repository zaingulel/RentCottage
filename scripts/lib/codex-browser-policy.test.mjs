// codex-browser-policy.test.mjs — the Codex browser permission policy.
//
// Codex prompts before a browser run under .codex/rules/playwright.rules; every prefix it allows
// runs without a prompt, so it must stay the real aggregate and Playwright command prefixes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const codexRules = readFileSync(
  resolve(ROOT, ".codex/rules/playwright.rules"),
  "utf8",
);

test("Codex browser permissions cover only the real aggregate and Playwright command prefixes", () => {
  for (const pattern of [
    '["npm", "run", "verify"]',
    '["npm", "run", "verify:access"]',
    '["npx", "--yes", "playwright"]',
  ]) {
    assert.equal(
      codexRules.split(`pattern = ${pattern}`).length - 1,
      1,
      `${pattern} permission count`,
    );
  }
  assert.doesNotMatch(
    codexRules,
    /pattern = \["npm", "run", "verify:preview"\]/,
  );
});
